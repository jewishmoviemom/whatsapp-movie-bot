/* "#request-480p <title>": a smaller copy of a film. Run:
   node test/request-480p-films.test.mjs

   The operator, 2026-10-26: "Add option for users to request movies in lower
   quality so the file size is in megabytes - Movie #request-480p moviename
   year, TV Request-480p the office s01". Staged as beta006 (request-480p). */
import './fixtures/roomy-disk.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeDefaults } from '../src/config/schema.js';
import moviePlugin from '../src/plugins/movie-requests/index.js';
import { markQuality, readQualityTag, wantedQuality, qualityFileName, QUALITY_FEATURE } from '../src/core/quality-tag.js';
import { testersGuide } from '../src/core/beta.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const REQ = 'movie-requests@g.us';
const POSTS = 'movie-posts@g.us';
const NOTIFY = 'movie-notify@g.us';
const TESTING = '120363900000000013@g.us';
const BETA_POSTS = '120363900000000014@g.us';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'film-480p-'));
const LIB = path.join(TMP, 'lib');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(LIB); fs.mkdirSync(WORK);
fs.writeFileSync(path.join(LIB, 'Minority Report (2002).mp4'), 'not really a film');
fs.writeFileSync(path.join(LIB, 'Heat (1995).mp4'), 'not really a film');
const FFPROBE = path.join(TMP, 'ffprobe');
fs.writeFileSync(FFPROBE, `#!/bin/sh
cat <<'JSON'
{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720},{"codec_type":"audio","codec_name":"aac","channels":2}],"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"60","size":"17"}}
JSON
`, { mode: 0o755 });

const FFMPEG_LOG = path.join(TMP, 'ffmpeg.log');
const FFMPEG = path.join(TMP, 'ffmpeg');
fs.writeFileSync(FFMPEG, `#!/bin/sh\necho "$@" >> ${FFMPEG_LOG}\nexit 1\n`, { mode: 0o755 });

const FILMS = {
  minority: { Title: 'Minority Report', Year: '2002', Rated: 'PG-13', imdbID: 'tt0181689' },
  heat: { Title: 'Heat', Year: '1995', Rated: 'R', imdbID: 'tt0113277' },
};
let omdbDelayMs = 0;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname.includes('omdbapi')) {
    if (omdbDelayMs) await tick(omdbDelayMs);
    const q = String(u.searchParams.get('t') ?? u.searchParams.get('s') ?? '').toLowerCase();
    const f = Object.entries(FILMS).find(([k]) => q.includes(k))?.[1];
    const body = f ? { Response: 'True', Type: 'movie', ...f } : { Response: 'False', Error: 'Movie not found!' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
};

function config({ mode = 'on' } = {}) {
  return mergeDefaults({
    movieRequests: {
      requestGroups: [REQ], postsGroup: POSTS, notify: { group: NOTIFY }, cooldownSecondsPerUser: 0, blockedRatings: [],
      // The request rules this was written against, the defaults until 2026-10-12
      // (request-rule-defaults): no prefix needed, react only, 50 waiting.
      requirePrefix: true, prefix: '#request', replyOnBlock: false, maxQueueLength: 50,
    },
    omdb: { apiKey: 'test-key' },
    library: { provider: 'local', local: { roots: [LIB], extensions: ['.mp4'] } },
    media: { workDir: WORK, ffprobePath: FFPROBE, ffmpegPath: FFMPEG, deleteAfterSend: true, segmentedEncode: false },
    beta: { groups: [TESTING], postsGroup: BETA_POSTS, features: { 'request-480p': mode } },
    whatsapp: { broadcastPacingMs: 0 },
  }, DEFAULT_CONFIG);
}

function fakeStore(data = {}) {
  return { get: (k, d = null) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, push: (k, v) => { (data[k] ??= []).unshift(v); }, data };
}

function harness(cfg = config(), store = fakeStore()) {
  const out = [];
  const jobs = [];
  const bot = {
    connected: true,
    isConnected: () => bot.connected,
    react: async (msg, emoji) => { out.push({ op: 'react', id: msg.id, emoji }); return true; },
    sendText: async (jid, body) => { out.push({ op: 'text', jid, body }); return { key: { id: 'sent' } }; },
    sendDocument: async (jid, file, opts) => { out.push({ op: 'document', jid, file: opts?.fileName }); return {}; },
    deleteMessage: async () => {}, archiveChat: async () => {}, isGroupAdmin: () => false,
    groupMemberInfo: () => ({ isMember: false }), groups: () => [], on() {}, off() {},
  };
  const queue = {
    maxLength: 50, pending: [], active: new Map(), on() {}, off() {},
    add(j) { jobs.push(j); this.pending.push({ id: `job-${jobs.length}`, kind: 'movie', meta: j.meta }); return `job-${jobs.length}`; },
    moveTop() { return true; },
    snapshot() { return { pending: [], active: [] }; },
  };
  const ctx = { config: cfg, store, bot, queue, log: { info() {}, warn() {}, error() {}, debug() {} }, configStore: { update() {} } };
  return { ctx, out, jobs, store };
}

let seq = 0;
// One number each: the same number is the same member (requestMemberKey).
const NUMBERS = {
  Aaron: { senderNumber: '15558150192', senderNumberDisplay: '+1 (555) 815-0192' },
  Mia: { senderNumber: '15558150171', senderNumberDisplay: '+1 (555) 815-0171' },
  Mommy: { senderNumber: '15558150172', senderNumberDisplay: '+1 (555) 815-0172' },
};
const ask = (text, { chatJid = REQ, who = 'Aaron' } = {}) => {
  const id = `MSG${++seq}`;
  // As src/index.js does with every message, before the plugins see it.
  return markQuality({
    id, key: { id, remoteJid: chatJid }, text, chatJid, isGroup: true, fromMe: false, messageType: 'conversation',
    senderJid: `${who}@lid`, ...NUMBERS[who] ?? NUMBERS.Aaron, pushName: who, timestamp: Date.now(),
  });
};
const job = () => ({ id: `j${++seq}`, progress() {}, isCancelled: () => false, cancelReason: () => null });
const rowOf = (store, id) => (store.data.history ?? []).find((h) => h.id === id);
const notes = (out, jid = NOTIFY) => out.filter((e) => e.op === 'text' && e.jid === jid).map((e) => e.body);

moviePlugin._reactors = new Map();                    // normally made by setup()


console.log('=== the tag ===');
{
  const r = readQualityTag('#request-480p The Office S01');
  ok(r.quality === '480p' && r.text === '#request The Office S01', '"#request-480p The Office S01" is a 480p "#request The Office S01"');
  ok(readQualityTag('#REQUEST-480P inception 2010').quality === '480p', 'in any case, as #request is');
  ok(readQualityTag('#request-480 inception 2010').quality === null, 'only exactly "#request-480p": not "#request-480"');
  ok(readQualityTag('#request - 480p inception 2010').quality === null, 'nor with spaces round the dash');
  ok(readQualityTag('#request480p inception 2010').quality === null, 'nor without the dash');
  ok(readQualityTag('$beta006 #request-480p Inception 2010').text === '$beta006 #request Inception 2010', 'after a beta code');
  ok(readQualityTag('#request inception 2010').quality === null, 'a plain #request is not');
  ok(readQualityTag('#request-4800 x').quality === null && readQualityTag('#request-movie x').quality === null, 'nor anything else after the dash');
  ok(readQualityTag('#request 480p inception').quality === null, '"480p" as part of the title is not the tag');
  ok(qualityFileName('Inception (2010).mp4', '480p') === 'Inception (2010) 480p.mp4', 'its file is named "… 480p.mp4"');
  ok(qualityFileName('Inception (2010).mp4', null) === 'Inception (2010).mp4', 'a full copy keeps its name');
}

console.log('=== the beta switch ===');
{
  const m = ask('#request-480p minority report 2002');
  ok(wantedQuality(config({ mode: 'on' }), m) === '480p', 'On: everywhere');
  ok(wantedQuality(config({ mode: 'beta' }), m) === null, 'Beta: not in a main group');
  ok(wantedQuality(config({ mode: 'beta' }), { ...m, chatJid: TESTING }) === '480p', 'but in the beta group');
  ok(wantedQuality(config({ mode: 'off' }), m) === null, 'Off: nowhere');
  const guide = testersGuide(config({ mode: 'beta' }), { code: 'beta006' });
  ok(guide.ok && guide.text.includes('$beta006 #request-480p Inception 2010') && !guide.text.includes('#request #request-480p'),
    'the testers\' guide says "$beta006 #request-480p Inception 2010"');
}

console.log('=== a 480p request, and a full one for the same film ===');
{
  const { ctx, out, jobs, store } = harness();
  const small = ask('#request-480p minority report 2002');
  await moviePlugin.onMessage(small, ctx);
  ok(jobs.length === 1 && store.data.pending[0]?.record?.quality === '480p', 'it is queued, its journal entry marked 480p (a restart keeps it)');
  ok(rowOf(store, small.id)?.quality === '480p' && rowOf(store, small.id)?.request === 'minority report 2002', 'History says 480p, and the title it asked for');

  const full = ask('#request minority report 2002', { who: 'Mia' });
  await moviePlugin.onMessage(full, ctx);
  ok(jobs.length === 2 && rowOf(store, full.id)?.status === 'queued' && !rowOf(store, full.id)?.quality,
    'a full copy of the same film is queued too: not a duplicate of the 480p one');

  const smallAgain = ask('#request-480p minority report 2002', { who: 'Mommy' });
  out.length = 0;
  await moviePlugin.onMessage(smallAgain, ctx);
  ok(jobs.length === 2 && rowOf(store, smallAgain.id)?.status === 'duplicate', 'a second 480p of it is a duplicate of the first');
  const fullAgain = ask('#request minority report 2002', { who: 'Mommy' });
  await moviePlugin.onMessage(fullAgain, ctx);
  ok(jobs.length === 2 && rowOf(store, fullAgain.id)?.status === 'duplicate', 'and a second full one of the full one');

  // Made: always encoded, 480 lines, at most 800 kbps (the fake ffmpeg fails, after saying how it was asked).
  fs.rmSync(FFMPEG_LOG, { force: true });
  await jobs[0].run(job()).catch(() => {});
  const args = fs.existsSync(FFMPEG_LOG) ? fs.readFileSync(FFMPEG_LOG, 'utf8') : '';
  ok(/scale=-2:480/.test(args), 'the 480p job is encoded down to 480 lines, though the file would fit as it is');
  ok(/-b:v (\d+)/.test(args) && Number(/-b:v (\d+)/.exec(args)[1]) <= 800_000, `at no more than 800 kbps (${/-b:v (\d+)/.exec(args)?.[1]})`);
  fs.rmSync(FFMPEG_LOG, { force: true });
  await jobs[1].run(job()).catch(() => {});
  const fullArgs = fs.existsSync(FFMPEG_LOG) ? fs.readFileSync(FFMPEG_LOG, 'utf8') : '';
  ok(!/scale=-2:480/.test(fullArgs), 'the full job is not: a 720p mp4 that fits is sent as it is');
}

console.log('=== Off ===');
{
  const { ctx, jobs, store } = harness(config({ mode: 'off' }));
  const m = ask('#request-480p heat 1995');
  await moviePlugin.onMessage(m, ctx);
  ok(jobs.length === 1 && rowOf(store, m.id)?.status === 'queued' && !rowOf(store, m.id)?.quality && rowOf(store, m.id)?.title === 'Heat',
    'Off, "#request-480p heat 1995" is queued as a plain #request for Heat');
}

console.log('=== a beta test ===');
{
  const { ctx, out, jobs } = harness(config({ mode: 'beta' }));
  const m = ask('$beta006 #request-480p minority report 2002', { chatJid: TESTING });
  await moviePlugin.onMessage(m, ctx);
  const said = out.filter((e) => e.op === 'text' && e.jid === TESTING).map((e) => e.body).join('\n');
  ok(jobs.length === 0 && /Test passed\* \(\$beta006\)/.test(said), 'is answered Test passed, and nothing is queued');
  ok(/would send \*Minority Report\* \(2002\) in 480p, a smaller file under 950 MB/.test(said), `and says it would be 480p, under 950 MB ("${said.split('\n')[2] ?? said}")`);
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
