/* A TV miss that is a mistyped code is not a library gap. Run: node test/incident-scan-mistyped-miss.test.mjs

   Jake Brown's "Georgie & Mandy's First Marriage SO1E11-E20" (2026-10-18, the
   letter O for the zero) was recorded as a miss before the bot answered such
   requests with the written-wrong reaction. The old miss stayed open and the
   hourly scan reported it as unfulfilled every hour. */
import { scan } from '../src/core/incident-scan.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const NOW = Date.parse('2026-11-01T03:00:00Z');
const HOUR = 3600_000;
const TV_REQ = '120363900000000003@g.us';
const CONFIG = { tvRequests: { enabled: true, requestGroups: [TV_REQ], requirePrefix: true, prefix: '#request' } };
const run = (misses) => scan({
  now: NOW, config: CONFIG, names: {}, unit: { ActiveState: 'active', NRestarts: '0' },
  state: { 'movie-requests': { history: [], pending: [] }, 'tv-requests': { history: [], pending: [], 'library-misses': misses }, 'msg-index': { entries: [] } },
});
const miss = (request, title) => ({
  key: `tv|${title.toLowerCase()}|||`, kind: 'tv', reason: 'not-found', detail: `no series matching "${title}"`,
  request, title, groupJid: TV_REQ, count: 1, firstAt: NOW - 5 * HOUR, lastAt: NOW - HOUR, requesters: ['Jake Brown'], resolved: false,
});

const bad = miss("Georgie & Mandy's First Marriage SO1E11-E20", "Georgie & Mandy's First Marriage SO1E11-E20");
ok(!run([bad]).incidents.some((f) => f.fp === `miss:${bad.key}`), 'a request written wrong is not reported as unfulfilled');
const real = miss('Nosuchshow S01E01', 'Nosuchshow');
ok(run([real]).incidents.some((f) => f.fp === `miss:${real.key}`), 'a genuine miss still is');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
