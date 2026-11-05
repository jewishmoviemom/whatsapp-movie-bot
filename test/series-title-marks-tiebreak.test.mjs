/* Incident 2026-11-05 06:09Z: a member asked "what if...? season 01" for the
   Marvel series and was sent WHAT / IF (2019) a third time, because both
   titles normalise to "what if" and the first listed won the tie. */
import { bestMatch } from '../src/util/fuzzy.js';
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail = 1; };
const items = [{ title: 'WHAT / IF', year: 2019 }, { title: 'What If...?', year: 2021 }];
ok(bestMatch('what if...?', items)?.item.title === 'What If...?', 'marks in the request pick the title with marks');
ok(bestMatch('what if', items)?.item.title === 'WHAT / IF', 'no marks keeps the plain title');
ok(bestMatch('what if...?', [...items].reverse())?.item.title === 'What If...?', 'order does not matter');
process.exit(fail);
