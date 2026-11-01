/* "mission impossible 1" is Mission: Impossible (1996), not its making-of.
   Run: node test/omdb-first-film-of-franchise.test.mjs

   Incident 2026-10-27, 02:02Z: "mission impossible 1" resolved to "22. The
   Making of 'Mission: Impossible' (1996), Part 1", and no well-known film
   replaced it because franchiseSequel refused a typed 1; the member was sent
   to the TV group. The first film is the bare-name one. OMDb is stubbed. */
import { lookupMovie } from '../src/plugins/movie-requests/omdb.js';

let fail = 0;
const ok = (c, m) => { c || fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); };
const film = (Title, Year, imdbID, more = {}) => ({
  Title, Year: String(Year), imdbID, Type: 'movie', Response: 'True', Rated: 'PG-13', Runtime: '110 min',
  Genre: 'Action', Writer: 'A', Actors: 'B', Plot: 'x', imdbVotes: '400,000', ...more,
});
const DOC = film("22. The Making of 'Mission: Impossible' (1996), Part 1", 1996, 'tt0000001', { Genre: 'Short, Documentary', Runtime: '5 min', imdbVotes: '9' });
const M1 = film('Mission: Impossible', 1996, 'tt0117060');
const M2 = film('Mission: Impossible II', 2000, 'tt0120755');
const row = (f) => ({ Title: f.Title, Year: f.Year, imdbID: f.imdbID, Type: 'movie' });
const table = { 't:mission impossible 1|': DOC, 's:mission impossible 1|': [row(DOC)], 's:mission impossible|': [row(M1), row(M2), row(DOC)] };
for (const f of [DOC, M1, M2]) table[`i:${f.imdbID}`] = f;
globalThis.fetch = async (url) => {
  const p = new URL(String(url)).searchParams;
  const key = p.get('i') ? `i:${p.get('i')}` : p.get('t') ? `t:${p.get('t').toLowerCase()}|${p.get('y') ?? ''}` : `s:${p.get('s').toLowerCase()}|${p.get('y') ?? ''}`;
  let body = table[key] ?? { Response: 'False', Error: 'Movie not found!' };
  if (Array.isArray(body)) body = { Response: 'True', Search: body, totalResults: String(body.length) };
  return new Response(JSON.stringify(body), { status: 200 });
};
const f = await lookupMovie('mission impossible 1', { apiKey: 'test' });
ok(f?.movie?.imdbId === 'tt0117060', `"mission impossible 1" -> ${f?.movie?.title} (${f?.movie?.year})`);
process.exit(fail ? 1 : 0);
