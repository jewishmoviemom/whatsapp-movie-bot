/* A film the server holds under another name is found, when OMDb took the
   request for a short or an unrated record the server does not have.
   Run: node test/film-named-otherwise.test.mjs

   Incident, 2026-10: "The F Word 2013" went to the wanted list as a 9-minute
   British short of that title (tt3360884), and "wardogs" as Wardogs (2022), a
   30-minute film nobody rated; both were requested from the Jellyfin host.
   The server had What If (2013) - The F Word in Britain, TMDB 212716 - and
   War Dogs (2016) all along (the operator, 2026-10-28: "war dogs is only with
   space not wardogs and f word is already in library as what if 2013").
   Pinned here: both are found, with how; a film OMDb read right, or one it
   read as a short the server does hold, is left alone; the year typed still
   rules; two films the squashed name fits are not guessed between; a TMDB
   failure finds nothing rather than throwing; the library listing is asked
   for once and cached; and OMDb's record for the id is what the request
   goes on with. */
import { namedOtherwise, squash, tmdbFirstFilm } from '../src/plugins/movie-requests/named-otherwise.js';
import { createProvider, forgetLibraryIndex } from '../src/plugins/movie-requests/library.js';
import { lookupById } from '../src/plugins/movie-requests/omdb.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

// OMDb's records as it sent them, trimmed to what obscureReason reads.
const short = (title, year, imdbId, runtime) => ({
  imdbId, title, year, rated: null, runtime,
  raw: { Title: title, Year: String(year), imdbID: imdbId, Genre: 'Short', Runtime: runtime, imdbVotes: 'N/A', Rated: 'N/A' },
});
const F_WORD = short('The F Word', 2013, 'tt3360884', '9 min');
const WARDOGS = short('Wardogs', 2022, 'tt28360591', '30 min');
const WHAT_IF_REAL = {
  imdbId: 'tt1486834', title: 'What If', year: 2013, rated: 'PG-13',
  raw: { Title: 'What If', Year: '2013', imdbID: 'tt1486834', Genre: 'Comedy, Romance', Runtime: '98 min', imdbVotes: '80,000', Rated: 'PG-13' },
};
const INDEX = [
  { title: 'What If', year: 2013, imdbId: 'tt1486834', tmdbId: '212716' },
  { title: 'What if...', year: 2010, imdbId: 'tt1468387', tmdbId: '42950' },
  { title: 'War Dogs', year: 2016, imdbId: 'tt2005151', tmdbId: '308266' },
  { title: 'Paddington', year: 2014, imdbId: 'tt1109624', tmdbId: '116149' },
];
// TMDB's first answers, 2026-10-28.
const TMDB = { 'The F Word|2013': { tmdbId: '212716', title: 'What If', year: 2013 }, 'wardogs|': { tmdbId: '80762', title: 'War Dog', year: 1987 } };
const tmdb = async (q, y) => TMDB[`${q}|${y ?? ''}`] ?? null;

console.log('=== "The F Word 2013": TMDB knows it as What If, which the server holds ===');
{
  const hit = await namedOtherwise({ movie: F_WORD, typed: 'The F Word 2013', index: INDEX, tmdb });
  ok(hit?.imdbId === 'tt1486834' && hit.title === 'What If' && hit.year === 2013, `What If (2013): ${JSON.stringify(hit)}`);
  ok(/TMDB knows "The F Word" as "What If"/.test(hit?.via ?? ''), `and says how: ${hit?.via}`);
  ok(await namedOtherwise({ movie: F_WORD, typed: 'The F Word 2013', index: INDEX, tmdb: null }) === null,
    'without a TMDB key, nothing is guessed');
}

console.log('=== "wardogs": War Dogs, the same letters a space apart ===');
{
  ok(squash('War Dogs') === squash('wardogs') && squash('Fast & Furious') === 'fastandfurious', 'squash takes out spaces and punctuation');
  const hit = await namedOtherwise({ movie: WARDOGS, typed: 'wardogs', index: INDEX, tmdb });
  ok(hit?.imdbId === 'tt2005151' && hit.title === 'War Dogs', `War Dogs (2016): ${JSON.stringify(hit)}`);
  ok(/written apart/.test(hit?.via ?? ''), `and says how: ${hit?.via}`);
  ok(await namedOtherwise({ movie: WARDOGS, typed: 'wardogs 2022', index: INDEX, tmdb }) === null,
    'a year typed that is not the server film\'s rules it out');
  const twice = [...INDEX, { title: 'War-Dogs', year: 1999, imdbId: 'tt0000001', tmdbId: '1' }];
  ok(await namedOtherwise({ movie: WARDOGS, typed: 'wardogs', index: twice, tmdb: null }) === null,
    'two films the squashed name fits: neither is guessed');
}

console.log('=== left alone ===');
{
  ok(await namedOtherwise({ movie: WHAT_IF_REAL, typed: 'what if 2013', index: INDEX, tmdb }) === null,
    'a film OMDb read right (votes, a runtime) is never second-guessed');
  ok(await namedOtherwise({ movie: F_WORD, typed: 'The F Word 2013', index: [...INDEX, { title: 'The F Word', year: 2013, imdbId: 'tt3360884' }], tmdb }) === null,
    'a short the server does hold is what was asked for');
  ok(await namedOtherwise({ movie: F_WORD, typed: 'The F Word 2013', index: INDEX, tmdb: async () => { throw new Error('TMDB HTTP 503'); } }) === null,
    'a TMDB failure finds nothing, and does not throw');
  ok(await namedOtherwise({ movie: F_WORD, typed: 'The F Word 2013', index: INDEX, tmdb: async () => ({ tmdbId: '999', title: 'Not held' }) }) === null,
    'TMDB\'s first film not on the server: nothing');
}

console.log('=== the library listing, TMDB and OMDb by id, against stubbed servers ===');
{
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(`${u.hostname}${u.pathname}`);
    const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'jf.test' && u.pathname === '/Items') {
      return json({ Items: [{ Name: 'What If', ProductionYear: 2013, ProviderIds: { Imdb: 'tt1486834', Tmdb: '212716' } }, { Name: 'No Ids', ProductionYear: 2001 }] });
    }
    if (u.hostname === 'api.themoviedb.org') {
      ok(u.searchParams.get('query') === 'The F Word' && u.searchParams.get('year') === '2013' && u.searchParams.get('api_key') === 'TK', 'TMDB is asked for the typed words and year, key as api_key');
      return json({ results: [{ id: 212716, title: 'What If', release_date: '2013-09-07' }] });
    }
    if (u.hostname === 'www.omdbapi.com') {
      ok(u.searchParams.get('i') === 'tt1486834', 'OMDb is asked for the server film\'s id');
      return json({ ...WHAT_IF_REAL.raw, Response: 'True', Type: 'movie' });
    }
    throw new Error(`unexpected ${url}`);
  };
  forgetLibraryIndex();
  const p = createProvider({ provider: 'jellyfin', jellyfin: { baseUrl: 'http://jf.test', authMethod: 'apikey', apiKey: 'KEY' } });
  const a = await p.libraryIndex();
  const b = await p.libraryIndex();
  ok(a.length === 2 && a[0].imdbId === 'tt1486834' && a[0].tmdbId === '212716' && a[1].imdbId === null && a[1].tmdbId === null,
    `every film, with its ids or none: ${JSON.stringify(a)}`);
  ok(b === a && asked.filter((x) => x === 'jf.test/Items').length === 1, 'listed once, then cached');
  const first = await tmdbFirstFilm('The F Word', 2013, 'TK');
  ok(first?.tmdbId === '212716' && first.year === 2013, `TMDB's first film: ${JSON.stringify(first)}`);
  const again = await lookupById('tt1486834', { apiKey: 'OK', retry: false });
  ok(again?.movie.title === 'What If' && again.movie.rated === 'PG-13' && again.method === 'imdb-id',
    'and the request goes on with OMDb\'s record for What If, its rating included');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
