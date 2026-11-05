// Incident (hourly check 20261104T160001Z): "Attack on Titan English season 4
// episodes 13 29 and 30" was answered "no series matching" although "Attack on
// Titan" (2013) is in the library. "English" names a language, not the title.
import { languageVariant, findSeries } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

let failed = 0;
function ok(name, cond) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; }

ok('strips English', languageVariant('Attack on Titan English') === 'Attack on Titan');
ok('strips English dub', languageVariant('Attack on Titan English dub') === 'Attack on Titan');
ok('strips dubbed', languageVariant('Naruto dubbed') === 'Naruto');
ok('strips in English', languageVariant('Frieren in English') === 'Frieren');
ok('plain title has none', languageVariant('Attack on Titan') === null);
ok('only English has none', languageVariant('English') === null);

const all = [{ Id: 'a', Name: 'Attack on Titan', ProductionYear: 2013, RecursiveItemCount: 90 }];
const fetchImpl = async (url) => {
  const u = decodeURIComponent(String(url));
  const items = /searchTerm=attack[+ ]on[+ ]titan[+ ]english/i.test(u) ? [] : (/searchTerm=/.test(u) ? all : []);
  return { ok: true, status: 200, json: async () => ({ Items: items, SearchHints: [] }) };
};
const found = await findSeries('Attack on Titan English', { base: 'http://j', token: 't', fetchImpl, bestMatch });
ok('English finds the show', found?.id === 'a');
process.exit(failed ? 1 : 0);
