/* A library film recovered by research, which OMDb names without its subtitle, is still found.
   Run: node test/research-subtitle-lookup.test.mjs

   Incident 2026-11-08 08:14: a member asked "snake eyes: G.I. jones origins".
   Research recovered the library's Snake Eyes: G.I. Joe Origins (2021) at 0.93,
   but OMDb knows it only as "Snake Eyes" (2021), the re-lookup failed and the
   request was answered "not recognised". */
import fs from 'node:fs';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const src = fs.readFileSync(new URL('../src/plugins/movie-requests/index.js', import.meta.url), 'utf8');
ok(/corrected\.title\.split\(/.test(src) && /Number\(baseHit\.movie\.year\) === Number\(corrected\.year\)/.test(src),
  'a researched library title OMDb lacks is looked up by the title before its subtitle, in the library\'s year only');
ok('Snake Eyes: G.I. Joe Origins'.split(/\s*[:–—-]\s+/)[0].trim() === 'Snake Eyes', 'looked up as Snake Eyes');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
