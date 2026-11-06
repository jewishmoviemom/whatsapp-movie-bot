/* A one-word title typed as two words is still found.
   Run: node test/series-joined-words.test.mjs

   Incident (hourly check 20261106T160001Z): "bay watch s01 episodes 1-10" was
   answered "no series matching" while "Baywatch" (1989) is in the library. */
import { findSeries, joinedWordsVariant } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const library = [{ Id: 'B', Name: 'Baywatch', ProductionYear: 1989, RecursiveItemCount: 200 }];
const fetchImpl = async (raw) => {
  const url = new URL(String(raw));
  const term = (url.searchParams.get('searchTerm') ?? '').toLowerCase();
  const Items = term ? library.filter((i) => i.Name.toLowerCase().includes(term)) : library;
  const body = url.pathname.endsWith('/Search/Hints') ? { SearchHints: [] } : { Items, TotalRecordCount: Items.length };
  return { ok: true, status: 200, json: async () => body };
};
const OPTS = { base: 'http://jf', token: 'T', userId: 'U', bestMatch, fetchImpl };
ok(joinedWordsVariant('bay watch') === 'baywatch', 'two words are joined');
ok(joinedWordsVariant('Baywatch') === null, 'one word is left alone');
ok(joinedWordsVariant('the office us uk fr') === null, 'long titles are left alone');
const r = await findSeries('bay watch', OPTS);
ok(r && (r.id === 'B' || r.Id === 'B'), `"bay watch" finds Baywatch (${JSON.stringify(r)?.slice(0, 80)})`);
ok(await findSeries('no such', OPTS) === null, 'a show that is not there is still not found');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
