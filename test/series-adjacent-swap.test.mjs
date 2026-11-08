// Incident 2026-11-08: a member asked for "sekirie season 1"; the library
// holds Sekirei. The two swapped letters scored 0.857, under the 0.9 bar of the
// wide-net steps, so the bot said "no series matching". An adjacent swap now counts.
import assert from 'node:assert';
import { findSeries, isAdjacentSwap } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

assert(isAdjacentSwap('sekirie', 'sekirei'));
assert(!isAdjacentSwap('crew girl', 'crow girl'), 'a substitution is a different show');
assert(!isAdjacentSwap('abcde', 'abdce'), 'too short');
assert(!isAdjacentSwap('sekirei', 'sekirei'));

const fetchImpl = async (url) => {
  const u = new URL(url);
  const items = u.searchParams.get('searchTerm') ? [] : [
    { Id: 'x', Name: 'Sekirei', ProductionYear: 2008, RecursiveItemCount: 12 },
    { Id: 'y', Name: 'The Crow Girl', ProductionYear: 2015, RecursiveItemCount: 6 },
  ];
  return { ok: true, status: 200, json: async () => ({ Items: items, TotalRecordCount: items.length, SearchHints: [] }), text: async () => '' };
};
const opts = { base: 'http://j', token: 't', fetchImpl, bestMatch };
const r = await findSeries('sekirie', opts);
assert.equal(r?.name, 'Sekirei');
assert.equal(await findSeries('crew girl', opts), null);
console.log('ok series-adjacent-swap');
