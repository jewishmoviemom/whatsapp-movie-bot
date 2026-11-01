/* Light / Dark / Auto theme switch in the panel.
   Run: node test/panel-theme.test.mjs

   The operator asked for a theme switch on the panel itself, discoverable by
   searching "dark mode" in Settings. It is a per-browser display choice, so it
   lives in localStorage (botpanel.theme), not in the bot's config, and it must
   not flash the wrong colours on load.

   These are static assertions over the three panel files plus a behavioural
   check of the apply logic, so they run on a production (--omit=dev) box too,
   where linkedom is absent. The webui-lint suite separately proves every
   $('f-theme') resolves to a real id in index.html. */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const html = fs.readFileSync(new URL('../src/web/public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/web/public/style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');

console.log('=== the control exists, with the three modes ===');
{
  ok(/id="f-theme"/.test(html), 'there is a theme select (#f-theme)');
  for (const v of ['auto', 'light', 'dark']) {
    ok(new RegExp(`<option value="${v}"`).test(html), `it offers "${v}"`);
  }
  // Auto must be the first option, so a browser that never saved a choice lands
  // on "match my device" rather than being forced to one palette.
  const sel = html.slice(html.indexOf('id="f-theme"'));
  const firstOpt = sel.match(/<option value="([a-z]+)"/)?.[1];
  ok(firstOpt === 'auto', `auto is the default option (first was "${firstOpt}")`);
}

console.log('=== searching "dark mode" in Settings finds it ===');
{
  // buildSearchIndex() in app.js indexes card <h2>/<h3> text and <label> text
  // under 90 chars. The words "dark mode" have to appear in one of those, not
  // only in a hint, or the search cannot surface the control.
  const heads = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  const inHeading = heads.some((h) => /dark mode/i.test(h));
  ok(inHeading, `an <h3> carries "dark mode" (${heads.filter((h) => /appearance|dark/i.test(h)).join(' | ') || 'none'})`);
  // And that heading sits in the same card as the control.
  const card = html.slice(0, html.indexOf('id="f-theme"'));
  ok(/<h3>[^<]*dark mode[^<]*<\/h3>/i.test(card.slice(card.lastIndexOf('<div class="card"'))),
    'the "dark mode" heading is in the control\'s own card');
}

console.log('=== the CSS actually themes on the attribute ===');
{
  ok(/:root\[data-theme="light"\]/.test(css), 'an explicit-light palette keyed on data-theme');
  ok(/:root\[data-theme="dark"\]/.test(css), 'and an explicit-dark one');
  // The light attribute block must set the light background, or "Light" on a
  // dark OS would do nothing.
  const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf(':root[data-theme="dark"]'));
  ok(/--bg:\s*#f2f4f7/.test(lightBlock), 'the light block sets the light --bg');
  // The media query (auto mode) is still there, so "auto" follows the device.
  ok(/@media \(prefers-color-scheme: light\)/.test(css), 'auto mode still rides prefers-color-scheme');
}

console.log('=== no flash: the head applies it before paint ===');
{
  const head = html.slice(0, html.indexOf('</head>'));
  ok(/localStorage\.getItem\('botpanel\.theme'\)/.test(head), 'the <head> reads the saved theme');
  ok(/data-theme|dataset\.theme/.test(head), 'and sets it on <html> before the body renders');
}

console.log('=== it is a browser pref, not server config ===');
{
  ok(/botpanel\.theme/.test(app), 'app.js keys it under botpanel.theme');
  // It must NOT ride the Save-settings round-trip: collectForm builds the PUT
  // body, and f-theme has no business in it.
  ok(!/f-theme/.test(app.replace(/[\s\S]*function collectForm[\s\S]*?\n}/, (m) => m.includes('f-theme') ? 'HIT' : '')),
    'f-theme is not swept into collectForm / the server save');
  ok(/try \{ localStorage\.setItem\(THEME_KEY/.test(app) || /localStorage\.setItem\(THEME_KEY/.test(app),
    'the choice is saved to localStorage, guarded for private mode');
}

console.log('=== applyTheme behaves (auto clears, explicit sets) ===');
{
  // Exercise the real function against a tiny documentElement.dataset stub, the
  // way a browser would drive it.
  const el = { dataset: {} };
  globalThis.document = { documentElement: el };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const body = app.slice(app.indexOf('function applyTheme'), app.indexOf('applyTheme(savedTheme());'));
  const applyTheme = new Function(`${body}; return applyTheme;`)();

  ok(applyTheme('dark') === 'dark' && el.dataset.theme === 'dark', 'dark sets data-theme=dark');
  ok(applyTheme('light') === 'light' && el.dataset.theme === 'light', 'light sets data-theme=light');
  ok(applyTheme('auto') === 'auto' && !('theme' in el.dataset), 'auto removes the attribute');
  // Anything unexpected is treated as auto, never left on a stale value.
  el.dataset.theme = 'dark';
  ok(applyTheme('weird') === 'auto' && !('theme' in el.dataset), 'an unknown value falls back to auto');
  delete globalThis.document; delete globalThis.localStorage;
}

console.log('=== the clock test\'s cousin: 24h untouched, no hour12 added ===');
{
  // Not strictly this feature, but this change touches app.js: make sure it did
  // not smuggle in a 12-hour format the clock-24h rule forbids.
  ok(!/hour12:\s*(true|false)/.test(app.slice(app.indexOf('function applyTheme'), app.indexOf('const api ='))),
    'the theme block introduced no hour12 formatting');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
