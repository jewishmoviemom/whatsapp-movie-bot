/**
 * A film the library holds under another name than the one OMDb gave it.
 *
 * Two requests of 2026-10 went to the wanted list, and on to the Jellyfin
 * host, for films the server had all along (the operator, 2026-10-28):
 *   - "The F Word 2013", which OMDb took for a 9-minute British short of
 *     that title (tt3360884). The film meant is What If (2013), released in
 *     Britain as The F Word, held under its TMDB id 212716 and its own IMDb
 *     id - neither the short's - so no title search and no IMDb id could
 *     find it. TMDB's search knows the other title.
 *   - "wardogs", which OMDb took for Wardogs (2022), a 30-minute film with
 *     no votes. The server has War Dogs (2016): the same letters, a space
 *     apart ("It's war dogs not 1 word").
 *
 * So when OMDb's film looks like something a member would not mean
 * (obscureReason: a short, an audiobook, a film nobody rated) and the server
 * does not have it, the whole library is looked through once, for a film
 * whose title is the typed words without their spaces, or which TMDB's own
 * search for the typed words names first. A film found that way carries an
 * IMDb id, and the request goes on as that film (lookupById) - its rating
 * gated like any other's. Nothing is found, and nothing changes, otherwise.
 */
import log from '../../util/logger.js';
import { cleanRequestText, extractYear } from '../../util/fuzzy.js';
import { obscureReason } from './omdb.js';

const logger = log.scope('library');

/** Letters and digits only, lower case: "War Dogs" and "wardogs" are one. */
export function squash(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

/**
 * The first film TMDB's search names for `query` (in `year`, when given), as
 * { tmdbId, title, year }, or null. TMDB matches a film's other titles too,
 * which is what OMDb's search does not. The key goes as `api_key`, as
 * theatrical.js sends it.
 */
export async function tmdbFirstFilm(query, year, apiKey, { signal, timeoutMs = 8000 } = {}) {
  if (!apiKey || !query) return null;
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', query);
  if (year) url.searchParams.set('year', String(year));
  url.searchParams.set('api_key', apiKey);
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  const first = (await res.json())?.results?.[0];
  if (!first?.id) return null;
  return { tmdbId: String(first.id), title: first.title ?? null, year: Number(String(first.release_date ?? '').slice(0, 4)) || null };
}

/**
 * The library's film for `typed` when OMDb's `movie` is not it, or null.
 * `index` is libraryIndex()'s list; `tmdb(query, year)` is tmdbFirstFilm
 * bound to a key, or null without one. Returns { title, year, imdbId, via }.
 */
export async function namedOtherwise({ movie, typed, index, tmdb = null }) {
  if (!movie || !obscureReason(movie)) return null;
  const films = Array.isArray(index) ? index : [];
  // OMDb's own film is on the server: then it is what was asked for.
  if (movie.imdbId && films.some((f) => f.imdbId === movie.imdbId)) return null;
  const title = cleanRequestText(typed);
  const year = extractYear(typed);
  const usable = (f) => f.imdbId && f.imdbId !== movie.imdbId && (!year || !f.year || Math.abs(f.year - year) <= 1);

  // The typed words with their spaces taken out, or put in: one film only,
  // and a name long enough to mean something ("wardogs", not "up").
  const key = squash(title);
  if (key.length >= 6) {
    const same = films.filter((f) => usable(f) && squash(f.title) === key);
    if (same.length === 1) return { ...pick(same[0]), via: `"${title}" is "${same[0].title}" written apart` };
  }

  if (tmdb) {
    let first = null;
    try { first = await tmdb(title, year); } catch (err) { logger.warn(`TMDB search for "${title}" failed: ${err.message}`); }
    if (first) {
      const held = films.filter((f) => usable(f) && f.tmdbId === first.tmdbId);
      if (held.length) return { ...pick(held[0]), via: `TMDB knows "${title}" as "${first.title}"` };
    }
  }
  return null;
}

const pick = (f) => ({ title: f.title, year: f.year ?? null, imdbId: f.imdbId });
