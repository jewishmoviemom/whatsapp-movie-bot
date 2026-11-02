/* The "for a member" box under the queue opens its own dropdown of members,
   so it works in a phone's browser too. Run: node test/member-picker-on-phones.test.mjs

   The operator, 2026-11-02: "in the phone browser when logged into the bot
   remotely and adding an item to queue when typing a name for a member it
   doesn't open a dropdown selection like it does on the computer". The box
   was an <input list> with a <datalist>, which desktop browsers show as a
   dropdown and phone browsers mostly do not. Pinned here: no datalist is
   left, typing a name or a few digits of a number lists the matching members,
   a tap picks one (on pointerdown, before the tap's blur closes the list),
   the arrow keys and Enter still work, and what is picked is what the queue
   buttons send. Uses linkedom, like the other panel suites; skipped, and
   says so, where it is not installed. */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');
const csvJs = fs.readFileSync(new URL('../src/web/public/csv-export.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../src/web/public/index.html', import.meta.url), 'utf8');

console.log('=== no datalist left ===');
ok(!/<datalist[ >]/.test(html.replace(/<!--[\s\S]*?-->/g, '')) && !/list="q-member-list"/.test(html), 'the panel has no <datalist> a phone would ignore');
ok(/class="member-pick[^"]*"><input id="q-member"/.test(html) && /class="member-pick"[^>]*><input id="pl-member"/.test(html),
  'both member boxes sit in a member-pick wrapper the dropdown hangs from');

let parseHTML = null;
try { ({ parseHTML } = await import('linkedom')); } catch { /* a production install */ }

if (!parseHTML) {
  console.log('=== the panel: SKIPPED - linkedom is not installed (npm install --include=dev) ===');
} else {
  const ROSTER = [
    { key: 'num:15551230000', id: '111@lid', number: '15551230000', name: 'Abby' },
    { key: 'num:15557778888', id: '222@lid', number: '15557778888', name: 'Dan' },
    { key: 'lid:333@lid', id: '333@lid', number: null, name: 'Abe' },
  ];
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  const fetch = async (url) => {
    if (url === '/api/auth/status') return new Promise(() => {});
    const path = url.replace(/^\/api/, '').split('?')[0];
    const out = path === '/members' ? { members: ROSTER } : {};
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(out) };
  };
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const win = { document, localStorage, location: { reload() {}, href: '' }, navigator: {}, scrollTo() {}, addEventListener() {},
    MutationObserver: window.MutationObserver };
  // eslint-disable-next-line no-new-func
  const make = new Function('window', 'document', 'localStorage', 'fetch', 'EventSource',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'confirm', 'alert', 'prompt',
    'navigator', 'location', `"use strict";\n${app}\n;\n${csvJs}\n;return {};`);
  make(win, document, localStorage, fetch, function EventSource() {},
    () => 0, () => {}, () => 0, () => {}, () => true, () => {}, () => null, win.navigator, win.location);
  const $ = (id) => document.getElementById(id);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const fire = (el, type, init = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, init);
    el.dispatchEvent(e);
    return e;
  };

  for (const id of ['q-member', 'pl-member']) {
    console.log(`=== ${id} ===`);
    const input = $(id);
    const box = input.parentElement.querySelector('.member-results');
    const names = () => [...box.querySelectorAll('.sr-item')].map((x) => x.textContent);
    const open = () => !box.classList.contains('hidden');
    ok(box && !open(), 'a dropdown is there, closed until the box is used');

    fire(input, 'focus');
    await settle();
    ok(open() && names().length === 3, `tapping the box lists the members: ${names().join(' | ')}`);

    input.value = 'ab';
    fire(input, 'input');
    await settle();
    ok(names().join('|') === 'Abby · +15551230000|Abe', `typing "ab" narrows it to ${names().join(' | ')}`);

    input.value = '777';
    fire(input, 'input');
    await settle();
    ok(names().length === 1 && names()[0].startsWith('Dan'), 'a few digits of a number find its member');

    input.value = 'zzz';
    fire(input, 'input');
    await settle();
    ok(open() && /No member matches/.test(box.textContent), 'and nobody matching says so');

    input.value = 'ab';
    fire(input, 'input');
    await settle();
    const tap = fire(box.querySelector('.sr-item[data-i="1"] .sr-what'), 'pointerdown');
    ok(tap.defaultPrevented, 'a tap keeps the box focused, so the list is not closed under the finger');
    ok(input.value === 'Abe' && !open(), `a tap picks the member and closes the list (${input.value})`);
    ok(await win.memberKeyFrom(id) === 'lid:333@lid', 'and that is the member the queue button sends');

    input.value = '';
    fire(input, 'input');
    await settle();
    fire(input, 'keydown', { key: 'ArrowDown' });
    fire(input, 'keydown', { key: 'ArrowDown' });
    const enter = fire(input, 'keydown', { key: 'Enter' });
    ok(enter.defaultPrevented && input.value === 'Dan · +15557778888', `the arrow keys and Enter still pick on a computer (${input.value})`);

    fire(input, 'focus');
    await settle();
    fire(input, 'blur');
    ok(!open(), 'leaving the box closes the list');
    input.value = '';
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
