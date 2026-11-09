/* Every reaction the bot puts on a request can be found in the panel: in
   Settings, to change it, and in "What the reactions mean" on the Dashboard.
   Run: node test/panel-shows-every-reaction.test.mjs

   The operator, 2026-11-06: "The panel is missing a couple reaction items".
   Settings had no box for ☝️ (one movie per request), 🚫 (too many too fast),
   ❌ (cancelled by an admin), ⏸️ (requests paused) or TV's 📺 (which season,
   and since 2026-11-05 which of two shows with one name). The guide left out
   🔞, 📺, 🚫 and ❌. Each was added to the schema with its own reason and never
   to the panel. This checks the panel against the schema, so the next one
   added to the schema fails here until it is in the panel too. */
import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config/schema.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

const html = fs.readFileSync(new URL('../src/web/public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');

// Keys kept only so an old config.json loads; the bot never reacts with them.
const LEGACY = new Set(['queued', 'working']);
const movie = Object.keys(DEFAULT_CONFIG.movieRequests.reactions).filter((k) => !LEGACY.has(k));
const tv = Object.keys(DEFAULT_CONFIG.tvRequests.reactions);

console.log('=== Settings has a box for every reaction ===');
const fields = {};
for (const m of app.matchAll(/'(r-[a-z]+)':\s*'([a-zA-Z.]+)'/g)) fields[m[2]] = m[1];
for (const [section, keys] of [['movieRequests', movie], ['tvRequests', tv]]) {
  for (const k of keys) {
    const path = `${section}.reactions.${k}`;
    const id = fields[path];
    ok(id && html.includes(`id="${id}"`), `${path} -> ${id ? `#${id}` : 'no field'}`);
  }
}

console.log('=== the Dashboard guide explains every reaction ===');
const start = app.indexOf('function renderReactionGuide(');
const end = app.indexOf('\n}\n', start) + 2;
const box = { innerHTML: '' };
// eslint-disable-next-line no-new-func
const render = new Function('$', 'esc', `${app.slice(start, end)}; return renderReactionGuide;`)(
  () => box, (s) => String(s));
// Give every key an emoji of its own, so a row shows which key it used.
const mark = (keys, base) => Object.fromEntries(keys.map((k, i) => [k, String.fromCodePoint(base + i)]));
const mr = { ...mark(movie, 0x1F400), positions: ['P1', 'P2', 'P3'] };
const tr = mark(tv, 0x1F600);
render(mr, tr);
for (const k of movie) {
  // The numbers have a row of their own below. 🔢, past the end of them, was
  // left out of this loop and of the guide until the operator noticed
  // (2026-11-09: "🔢 11th or further back in queue is not listed in panel").
  if (k === 'positions') continue;
  ok(box.innerHTML.includes(mr[k]), `movie ${k} has a row`);
}
for (const k of tv) ok(box.innerHTML.includes(tr[k]), `tv ${k} has a row`);
ok(box.innerHTML.includes('P1 P2 P3'), 'the place-in-line numbers have a row');
ok(/Further back than place 3 in line/.test(box.innerHTML), 'and 🔢 says it means further back than the numbers go');

render(mr, undefined);
ok(box.innerHTML.includes(mr.needYear) && !/undefined/.test(box.innerHTML),
  'without TV settings the TV row falls back to the year reaction, as the bot does');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
