/* A weak OMDb match must give way to a clearly better library title.
   Run: node test/weak-match-library-check.test.mjs

   Incident 2026-11-01 09:41: Max N asked "Deadpool vs wolvarine"; OMDb's
   relaxed search gave a 2022 fan short (search 0.75), which the library lacks,
   so the answer was "not in the library" while Deadpool & Wolverine (2024) was
   on the server. */
import fs from 'node:fs';
import { researchLibrary } from '../src/plugins/movie-requests/library.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ Items: [{ Name: 'Deadpool & Wolverine', ProductionYear: 2024 }] }), { status: 200 });
const cfg = { provider: 'jellyfin', jellyfin: { baseUrl: 'http://jf.test', authMethod: 'apikey', apiKey: 'k', userId: 'u' } };
try {
  const r = await researchLibrary('Deadpool vs wolvarine', cfg);
  ok(r?.title === 'Deadpool & Wolverine' && r.score >= 0.8, 'the library title outscores the 0.75 weak match');
} finally { globalThis.fetch = realFetch; }

const src = fs.readFileSync(new URL('../src/plugins/movie-requests/index.js', import.meta.url), 'utf8');
ok(/found\.method === 'search' && found\.confidence < 0\.9/.test(src), 'a weak search match is checked against the library');
ok(/Number\(found\.movie\.year\) !== typedYear/.test(src), 'a typed year that the weak match does not carry still lets the library be checked (2026-11-06, a dogs perfect christmas 2026)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
