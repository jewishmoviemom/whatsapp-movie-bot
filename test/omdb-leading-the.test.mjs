/* A leading "the" the catalogue lacks does not hide the real film behind an
   obscure one.
   Run: node test/omdb-leading-the.test.mjs

   2026-10-26 05:13Z: Jack asked for "the avengers endgame". OMDb's search
   wants every typed word, so it returned only the parody short "Avengers
   Endgame: the Butt Plan" (2019), which was kept after "no well-known film
   answers" and then refused as not in the library, though the library holds
   Avengers: Endgame. Searching again without the "the" finds the real film. */
import { searchVariants } from '../src/plugins/movie-requests/omdb.js';

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); };

ok(searchVariants('the avengers endgame', 'Avengers Endgame: the Butt Plan').includes('avengers endgame'),
  'a leading "the" is dropped as a variant');
ok(!searchVariants('the', 'x').length, 'a lone "the" is not searched bare');
ok(!searchVariants('the matrix', 'x').includes('matrix'), 'a one-word remainder is not searched');
ok(!searchVariants('avengers endgame', 'x').length, 'no "the", no variant');
process.exit(fail ? 1 : 0);
