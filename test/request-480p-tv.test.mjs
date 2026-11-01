/* "#request-480p <show> S01": smaller copies of episodes. Run:
   node test/request-480p-tv.test.mjs

   The operator, 2026-10-26: "TV Request-480p the office s01". Staged as
   beta006 (request-480p); the encode itself is test/request-480p-encode. */
import plugin from '../src/plugins/tv-requests/index.js';
import fs from 'node:fs';
import { markQuality } from '../src/core/quality-tag.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const TVREQ = 'tvreq@g.us';
const BETA = 'beta@g.us';

const HOST = { Id: 'HOST', Name: 'Loki', ProductionYear: 2021 };
const MENTALIST = { Id: 'MENT', Name: 'The Mentalist', ProductionYear: 2008 };
const episodesOf = (series, season, n) => Array.from({ length: n }, (_, i) => ({
  Id: `${series.Id}-${season}-${i + 1}`, SeriesName: series.Name, ParentIndexNumber: season, IndexNumber: i + 1,
  Name: `Ep ${i + 1}`, MediaSources: [{ Path: `/tv/${series.Id}${i}.mkv`, Size: 1000, Container: 'mkv' }],
}));

/** A tiny Jellyfin: two shows, Loki season 1 (6) and The Mentalist season 3 (24). */
function jellyfin() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('/Shows/HOST/Seasons')) return json({ Items: [{ Id: 'L1', IndexNumber: 1, ChildCount: 6 }] });
    if (u.includes('/Shows/MENT/Seasons')) return json({ Items: [{ Id: 'M3', IndexNumber: 3, ChildCount: 24 }] });
    if (u.includes('/Shows/HOST/Episodes')) return json({ Items: episodesOf(HOST, 1, 6) });
    if (u.includes('/Shows/MENT/Episodes')) return json({ Items: episodesOf(MENTALIST, 3, 24) });
    if (u.includes('/Items')) {
      const term = decodeURIComponent((u.match(/searchTerm=([^&]*)/) ?? [])[1] ?? '').toLowerCase();
      return json({ Items: [HOST, MENTALIST].filter((s) => !term || s.Name.toLowerCase().includes(term.replace(/^the /, ''))) });
    }
    return { ok: false, status: 404, statusText: 'NF', json: async () => ({}) };
  };
}

/** The live queue's shape: raw entries in pending and active, meta and kind on each. */
function fakeQueue() {
  let n = 0;
  return {
    maxLength: 500, pending: [], active: new Map(),
    add(job) {
      const entry = { id: `q${++n}`, label: job.label, kind: job.kind === 'tv' ? 'tv' : 'movie', meta: job.meta ?? {}, run: job.run };
      this.pending.push(entry);
      return entry.id;
    },
    start(label) {
      const i = this.pending.findIndex((e) => e.label === label);
      const [e] = this.pending.splice(i, 1);
      this.active.set(e.id, e);
    },
    cancelWaiting(label) {
      const i = this.pending.findIndex((e) => e.label === label);
      this.pending.splice(i, 1);
    },
  };
}

function makeCtx({ slowReact = 0, dup = 'on', mode = 'on' } = {}) {
  jellyfin();
  const reacted = [], notes = [];
  const store = new Map();
  const logs = [];
  return {
    reacted, notes, logs, store,
    ctx: {
      config: {
        tvRequests: { enabled: true, requestGroups: [TVREQ], postsGroups: ['tvposts@g.us'], cooldownSecondsPerUser: 0, requirePrefix: true, prefix: '#request' },
        movieRequests: {
          reactions: { researching: '🔍', added: '🎬', duplicate: '🤥', needYear: '📅', notInLibrary: '📬', rated: '⛔', failed: '⚠️', done: '✅' },
          notify: { group: 'notif@g.us' },
        },
        beta: { groups: [BETA], postsGroup: 'betaposts@g.us', features: { ...(dup ? { 'tv-duplicate-notice': dup } : {}), 'request-480p': mode } },
        library: { jellyfin: { baseUrl: 'http://jf:8096', accessToken: 'TOK', userId: 'U1' } },
        media: { workDir: '/tmp/tvdup' },
      },
      bot: {
        react: async (m, e) => { if (slowReact) await tick(slowReact); reacted.push(`${m.id} ${e}`); },
        isConnected: () => true,
        sendText: async (j, t) => { notes.push(t); return { key: { id: 'X' } }; },
        isGroupAdmin: () => false,
        deleteMessage: async () => {},
        archiveChat: async () => {},
        groupMemberInfo: () => ({ isMember: false }),
      },
      queue: fakeQueue(),
      store: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
      log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m), debug() {} },
    },
  };
}

let seq = 0;
// As src/index.js does with every message, before the plugins see it.
const mkMsg = (text, { chatJid = TVREQ, sender = '15551112222' } = {}) => markQuality({
  text, chatJid, isGroup: true, fromMe: false, messageType: 'conversation',
  senderJid: `${sender}@s.whatsapp.net`, senderNumber: sender, senderNumberDisplay: `+${sender}`,
  pushName: 'Avi', id: `MSG${++seq}`, key: { remoteJid: chatJid, id: `MSG${seq}`, fromMe: false }, timestamp: Date.now(),
});
const tvLabels = (q) => q.pending.filter((e) => e.kind === 'tv').map((e) => e.label);
const history = (store) => store.get('history') ?? [];


console.log('=== "#request-480p Loki S01" ===');
{
  const { ctx, store } = makeCtx();
  const small = mkMsg('#request-480p Loki S01');
  await plugin.onMessage(small, ctx);
  ok(tvLabels(ctx.queue).length === 6, `all six episodes are queued (${tvLabels(ctx.queue).length})`);
  const j = (store.get('pending') ?? [])[0];
  ok(j?.baseRow?.quality === '480p', 'the journal marks the request 480p, so a restart or a retry makes the same copy');
  ok(ctx.queue.pending.every((e) => e.meta.quality === '480p'), 'each queued episode says 480p');
  const row = history(store).find((h) => h.id === small.id);
  ok(row?.quality === '480p' && /^Loki S01$/i.test(row?.request ?? ''), `History says 480p, and what was asked for (${row?.request})`);

  const full = mkMsg('#request Loki S01', { sender: '15553334444' });
  await plugin.onMessage(full, ctx);
  ok(tvLabels(ctx.queue).length === 12 && history(store).find((h) => h.id === full.id)?.status === 'queued',
    'a full copy of the same season is queued as well: not a duplicate of the 480p one');

  const smallAgain = mkMsg('#request-480p Loki S01', { sender: '15556667777' });
  await plugin.onMessage(smallAgain, ctx);
  ok(tvLabels(ctx.queue).length === 12 && history(store).find((h) => h.id === smallAgain.id)?.status === 'duplicate',
    'a second 480p of it is a duplicate');
  const fullAgain = mkMsg('#request Loki S01', { sender: '15558889999' });
  await plugin.onMessage(fullAgain, ctx);
  ok(tvLabels(ctx.queue).length === 12 && history(store).find((h) => h.id === fullAgain.id)?.status === 'duplicate',
    'and a second full one too');
}

console.log('=== Off ===');
{
  const { ctx, store } = makeCtx({ mode: 'off' });
  const m = mkMsg('#request-480p Loki S01');
  await plugin.onMessage(m, ctx);
  const row = history(store).find((h) => h.id === m.id);
  ok(tvLabels(ctx.queue).length === 6 && !row?.quality && ctx.queue.pending.every((e) => !e.meta.quality),
    'Off, it is a plain request for Loki season 1');
}

console.log('=== a beta test ===');
{
  const { ctx, notes } = makeCtx({ mode: 'beta' });
  await plugin.onMessage(mkMsg('$beta006 #request-480p Loki S01', { chatJid: BETA }), ctx);
  const said = notes.join('\n');
  ok(tvLabels(ctx.queue).length === 0 && /Test passed\* \(\$beta006\)/.test(said), 'is answered Test passed, and nothing is queued');
  ok(/6 episodes of \*Loki\* .* in 480p, a smaller file under 950 MB each/.test(said), `and says 480p, under 950 MB each (${said.split('\n')[2] ?? said})`);
}

console.log('=== the episode is made small ===');
{
  const src = fs.readFileSync(new URL('../src/plugins/tv-requests/index.js', import.meta.url), 'utf8');
  const d = src.slice(src.indexOf('  async deliverEpisode('), src.indexOf('  async deliverEpisode(') + 1500);
  ok(/const quality = copyOf\(\(ctx\.store\.get\('pending', \[\]\) \?\? \[\]\)\.find\(\(r\) => r\.reqKey === reqKey\)\)/.test(d),
    'deliverEpisode reads the quality from its journalled request');
  ok(/const media = quality === LOW_QUALITY \? lowQualityMedia\(ctx\.config\.media\) : ctx\.config\.media;/.test(d), 'and encodes with the 480p settings');
  ok(/const outName = qualityFileName\(episodeFileName\(ep\), quality\);/.test(d), 'naming the file "… 480p.mp4"');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
