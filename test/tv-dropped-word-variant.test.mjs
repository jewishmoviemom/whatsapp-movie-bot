/* An extra word typed in a show's name is dropped as a last try.
   Run: node test/tv-dropped-word-variant.test.mjs

   Incident 2026-10-27, 02:49Z: "marvels secret agents of shield s01 e1-10"
   was answered "no series matching" although "Marvel's Agents of
   S.H.I.E.L.D." is on the server: with "secret" it scores 0.81, under the
   0.9 bar of the word search. */
import { droppedWordVariants, findSeries } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

let fail = 0;
const ok = (c, m) => { c || fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); };
const v = droppedWordVariants('marvels secret agents of shield');
ok(v[0] === 'marvels agents of shield' && v.length === 3, 'interior words dropped one at a time');
ok(droppedWordVariants('the walking dead').length === 0, 'short titles are left alone');

const SHOW = { Id: 'a1', Name: "Marvel's Agents of S.H.I.E.L.D.", ProductionYear: 2013, RecursiveItemCount: 136 };
const fetchImpl = async (url) => {
  const u = new URL(String(url));
  const term = u.searchParams.get('searchTerm');
  const items = term === 'agents' || term === 'marvels agents of shield' ? [SHOW] : [];
  const body = u.pathname.endsWith('/Search/Hints') ? { SearchHints: [] } : { Items: items, TotalRecordCount: items.length };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};
const r = await findSeries('marvels secret agents of shield', { base: 'http://x', token: 't', fetchImpl, bestMatch });
ok(r?.id === 'a1' || r?.Id === 'a1' || /S\.H\.I\.E\.L\.D/.test(r?.name ?? r?.Name ?? ''), 'the series is found');
process.exit(fail ? 1 : 0);
