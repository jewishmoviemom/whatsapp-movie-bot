/* A fresh sign-in is the browser's own form post, so every password manager on every browser saves it.
   Run: node test/login-form-post.test.mjs

   The operator (2026-11-15): "This optimization for password manager login
   across all browsers of all device types is very important". The panel's
   sign-in went by fetch() with the form's submit stopped, and a password
   manager offers to save a login when it sees a form submitted: Safari
   (macOS, iPhone, iPad), Firefox and Samsung Internet saw nothing to save.
   The form now posts to /api/auth/login-form, which answers with a 303 back
   to the panel - signed in, or with ?signin=wrong, limited or refused for the
   page to say. The markup is in test/login-autofill.test.mjs.

   Pinned here: the right password signs in and lands on the panel with a
   session; a wrong one lands on ?signin=wrong with none, and counts towards
   the rate limit; a post from another site is refused; the panel's own
   origin, and one through a proxy (X-Forwarded-Host, the Cloudflare tunnel),
   are not; and the JSON sign-in the tests and the session-expiry gate use is
   unchanged. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from '../src/web/server.js';
import { ConfigStore } from '../src/config/store.js';
import { JobQueue } from '../src/core/queue.js';
import { hashPassword } from '../src/util/crypto.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-form-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const cs = new ConfigStore({ dataDir: tmp, masterKey: 'test-master-key-0123456789abcdef' });
cs.load();
cs.update({
  web: { admins: [{ username: 'alice', role: 'superadmin', passwordHash: hashPassword('alice-secret-1'), createdAt: 1, lastLogin: null }] },
  media: { workDir: path.join(tmp, 'media') },
});
const sp = new Map();
const stateStore = { namespace(n) {
  if (!sp.has(n)) sp.set(n, {});
  const d = sp.get(n);
  return { get: (k, v) => d[k] ?? v, set: (k, v) => { d[k] = v; }, push: (k, v) => { (d[k] ??= []).unshift(v); } };
} };
const bot = Object.assign(new EventEmitter(), {
  dataDir: tmp, groupCache: new Map(), groups: () => [], state: 'connected',
  status: () => ({ state: 'connected' }), isConnected: () => true,
});
const app = createServer({
  configStore: cs, bot,
  queue: new JobQueue({ concurrency: 1 }), linkQueue: new JobQueue({ concurrency: 1 }),
  pluginManager: { plugins: new Map(), notifyConfigChange: async () => {} },
  stateStore, fileLogger: { tail: () => [] }, alerts: {}, lockScheduler: {}, failover: null,
});
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const port = server.address().port;
const HOST = `127.0.0.1:${port}`;

const call = (method, p, { form = null, json = null, cookie = null, headers = {}, ip = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  let data = null;
  if (form) { data = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  if (json) { data = JSON.stringify(json); h['content-type'] = 'application/json'; }
  if (data != null) h['content-length'] = Buffer.byteLength(data);
  if (cookie) h.cookie = cookie;
  // A client address of its own, so the rate limit of one case does not reach the next.
  if (ip) h['x-forwarded-for'] = ip;
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
    let buf = '';
    res.on('data', (c) => { buf += c; });
    res.on('end', () => resolve({
      status: res.statusCode, location: res.headers.location, body: buf,
      cookie: (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ') || null,
      json: (() => { try { return JSON.parse(buf); } catch { return null; } })(),
    }));
  });
  r.on('error', reject);
  if (data != null) r.write(data);
  r.end();
});

try {
  console.log('=== the right password: signed in, and back on the panel ===');
  {
    const r = await call('POST', '/api/auth/login-form', {
      form: { username: 'alice', password: 'alice-secret-1' }, headers: { origin: `http://${HOST}` }, ip: '10.0.0.1',
    });
    ok(r.status === 303 && r.location === '/', `a 303 to the panel (${r.status} ${r.location})`);
    ok(!!r.cookie, 'with the session cookie');
    const st = await call('GET', '/api/auth/status', { cookie: r.cookie });
    ok(st.json?.authed === true && st.json.user?.username === 'alice', 'and the session is signed in');
  }

  console.log('=== a wrong password: back with ?signin=wrong, not signed in ===');
  {
    const r = await call('POST', '/api/auth/login-form', { form: { username: 'alice', password: 'nope' }, ip: '10.0.0.2' });
    ok(r.status === 303 && r.location === '/?signin=wrong', `a 303 to ?signin=wrong (${r.location})`);
    const st = await call('GET', '/api/auth/status', { cookie: r.cookie });
    ok(st.json?.authed === false, 'no session');
  }

  console.log('=== the rate limit holds for the form too ===');
  {
    let last = null;
    for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login-form', { form: { username: 'alice', password: `x${i}` }, ip: '10.0.0.3' });
    ok(last.location === '/?signin=limited', `after many wrong tries: ?signin=limited (${last.location})`);
    const r = await call('POST', '/api/auth/login-form', { form: { username: 'alice', password: 'alice-secret-1' }, ip: '10.0.0.3' });
    ok(r.location === '/?signin=limited', 'and even the right password waits');
  }

  console.log('=== a post from another site is refused ===');
  {
    const r = await call('POST', '/api/auth/login-form', {
      form: { username: 'alice', password: 'alice-secret-1' }, headers: { origin: 'https://evil.example' }, ip: '10.0.0.4',
    });
    ok(r.location === '/?signin=refused', `refused (${r.location})`);
    const st = await call('GET', '/api/auth/status', { cookie: r.cookie });
    ok(st.json?.authed === false, 'and not signed in');
    const proxied = await call('POST', '/api/auth/login-form', {
      form: { username: 'alice', password: 'alice-secret-1' },
      headers: { origin: 'https://panel.example.org', 'x-forwarded-host': 'panel.example.org' }, ip: '10.0.0.5',
    });
    ok(proxied.location === '/', 'through a proxy that names the panel\'s host (the Cloudflare tunnel), it signs in');
  }

  console.log('=== the JSON sign-in is unchanged ===');
  {
    const r = await call('POST', '/api/auth/login', { json: { username: 'alice', password: 'alice-secret-1' }, ip: '10.0.0.6' });
    ok(r.status === 200 && r.json?.user?.username === 'alice', 'still answers JSON');
  }
} finally {
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
