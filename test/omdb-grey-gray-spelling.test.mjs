// Incident 2026-10-27 19:01Z: "the grey man" resolved to an obscure 2007
// record because the catalogue's "The Gray Man" (2022) fitted only 0.875,
// under the 0.9 bar for replacing it. A British spelling must fit as well as
// the American one.
import { titleFit } from '../src/plugins/movie-requests/omdb.js';
let failed = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) failed++; };
ok(titleFit('the grey man', 'The Gray Man').fit >= 0.9, 'grey fits Gray at STRONG_FIT');
ok(titleFit('the grey man', 'The Gray Man').names, 'grey names The Gray Man');
ok(titleFit('colour of money', 'The Color of Money').fit > 0.7, 'colour fits color');
ok(titleFit('the grey man', 'The Grey Man').fit === 1, 'exact still 1');
ok(titleFit('the grey man', 'The Great Man').fit < 0.9, 'other titles unaffected');
process.exit(failed ? 1 : 0);
