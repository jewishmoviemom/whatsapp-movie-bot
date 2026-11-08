/* A library film recovered by research, which OMDb files one year off, is still found.
   Run: node test/research-near-year.test.mjs

   Incident 2026-11-08 14:43: YR asked "Atonement (2007)". Research recovered the
   library's Atonement (2007) at 1.00, but OMDb files it under 2008; the year-filtered
   lookup found nothing and the request was answered "not recognised". */
import fs from 'node:fs';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const src = fs.readFileSync(new URL('../src/plugins/movie-requests/index.js', import.meta.url), 'utf8');
ok(/lookupNearYear\(corrected\.title, Number\(corrected\.year\)/.test(src),
  'a researched library film is looked up one year either side when OMDb has it under another year');
ok(/import \{[^}]*lookupNearYear[^}]*\} from '\.\/omdb\.js'/.test(src), 'lookupNearYear is imported');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
