/**
 * The media server down: everything paused, one check every 10 minutes, and
 * everything the outage held resumed, in order, once it answers.
 *
 * The operator (2026-11-15): "If the Jellyfin server goes down, the box
 * should say let's pause everything for now and try again in 10 minutes.
 * Any requests or items in the queue that got interrupted should auto-resume
 * once the server is back up. If it's still down at the 10-minute check,
 * check again in another 10 minutes. It usually stays offline for about 10
 * minutes when it goes down. The box should not keep retrying."
 *
 * What it replaced. A Jellyfin that stopped answering was met by every part
 * of the bot on its own: each failed job retried at 30 s, 1 min and 2 min
 * (media/resume.js RetryBook), then was parked until the next restart; each
 * new request was looked up, failed and answered ⚠️; the wanted recheck
 * looked every open film up, one failure each. On 2026-11-10 Jellyfin
 * answered 500 from 18:10 to 18:17 New York time and fourteen requests were
 * left part-posted. Ten minutes of outage spent every retry a job had, so
 * nothing came back by itself when the server did.
 *
 * HOW IT WORKS. Every request the bot makes to the media server goes through
 * one place: installFetchGuard() wraps the process's fetch, and a URL on the
 * media server's host (the configured Jellyfin, Plex or HTTP library) is
 * watched there. Nothing else is touched - OMDb, the AI providers, public
 * links and WhatsApp go straight through.
 *
 *   - A failure that means the server is down (connection refused, reset or
 *     timed out, a name that does not resolve, HTTP 5xx) is confirmed with
 *     one cheap request (Jellyfin's /System/Info/Public). If that fails too,
 *     the outage begins. One confirmed failure is enough. A 404 or "not
 *     found" is never an outage, and a 401/403 is a settings problem, logged
 *     as one and never looped on.
 *   - While it is down, every request to the server fails at once, without
 *     touching the network, with "could not reach the library: the media
 *     server is down", which media/resume.js already counts as transient.
 *     So the only thing that reaches the server is the scheduled check.
 *   - The queue is paused (nothing new starts), unless it already was. A job
 *     that was running finishes what does not need the server - an encode or
 *     an upload - and a job that needed it fails, and waits for the server
 *     (RetryBook), keeping its download's partial file to resume from.
 *   - A request that arrives is held like a paused request
 *     (src/core/request-pause.js): ⏸️, a reply saying the server is down and
 *     the request will run when it is back, and it waits.
 *   - A check is booked for 10 minutes after the outage began, and for 10
 *     minutes after each check that finds the server still down. Never
 *     faster. The panel's "Check now" makes one more check and leaves the
 *     schedule alone.
 *   - When the server answers, the jobs that failed for it go back in the
 *     queue first, one at a time in the order they failed, then the queue
 *     resumes (only if the outage paused it), then the held requests run in
 *     the order they came.
 *
 * NOT TOUCHED: the queue's own Pause, requests paused from the panel, and
 * anything that failed for another reason. A queue paused by hand stays
 * paused when the server comes back, and requests held by a manual pause
 * stay held until the admin resumes them.
 *
 * One WhatsApp message when it goes down and one when it comes back, to the
 * movie notifications group, never one per check. A log line on each check.
 *
 * Kept in data/state.json, so a restart in the middle of an outage stays
 * paused, keeps the same next check and forgets nothing:
 *
 *   "server-outage": { "state": { "down": true, "since": <ms>, "nextCheck": <ms>,
 *     "reason": "...", "pausedQueue": true, "toldDown": true, "checks": 2,
 *     "lastCheck": <ms>, "items": [ { "place", "label", "state", "pct" } ] } }
 */
import { EventEmitter } from 'node:events';
import log from '../util/logger.js';

const logger = log.scope('server-outage');

export const NAMESPACE = 'server-outage';
/** The operator's figure: "check every 10 minutes until the server answers". */
export const CHECK_EVERY_MS = 10 * 60_000;
/** How long the check, and the one that confirms an outage, waits for an answer. */
export const PROBE_TIMEOUT_MS = 15_000;
/** The error code a request refused during an outage carries. */
export const DOWN_CODE = 'MEDIA_SERVER_DOWN';

/** "14:02", on the 24-hour clock (CLAUDE.md, house style). */
export function clock(ts) {
  if (!Number.isFinite(ts)) return '?';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

// Network failures that mean nothing answered: Node's own codes and undici's.
const DOWN_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EHOSTDOWN',
  'ENETUNREACH', 'ENETDOWN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED',
]);

// The same failures as the bot's own code words them: library.js
// fetchWithTimeout ("Nothing is listening at", "Could not resolve", "did not
// respond within 30s"), download.js ("download failed: HTTP 502", "ended
// early"), and undici's "fetch failed" / "terminated" / "socket hang up".
const DOWN_TEXT = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|\bterminated\b|Nothing is listening|Could not resolve|Could not reach|did not respond within|timed? ?out|ended early|HTTP 5\d\d\b/i;
const CONFIG_TEXT = /HTTP 40[13]\b|Unauthori[sz]ed|Forbidden/i;

/** Was a request aborted by its own timeout, rather than cancelled? */
function timedOut(reason) {
  if (!reason) return false;
  return reason.name === 'TimeoutError' || /^timeout$|timed? ?out/i.test(String(reason.message ?? reason));
}

/**
 * What a failure says about the server: 'outage' (it is down), 'config' (it
 * answered, and refused the bot's credentials) or null (anything else: a
 * 404, a title not found, a bad request, a cancel).
 *
 * @param {{ err?: any, status?: number }} f
 */
export function classifyFailure({ err = null, status = null } = {}) {
  if (Number.isFinite(status)) {
    if (status >= 500 && status <= 599) return 'outage';
    if (status === 401 || status === 403) return 'config';
    return null;
  }
  if (!err) return null;
  if (err.code === DOWN_CODE) return 'outage';
  // A cancel is the bot's own doing, never the server's - unless it was a
  // timeout, which library.js aborts with.
  if (err.name === 'AbortError' && !timedOut(err.cause ?? err)) return null;
  if (/operation was aborted|cancelled/i.test(err.message ?? '') && !timedOut(err.cause)) return null;
  const code = err.cause?.code ?? err.code ?? err.cause?.cause?.code ?? null;
  if (code && DOWN_CODES.has(code)) return 'outage';
  const text = `${err.message ?? ''} ${err.cause?.message ?? ''}`;
  if (CONFIG_TEXT.test(text)) return 'config';
  if (DOWN_TEXT.test(text) || timedOut(err)) return 'outage';
  return null;
}

/** A request refused, without touching the network, because the server is down. */
export class ServerDownError extends Error {
  constructor(st) {
    // "could not reach the library" is in media/resume.js TRANSIENT_ERROR: a
    // job refused this way waits for the server rather than failing for good.
    super(`could not reach the library: the media server is down (since ${clock(st?.since)}, next check ${clock(st?.nextCheck)})`);
    this.name = 'ServerDownError';
    this.code = DOWN_CODE;
  }
}

/** The hosts (host:port) the library is reached at, from the live config. */
export function libraryHosts(libraryCfg) {
  const out = new Set();
  const add = (u) => {
    if (!u) return;
    try { out.add(new URL(String(u)).host.toLowerCase()); } catch { /* not a URL: nothing to watch */ }
  };
  const lib = libraryCfg ?? {};
  // Jellyfin is where films are downloaded from as well as looked up, so it
  // is watched whatever the search goes through.
  add(lib.jellyfin?.baseUrl);
  if (lib.provider === 'plex') add(lib.plex?.baseUrl);
  if (lib.provider === 'http') add(lib.http?.searchUrl);
  return out;
}

/** The cheap request that says whether the library answers, for the provider in use. */
export function probeUrl(libraryCfg) {
  const lib = libraryCfg ?? {};
  const base = (u) => String(u ?? '').trim().replace(/\/+$/, '');
  if (lib.provider === 'plex' && lib.plex?.baseUrl) return `${base(lib.plex.baseUrl)}/identity`;
  if (lib.provider === 'http' && lib.http?.searchUrl) {
    try { return new URL(lib.http.searchUrl).origin + '/'; } catch { return null; }
  }
  if (lib.jellyfin?.baseUrl) return `${base(lib.jellyfin.baseUrl)}/System/Info/Public`;
  return null;
}

/**
 * Ask the server once. Resolves { up: true } on any answer below 500 (the
 * endpoint needs no sign-in, so a 401 still means it is there), or
 * { up: false, why } on anything else. Never rejects.
 */
export async function probeServer(url, { fetchImpl, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!url) return { up: true, why: 'no library to check' };
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    try { await res.body?.cancel?.(); } catch { /* nothing left to read */ }
    if (res.status >= 500) return { up: false, why: `HTTP ${res.status}` };
    return { up: true, status: res.status };
  } catch (err) {
    const code = err?.cause?.code ?? err?.code;
    const why = timedOut(err) ? `no answer within ${Math.round(timeoutMs / 1000)}s`
      : code === 'ECONNREFUSED' ? 'connection refused'
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'its name does not resolve'
          : code === 'ECONNRESET' ? 'connection reset'
            : (err?.cause?.message ?? err?.message ?? String(err));
    return { up: false, why };
  }
}

const OFF = Object.freeze({ down: false });

/** The stored state, or "up" for anything else. */
export function normalState(v) {
  if (!v || typeof v !== 'object' || v.down !== true) return { ...OFF };
  return {
    down: true,
    since: Number.isFinite(v.since) ? v.since : null,
    nextCheck: Number.isFinite(v.nextCheck) ? v.nextCheck : null,
    reason: typeof v.reason === 'string' ? v.reason : null,
    pausedQueue: v.pausedQueue === true,
    toldDown: v.toldDown === true,
    checks: Number.isFinite(v.checks) ? v.checks : 0,
    lastCheck: Number.isFinite(v.lastCheck) ? v.lastCheck : null,
    lastWhy: typeof v.lastWhy === 'string' ? v.lastWhy : null,
    items: Array.isArray(v.items) ? v.items : [],
  };
}

// The one watch of this process, for the code that has no ctx to be handed
// it: media/resume.js RetryBook, which both plugins create.
let current = null;
export function currentOutage() { return current; }

export class OutageWatch extends EventEmitter {
  /**
   * @param store        the 'server-outage' namespace of the state store
   * @param queue        the media queue, paused while the server is down
   * @param requestPause the request pause: its held list carries the
   *                     requests that arrive meanwhile, and its queue Pause
   *                     is the admin's, never undone here
   * @param bot          for the down and up messages
   * @param getConfig    the live config: the library's address, the group
   * @param probe        (libraryCfg) => Promise<{up, why}>, the check
   * @param now/setTimer/clearTimer  the clock, for tests
   */
  constructor({
    store, queue = null, requestPause = null, bot = null, getConfig = () => ({}), probe = null,
    now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
    everyMs = CHECK_EVERY_MS,
  }) {
    super();
    this.store = store;
    this.queue = queue;
    this.requestPause = requestPause;
    this.bot = bot;
    this.getConfig = getConfig;
    this.probe = probe ?? ((lib) => probeServer(probeUrl(lib), { fetchImpl: rawFetch }));
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.everyMs = everyMs;
    this._timer = null;
    this._confirming = null;
    this._checking = null;
    this._waiters = [];          // jobs waiting for the server, in the order they failed
    this._configWarnedAt = 0;
    this.recovering = null;
  }

  /** This watch is the process's (RetryBook asks for it). */
  makeCurrent() { current = this; return this; }

  state() { return normalState(this.store.get('state', null)); }
  isDown() { return this.state().down; }

  _save(st) {
    this.store.set('state', st);
    // On the disk before anything else happens: a restart in the next half
    // second must not forget an outage, or the schedule.
    try { this.store.flush?.(); } catch (err) { logger.warn(`could not write the outage state now: ${err.message}`); }
  }

  _changed() { this.emit('change', this.snapshot()); }

  /** Is this URL on the media server? */
  covers(url) {
    let host;
    try { host = new URL(String(url)).host.toLowerCase(); } catch { return false; }
    return libraryHosts(this.getConfig()?.library).has(host);
  }

  /** Before a request to the server: refused at once while it is down. */
  guard(url) {
    const st = this.state();
    if (st.down && this.covers(url)) throw new ServerDownError(st);
  }

  /**
   * After a request to the server: a failure that means it is down is
   * confirmed, and begins the outage; a refused sign-in is logged as a
   * settings problem, at most every ten minutes.
   */
  observe(url, failure) {
    if (!this.covers(url)) return null;
    const kind = classifyFailure(failure);
    if (kind === 'config') {
      if (this.now() - this._configWarnedAt > this.everyMs) {
        this._configWarnedAt = this.now();
        logger.warn(`the media server refused the bot's sign-in (${failure.status ? `HTTP ${failure.status}` : failure.err?.message}) - `
          + 'a settings problem (Settings -> Library), not an outage: nothing is paused');
      }
      return null;
    }
    if (kind !== 'outage') return null;
    const why = failure.status ? `HTTP ${failure.status}` : (failure.err?.cause?.code ?? failure.err?.message ?? 'no answer');
    return this.suspect(why);
  }

  /**
   * Something failed the way an outage does: confirm it with one check, and
   * begin the outage if that fails too. One at a time: twenty failures in
   * the same second are one check. Resolves true when the server is down.
   */
  suspect(why) {
    if (this.isDown()) return Promise.resolve(true);
    if (this._confirming) return this._confirming;
    const lib = this.getConfig()?.library;
    if (!probeUrl(lib)) return Promise.resolve(false);
    this._confirming = (async () => {
      try {
        const r = await this.probe(lib);
        if (r?.up) {
          logger.info(`a request to the media server failed (${why}), but it answers a check - not an outage`);
          return false;
        }
        this.goDown(`${why}${r?.why && r.why !== why ? `; the check: ${r.why}` : ''}`);
        return true;
      } catch (err) {
        logger.warn(`could not check the media server: ${err.message}`);
        return false;
      } finally {
        this._confirming = null;
      }
    })();
    return this._confirming;
  }

  /** The outage begins. */
  goDown(reason) {
    if (this.isDown()) return this.state();
    const now = this.now();
    const pausedQueue = !!this.queue && !this.queue.paused;
    const items = this._itemsNow();
    const st = {
      down: true, since: now, nextCheck: now + this.everyMs, reason: String(reason ?? 'no answer').slice(0, 300),
      pausedQueue, toldDown: false, checks: 0, lastCheck: now, lastWhy: String(reason ?? '').slice(0, 300), items,
    };
    this._save(st);
    if (pausedQueue) this.queue.pause();
    logger.warn(`⛔ the media server is DOWN (${st.reason}) - pausing everything for now and checking again at ${clock(st.nextCheck)}`
      + `${pausedQueue ? '; the queue is paused' : '; the queue was already paused'}`
      + `${items.length ? `; ${items.length} item(s) in the queue held: ${items.map((i) => `${i.place}. ${i.label} (${i.state}${i.pct != null ? `, ${i.pct}%` : ''})`).join(', ')}` : ''}`);
    this._arm();
    this._changed();
    this._tellDown();
    return st;
  }

  /** What was in the queue when it went down: place, label, state, how far. */
  _itemsNow() {
    try {
      const snap = this.queue?.snapshot?.();
      if (!snap) return [];
      const run = (snap.active ?? []).map((v) => ({ label: v.label, state: 'running', pct: v.progress?.pct ?? null, stage: v.progress?.stage ?? null }));
      const wait = (snap.pending ?? []).map((v) => ({ label: v.label, state: 'waiting', pct: null }));
      return [...run, ...wait].slice(0, 200).map((it, i) => ({ place: i + 1, ...it }));
    } catch { return []; }
  }

  /** Book the next check, at nextCheck - never sooner. */
  _arm() {
    if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
    const st = this.state();
    if (!st.down) return;
    const wait = Math.max(0, (st.nextCheck ?? this.now()) - this.now());
    this._timer = this.setTimer(() => { this._timer = null; this.check({ manual: false }); }, wait);
    this._timer?.unref?.();
  }

  /**
   * One check. Booked: still down books the next one 10 minutes on. From the
   * panel's "Check now" (`manual`): the schedule is left as it was. Up, either
   * way: everything the outage held is resumed.
   */
  check({ manual = false } = {}) {
    if (this._checking) return this._checking;
    this._checking = (async () => {
      const st = this.state();
      if (!st.down) return { down: false };
      let r;
      try { r = await this.probe(this.getConfig()?.library); } catch (err) { r = { up: false, why: err.message }; }
      const now = this.now();
      if (r?.up) {
        logger.info(`media server check at ${clock(now)}${manual ? ' (Check now)' : ''}: UP - down since ${clock(st.since)}`);
        // Not awaited: putting the jobs back and running the held requests
        // is paced and can take minutes, and "Check now" answers at once.
        // `recovering` is the promise, for whoever wants to wait (the tests).
        this.recovering = this.goUp()
          .catch((err) => logger.error(`resuming after the outage: ${err.message}`))
          .finally(() => { this.recovering = null; });
        return { down: false };
      }
      const next = manual ? st.nextCheck : now + this.everyMs;
      this._save({ ...this.state(), nextCheck: next, checks: st.checks + 1, lastCheck: now, lastWhy: String(r?.why ?? '').slice(0, 300) });
      logger.warn(`media server check at ${clock(now)}${manual ? ' (Check now)' : ''}: still DOWN (${r?.why ?? 'no answer'}) - `
        + `down since ${clock(st.since)}, next check ${clock(next)}`);
      if (!manual) this._arm();
      this._changed();
      return { down: true, nextCheck: next };
    })().finally(() => { this._checking = null; });
    return this._checking;
  }

  /**
   * A job that failed for the server, waiting for it (RetryBook). `go` runs
   * the job's retry and resolves once it is back in the queue; `signal`
   * takes it off the list (the job cancelled meanwhile).
   */
  waitForServer({ key, go, signal = null }) {
    const w = { key, go, signal };
    this._waiters.push(w);
    signal?.addEventListener?.('abort', () => {
      this._waiters = this._waiters.filter((x) => x !== w);
      this._changed();
    }, { once: true });
    logger.info(`${key} waits for the media server (${this._waiters.length} waiting)`);
    this._changed();
  }

  /** How many are held by the outage: jobs waiting for it, the queue's waiting, requests held. */
  heldCount() {
    let n = this._waiters.length;
    try { n += this.queue?.waitingCount?.() ?? 0; } catch { /* a queue that cannot count */ }
    try { n += this._heldRequests(); } catch { /* none */ }
    return n;
  }

  _heldRequests() {
    const rp = this.requestPause;
    if (!rp?._held) return 0;
    return rp._held().filter((it) => it.reason === 'server-down').length;
  }

  /** The server answers: resume what the outage held, and only that. */
  async goUp() {
    const st = this.state();
    if (!st.down) return;
    if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
    const resumed = this.heldCount();
    const mins = st.since ? Math.max(1, Math.round((this.now() - st.since) / 60_000)) : null;
    this._save({ down: false });
    this._changed();
    // 1. The jobs that failed for the server, back in the queue first, one at
    //    a time in the order they failed: they were running, ahead of all
    //    that waits. The queue is still paused, so none starts before its
    //    place is taken.
    const waiters = this._waiters.splice(0);
    for (const w of waiters) {
      if (w.signal?.aborted) continue;
      try { await w.go(); } catch (err) { logger.warn(`${w.key}: could not go back in the queue: ${err.message}`); }
    }
    // 2. The queue, only if the outage paused it and nobody has paused it by
    //    hand since (the queue's own Pause, or a request pause that took it).
    const manual = this.requestPause?.queueState?.().paused === true;
    if (st.pausedQueue && !manual && this.queue?.paused) this.queue.resume();
    logger.warn(`▶️ the media server is back after ${mins ?? '?'} min - resuming ${resumed} held`
      + `${st.pausedQueue ? (manual ? '; the queue stays paused (paused by hand)' : '; the queue resumes') : '; the queue was paused before, and stays so'}`);
    this._changed();
    this._tellUp(resumed);
    // 3. The requests that came in meanwhile, in the order they came. Not if
    //    requests are paused by hand: theirs is the admin's Resume.
    try { await this.requestPause?.replay?.(); } catch (err) { logger.error(`held requests: ${err.message}`); }
    this._changed();
  }

  /**
   * At start-up, before any plugin loads: an outage the last process was in
   * is still on. The queue stays paused, the same next check is kept (or
   * made at once, if it fell due while the bot was stopped).
   */
  restore() {
    const st = this.state();
    if (!st.down) return st;
    if (st.pausedQueue && this.queue && !this.queue.paused) this.queue.pause();
    logger.warn(`⛔ the media server has been down since ${clock(st.since)} (${st.reason ?? '?'}) - still paused, `
      + `next check ${clock(st.nextCheck)}`);
    this._arm();
    return st;
  }

  stop() { if (this._timer) { this.clearTimer(this._timer); this._timer = null; } }

  /** For the panel's banner. */
  snapshot() {
    const st = this.state();
    if (!st.down) return { down: false, checking: !!this._checking };
    return {
      down: true, since: st.since, nextCheck: st.nextCheck, reason: st.reason, lastCheck: st.lastCheck,
      lastWhy: st.lastWhy, checks: st.checks, held: this.heldCount(), pausedQueue: st.pausedQueue,
      checking: !!this._checking,
    };
  }

  _group() { return this.getConfig()?.movieRequests?.notify?.group || null; }

  async _send(text) {
    const group = this._group();
    if (!group || !this.bot?.sendText) return false;
    if (this.bot.isConnected?.() === false) return false;
    try {
      await this.bot.sendText(group, text, { kind: 'critical' });
      return true;
    } catch (err) {
      logger.warn(`could not tell the group: ${err.message}`);
      return false;
    }
  }

  async _tellDown() {
    const st = this.state();
    if (!st.down || st.toldDown) return;
    // Marked first: one message, however the send goes.
    this._save({ ...st, toldDown: true });
    await this._send(`⛔ The media server isn't answering (since ${clock(st.since)}). Pausing everything for now `
      + `and trying again at ${clock(st.nextCheck)}. Requests sent meanwhile are kept and run by themselves when it's back.`);
  }

  async _tellUp(n) {
    await this._send(`▶️ Server's back, resuming ${n} request${n === 1 ? '' : 's'}.`);
  }
}

// The process's own fetch, before the guard wraps it: the check must reach
// the server while every other request to it is refused.
const rawFetch = (...a) => (originalFetch ?? globalThis.fetch)(...a);
let originalFetch = null;

/**
 * Every request the process makes to the media server, through the watch:
 * refused at once while it is down, and its failures watched. Installed once,
 * by src/index.js. Anything not on the media server's host goes straight
 * through, untouched.
 */
export function installFetchGuard(watch) {
  if (originalFetch) return () => {};
  originalFetch = globalThis.fetch;
  const inner = originalFetch;
  globalThis.fetch = async function guardedFetch(input, init) {
    let url;
    try { url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input); }
    catch { url = ''; }
    if (!watch.covers(url)) return inner(input, init);
    watch.guard(url);
    try {
      const res = await inner(input, init);
      if (res.status >= 500 || res.status === 401 || res.status === 403) {
        Promise.resolve(watch.observe(url, { status: res.status })).catch(() => {});
      }
      return res;
    } catch (err) {
      const signal = init?.signal ?? input?.signal;
      // A cancel is not the server's doing; a timeout is.
      if (!signal?.aborted || timedOut(signal.reason)) {
        Promise.resolve(watch.observe(url, { err: signal?.aborted ? Object.assign(new Error('timeout'), { name: 'TimeoutError' }) : err })).catch(() => {});
      }
      throw err;
    }
  };
  return () => { globalThis.fetch = inner; originalFetch = null; };
}
