// Incident: Avi Sternbuch, 2026-11-06 12:09 UTC, "episodes 11-12 Ted lasso
// season 3" was answered "no series matching" because the episodes came
// before the show and were kept in its name.
import { parseTvRequest } from '../src/plugins/tv-requests/parse.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } else console.log('ok', n); };
let p = parseTvRequest('episodes 11-12 Ted lasso season 3');
ok(p.show === 'Ted lasso' && p.season === 3 && p.episodeRange?.from === 11 && p.episodeRange?.to === 12, 'episodes first, range');
p = parseTvRequest('episode 5 ted lasso season 3');
ok(p.show === 'ted lasso' && p.season === 3 && p.episode === 5, 'episode first, single');
p = parseTvRequest('Ted lasso season 3 episodes 11-12');
ok(p.show === 'Ted lasso' && p.episodeRange?.to === 12, 'usual order unchanged');
p = parseTvRequest('Episodes');
ok(p.show === 'Episodes', 'show named Episodes untouched');
process.exit(bad ? 1 : 0);
