/* The sign-in form must look like a sign-in form to a password manager.
   Run: node test/login-autofill.test.mjs

   Reported from mobile: 1Password filled the username and left the password
   empty. Three things were fighting it - autocomplete="off" on the form
   overriding the per-field hints, no `name` attributes (what most managers
   actually match on), and a second password input which makes a form look
   like REGISTRATION rather than sign-in. */
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const html = fs.readFileSync(new URL('../src/web/public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/web/public/app.js', import.meta.url), 'utf8');
const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);

const form = document.getElementById('gate-form');
const user = document.getElementById('gate-user');
const pw = document.getElementById('gate-pw');
const pw2 = document.getElementById('gate-pw2');

console.log('=== the form does not suppress autofill ===');
{
  ok(!!form, 'the sign-in form exists');
  ok(form.getAttribute('autocomplete') !== 'off',
    'autocomplete="off" is gone — it overrode the per-field hints below it');
  ok(form.tagName === 'FORM', 'it is a real form, not a div — managers look for one');
}

console.log('=== both fields carry the hints a manager reads ===');
{
  ok(user.getAttribute('autocomplete') === 'username', 'the username field is marked as such');
  ok(pw.getAttribute('autocomplete') === 'current-password',
    'and the password as an EXISTING password, not a new one');
  ok(pw.getAttribute('type') === 'password', 'it is a real password input');
}

console.log('=== name attributes, which is what most managers match on ===');
{
  // With only ids, 1Password filled the username and left the password alone.
  ok(user.getAttribute('name') === 'username', 'the username field has name="username"');
  ok(pw.getAttribute('name') === 'password', 'and the password has name="password"');
}

console.log('=== one password field, so it reads as sign-in not registration ===');
{
  // Two password inputs is the signature of a signup form, and a manager
  // offering to SAVE a new login instead of filling the saved one is exactly
  // the reported symptom.
  ok(pw2.hasAttribute('disabled'),
    'the confirm field is disabled while hidden, so the form parses as sign-in');
  ok(pw2.getAttribute('autocomplete') === 'new-password',
    'and is marked new-password for when it IS used, during first-run setup');

  const active = [...form.querySelectorAll('input[type=password]')].filter((i) => !i.hasAttribute('disabled'));
  ok(active.length === 1, `exactly one live password field (${active.length})`);
}

console.log('=== the disabled flag is kept in step with hidden ===');
{
  // Leaving it disabled during first-run setup would make the confirm field
  // unusable; leaving it enabled the rest of the time reintroduces the bug.
  ok(/\$\('gate-pw2'\)\.disabled = true;/.test(app), 'disabled when hidden');
  ok(/\$\('gate-pw2'\)\.disabled = false;/.test(app), 'and enabled when shown for setup');
  const hideAt = app.indexOf("$('gate-pw2').classList.add('hidden')");
  const disableAt = app.indexOf("$('gate-pw2').disabled = true");
  ok(disableAt > hideAt && disableAt - hideAt < 200, 'the two are set together, not in different places');
}

console.log('=== mobile keyboards do not mangle the username ===');
{
  ok(user.getAttribute('autocapitalize') === 'none', 'no auto-capitalising the first letter');
  ok(user.getAttribute('autocorrect') === 'off', 'no autocorrect');
  ok(user.getAttribute('spellcheck') === 'false', 'and no spellcheck underline');
}

/* Since 2026-11-15, every browser on every device. The operator: "This
   optimization for password manager login across all browsers of all device
   types is very important". The form was submitted by fetch(), with its
   submit stopped, and a password manager offers to save a login when it sees
   a form submitted: Chrome guessed from the form disappearing, and Safari
   (macOS, iPhone, iPad), Firefox and Samsung Internet saw nothing. So a fresh
   sign-in is a real form post now (test/login-form-post.test.mjs has the
   server's side); the panel's API-key and token fields are kept out of the
   managers' reach, where Chrome and Safari had been offering the panel's own
   password; and the password change carries the username, so the right
   saved login is updated. */
console.log('=== a fresh sign-in is a real form post ===');
{
  ok(form.getAttribute('method') === 'post' && form.getAttribute('action') === '/api/auth/login-form',
    'the form posts to /api/auth/login-form itself');
  ok(user.hasAttribute('required'), 'the username is required, as a sign-in form\'s is');
  ok(user.getAttribute('aria-label') === 'Username' && pw.getAttribute('aria-label') === 'Password',
    'each field is labelled for the managers that read labels');
  const handler = app.slice(app.indexOf("$('gate-form').addEventListener('submit'"));
  const first = handler.slice(0, handler.indexOf('e.preventDefault()'));
  ok(/if \(!SETUP_MODE && !gateShownForExpiry\) \{[\s\S]*?return;\s*\}/.test(first),
    'a fresh sign-in returns before preventDefault, so the browser submits the form');
  ok(/sessionStorage\.setItem\('gate-user'/.test(first), 'the typed username is kept for a wrong password');
  ok(/params\.get\('signin'\)/.test(app) && /history\.replaceState/.test(app), 'the page reads ?signin= and clears it');
}

console.log('=== where a sign-in goes by fetch(), the browser is told ===');
{
  ok(/new window\.PasswordCredential\(\{ id, password, name: id \}\)/.test(app) && /navigator\.credentials\.store/.test(app),
    'the Credential Management API saves it (Chrome, Edge, Samsung Internet)');
  const calls = app.match(/rememberLogin\(/g)?.length ?? 0;
  ok(calls >= 4, `after the fetch sign-in and both password changes (${calls - 1} calls)`);
  ok(/\$\('gate-user'\)\.value = 'superadmin';/.test(app), 'the first setup saves the login with its username');
}

console.log('=== the password change updates the saved login ===');
{
  const chpw = document.getElementById('chpw-form');
  ok(chpw?.tagName === 'FORM', 'My account\'s password change is a form');
  const u = document.getElementById('f-pw-user');
  ok(u && u.getAttribute('autocomplete') === 'username' && chpw.contains(u), 'with the username in it');
  ok(document.getElementById('f-pw-cur').getAttribute('autocomplete') === 'current-password'
    && document.getElementById('f-pw-new').getAttribute('autocomplete') === 'new-password', 'current and new marked as such');
  ok(/\$\('f-pw-user'\)\.value = u\?\.username/.test(app), 'filled with the signed-in admin');
  ok(/\$\('chpw-form'\)\.addEventListener\('submit'/.test(app), 'and handled as a submit, so Enter works too');
}

console.log('=== no password manager fills the panel\'s login into a key or token ===');
{
  for (const id of ['f-omdbkey', 'f-tmdbkey', 'f-gemini-key', 'f-dl-apikey', 'dc-token', 'f-jf-key', 'f-plex-token',
    'f-http-auth', 'f-jf-password', 'f-em-pass', 'na-pass', 'na-user']) {
    const el = document.getElementById(id);
    const ac = el?.getAttribute('autocomplete');
    ok(el && (ac === 'off' || ac === 'new-password') && el.hasAttribute('data-1p-ignore')
      && el.getAttribute('data-lpignore') === 'true' && el.getAttribute('data-bwignore') === 'true',
    `${id}: never filled with the saved login (autocomplete=${ac}, 1Password/LastPass/Bitwarden told to ignore it)`);
  }
  const strays = [...document.querySelectorAll('input[type=password]')]
    .filter((i) => !i.getAttribute('autocomplete') && !i.closest('#gate-form, #chpw-gate-form, #chpw-form'));
  ok(strays.length === 0, `no password field anywhere without an autocomplete hint (${strays.map((i) => i.id).join(', ') || 'none'})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
