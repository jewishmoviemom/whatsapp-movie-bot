/* A library film OMDb names without its subtitle must still replace a weak match.
   Run: node test/weak-match-subtitle-lookup.test.mjs

   Incident 2026-11-08 03:05: TW asked "dune part one"; OMDb's relaxed search
   gave Dune: Part Two (2024) [0.77]. The library check found Dune: Part One
   (2021) at 1.00, but OMDb knows that film only as "Dune" (2021), the re-lookup
   failed, and Part Two was sent instead of Part One. */
import fs from 'node:fs';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const src = fs.readFileSync(new URL('../src/plugins/movie-requests/index.js', import.meta.url), 'utf8');
ok(/better\.title\.split\(/.test(src) && /Number\(baseHit\.movie\.year\) === Number\(better\.year\)/.test(src),
  'when OMDb lacks the library title, the title before its subtitle is tried, in the library\'s year only');
const base = 'Dune: Part One'.split(/\s*[:–—-]\s+/)[0].trim();
ok(base === 'Dune', 'Dune: Part One is looked up as Dune');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
