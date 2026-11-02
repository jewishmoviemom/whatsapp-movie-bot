/* No number switch while the whole machine is offline.
   Run: node test/failover-not-when-offline.test.mjs

   The operator, 2026-11-02: "failover of whatsapp account should not be
   attempted if issue is due to entire machine being offline". Every number
   connects from this one box, so with no network a spare cannot connect
   either. The switch marked a good number failed, put it in a cooldown,
   emailed "switched numbers" and tore down a session that would have come
   back by itself. Pinned here: offline holds the switch and marks nothing,
   attempts made offline do not count once the network is back, a number
   that is still dead with the network up is switched as before, and the
   probe itself says offline when nothing answers. */
import { EventEmitter } from 'node:events';
import { FailoverSupervisor, machineOnline } from '../src/core/failover.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const ACCOUNTS = [{ id: 'main', label: 'Main' }, { id: 'nolan', label: 'Nolan' }];

class FakeBot extends EventEmitter {
  constructor() { super(); this.dataDir = '/tmp'; this.state = 'connected'; }
  setState(state, reconnectAttempts = 0) { this.state = state; this.emit('state', { state, lastError: null, reconnectAttempts }); }
  async stop() { this.state = 'stopped'; }
  async start() { setImmediate(() => this.setState('connected')); }
}

function build(net) {
  const bot = new FakeBot();
  let cfg = { whatsapp: { activeAccount: 'main', accounts: ACCOUNTS,
    failover: { enabled: true, failAfterAttempts: 4, probeTimeoutMs: 200, checkEveryMs: 999_999 } } };
  const configStore = {
    get: () => cfg,
    update: (p) => { cfg = { ...cfg, whatsapp: { ...cfg.whatsapp, ...p.whatsapp } }; return cfg; },
  };
  const audit = [];
  const sup = new FailoverSupervisor({ bot, configStore, audit: (a) => audit.push(a), online: async () => net.up });
  const realRanked = sup.ranked.bind(sup);
  sup.ranked = () => realRanked().map((a) => ({ ...a, linked: true }));
  sup.start();
  return { sup, bot, configStore, audit };
}
const tick = () => new Promise((r) => setTimeout(r, 30));
const active = (c) => c.get().whatsapp.activeAccount;

console.log('=== the machine offline: no switch ===');
{
  const net = { up: false };
  const { sup, bot, configStore, audit } = build(net);
  for (const n of [4, 5, 9, 12]) { bot.setState('connecting', n); await tick(); }
  ok(active(configStore) === 'main', 'still on the number in use after 12 attempts with no network');
  ok(!sup.health.has('main'), 'and it is not marked failed or put in a cooldown');
  ok(audit.filter((a) => /machine offline/.test(a)).length === 1, 'the hold is recorded once, not per attempt');

  console.log('=== back online: attempts made offline do not count ===');
  net.up = true;
  bot.setState('connecting', 13);
  await tick();
  ok(active(configStore) === 'main', 'the first attempt with the network back does not switch');
  bot.setState('connected');
  await tick();
  ok(active(configStore) === 'main' && !sup.health.has('main'), 'and it reconnects by itself, with no switch made');
  sup.stop();
}

console.log('=== online, but the number is still dead: the switch happens as before ===');
{
  const net = { up: false };
  const { sup, bot, configStore } = build(net);
  for (const n of [4, 5, 6]) { bot.setState('connecting', n); await tick(); }
  net.up = true;
  bot.setState('connecting', 7);
  await tick();
  for (const n of [8, 9, 10]) { bot.setState('connecting', n); await tick(); }
  ok(active(configStore) === 'main', 'three attempts after the network returned: still waiting');
  bot.setState('connecting', 11);
  await tick(); await tick();
  ok(active(configStore) === 'nolan', 'the fourth after it returned hands over to the spare');
  ok(sup.health.get('main')?.reason === '11 reconnect attempts failed', 'and the dead number is marked as before');
  sup.stop();
}

console.log('=== a probe that throws counts as offline ===');
{
  const bot = new FakeBot();
  const cfg = { whatsapp: { activeAccount: 'main', accounts: ACCOUNTS, failover: { enabled: true, failAfterAttempts: 1, checkEveryMs: 999_999 } } };
  const sup = new FailoverSupervisor({ bot, configStore: { get: () => cfg, update() {} }, online: async () => { throw new Error('boom'); } });
  sup.ranked = () => ACCOUNTS.map((a) => ({ ...a, linked: true }));
  sup.start();
  bot.setState('connecting', 3);
  await tick();
  ok(cfg.whatsapp.activeAccount === 'main' && !sup.health.has('main'), 'no switch when the check itself cannot tell');
  sup.stop();
}

console.log('=== the probe ===');
{
  // An address that cannot be connected to: the probe answers false within
  // its timeout rather than hanging.
  const t0 = Date.now();
  const net = await import('node:net');
  const orig = net.default.connect;
  net.default.connect = () => { const s = new EventEmitter(); s.setTimeout = () => {}; s.destroy = () => {}; setImmediate(() => s.emit('error', new Error('ENETUNREACH'))); return s; };
  let up;
  try { up = await machineOnline({ timeoutMs: 300 }); } finally { net.default.connect = orig; }
  ok(up === false, 'no address reachable: offline');
  ok(Date.now() - t0 < 2000, 'answered within its timeout');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
