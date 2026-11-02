// Incident: 2026-10-21, Benji asked for "Rafa (TV series 2026)" and "Rafa the
// Netflix mini series" in the TV group. The year was cut from inside the
// brackets, leaving "Rafa (TV series )", and both were answered "no series
// matching". A kind-of-thing descriptor is not part of the title.
import { stripSeriesDescriptor } from '../src/util/fuzzy.js';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
ok(stripSeriesDescriptor('Rafa (TV series 2026)') === 'Rafa', 'bracketed descriptor with year');
ok(stripSeriesDescriptor('Rafa (2026 TV series)') === 'Rafa', 'year first');
ok(stripSeriesDescriptor('Rafa the Netflix mini series') === 'Rafa', 'trailing netflix mini series');
ok(stripSeriesDescriptor('Rafa tv show') === 'Rafa', 'trailing tv show');
ok(stripSeriesDescriptor('The Late Show') === 'The Late Show', 'a title ending in Show stays');
ok(stripSeriesDescriptor('Mini Series') === 'Mini Series', 'never returns empty');
ok(stripSeriesDescriptor('Friends season 3') === 'Friends season 3', 'plain request untouched');
// Incident: 2026-11-02, a member asked "White collar full series if possible" and was
// told the show was not in the library, which has it. The ask for the whole run
// is not part of the title.
ok(stripSeriesDescriptor('White collar full series if possible') === 'White collar', 'full series if possible');
ok(stripSeriesDescriptor('White collar the whole series') === 'White collar', 'the whole series');
ok(stripSeriesDescriptor('White collar all seasons if you can') === 'White collar', 'all seasons if you can');
ok(stripSeriesDescriptor('Friends if possible') === 'Friends', 'bare if possible');
ok(stripSeriesDescriptor('The Complete Series') === 'The Complete Series' || stripSeriesDescriptor('The Complete Series').length > 0, 'never empty');
if (fail) process.exit(1);
console.log('tv-series-descriptor: ok');
