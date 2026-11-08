// Incident: "fallout season S2E1-8" (a member, 2026-10-25) was searched as
// the show "fallout season" and answered "not in the library". A trailing
// "season"/"series" word before an episode code is not part of the name.
import { parseTvRequest } from '../src/plugins/tv-requests/parse.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.log('FAIL', n); } else console.log('ok', n); };
for (const t of ['fallout season S2E1-8', 'fallout season S2E3', 'fallout series S02E01-E08', 'fallout season 2 episodes 1-8']) {
  ok(parseTvRequest(t).show === 'fallout', `${t} -> fallout`);
}
ok(parseTvRequest('Season S01E01').show === 'Season', 'a show named Season is kept');
ok(parseTvRequest('fallout S2E1-8').show === 'fallout', 'plain unchanged');
if (bad) process.exit(1);
