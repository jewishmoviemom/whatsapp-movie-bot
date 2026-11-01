/* A request re-run from the History tab goes in as the member's, queued by an
   admin for them. Run: node test/history-rerun-keeps-the-member.test.mjs

   The operator, 2026-11-01: "if I rerun a failed request from history tab it
   should show as user requested in the rerun not queued by admin, or it
   should show queued by admin for that user". History's Re-run sent only the
   request's words, so the new row was "manual (admin)": nobody to tag, and no
   trace of whose request it was. Pinned here: the row's member is read from
   the row itself (one who has since left every group too), a row that was
   nobody's stays the panel's, the movie and TV re-runs carry the member with
   the admin beside them, and the panel sends the row with the Re-run. */
import './fixtures/roomy-disk.mjs';
import fs from 'node:fs';
import { historyRowMember, panelRequester } from '../src/core/members.js';
import moviePlugin from '../src/plugins/movie-requests/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const GROUP_ROW = {
  id: '3EB0A1', kind: 'movie', status: 'error', request: 'heat 1995', requester: 'Abby',
  requesterJid: '10000000000007@lid', requesterNumber: '15551230000', requesterNumberDisplay: '+15551230000',
};

console.log('=== whose request the row was ===');
{
  const m = historyRowMember(GROUP_ROW);
  ok(m?.name === 'Abby' && m.number === '15551230000' && m.jid === '10000000000007@lid', `the member, from the row: ${JSON.stringify(m)}`);
  ok(m.key === 'num:15551230000' && m.display === '+15551230000', 'keyed and shown as the roster would');
  const lidOnly = historyRowMember({ requester: 'Ari', requesterJid: '999@lid' });
  ok(lidOnly?.key === 'lid:999@lid' && lidOnly.number === null, 'a member WhatsApp gave no number for, by their id');
  const numberOnly = historyRowMember({ requester: null, requesterNumber: '+1 (555) 123-0001' });
  ok(numberOnly?.jid === '15551230001@s.whatsapp.net' && numberOnly.name === '+15551230001', 'one with only a number is named by it');
  ok(historyRowMember({ requester: 'manual (admin)', requesterJid: null, requesterNumber: null }) === null,
    'a row queued from the panel for nobody stays nobody\'s');
  ok(historyRowMember(null) === null, 'no row, no member');
  const again = panelRequester('manual (admin)', historyRowMember({ ...GROUP_ROW, requesterJid: '10000000000007@lid', assignedBy: 'manual (admin)' }));
  ok(again.requester === 'Abby' && again.assignedBy === 'manual (admin)', 'a re-run of a re-run is still theirs');
}

console.log('=== the re-run carries them ===');
{
  const added = [];
  const store = (() => { const m = {}; return { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; } }; })();
  const ctx = {
    config: { movieRequests: { postsGroup: 'posts@g.us', blockedRatings: ['R'], reactions: {}, notify: {} }, media: {} },
    log: { info() {}, warn() {}, debug() {} },
    store,
    queue: { add: (j) => added.push(j) },
    bot: { isConnected: () => true, sendText: async () => {} },
  };
  // The queueing every hand-queued job shares (panelRequester), as a
  // Jellyfin item: what the lookup found is not what this pins.
  const item = { id: '39b452edcb8e1db19bb78cf69764ab4b', title: 'Heat', year: 1995, rated: 'R', downloadUrl: 'https://srv/x', headers: {} };
  ctx.config.movieRequests.blockedRatings = [];
  let row = null;
  try {
    await moviePlugin.queueLibraryItem(item, ctx, { requester: 'manual (admin)', member: historyRowMember(GROUP_ROW) });
    await new Promise((r) => setImmediate(r));
    row = (store.get('history', []) ?? []).find((h) => h.title === 'Heat');
  } catch (err) { console.log(`  (queueLibraryItem: ${err.message})`); }
  ok(row?.requester === 'Abby' && row.requesterNumber === '15551230000' && row.requesterJid === '10000000000007@lid',
    `the new row is the member's: ${row?.requester}`);
  ok(row?.assignedBy === 'manual (admin)', 'queued by an admin for them');
}

console.log('=== the panel and the route ===');
{
  const api = fs.readFileSync(new URL('../src/web/api.js', import.meta.url), 'utf8');
  const block = api.match(/router\.post\('\/requeue'[\s\S]*?\n  \}\);/)[0];
  ok(/historyRowMember\(historyRow\(req\.body\.fromHistory\)\)/.test(block) && /if \(!member && req\.body\?\.fromHistory/.test(block),
    '/requeue takes the member from the row when none was picked');
  const bulk = api.match(/router\.post\('\/requeue-all'[\s\S]*?\n  \}\);/)[0];
  ok(/member: historyRowMember\(r\)/.test(bulk) && /requester: 'bulk re-run \(admin\)', member \}/.test(bulk),
    'Re-run all puts each one in as its member\'s too');
  const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');
  ok(/fromHistory: from/.test(app) && /: rerunButton\(x\)\}/.test(app) && /data-id="' \+ esc\(x\.id \?\? ''\) \+ '" onclick="requeueRow\(this\)"/.test(app) && /requeue\(btn\.dataset\.req, \{ kind: btn\.dataset\.kind, id: btn\.dataset\.id \}\)/.test(app),
    'History\'s Re-run sends the row it repeats');
  ok(/x\.assignedBy \? ' · <span class="muted">queued by an admin for them<\/span>'/.test(app), 'and History says it was queued for them');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
