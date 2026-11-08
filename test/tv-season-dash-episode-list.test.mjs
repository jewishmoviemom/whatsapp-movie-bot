// Incident: 🏈🏈a member (+97250***4494) asked "Rick and Morty season 08-e05,e06"
// (2026-11-07 16:05 UTC) and the bot read it as the whole of season 8: the
// list start for "season N" took a comma, "and" or "&" before the episode but
// not a dash, so the episodes were dropped, E1-E4 and E7-E10 were posted
// again and E5/E6 - the two asked for - were withheld on their rating.
import { parseTvRequest } from '../src/plugins/tv-requests/parse.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } else console.log('ok', n); };
for (const t of ['Rick and Morty season 08-e05,e06', 'Rick and Morty season 8-e5,e6', 'Rick and Morty season 8 – e5, e6', 'Rick and Morty season 8 e05,e06']) {
  const r = parseTvRequest(t);
  ok(r.show === 'Rick and Morty' && r.season === 8 && r.episodeRange?.from === 5 && r.episodeRange?.to === 6, t + ' -> ' + JSON.stringify(r));
}
const w = parseTvRequest('Rick and Morty season 8');
ok(w.season === 8 && !w.episodeRange && w.episode == null, 'a whole season is still a whole season');
process.exit(bad ? 1 : 0);
