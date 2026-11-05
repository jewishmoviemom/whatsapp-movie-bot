// Incident: Max Neuman asked "Brooklyn Nine-Nine season 1" (2026-11-04) and was
// answered "has no season 9": "Nine season" was read as "season 9".
import { parseTvRequest } from '../src/plugins/tv-requests/parse.js';
let bad = 0;
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } else console.log('ok', n); };
for (const t of ['Brooklyn Nine-Nine season 1', 'Brooklyn Nine-Nine season 1 e1-5']) {
  const r = parseTvRequest(t);
  ok(r.show === 'Brooklyn Nine-Nine' && r.season === 1, t + ' -> ' + JSON.stringify([r.show, r.season]));
}
const a = parseTvRequest('Chad powers season two');
ok(a.show === 'Chad powers' && a.season === 2, 'season two still works');
const b = parseTvRequest('Friends second season');
ok(b.show === 'Friends' && b.season === 2, 'second season still works');
const c = parseTvRequest('Friends two season');
ok(c.season === 2, 'two season still works');
process.exit(bad ? 1 : 0);
