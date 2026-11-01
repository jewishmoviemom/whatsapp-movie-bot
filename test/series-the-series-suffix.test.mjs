// Incident (hourly check 20261026T010001Z): "ted the series" was answered
// "no series matching" although "ted" (2024) is in the library; dropping only
// "series" left "ted the", which matches nothing.
import { trailingSeasonVariant } from '../src/plugins/tv-requests/jellyfin-tv.js';

let failed = 0;
function ok(name, cond) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; }

ok('"ted the series" becomes "ted"', trailingSeasonVariant('ted the series') === 'ted');
ok('"fallout the season" becomes "fallout"', trailingSeasonVariant('fallout the season') === 'fallout');
process.exit(failed ? 1 : 0);
