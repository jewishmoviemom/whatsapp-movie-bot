/* A film whose title is a year is looked up as that title.
   Run: node test/omdb-year-shaped-title.test.mjs

   The incident, 2026-10-28 02:33Z (hourly check 20261028T030001Z): a member
   asked for "1917". The library research recovered "1917" (2019), but the
   re-lookup of "1917 2019" returned nothing: cleanRequestText takes every
   year-shaped number out of a request, left an empty title, and lookupMovie
   gave up before asking OMDb. The member got ❓ "not recognised" for a film
   the server has. */
import { lookupMovie } from '../src/plugins/movie-requests/omdb.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const asked = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const q = Object.fromEntries(u.searchParams);
  asked.push(q);
  const film = { Title: '1917', Year: '2019', Rated: 'R', imdbID: 'tt8579674', Type: 'movie', Response: 'True', Released: 'N/A', DVD: 'N/A' };
  const body = q.t === '1917' && (!q.y || q.y === '2019') ? film : { Response: 'False', Error: 'Movie not found!' };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

for (const text of ['1917', '1917 2019']) {
  asked.length = 0;
  const r = await lookupMovie(text, { apiKey: 'k' });
  ok(r?.movie?.title === '1917', `"${text}" finds the film 1917`);
  ok(asked.length > 0 && asked[0].t === '1917', `"${text}" asks OMDb for the title 1917`);
}
asked.length = 0;
await lookupMovie('1917 2019', { apiKey: 'k' });
ok(asked[0]?.y === '2019', 'a second year is still the film\'s year');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
