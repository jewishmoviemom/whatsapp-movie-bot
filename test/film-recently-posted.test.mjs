/* A film asked for again soon after it was posted.
   Run: node test/film-recently-posted.test.mjs

   2026-11-08: Romeo and Juliet (1968) was posted at 16:16:51 New York time
   and asked for again 95 seconds later. 🤥 covered only a film still waiting
   or in progress, so it was converted and posted a second time. The
   operator, 2026-11-09 (src/plugins/movie-requests/recent-post.js):
   - posted within 24 hours: 🤥, not queued;
   - within a week: queued as usual if the member joined the posts group
     after it was posted, or if no film is waiting; otherwise 🤥, not queued,
     and told in the request group - never privately - when it was posted
     and to ask in 06 MOVIE DISCUSSIONS;
   - a week or more: queued as usual.
   Joins are read from the group activity feed, which the panel's member
   pages show too; index.js now keeps 2,000 events of it, about four weeks. */
import './fixtures/roomy-disk.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeDefaults } from '../src/config/schema.js';
import moviePlugin from '../src/plugins/movie-requests/index.js';
import { lastPosted, judgeRepost, joinedAt, postedWhen, repostReply, DAY, WEEK } from '../src/plugins/movie-requests/recent-post.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const REQ = 'movie-requests@g.us';
const POSTS = 'movie-posts@g.us';
const NOTIFY = 'movie-notify@g.us';
const DISC = 'movie-discussions@g.us';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'film-reposted-'));
const LIB = path.join(TMP, 'lib');
const WORK = path.join(TMP, 'work');
fs.mkdirSync(LIB); fs.mkdirSync(WORK);
fs.writeFileSync(path.join(LIB, 'Romeo and Juliet (1968).mp4'), 'not really a film');
const FFPROBE = path.join(TMP, 'ffprobe');
fs.writeFileSync(FFPROBE, `#!/bin/sh
cat <<'JSON'
{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720},{"codec_type":"audio","codec_name":"aac","channels":2}],"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"60","size":"17"}}
JSON
`, { mode: 0o755 });

const ROMEO = { Title: 'Romeo and Juliet', Year: '1968', Rated: 'PG', imdbID: 'tt0063518' };
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname.includes('omdbapi')) {
    const q = String(u.searchParams.get('t') ?? u.searchParams.get('s') ?? '').toLowerCase();
    const body = q.includes('romeo') ? { Response: 'True', Type: 'movie', ...ROMEO } : { Response: 'False', Error: 'Movie not found!' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
};

const cfg = mergeDefaults({
  movieRequests: {
    requestGroups: [REQ], postsGroup: POSTS, notify: { group: NOTIFY }, cooldownSecondsPerUser: 0, blockedRatings: [],
    requirePrefix: false, replyOnBlock: false, maxQueueLength: 50,
  },
  omdb: { apiKey: 'test-key' },
  library: { provider: 'local', local: { roots: [LIB], extensions: ['.mp4'] } },
  media: { workDir: WORK, ffprobePath: FFPROBE, ffmpegPath: '/bin/false', deleteAfterSend: true },
  libraryNews: { groups: [DISC] },
  whatsapp: { broadcastPacingMs: 0 },
}, DEFAULT_CONFIG);

function fakeStore(data = {}) {
  return { get: (k, d = null) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, push: (k, v) => { (data[k] ??= []).unshift(v); }, data };
}

/** A posted row for Romeo and Juliet `ago` ms ago, and a request rig around it. */
function rig({ ago, filmsWaiting = false, events = [], admin = false, quality = null, subject = null } = {}) {
  const now = Date.now();
  const store = fakeStore({ history: [{ id: 'old', status: 'sent', title: 'Romeo and Juliet', year: 1968, imdbId: 'tt0063518', finishedAt: now - ago, ...(quality ? { quality } : {}) }] });
  const activity = fakeStore({ events });
  const out = [];
  const jobs = [];
  const bot = {
    connected: true,
    isConnected: () => true,
    react: async (msg, emoji) => { out.push({ op: 'react', id: msg.id, emoji }); return true; },
    sendText: async (jid, body, opts = {}) => { out.push({ op: 'text', jid, body, quoted: opts.quoted?.id ?? null, groupMentions: opts.groupMentions ?? null }); return { key: { id: 'sent' } }; },
    sendDocument: async () => ({}), deleteMessage: async () => {}, archiveChat: async () => {},
    isGroupAdmin: () => admin, groupMemberInfo: () => ({ isMember: false }), groups: () => [], on() {}, off() {},
    groupCache: new Map(subject ? [[DISC, { subject }]] : []),
    sameCommunity: () => false,
    groupMentionToken: (jid) => `@${jid.split('@')[0]}`,
  };
  const queue = {
    maxLength: 50, pending: [], active: new Map(), on() {}, off() {},
    add(j) { jobs.push(j); this.pending.push({ id: `job-${jobs.length}`, kind: 'movie', meta: j.meta }); return `job-${jobs.length}`; },
    moveTop() { return true; },
    snapshot() { return { pending: filmsWaiting ? [{ kind: 'movie', label: 'Something (2001)' }] : [{ kind: 'tv', label: 'Friends S01E01' }], active: [] }; },
  };
  const ctx = {
    config: cfg, store, bot, queue, peerStore: (n) => (n === 'group-activity' ? activity : fakeStore()),
    log: { info() {}, warn() {}, error() {}, debug() {} }, configStore: { update() {} },
  };
  return { ctx, out, jobs, store };
}

let seq = 0;
const ask = (who = 'Dana', number = '17130000001') => {
  const id = `MSG${++seq}`;
  return {
    id, key: { id, remoteJid: REQ }, text: 'Romeo and Juliet', chatJid: REQ, isGroup: true, fromMe: false, messageType: 'conversation',
    senderJid: `${who}@lid`, senderNumber: number, senderNumberDisplay: `+${number}`, pushName: who, timestamp: Date.now(),
  };
};
const reacted = (out, msg) => out.filter((e) => e.op === 'react' && e.id === msg.id).map((e) => e.emoji);
const repliesIn = (out, jid) => out.filter((e) => e.op === 'text' && e.jid === jid);
const rowOf = (store, id) => (store.data.history ?? []).find((h) => h.id === id);
moviePlugin._reactors = new Map();

console.log('=== the incident: asked for again 95 seconds after it was posted ===');
{
  const r = rig({ ago: 95_000, filmsWaiting: true });
  const msg = ask();
  await moviePlugin.onMessage(msg, r.ctx);
  ok(r.jobs.length === 0, 'not queued');
  ok(reacted(r.out, msg).at(-1) === '🤥', `answered 🤥 (${reacted(r.out, msg).join(' ')})`);
  ok(rowOf(r.store, msg.id)?.status === 'already-posted' && /less than 24 hours/.test(rowOf(r.store, msg.id)?.detail ?? ''),
    `History says why (${rowOf(r.store, msg.id)?.status}: ${rowOf(r.store, msg.id)?.detail})`);
  ok(!r.out.some((e) => e.op === 'text' && e.jid !== NOTIFY), 'within 24 hours the 🤥 is the whole answer');
}
{
  // Within 24 hours even with no film waiting, and even for someone who joined since.
  const r = rig({ ago: 3 * 3_600_000, filmsWaiting: false,
    events: [{ ts: Date.now() - 3_600_000, action: 'add', groupJid: POSTS, targets: [{ jid: 'Dana@lid', number: null }] }] });
  const msg = ask();
  await moviePlugin.onMessage(msg, r.ctx);
  ok(r.jobs.length === 0 && reacted(r.out, msg).at(-1) === '🤥', 'within 24 hours it is 🤥 whatever else is true');
}

console.log('=== within a week: told in the group when, and where to ask ===');
{
  const r = rig({ ago: 3 * DAY, filmsWaiting: true });
  const msg = ask();
  await moviePlugin.onMessage(msg, r.ctx);
  ok(r.jobs.length === 0 && reacted(r.out, msg).at(-1) === '🤥', 'a member who was in the group, with films waiting: 🤥, not queued');
  const replies = repliesIn(r.out, REQ);
  ok(replies.length === 1 && replies[0].quoted === msg.id, 'one reply, in the request group, quoting the request');
  ok(!r.out.some((e) => e.op === 'text' && /@s\.whatsapp\.net$|@lid$/.test(e.jid)), 'nothing sent to the member privately');
  const body = replies[0]?.body ?? '';
  ok(/Romeo and Juliet \(1968\)\* was already posted on \w+day \d+ \w+ at \d{2}:\d{2}/.test(body), `says when it was posted: "${body.split('\n')[0]}"`);
  ok(/further issues with this decision, ask in the discussions group/.test(body), 'and where to take it');
  ok(rowOf(r.store, msg.id)?.status === 'already-posted', 'History: already-posted');
}
{
  const r = rig({ ago: 3 * DAY, filmsWaiting: true, subject: '06 MOVIE DISCUSSIONS' });
  const msg = ask();
  await moviePlugin.onMessage(msg, r.ctx);
  ok(/ask in 06 MOVIE DISCUSSIONS\./.test(repliesIn(r.out, REQ)[0]?.body ?? ''), 'names 06 MOVIE DISCUSSIONS when the bot knows the group');
}

console.log('=== within a week: queued as usual when it would help ===');
{
  const r = rig({ ago: 3 * DAY, filmsWaiting: true,
    events: [{ ts: Date.now() - DAY, action: 'add', groupJid: POSTS, targets: [{ jid: 'other@lid', number: '17130000001' }] }] });
  const msg = ask();
  await moviePlugin.onMessage(msg, r.ctx);
  ok(r.jobs.length === 1, 'joined the posts group after it was posted (matched by number): queued');
  ok(!repliesIn(r.out, REQ).length && !reacted(r.out, msg).includes('🤥'), 'with no 🤥 and no reply');
}
{
  const r = rig({ ago: 3 * DAY, filmsWaiting: true,
    events: [{ ts: Date.now() - DAY, action: 'add', groupJid: REQ, targets: [{ jid: 'Dana@lid' }] }] });
  await moviePlugin.onMessage(ask(), r.ctx);
  ok(r.jobs.length === 0, 'joining another group since does not count - only the posts group, where the file is');
}
{
  const r = rig({ ago: 3 * DAY, filmsWaiting: false });
  await moviePlugin.onMessage(ask(), r.ctx);
  ok(r.jobs.length === 1, 'no film waiting (TV only): the old file may not work - queued again');
}
{
  const r = rig({ ago: 8 * DAY, filmsWaiting: true });
  await moviePlugin.onMessage(ask(), r.ctx);
  ok(r.jobs.length === 1, 'posted over a week ago: queued as usual');
}
{
  const r = rig({ ago: 2 * 3_600_000, filmsWaiting: true, admin: true });
  await moviePlugin.onMessage(ask(), r.ctx);
  ok(r.jobs.length === 1, 'an admin\'s request is not held back');
}
{
  const r = rig({ ago: 2 * 3_600_000, filmsWaiting: true, quality: '480p' });
  await moviePlugin.onMessage(ask(), r.ctx);
  ok(r.jobs.length === 1, 'only a smaller copy was posted: the full one is a different file, queued');
}

console.log('=== the rules on their own ===');
{
  const now = 1_800_000_000_000;
  const j = (o) => judgeRepost({ now, ...o });
  ok(j({ postedAt: null }).go, 'never posted: go');
  ok(!j({ postedAt: now - DAY + 1 }).go && !j({ postedAt: now - DAY + 1 }).tell, 'a minute under a day: no, without a reply');
  ok(!j({ postedAt: now - DAY, filmsWaiting: true }).go && j({ postedAt: now - DAY, filmsWaiting: true }).tell, 'a day exactly, films waiting: no, with a reply');
  ok(j({ postedAt: now - WEEK }).go, 'a week exactly: go');
  ok(j({ postedAt: now - 2 * DAY, filmsWaiting: true, joinedAt: now - DAY }).go, 'joined after: go');
  ok(!j({ postedAt: now - 2 * DAY, filmsWaiting: true, joinedAt: now - 3 * DAY }).go, 'joined before: no');
  const rows = [
    { status: 'sent', imdbId: 'tt1', finishedAt: 10 }, { status: 'sent', imdbId: 'tt1', finishedAt: 30 },
    { status: 'failed', imdbId: 'tt1', finishedAt: 50 }, { status: 'sent', imdbId: 'tt2', finishedAt: 60 },
    { status: 'sent', title: 'Heat', year: 1995, at: 70 },
  ];
  ok(lastPosted(rows, { imdbId: 'tt1' })?.at === 30, 'the newest sent row of the film, not a failed one');
  ok(lastPosted(rows, { title: 'heat', year: '1995' })?.at === 70, 'by title and year when there is no IMDb id');
  const ev = [
    { ts: 5, action: 'add', groupJid: 'g', targets: [{ jid: 'a@lid' }] },
    { ts: 9, action: 'remove', groupJid: 'g', targets: [{ jid: 'a@lid' }] },
    { ts: 3, action: 'add', groupJid: 'g', targets: [{ jid: 'x@lid', number: '15550001111' }] },
  ];
  ok(joinedAt(ev, 'g', { jid: 'a@lid' }) === 5 && joinedAt(ev, 'g', { number: '+1 555 000 1111' }) === 3 && joinedAt(ev, 'g', { jid: 'z@lid' }) === null,
    'the last add naming them, by id or number; none seen is null');
  ok(postedWhen(Date.UTC(2026, 10, 8, 21, 16), 'America/New_York') === 'Sunday 8 Nov at 16:16', `on the 24-hour clock, New York time (${postedWhen(Date.UTC(2026, 10, 8, 21, 16), 'America/New_York')})`);
  ok(/^🤥 \*Heat \(1995\)\* was already posted on/.test(repostReply({ title: 'Heat', year: 1995, at: 0, timeZone: 'UTC', where: 'X' })), 'the reply starts with the film in bold');
}
{
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  ok(/const ACTIVITY_EVENTS = 2000;/.test(src) && /activity\.push\('events', ev, ACTIVITY_EVENTS\)/.test(src), 'index.js keeps 2,000 activity events, weeks of joins');
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
if (fail) process.exit(1);
