// Incident 2026-11-08: Sol Stone asked about "spiderman brand new day". The
// discussions agent's search_library got nothing from Jellyfin's substring
// search (the library has "Spider-Man: Brand New Day") and opened ticket #0010
// saying no file matched. A film that rawSearch misses is now looked for with
// the movie plugin's fuzzy discovery before the agent says it is absent.
import { createDiscussionTools } from '../src/core/discussion-tools.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } else console.log('ok  ', m); };
const store = new Map();
const stateStore = { namespace: (n) => ({ get: (k, d) => store.get(`${n}:${k}`) ?? d, set: (k, v) => store.set(`${n}:${k}`, v) }) };
const lib = [{ title: 'Spider-Man: Brand New Day', year: 2026 }, { title: 'Spider-Man', year: 2002 }];
const tools = createDiscussionTools({
  stateStore, getConfig: () => ({ library: {} }), nextTicket: () => 1, notify: async () => {},
  createProvider: () => ({ configured: true, base: 'http://j', token: 't',
    rawSearch: async (t) => lib.filter((x) => x.title.toLowerCase().includes(t.toLowerCase())) }),
  findSeries: async () => null, listSeasons: async () => [],
});
const run = tools.forMessage({ group: 'g', who: 'x', where: 'w', question: 'q' });
const r = await run('search_library', { term: 'spiderman brand new day' });
ok(r.matches?.some((m) => m.name === 'Spider-Man: Brand New Day' && m.year === 2026), 'a film spelled loosely is found');
ok((await run('search_library', { term: 'zzzz qqqq' })).note, 'a film that is not there is still reported absent');
process.exit(failed ? 1 : 0);
