// Incident (hourly check 20261105T210001Z): "seventh heavens season 2" was
// answered "no series matching" although "7th Heaven" (1996) is in the library.
// A leading ordinal word is also tried as a digit, and with the plural dropped.
import { ordinalVariant } from '../src/plugins/tv-requests/jellyfin-tv.js';

let failed = 0;
function ok(name, cond) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; }

ok('seventh heavens becomes 7th heavens', ordinalVariant('seventh heavens') === '7th heavens');
ok('singular form drops the plural', ordinalVariant('seventh heavens', { singular: true }) === '7th heaven');
ok('second and third get their suffixes', ordinalVariant('Second Chance') === '2nd Chance' && ordinalVariant('third watch') === '3rd watch');
ok('no leading ordinal, no variant', ordinalVariant('friends') === null);
ok('a lone ordinal has no variant', ordinalVariant('seventh') === null);
process.exit(failed ? 1 : 0);
