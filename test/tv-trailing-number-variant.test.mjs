// Incident: A member asked "Off campus 1" (2026-11-06) and was answered "no series
// matching"; "Off Campus" (2026) is on the server. The bare number is dropped
// as a last-chance variant.
import { trailingNumberVariant } from '../src/plugins/tv-requests/jellyfin-tv.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } else console.log('ok', n); };
ok(trailingNumberVariant('Off campus 1') === 'Off campus', 'drops trailing 1');
ok(trailingNumberVariant('Off campus') === null, 'nothing to drop');
ok(trailingNumberVariant('Catch 22') === 'Catch', 'variant only; as-typed is tried first');
ok(trailingNumberVariant('Show 2019') === null, 'a year is not touched');
process.exit(bad ? 1 : 0);
