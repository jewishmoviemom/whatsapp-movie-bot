/* A two-word title typed as one word is still found.
   Run: node test/series-split-word.test.mjs

   Incident (hourly check 20261106T030002Z): "Labrats s2 episodes 01-08" was
   answered "no series matching" while "Lab Rats" (2012) is in the library. */
import { findSeries } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const library = [{ Id: 'L', Name: 'Lab Rats', ProductionYear: 2012, RecursiveItemCount: 80 },
  { Id: 'E', Name: 'Lab Rats: Elite Force', ProductionYear: 2016, RecursiveItemCount: 20 }];
const fetchImpl = async (raw) => {
  const url = new URL(String(raw));
  const term = (url.searchParams.get('searchTerm') ?? '').toLowerCase();
  const Items = term ? library.filter((i) => i.Name.toLowerCase().includes(term)) : library;
  const body = url.pathname.endsWith('/Search/Hints') ? { SearchHints: [] } : { Items, TotalRecordCount: Items.length };
  return { ok: true, status: 200, json: async () => body };
};
const OPTS = { base: 'http://jf', token: 'T', userId: 'U', bestMatch, fetchImpl };
const r = await findSeries('Labrats', OPTS);
ok(r && (r.id === 'L' || r.Id === 'L'), `"Labrats" finds Lab Rats (${JSON.stringify(r)?.slice(0, 80)})`);
ok(await findSeries('Nothingatall', OPTS) === null, 'a show that is not there is still not found');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
