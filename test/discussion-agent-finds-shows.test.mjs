// Incident 2026-10-29: Head Admin asked which episodes of Impractical Jokers S13
// were on Jellyfin. The discussions agent's search_library searched films only,
// found nothing, and opened ticket #0006 saying the season was not on the server
// while it held seven episodes. The search now also finds a show, with its seasons.
import { createDiscussionTools } from '../src/core/discussion-tools.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } else console.log('ok  ', m); };

const store = new Map();
const stateStore = { namespace: (n) => ({ get: (k, d) => store.get(`${n}:${k}`) ?? d, set: (k, v) => store.set(`${n}:${k}`, v) }) };
const mk = (series) => createDiscussionTools({
  stateStore, getConfig: () => ({ library: {} }), nextTicket: () => 1, notify: async () => {},
  createProvider: () => ({ configured: true, base: 'http://j', token: 't', rawSearch: async () => [] }),
  findSeries: async (term) => (/impractical jokers/i.test(term) ? series : null),
  listSeasons: async () => [{ season: 12, episodes: 18 }, { season: 13, episodes: 7 }, { season: 14, episodes: 0 }],
});
const run = mk({ id: 's1', name: 'Impractical Jokers', year: 2011 }).forMessage({ group: 'g', who: 'x', where: 'w', question: 'q' });

const r = await run('search_library', { term: 'Impractical Jokers S13' });
ok(r.matches?.[0]?.name === 'Impractical Jokers' && r.matches[0].type === 'Series', 'a show is found though no film matches, even with S13 on the end');
ok(r.matches[0].seasons.includes('S13: 7 episode(s)') && !r.matches[0].seasons.some((x) => x.startsWith('S14')), 'its seasons come with their episode counts, empty ones left out');
ok((await run('search_library', { term: 'zzz' })).note, 'nothing at all is still said so');
process.exit(failed ? 1 : 0);
