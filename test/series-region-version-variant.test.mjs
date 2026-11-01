// Incident (hourly check 20261025T190001Z): "deal or no deal US version S05"
// was answered "no series matching" three times although "Deal or No Deal"
// (2023) is in the library. "US version" names an edition, not the title.
import { regionVersionVariant, findSeries } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';

let failed = 0;
function ok(name, cond) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; }

ok('strips US version', regionVersionVariant('deal or no deal US version') === 'deal or no deal');
ok('strips the UK edition', regionVersionVariant('The Office the UK edition') === 'The Office');
ok('strips U.S. version', regionVersionVariant('Shameless U.S. version') === 'Shameless');
ok('plain title has none', regionVersionVariant('deal or no deal') === null);
ok('only the words has none', regionVersionVariant('US version') === null);

const all = [{ Id: 'a', Name: 'Deal or No Deal', ProductionYear: 2023, RecursiveItemCount: 10 }];
const fetchImpl = async (url) => {
  const u = decodeURIComponent(String(url));
  const items = /searchTerm=deal[+ ]or[+ ]no[+ ]deal[+ ]us/i.test(u) ? [] : (/searchTerm=/.test(u) ? all : []);
  return { ok: true, status: 200, json: async () => ({ Items: items, SearchHints: [] }) };
};
const found = await findSeries('deal or no deal US version', { base: 'http://j', token: 't', fetchImpl, bestMatch });
ok('US version finds the show', found?.id === 'a');
process.exit(failed ? 1 : 0);
