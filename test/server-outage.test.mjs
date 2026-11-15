/* The media server down: everything paused, one check every 10 minutes, and what it held resumed in order.
   Run: node test/server-outage.test.mjs

   The operator's request (2026-11-15): "If the Jellyfin server goes down, the
   box should say let's pause everything for now and try again in 10 minutes.
   Any requests or items in the queue that got interrupted should auto-resume
   once the server is back up. If it's still down at the 10-minute check,
   check again in another 10 minutes ... The box should not keep retrying."

   The incident behind it: on 2026-11-10 Jellyfin answered 500 from 18:10 to
   18:17 New York time. Every failed job retried at 30 s, 1 min and 2 min,
   spent its attempts inside the outage and was parked until the next
   restart; fourteen requests were left part-posted, and a request that
   arrived meanwhile was answered ⚠️ and lost.

   Pinned here, with a fake clock and a fake server (nothing waits for real):
   1. a server error pauses the queue and holds what is in it, and nothing
      new starts;
   2. still down at the check, the next is booked exactly 10 minutes on, and
      nothing else reaches the server in between;
   3. back up, only what the outage held resumes, in order - a queue paused
      by hand and requests paused by hand stay as they were;
   4. a 404 or "not found" is no outage, and a 401/403 is a settings problem;
   5. a restart in the middle keeps the pause, the schedule and the held;
   6. one WhatsApp message when it goes down and one when it is back. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobQueue } from '../src/core/queue.js';
import { RequestPause } from '../src/core/request-pause.js';
import {
  OutageWatch, classifyFailure, installFetchGuard, ServerDownError, libraryHosts, probeUrl, CHECK_EVERY_MS,
} from '../src/core/server-outage.js';
import { RetryBook, isTransient } from '../src/media/resume.js';
import { WantedRecheck } from '../src/core/wanted-recheck.js';
import log from '../src/util/logger.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
log.setLevel?.('error');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'server-outage-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

const JF = 'http://jelly.example:8096';
const ADMINS = 'admins@g.us';
const MOVIES = 'movies@g.us';
const MIN = 60_000;

/** A namespace like the state store's, in memory. */
function memStore(data = {}) {
  return {
    _data: data,
    get: (k, d = null) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; return v; },
    delete: (k) => { delete data[k]; },
    push: (k, v, cap = 200) => { (data[k] ??= []).unshift(v); if (data[k].length > cap) data[k].length = cap; },
    flush: () => true,
  };
}

function fakeBot(out = []) {
  return {
    out,
    isConnected: () => true,
    react: async (msg, emoji) => { out.push({ op: 'react', on: msg.id, emoji }); return true; },
    sendText: async (jid, text, opts = {}) => { out.push({ op: 'text', jid, text, quoted: opts.quoted?.id ?? null }); return { key: { id: `B${out.length}` } }; },
    async _bulkPace() {},
    on() {}, off() {},
  };
}

const CONFIG = {
  library: { provider: 'jellyfin', jellyfin: { baseUrl: JF } },
  movieRequests: { notify: { group: ADMINS }, reactions: { failed: '⚠️', paused: '⏸️' } },
};

/** A fake clock: timers fire only when the test moves time on. */
function fakeClock(start = Date.UTC(2026, 10, 15, 13, 0)) {
  let t = start;
  let timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { timers = timers.filter((x) => x !== h); },
    pending: () => timers.map((h) => h.at),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((h) => h !== due);
        t = due.at;
        due.fn();
        await settle();
      }
      t = end;
      await settle();
    },
  };
}

/** A fake media server: up or down, and every check it was asked. */
function fakeServer() {
  const s = {
    up: false,
    probes: [],
    probe: async () => { s.probes.push(Date.now()); return s.up ? { up: true } : { up: false, why: 'connection refused' }; },
  };
  return s;
}

function deferred() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }

function rig({ data = {}, queue = new JobQueue({ concurrency: 1, maxLength: 50 }), clock = fakeClock(), server = fakeServer(), bot = fakeBot() } = {}) {
  data.outage ??= {};
  data.pause ??= {};
  data.qpause ??= {};
  const ran = [];
  const requestPause = new RequestPause({ store: memStore(data.pause), queueStore: memStore(data.qpause), queue, bot, now: clock.now });
  requestPause.attach({ plugins: new Map([['movie-requests', { plugin: { replayHeld: async (item) => { ran.push(item.text); } }, ctx: {} }]]) });
  const watch = new OutageWatch({
    store: memStore(data.outage), queue, requestPause, bot, getConfig: () => CONFIG,
    probe: server.probe, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  requestPause.setOutage(watch);
  return { data, queue, clock, server, bot, requestPause, watch, ran };
}

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
const message = (id, text) => ({ id, key: { id, remoteJid: MOVIES }, chatJid: MOVIES, senderJid: `${id}@s.whatsapp.net`, senderNumber: '15550001111', text });

/* ----------------------------- what counts ----------------------------- */
console.log('what is an outage, and what is not');
{
  ok(classifyFailure({ err: refused() }) === 'outage', 'connection refused is an outage');
  ok(classifyFailure({ err: new Error('Jellyfin did not respond within 30s') }) === 'outage', 'a timeout is an outage');
  ok(classifyFailure({ err: Object.assign(new Error('getaddrinfo ENOTFOUND jelly'), { code: 'ENOTFOUND' }) }) === 'outage', 'a name that does not resolve is an outage');
  ok(classifyFailure({ err: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }) === 'outage', 'a connection reset is an outage');
  ok(classifyFailure({ status: 502 }) === 'outage' && classifyFailure({ status: 500 }) === 'outage', 'HTTP 5xx is an outage');
  ok(classifyFailure({ err: new Error('download failed: HTTP 503 Service Unavailable') }) === 'outage', 'a download that failed on a 503 is an outage');
  // 4. Not an outage.
  ok(classifyFailure({ status: 404 }) === null, '404 is not an outage');
  ok(classifyFailure({ err: new Error('title not found') }) === null, '"title not found" is not an outage');
  ok(classifyFailure({ status: 400 }) === null, 'a bad request is not an outage');
  ok(classifyFailure({ status: 401 }) === 'config' && classifyFailure({ status: 403 }) === 'config', '401/403 is a settings problem');
  ok(classifyFailure({ err: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) }) === null, 'a cancel is not an outage');
  ok(isTransient(new ServerDownError({ since: 0, nextCheck: 0 })), 'a request refused during an outage is transient, so its job waits rather than failing for good');
  ok([...libraryHosts(CONFIG.library)].join() === 'jelly.example:8096', 'the watched host is the library\'s');
  ok(probeUrl(CONFIG.library) === `${JF}/System/Info/Public`, 'the check is Jellyfin\'s /System/Info/Public');
}

console.log('4. a 404 or "not found" triggers no outage');
{
  const r = rig();
  await r.watch.observe(`${JF}/Items?searchTerm=x`, { status: 404 });
  await r.watch.observe(`${JF}/Items?searchTerm=x`, { err: new Error('title not found') });
  await r.watch.observe(`${JF}/Users/me`, { status: 401 });
  ok(!r.watch.isDown() && !r.queue.paused, 'no outage, the queue runs');
  ok(r.server.probes.length === 0, 'and the server was not even checked');
  await r.watch.observe('http://omdb.example/?t=x', { err: refused() });
  ok(!r.watch.isDown() && r.server.probes.length === 0, 'a failure on another host is none of the watch\'s business');
  // A failure the server's own check contradicts - a slow search - is no outage either.
  r.server.up = true;
  await r.watch.observe(`${JF}/Items`, { err: new Error('Jellyfin did not respond within 180s') });
  ok(!r.watch.isDown() && r.server.probes.length === 1, 'a slow search on a server that answers its check is no outage');
}

/* ------------------------------ 1. going down ------------------------------ */
console.log('1. a server error holds everything in the queue, and nothing new starts');
{
  const r = rig();
  const started = [];
  const gate = deferred();
  r.queue.add({ label: 'Running Film (2001)', run: async () => { started.push('A'); await gate.p; } });
  r.queue.add({ label: 'Waiting One (2002)', run: async () => { started.push('B'); } });
  r.queue.add({ label: 'Waiting Two (2003)', run: async () => { started.push('C'); } });
  await settle();
  ok(started.join() === 'A', 'one job running, two waiting');
  const down = await r.watch.observe(`${JF}/Items`, { err: refused() });
  ok(down === true && r.watch.isDown(), 'one confirmed failure is enough');
  ok(r.queue.paused, 'the queue is paused');
  const st = r.watch.state();
  ok(st.nextCheck === st.since + CHECK_EVERY_MS, 'the check is booked 10 minutes on');
  ok(st.items.length === 3 && st.items[0].state === 'running' && st.items[1].label === 'Waiting One (2002)' && st.items[2].place === 3,
    'each item\'s place and state is recorded');
  ok(r.requestPause.isPaused(), 'new requests are held while it is down');
  gate.resolve();
  await settle(10);
  ok(started.join() === 'A', 'the running job finished, and nothing new started');
  let threw = null;
  try { r.watch.guard(`${JF}/Items`); } catch (e) { threw = e; }
  ok(threw instanceof ServerDownError && /could not reach the library/.test(threw.message), 'a request to the server is refused at once');
  let other = null;
  try { r.watch.guard('https://www.omdbapi.com/?t=x'); } catch (e) { other = e; }
  ok(other === null, 'a request anywhere else is not');
}

/* --------------------- 2. the 10-minute schedule, nothing else --------------------- */
console.log('2. still down at the check: the next is exactly 10 minutes on, and nothing else reaches the server');
{
  const r = rig();
  // The process's fetch, guarded, over a fake network that counts what reaches the server.
  const hits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { hits.push(String(url)); throw refused(); };
  const unguard = installFetchGuard(r.watch);
  try {
    let err = null;
    try { await fetch(`${JF}/Items?searchTerm=heat`); } catch (e) { err = e; }
    ok(err && hits.length === 1, 'the first request reaches the server, and fails');
    await settle(10);
    ok(r.watch.isDown(), 'its failure, confirmed, begins the outage');
    const since = r.watch.state().since;
    const probesAtStart = r.server.probes.length;
    // A burst of requests while it is down: none leaves the box.
    for (let i = 0; i < 5; i++) { try { await fetch(`${JF}/Items/${i}/Download`); } catch { /* refused */ } }
    ok(hits.length === 1, 'five more requests during the outage: none reached the server');
    await fetch('http://elsewhere.example/').catch(() => {});
    ok(hits.length === 2 && hits[1].startsWith('http://elsewhere'), 'another host is reached as ever');
    await r.clock.advance(9 * MIN + 59_000);
    ok(r.server.probes.length === probesAtStart, 'no check before 10 minutes are up');
    await r.clock.advance(1_000);
    ok(r.server.probes.length === probesAtStart + 1, 'one check at 10 minutes');
    ok(r.watch.state().nextCheck === since + 2 * CHECK_EVERY_MS, 'still down: the next check is 10 minutes after it');
    ok(r.clock.pending().length === 1 && r.clock.pending()[0] === since + 20 * MIN, 'and only that one is booked');
    // Check now: one more check, the schedule untouched.
    await r.watch.check({ manual: true });
    ok(r.server.probes.length === probesAtStart + 2 && r.watch.state().nextCheck === since + 20 * MIN,
      'Check now asks once more and leaves the automatic schedule as it was');
    await r.clock.advance(10 * MIN);
    ok(r.server.probes.length === probesAtStart + 3 && r.watch.state().nextCheck === since + 30 * MIN, 'and the next comes on time');
    ok(hits.filter((h) => h.startsWith(JF)).length === 1, 'in 30 minutes of outage, only the checks asked the server anything');
  } finally {
    unguard();
    globalThis.fetch = realFetch;
  }
}

/* ------------------------------ 3. coming back ------------------------------ */
console.log('3. back up: only what the outage held resumes, in its original order');
{
  const r = rig();
  const started = [];
  const gate = deferred();
  r.queue.add({ label: 'Running', run: async () => { started.push('A'); await gate.p; } });
  r.queue.add({ label: 'Second', run: async () => { started.push('B'); } });
  r.queue.add({ label: 'Third', run: async () => { started.push('C'); } });
  await settle();
  await r.watch.observe(`${JF}/Items`, { err: refused() });
  // The running job's download dies with the server, and books its retry;
  // two more jobs had failed for the server before, in this order.
  const book = new RetryBook({ outage: r.watch, delayMs: () => 1 });
  const back = [];
  for (const k of ['film-1', 'film-2']) {
    book.schedule(k, { bot: null, err: new Error('download failed: HTTP 502 Bad Gateway'), run: async () => { back.push(k); } });
  }
  gate.resolve();
  await settle(20);
  ok(back.length === 0, 'the jobs that failed for the server wait for it, they are not retried');
  ok(book.isWaiting('film-1') && book.isWaiting('film-2'), 'and are still booked');
  // Its attempts are not spent waiting: a fourth failure during the outage still has a retry.
  const many = new RetryBook({ outage: r.watch, delayMs: () => 1, max: 1 });
  many.schedule('x', { bot: null, err: new Error('ECONNRESET'), run: async () => {} });
  many.forget('x');
  many.attempts.set('x', 1);
  ok(many.schedule('x', { bot: null, err: new Error('ECONNRESET'), run: async () => {} }) === 1, 'a job out of attempts during an outage is still kept for after it');
  many.clear();
  // Requests that came in meanwhile.
  await r.requestPause.hold(null, message('M1', 'heat 1995'), { plugin: 'movie-requests', text: 'heat 1995' });
  await r.requestPause.hold(null, message('M2', 'up 2009'), { plugin: 'movie-requests', text: 'up 2009' });
  ok(r.requestPause._held().every((it) => it.reason === 'server-down'), 'each is held with the reason server-down');
  ok(r.watch.heldCount() === 2 + 2 + 2, 'the banner counts the waiting jobs, the queue and the held requests');
  r.server.up = true;
  await r.clock.advance(CHECK_EVERY_MS);
  await r.watch.recovering;
  await settle(20);
  ok(!r.watch.isDown(), 'the outage is over');
  ok(back.join() === 'film-1,film-2', 'the jobs that failed for it went back, in the order they failed');
  ok(!r.queue.paused && started.join() === 'A,B,C', 'the queue resumed, and the waiting jobs ran in their original order');
  ok(r.ran.join() === 'heat 1995,up 2009' && r.requestPause.heldCount() === 0, 'the held requests ran, in the order they came');
}

console.log('3. what was paused by hand stays paused');
{
  const r = rig();
  await r.watch.observe(`${JF}/Items`, { err: refused() });
  // An admin pauses the queue by hand during the outage.
  r.requestPause.pauseQueue('admin');
  r.server.up = true;
  await r.clock.advance(CHECK_EVERY_MS);
  await r.watch.recovering;
  ok(!r.watch.isDown() && r.queue.paused, 'a queue paused by hand during the outage stays paused after it');

  const q = new JobQueue({ concurrency: 1 });
  q.pause();
  const r2 = rig({ queue: q });
  await r2.watch.observe(`${JF}/Items`, { err: refused() });
  ok(r2.watch.state().pausedQueue === false, 'a queue already paused is not the outage\'s to resume');
  r2.server.up = true;
  await r2.clock.advance(CHECK_EVERY_MS);
  await r2.watch.recovering;
  ok(q.paused, 'and it stays paused');

  // Requests paused by hand: theirs stay held, and so do the outage's until the admin resumes.
  const r3 = rig();
  r3.requestPause.pause('admin');
  await r3.requestPause.hold(null, message('P1', 'manual one'), { plugin: 'movie-requests', text: 'manual one' });
  await r3.watch.observe(`${JF}/Items`, { err: refused() });
  ok(r3.requestPause._held()[0].reason === 'paused', 'a request held by a manual pause says so');
  r3.server.up = true;
  await r3.clock.advance(CHECK_EVERY_MS);
  await r3.watch.recovering;
  ok(r3.ran.length === 0 && r3.requestPause.heldCount() === 1, 'requests paused by hand are not run by the recovery');
  ok(r3.queue.paused, 'nor is the queue the manual pause took');

  // A job that failed for another reason is not the outage's.
  const r4 = rig();
  const book = new RetryBook({ outage: r4.watch, delayMs: () => 1, max: 1 });
  book.schedule('bad', { bot: null, err: new Error('ffmpeg exited with code 1'), run: async () => {} });
  ok(r4.server.probes.length === 0, 'a failure that is not the server\'s does not even check it');
  book.clear();
}

/* ------------------------------ 5. a restart ------------------------------ */
console.log('5. a restart during the outage: still paused, same schedule, same held items');
{
  const data = {};
  const clock = fakeClock();
  const r = rig({ data, clock });
  r.queue.add({ label: 'Waiting One', run: async () => {} });
  r.queue.pause();
  r.queue.resume();
  await settle();
  await r.watch.observe(`${JF}/Items`, { err: refused() });
  await r.requestPause.hold(null, message('M9', 'jaws 1975'), { plugin: 'movie-requests', text: 'jaws 1975' });
  await clock.advance(3 * MIN);
  const before = JSON.parse(JSON.stringify(r.watch.state()));
  r.watch.stop();

  // The new process: a new queue and watch on the same state.
  const clock2 = fakeClock(clock.now());
  const server2 = fakeServer();
  const q2 = new JobQueue({ concurrency: 1 });
  const r2 = rig({ data, clock: clock2, server: server2, queue: q2 });
  r2.requestPause.restore();
  r2.watch.restore();
  const after = r2.watch.state();
  ok(after.down && q2.paused, 'still paused');
  ok(after.since === before.since && after.nextCheck === before.nextCheck, 'the same down-since and next check');
  ok(JSON.stringify(after.items) === JSON.stringify(before.items), 'the same items recorded');
  ok(r2.requestPause.heldCount() === 1 && r2.requestPause._held()[0].reason === 'server-down', 'the held request is still held');
  ok(clock2.pending().length === 1 && clock2.pending()[0] === before.nextCheck, 'one check booked, at the time the last process had booked');
  await clock2.advance(6 * MIN);
  ok(server2.probes.length === 0, 'nothing checked before it');
  await clock2.advance(1 * MIN);
  ok(server2.probes.length === 1, 'and it is checked on time');
  r2.watch.stop();
}

/* ------------------------------ 6. the messages ------------------------------ */
console.log('6. one WhatsApp message when it goes down and one when it is back, not one per check');
{
  const out = [];
  const r = rig({ bot: fakeBot(out) });
  await r.watch.observe(`${JF}/Items`, { err: refused() });
  await settle();
  for (let i = 0; i < 4; i++) await r.clock.advance(CHECK_EVERY_MS);
  await r.watch.observe(`${JF}/Items`, { err: refused() });
  const downs = out.filter((o) => o.op === 'text' && o.jid === ADMINS && /isn't answering/.test(o.text));
  ok(downs.length === 1, 'one "down" message for five checks');
  ok(/trying again at \d\d:\d\d/.test(downs[0].text), 'it says when the next check is, on the 24-hour clock');
  await r.requestPause.hold(null, message('M5', 'alien 1979'), { plugin: 'movie-requests', text: 'alien 1979' });
  const reply = out.find((o) => o.op === 'text' && o.jid === MOVIES);
  ok(reply && reply.quoted === 'M5' && /temporarily down/.test(reply.text), 'the requester is told it is queued and the server is down');
  r.server.up = true;
  await r.clock.advance(CHECK_EVERY_MS);
  await r.watch.recovering;
  await r.clock.advance(CHECK_EVERY_MS);
  const ups = out.filter((o) => o.op === 'text' && o.jid === ADMINS && /Server's back/.test(o.text));
  ok(ups.length === 1 && /resuming 1 request\b/.test(ups[0].text), 'one "Server\'s back, resuming N requests" message');

  // The down message is not sent again by a restart.
  const data = {};
  const out2 = [];
  const a = rig({ data, bot: fakeBot(out2) });
  await a.watch.observe(`${JF}/Items`, { err: refused() });
  await settle();
  const b = rig({ data, bot: fakeBot(out2) });
  b.watch.restore();
  await settle();
  ok(out2.filter((o) => /isn't answering/.test(o.text)).length === 1, 'a restart during the outage does not say it again');
  a.watch.stop(); b.watch.stop();
}

/* ------------------------- the request that meets it ------------------------- */
console.log('a request whose lookup meets the outage is held, not lost');
{
  const r = rig();
  const held = await r.requestPause.holdIfServerDown(null, message('Q1', 'dune 2021'), refused(), { plugin: 'movie-requests', text: 'dune 2021' });
  ok(held && r.watch.isDown(), 'the lookup\'s failure, confirmed, begins the outage and holds the request');
  ok(r.requestPause._held()[0]?.text === 'dune 2021', 'it waits to run');
  const r2 = rig();
  r2.server.up = true;
  const no = await r2.requestPause.holdIfServerDown(null, message('Q2', 'x'), new Error('title not found'), { plugin: 'movie-requests', text: 'x' });
  ok(!no && r2.requestPause.heldCount() === 0, 'any other failure is answered as before');
}

console.log('the wanted recheck is skipped while the server is down');
{
  let looked = 0;
  const wr = new WantedRecheck({
    configStore: { get: () => ({ ...CONFIG, library: { provider: 'jellyfin', jellyfin: { baseUrl: JF, authMethod: 'apikey', apiKey: 'k' } } }) }, stateStore: { namespace: () => memStore() },
    find: async () => { looked += 1; return null; }, serverDown: () => true,
    log: { info() {}, debug() {}, warn() {}, error() {} },
  });
  const res = await wr.run('test');
  ok(looked === 0 && /media server is down/.test(res.skipped ?? ''), 'no lookups, and it says why');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
