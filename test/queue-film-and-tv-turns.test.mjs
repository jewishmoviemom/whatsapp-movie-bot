/* Films ranked among films, TV taking turns, and an admin's "not extra".
   Run: node test/queue-film-and-tv-turns.test.mjs

   2026-11-08: Mia asked for A Cinderella Story: Once Upon a Song at 15:52
   New York time with her Dick Van Dyke Show episodes waiting since 13:17.
   The fair order counted the episodes, so the film was her second request,
   and seven first films asked for after it started ahead of it - one in a
   slot that stood free - while the episodes could not start before the
   films anyway. The operator, 2026-11-09:

   - "being that TV reqs always go after films, her film request should have
     joined the queue in order" (queue.rankByKind);
   - "each request gets epsiode 1 right away and if there are multiple shows
     (with no movies ahead in queue) the remaining episodes should get bumped
     to 1 persons request after the other" (queue.tvTakeTurns);
   - "in admin panel I should have option to unmark items as extra (for a
     case like Mia that I want to give courtesy)" (queue.courtesy). */
import fs from 'node:fs';
import { JobQueue } from '../src/core/queue.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const tick = () => new Promise((r) => setTimeout(r, 15));

/** Jobs that start when the queue says and end when the test says. */
function jobs(order) {
  const gates = new Map();
  const make = (label, who, extra = {}) => {
    let release;
    const done = new Promise((r) => { release = r; });
    gates.set(label, release);
    const meta = { ...(who ? { memberKey: who } : {}), ...(extra.meta ?? {}) };
    return { label, ...extra, meta, run: async () => { order.push(label); await done; } };
  };
  const release = async (label) => { gates.get(label)?.(); await tick(); };
  return { make, release };
}
/** A season of `n` episodes as the TV plugin queues it: one group, the member on the group. */
const season = (make, who, name, n, extra = {}) => Array.from({ length: n }, (_, i) => make(`${name}E${i + 1}`, null, {
  kind: 'tv', group: `${who}:${name}`, groupLabel: name, groupMeta: { memberKey: who, ...(extra.groupMeta ?? {}) },
}));
const waiting = (q) => q.snapshot().pending.map((e) => e.label);
/** Run the queue to the end, one job at a time (concurrency 1), releasing whatever started last. */
async function runAll(q, order, release, max = 40) {
  q.resume();
  await tick();
  for (let i = 0; i < max && (q.pending.length || q.active.size); i++) await release(order[order.length - 1]);
}

console.log('=== the config turns both on; a queue built without it is the old one ===');
ok(DEFAULT_CONFIG.queue.rankByKind === true && DEFAULT_CONFIG.queue.tvTakeTurns === true, 'on by default in the config');
{
  const q = new JobQueue({});
  ok(q.rankByKind === false && q.tvTakeTurns === false, 'off in a bare JobQueue, as fairShare is');
  ok(q.setFairShare({ rankByKind: true, tvTakeTurns: true }) === true && q.rankByKind && q.tvTakeTurns, 'and setFairShare() switches them live');
}
{
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  ok((src.match(/rankByKind: (?:config|cfg)\.queue\?\.rankByKind !== false/g) ?? []).length === 2
    && (src.match(/tvTakeTurns: (?:config|cfg)\.queue\?\.tvTakeTurns !== false/g) ?? []).length === 2,
  'index.js passes both at start and on every settings change');
}

console.log('=== Mia: a waiting TV request does not make her film an extra ===');
for (const byKind of [true, false]) {
  const q = new JobQueue({ concurrency: 1, fairShare: true, strictMoviePriority: true, rankByKind: byKind });
  const order = [];
  const { make } = jobs(order);
  q.pause();
  for (const j of season(make, 'M', 'DickVanDyke', 3)) q.add(j);
  q.add(make('Cinderella', 'M'));
  q.add(make('Romeo', 'L'));
  q.add(make('Duchess', 'Y'));
  const line = waiting(q).join();
  const cind = q.snapshot().pending.find((e) => e.label === 'Cinderella');
  if (byKind) {
    ok(line.startsWith('Cinderella,Romeo,Duchess'), `on: her film keeps its place among the films (${line})`);
    ok(!cind?.fair?.extra, 'and is not shown as an extra');
  } else {
    ok(line.startsWith('Romeo,Duchess,Cinderella'), `off, as before: her film is her second request and goes behind (${line})`);
    ok(cind?.fair?.extra === true, 'and is shown as an extra');
  }
}
{
  // Her second film is still an extra: only the other kind stops counting.
  const q = new JobQueue({ concurrency: 1, fairShare: true, rankByKind: true });
  const { make } = jobs([]);
  q.pause();
  for (const j of season(make, 'M', 'DVD', 2)) q.add(j);
  q.add(make('M-film1', 'M'));
  q.add(make('M-film2', 'M'));
  q.add(make('L-film1', 'L'));
  ok(waiting(q).slice(0, 3).join() === 'M-film1,L-film1,M-film2', `a member's second film is still behind others' first (${waiting(q).slice(0, 3).join()})`);
  // And the TV side the same way: her film does not make her season an extra.
  q.add(make('X-show', null, { kind: 'tv', group: 'X:show', groupMeta: { memberKey: 'X' } }));
  const tv = q.snapshot().pending.filter((e) => e.kind === 'tv').map((e) => `${e.label}${e.fair?.extra ? '*' : ''}`);
  ok(tv.join() === 'DVD,X-show', `her season, asked for before her films, is still first in the TV line (${tv.join()})`);
}

console.log('=== TV takes turns: every request its first episode, then one each ===');
{
  const order = [];
  const q = new JobQueue({ concurrency: 1, fairShare: true, tvTakeTurns: true });
  const { make, release } = jobs(order);
  q.pause();
  for (const j of [...season(make, 'A', 'A', 3), ...season(make, 'B', 'B', 3), ...season(make, 'C', 'C', 2)]) q.add(j);
  await runAll(q, order, release);
  ok(order.join() === 'AE1,BE1,CE1,AE2,BE2,CE2,AE3,BE3', `first episodes, then round the requests (${order.join()})`);
}
{
  // Off, as before: a season that has started runs to its end first.
  const order = [];
  const q = new JobQueue({ concurrency: 1, fairShare: true, tvTakeTurns: false });
  const { make, release } = jobs(order);
  q.pause();
  for (const j of [...season(make, 'A', 'A', 2), ...season(make, 'B', 'B', 2)]) q.add(j);
  await runAll(q, order, release);
  ok(order.join() === 'AE1,AE2,BE1,BE2', `off: each season whole (${order.join()})`);
}
{
  // A request bumped behind running shows gets its first episode as soon as one may start.
  const order = [];
  const q = new JobQueue({ concurrency: 1, fairShare: true, tvTakeTurns: true });
  const { make, release } = jobs(order);
  for (const j of season(make, 'A', 'A', 4)) q.add(j);
  await tick();
  for (const j of season(make, 'D', 'D', 2)) q.add(j);
  await release('AE1');
  ok(order.join() === 'AE1,DE1', `a show asked for while another runs gets its first episode next (${order.join()})`);
  ok(!q.snapshot().pending.some((e) => e.label === 'D' && e.place), 'and is running, so it has no place number');
  for (let i = 0; i < 6; i++) await release(order[order.length - 1]);
  ok(order.join() === 'AE1,DE1,AE2,DE2,AE3,AE4', `then they alternate until one is done (${order.join()})`);
}
{
  // A member's second request - season 2, the next part of a cut request -
  // waits behind their first, and takes no first-episode turn of its own.
  const order = [];
  const q = new JobQueue({ concurrency: 1, fairShare: true, tvTakeTurns: true });
  const { make, release } = jobs(order);
  q.pause();
  for (const j of [...season(make, 'A', 'AS1', 2), ...season(make, 'A', 'AS2', 2), ...season(make, 'B', 'B', 2)]) q.add(j);
  await runAll(q, order, release);
  ok(order.join() === 'AS1E1,BE1,AS1E2,AS2E1,BE2,AS2E2', `season 2 waits for season 1, then joins the turns (${order.join()})`);
}
{
  // Films still go first: one asked for mid-turns starts next.
  const order = [];
  const q = new JobQueue({ concurrency: 1, fairShare: true, tvTakeTurns: true, strictMoviePriority: true });
  const { make, release } = jobs(order);
  q.pause();
  for (const j of [...season(make, 'A', 'A', 2), ...season(make, 'B', 'B', 2)]) q.add(j);
  q.resume();
  await tick();
  q.add(make('Film', 'F'));
  for (let i = 0; i < 6; i++) await release(order[order.length - 1]);
  ok(order.join() === 'AE1,Film,BE1,AE2,BE2', `a film goes before the next episode (${order.join()})`);
}
{
  // Two slots for TV (one kept for films): two different requests run at once.
  const order = [];
  const q = new JobQueue({ concurrency: 3, fairShare: true, tvTakeTurns: true });
  const { make } = jobs(order);
  q.pause();
  for (const j of [...season(make, 'A', 'A', 3), ...season(make, 'B', 'B', 3)]) q.add(j);
  q.resume();
  await tick();
  ok(order.join() === 'AE1,BE1', `with two TV slots, the first episodes of two requests (${order.join()})`);
}

console.log('=== Not extra: an admin\'s courtesy ===');
{
  const q = new JobQueue({ concurrency: 1, fairShare: true, rankByKind: true });
  const { make } = jobs([]);
  q.pause();
  q.add(make('M-film1', 'M', { meta: { jobKey: 'k1' } }));
  q.add(make('M-film2', 'M', { meta: { jobKey: 'k2' } }));
  q.add(make('L-film1', 'L', { meta: { jobKey: 'k3' } }));
  q.add(make('Z-film1', 'Z', { meta: { jobKey: 'k4' } }));
  ok(waiting(q).join() === 'M-film1,L-film1,Z-film1,M-film2', `before: her second film is last (${waiting(q).join()})`);
  const id = q.snapshot().pending.find((e) => e.label === 'M-film2').id;
  let states = 0;
  q.on('state', () => { states += 1; });
  const r = q.courtesy(id);
  ok(r?.key === 'k2' && r.kind === 'movie' && r.wasRank === 2, `answers the journal key, the kind and its old rank (${JSON.stringify(r)})`);
  ok(waiting(q).join() === 'M-film1,M-film2,L-film1,Z-film1', `after: in the order it was asked for, among the first requests (${waiting(q).join()})`);
  ok(!q.snapshot().pending.find((e) => e.label === 'M-film2')?.fair?.extra, 'and no longer shown as an extra');
  ok(states > 0, 'the panel and the place-in-line reactions are told');
  q.add(make('M-film3', 'M', { meta: { jobKey: 'k5' } }));
  ok(q.snapshot().pending.find((e) => e.label === 'M-film3')?.fair?.rank === 3, 'it still counts against her later requests');
  ok(q.courtesy('nope') === null, 'an unknown id is refused');
  const first = q.snapshot().pending.find((e) => e.label === 'L-film1').id;
  ok(q.courtesy(first)?.wasRank === 1, 'a first request can be given it too, and changes nothing');
}
{
  // A season: the key is the request key the TV plugin journals.
  const q = new JobQueue({ concurrency: 1, fairShare: true });
  const { make } = jobs([]);
  q.pause();
  for (const j of season(make, 'M', 'S1', 2)) q.add(j);
  for (const j of season(make, 'M', 'S2', 2)) q.add(j);
  const id = q.snapshot().pending.find((e) => e.label === 'S2').id;
  const r = q.courtesy(id);
  ok(r?.key === 'M:S2' && r.kind === 'tv', `a season answers its group key (${JSON.stringify(r)})`);
}
{
  // Kept across a restart: the job's meta, or what expectBack is told.
  const q = new JobQueue({ concurrency: 1, fairShare: true });
  const { make } = jobs([]);
  q.pause();
  q.add(make('M-film1', 'M'));
  q.add(make('M-film2', 'M', { meta: { courtesy: true } }));
  q.add(make('L-film1', 'L'));
  ok(waiting(q).join() === 'M-film1,M-film2,L-film1', `a job queued with courtesy in its meta is a first request (${waiting(q).join()})`);
  const q2 = new JobQueue({ concurrency: 1, fairShare: true });
  q2.pause();
  q2.expectBack([
    { key: 'a', kind: 'movie', meta: { memberKey: 'M' }, at: 1, started: false },
    { key: 'b', kind: 'movie', meta: { memberKey: 'M', courtesy: true }, at: 2, started: false },
  ]);
  q2.add(make('L-film1', 'L'));
  q2.add(make('M-film2', 'M', { rankKey: 'b' }));
  q2.add(make('M-film1', 'M', { rankKey: 'a' }));
  ok(!q2.snapshot().pending.find((e) => e.label === 'M-film2')?.fair?.extra, 'and one expectBack was told had it comes back as a first request');
}

console.log('=== the plugins journal it, and the panel offers it ===');
{
  const movie = (await import('../src/plugins/movie-requests/index.js')).default;
  const tv = (await import('../src/plugins/tv-requests/index.js')).default;
  const store = (pending) => { let v = pending; return { get: () => v, set: (k, x) => { v = x; } }; };
  const m = store([{ jobKey: 'k2', meta: { memberKey: 'M' } }]);
  ok(movie.markCourtesy({ store: m }, 'k2') === true && m.get()[0].meta.courtesy === true, 'the film plugin keeps it in the journal entry\'s meta');
  ok(movie.markCourtesy({ store: m }, 'missing') === false, 'and says so when the entry is gone');
  const t = store([{ reqKey: 'M:S2', memberKey: 'M' }]);
  ok(tv.markCourtesy({ store: t }, 'M:S2') === true && t.get()[0].courtesy === true, 'the TV plugin keeps it on the request');
  const g = tv._groupOf({ reqKey: 'M:S2', label: 'S2', memberKey: 'M', courtesy: true }, { series: 'x', season: 2 });
  ok(g.groupMeta.courtesy === true, 'and hands it to the queue with every episode it queues');
  const api = fs.readFileSync(new URL('../src/web/api.js', import.meta.url), 'utf8');
  ok(/router\.post\('\/queue\/:id\/courtesy'/.test(api) && /markCourtesy/.test(api) && /unmarked .* as an extra/.test(api), 'POST /queue/:id/courtesy journals it and writes the audit log');
  const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');
  ok(/j\.fair\?\.extra \? `<button[^`]*unmarkExtra\('\$\{j\.id\}'\)">Not extra<\/button>`/.test(app), 'the panel shows "Not extra" on each waiting extra request');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
