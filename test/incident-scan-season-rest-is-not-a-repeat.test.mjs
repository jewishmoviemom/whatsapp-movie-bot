// Incident 20261106T190002Z: +1908***4834 sent "breaking bad S02" twice an hour
// apart. The first queued E1-E10 (the per-request cap, `cut`), the second -
// the same words - was handed the rest, S02E11-E13. The scanner called it a
// repeat because a whole-season ask has no span to compare with the cut.
import { requestChains } from '../src/core/incident-scan.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const NOW = Date.parse('2026-11-06T19:00:00Z');
const MIN = 60_000;
const row = (id, at, detail, extra = {}) => ({
  id, request: 'breaking bad S02', title: 'Breaking Bad', season: 2, status: 'queued', detail,
  requesterNumber: '+1908***4834', requestedAt: at, at, ...extra,
});
const first = row('A', NOW - 65 * MIN, 'S02E01–E10 — 10 of season 2', {
  episodes: 10, cut: { limit: 10, count: 10, of: 13, queued: [[1, 10]], left: [[11, 13]], parts: [[11, 13]] },
});
const rest = row('B', NOW - 4 * MIN, 'S02E11–E13 — 3 of season 2', { episodes: 3 });
let c = requestChains({ 'tv-requests': { history: [first, rest] } });
ok(c.length === 2, 'a whole-season ask handed the rest of a capped season is not a repeat');
const again = row('B', NOW - 4 * MIN, 'S02E05–E08 — 4 of season 2', { episodes: 4 });
c = requestChains({ 'tv-requests': { history: [first, again] } });
ok(c.length === 1 && c[0].rows.length === 2, 'episodes already queued, asked for again, is still a repeat');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
