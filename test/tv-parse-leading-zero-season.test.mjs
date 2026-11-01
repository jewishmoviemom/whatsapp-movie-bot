/* A season written with three digits. Run: node test/tv-parse-leading-zero-season.test.mjs
 * Incident: 2026-10-17, Yehuda Katz asked "South Park S029", "South Park s029 e01-e03"
 * and "South Park s029 e01"; the season code stayed in the show's name and the bot
 * answered "no series matching". */
import { parseTvRequest as p } from '../src/plugins/tv-requests/parse.js';
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
let r = p('South Park S029');
ok(r.show === 'South Park' && r.season === 29, '"S029" is season 29');
r = p('South Park s029 e01-e03');
ok(r.show === 'South Park' && r.season === 29 && r.episodeRange?.to === 3, '"s029 e01-e03" is a range in season 29');
r = p('South Park s029 e01');
ok(r.show === 'South Park' && r.season === 29 && r.episode === 1, '"s029 e01" is season 29 episode 1');
r = p('South Park s029e001');
ok(r.season === 29 && r.episode === 1, '"s029e001" reads too');
r = p('The Boys S01E01');
ok(r.show === 'The Boys' && r.season === 1 && r.episode === 1, 'ordinary codes unchanged');
process.exit(fail ? 1 : 0);
