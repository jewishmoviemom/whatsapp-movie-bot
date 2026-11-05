/* Two different shows of one title that both hold the season asked for, and
   no year in the request: the member is asked which, by year.
   Run: node test/tv-same-title-asks-which-show.test.mjs

   "what if season 1" (2026-11-04 18:55Z, and again 11-05 00:01Z) meant the
   Marvel "What If...?" (2021) and was sent "WHAT / IF" (2019), a TV-MA
   drama: both titles are "what if" to the matcher, so whichever the server
   listed first won. The operator, 2026-11-05: "someone asked for show "what
   if...?" and bot pulled "what / if" completely different show". Pinned
   here: the plain title asks, the year or the title's own "...?" decides, a
   season only one of them holds is sent without asking, the question names
   both shows with an example to copy, and the answer may pass the cooldown
   for either show. */
import fs from 'node:fs';
import { resolveEpisodes } from '../src/plugins/tv-requests/jellyfin-tv.js';
import { bestMatch } from '../src/util/fuzzy.js';
import tvPlugin from '../src/plugins/tv-requests/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const DRAMA = { Id: 'drama', Name: 'WHAT / IF', ProductionYear: 2019, Type: 'Series', RecursiveItemCount: 10, OfficialRating: 'TV-MA', ProviderIds: { Tmdb: '85723' } };
const MARVEL = { Id: 'marvel', Name: 'What If...?', ProductionYear: 2021, Type: 'Series', RecursiveItemCount: 26, OfficialRating: 'TV-14', ProviderIds: { Tmdb: '91363' } };
const SEASONS = { drama: [1], marvel: [1, 2, 3] };
const fetchImpl = async (raw) => {
  const url = new URL(String(raw));
  const json = (b) => ({ ok: true, status: 200, json: async () => b });
  if (url.pathname.endsWith('/Items')) {
    // Jellyfin's searchTerm, one LIKE over the name: "what if" finds neither
    // "WHAT / IF" nor "What If...?" by the phrase, so both come back from the
    // word searches, in the server's order, the drama first.
    const words = String(url.searchParams.get('searchTerm') ?? '').toLowerCase().split(/\W+/).filter(Boolean);
    return json({ Items: [DRAMA, MARVEL].filter((i) => words.every((w) => i.Name.toLowerCase().includes(w))) });
  }
  const m = url.pathname.match(/\/Shows\/([^/]+)\/(Seasons|Episodes)/);
  if (m && m[2] === 'Seasons') return json({ Items: SEASONS[m[1]].map((n) => ({ Id: `${m[1]}-s${n}`, IndexNumber: n, ChildCount: 3 })) });
  if (m && m[2] === 'Episodes') {
    const season = Number(url.searchParams.get('season'));
    return json({ Items: SEASONS[m[1]].includes(season) ? [1, 2, 3].map((n) => ({ Id: `${m[1]}-${season}-${n}`, Name: `e${n}`, ParentIndexNumber: season, IndexNumber: n })) : [] });
  }
  return { ok: false, status: 404, statusText: 'x', json: async () => ({}) };
};
const opts = { base: 'http://jf:8096', token: 'T', userId: 'U', bestMatch, fetchImpl };
const who = (r) => `${r.error ?? 'ok'} ${r.series?.name ?? '-'}`;

console.log('=== the lookup ===');
{
  const plain = await resolveEpisodes({ show: 'what if', season: 1 }, opts);
  ok(plain.error === 'need-year' && plain.choices.map((c) => c.id).join() === 'drama,marvel',
    `"what if season 1" asks which, oldest first (${who(plain)}: ${plain.choices?.map((c) => `${c.name} ${c.year}`).join(', ')})`);
  ok(plain.episodes.length === 0, 'and queues nothing meanwhile');
  const y21 = await resolveEpisodes({ show: 'what if 2021', season: 1 }, opts);
  ok(!y21.error && y21.series.id === 'marvel', `"what if 2021 season 1" is the Marvel one (${who(y21)})`);
  const y19 = await resolveEpisodes({ show: 'what if 2019', season: 1 }, opts);
  ok(!y19.error && y19.series.id === 'drama', `"what if 2019 season 1" is the drama (${who(y19)})`);
  const marks = await resolveEpisodes({ show: 'what if...?', season: 1 }, opts);
  ok(!marks.error && marks.series.id === 'marvel', `"what if...? season 1", typed with the title's marks, is not asked about (${who(marks)})`);
  const s2 = await resolveEpisodes({ show: 'what if', season: 2 }, opts);
  ok(!s2.error && s2.series.id === 'marvel', `season 2, which only the Marvel one has, is sent without asking (${who(s2)})`);
  const ep = await resolveEpisodes({ show: 'what if', season: 1, episode: 2 }, opts);
  ok(ep.error === 'need-year', 'an episode both hold is asked about too');
  const known = await resolveEpisodes({ show: 'what if', season: 1 }, { ...opts, knownSeries: { id: 'marvel', name: 'What If...?', year: 2021 } });
  ok(!known.error && known.series.id === 'marvel', 'a show already chosen (a multi-season request) is not asked about again');
}

console.log('=== the question in the group ===');
{
  const sent = [];
  const reacted = [];
  const notified = [];
  const ctx = {
    config: { tvRequests: { prefix: '#request', reactions: { needSeason: '📺' } }, movieRequests: { reactions: {} } },
    log: { info() {}, debug() {}, warn() {} },
    bot: { sendText: async (jid, text) => { sent.push({ jid, text }); } },
  };
  const plugin = Object.create(tvPlugin);
  plugin._notify = (c, text) => notified.push(text);
  const found = await resolveEpisodes({ show: 'what if', season: 1 }, opts);
  const out = await plugin._askWhichShow(ctx, {
    msg: { chatJid: 'g@g.us', id: 'm1' }, parsed: { show: 'what if', season: 1 }, found, route: null,
    react: async (e) => reacted.push(e),
  });
  const text = sent[0]?.text ?? '';
  ok(reacted[0] === '📺', 'the request gets 📺, as "which season?" does');
  ok(/2 different shows called that/.test(text) && /\*WHAT \/ IF\* \(2019\)/.test(text) && /\*What If\.\.\.\?\* \(2021\)/.test(text),
    `the reply names both shows with their years:\n${text}`);
  ok(/Send it again with the year, e\.g\. \*#request What If\.\.\.\? 2021 season 1\*/.test(text), 'and gives an example to copy, with the year: the newer show, usually the one meant');
  ok(out.outcome === 'need-year' && out.series.join() === 'drama,marvel', 'the outcome lets the answer through for either show');
  ok(plugin._passFits({ id: 'marvel', name: 'What If...?' }, { series: out.series }), 'the Marvel one passes the cooldown once');
  ok(!plugin._passFits({ id: 'other', name: 'Friends' }, { series: out.series }), 'another show does not');
  ok(notified.some((n) => /asked which show/.test(n)), 'and the notifications group is told it was asked');
}

console.log('=== every caller answers it ===');
{
  const tv = fs.readFileSync(new URL('../src/plugins/tv-requests/index.js', import.meta.url), 'utf8');
  ok(/found\.error === 'need-year'\) return this\._askWhichShow/.test(tv), 'a request for one season asks');
  ok(/which\.error === 'need-year'/.test(tv), 'a request for several seasons asks before looking any up');
  ok(/if \(found\.error === 'need-year'\) \{\s*throw new Error/.test(tv), 'the panel says which shows, and to add the year');
  const dl = fs.readFileSync(new URL('../src/plugins/direct-links/index.js', import.meta.url), 'utf8');
  ok(/found\.error === 'need-year'/.test(dl), 'and a direct-link request asks too');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
