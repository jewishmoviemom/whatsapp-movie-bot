// Incident 2026-11-08: a member sent "once upon a time2011" (no space before the year)
// and was told the series is not in the library; it is, as "Once Upon a Time (2011)".
import { stripTrailingYear } from '../src/plugins/tv-requests/parse.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.log('FAIL', n); } else console.log('ok', n); };
let r = stripTrailingYear('once upon a time2011');
ok(r.show === 'once upon a time' && r.year === 2011, 'glued year after a letter is stripped');
r = stripTrailingYear('The Boys 2019');
ok(r.show === 'The Boys' && r.year === 2019, 'spaced year still stripped');
r = stripTrailingYear('1883');
ok(r.show === '1883' && r.year === null, 'number-named show untouched');
r = stripTrailingYear('Catch22');
ok(r.year === null, 'short digits untouched');
process.exit(bad ? 1 : 0);
