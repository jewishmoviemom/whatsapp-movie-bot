/* An admin can add a ticket by hand, and the hourly check researches it.
   Run: node test/tickets-added-by-hand.test.mjs

   The operator, 2026-10-30: "make me an option to manually add tickets and of
   course you'll reconcile them accordingly". A problem told to them in a
   private message never came as an #issue, so it had no ticket and the hourly
   check never heard of it. Pinned here: a ticket added on the Tickets tab, or
   through the bot-cmd channel, takes the next number from the one counter
   the #issues use; it lists with the others as added by hand; the hourly
   scan turns it into a member-issue finding, with the member's number
   masked; one already resolved is left alone; and the bot-cmd channel can
   resolve it with a note, audited, which is how it is reconciled. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addTicket, listTickets } from '../src/core/tickets.js';
import { nextTicket } from '../src/core/issue-tickets.js';
import { manualTicketFindings } from '../src/core/incident-scan.js';
import { runAdminCommand, summariseAdminCommand } from '../src/core/admin-commands.js';
import { botRequest } from '../tools/hourly-debug.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-tickets-'));
const spaces = new Map();
const stateStore = {
  namespace(n) {
    if (!spaces.has(n)) spaces.set(n, {});
    const d = spaces.get(n);
    return { get: (k, v = null) => (k in d ? d[k] : v), set: (k, v) => { d[k] = v; return v; }, push: (k, v) => { (d[k] ??= []).push(v); } };
  },
};
const state = () => Object.fromEntries([...spaces.entries()]);
const T0 = Date.parse('2026-10-30T09:00:00Z');

console.log('=== added by hand, numbered with the #issues ===');
let first;
{
  ok(nextTicket(dataDir) === 1 && nextTicket(dataDir) === 2, 'two #issues took 0001 and 0002');
  ok(addTicket({ dataDir, stateStore }, { text: '   ' }).error === 'say what the problem is', 'nothing to say: no ticket');
  first = addTicket({ dataDir, stateStore, now: () => T0 }, {
    text: 'Says The Bear S02E03 has no sound', who: '  Ari  ', number: '+1 (555) 123-0000', group: '04 TV posts', by: 'admin',
  }).ticket;
  ok(first.n === 3, `the next number, 0003 (${first.n})`);
  ok(first.who === 'Ari' && first.number === '15551230000' && first.group === '04 TV posts' && first.by === 'admin', 'whose it is, the number as digits');
  ok(nextTicket(dataDir) === 4, 'and the next #issue gets 0004');
  const bare = addTicket({ dataDir, stateStore, now: () => T0 + 1000 }, { text: 'Subtitles drift in every Pixar film', number: '12' }).ticket;
  ok(bare.n === 5 && bare.who === null && bare.number === null, 'no member named, and too short a number is dropped');

  const list = listTickets({ dataDir, stateStore });
  const t = list.find((x) => x.n === 3);
  ok(t?.source === 'manual' && t.addedBy === 'admin' && t.status === 'open' && t.text === 'Says The Bear S02E03 has no sound', 'listed as added by hand, open');
  ok(list[0].n === 5, 'newest first');
}

console.log('=== the hourly scan researches it ===');
{
  const f = manualTicketFindings({ state: state(), since: T0 - 1 });
  const bear = f.find((x) => x.fp === 'manual-ticket:3');
  ok(f.length === 2 && bear?.kind === 'member-issue', `a member-issue finding each (${f.length})`);
  ok(/^Ticket #0003 - added by hand by admin, for Ari in 04 TV posts: "Says The Bear/.test(bear?.title ?? ''), `titled with its number: ${bear?.title}`);
  ok(bear?.report.ticket === 3 && bear.report.source === 'manual' && /whether the ticket can be resolved/.test(bear.remedy), 'and asks whether it can be resolved');
  ok(!JSON.stringify(f).includes('15551230000'), 'the member\'s number is not in the finding');
  ok(manualTicketFindings({ state: state(), since: T0 + 5000 }).length === 0, 'a ticket the last run covered is not found twice');
  ok(manualTicketFindings({ state: {}, since: 0 }).length === 0, 'no tickets, no findings');
  const unopenable = addTicket({ dataDir, stateStore, now: () => T0 + 2000 }, { text: 'WhatsApp says "This file is in an unusual format" on Dune' }).ticket;
  ok(manualTicketFindings({ state: state(), since: T0 + 1500 }).find((x) => x.report.ticket === unopenable.n)?.unopenable === true,
    'one quoting WhatsApp\'s "unusual format" carries its known cure');
}

console.log('=== the bot-cmd channel adds and resolves, audited ===');
{
  const deps = { bot: {}, dataDir, configStore: { get: () => ({}) }, stateStore };
  const cmd = { op: 'add-ticket', text: 'Told me privately: Oppenheimer stops at 1:12', who: 'Hank', by: 'Claude Code (for the operator)' };
  const r = await runAdminCommand(cmd, deps);
  ok(r.ok && r.ticket.n === 7 && r.ticket.by === 'Claude Code (for the operator)', `added as #0007 (${r.ticket?.n})`);
  ok(/^added ticket #0007 by hand for Hank$/.test(summariseAdminCommand(cmd, r)?.action ?? ''), 'audited');
  let err = null;
  try { await runAdminCommand({ op: 'add-ticket', text: '' }, deps); } catch (e) { err = e.message; }
  ok(err === 'say what the problem is', 'an empty one is refused');

  const done = { op: 'ticket-status', n: 3, note: 'The file had no English track; re-encoded and re-sent.', by: 'Claude Code (for the operator)' };
  const d = await runAdminCommand(done, deps);
  ok(d.ok && d.status === 'resolved', 'resolved');
  ok(/^resolved ticket #0003$/.test(summariseAdminCommand(done, d)?.action ?? '') && /English track/.test(summariseAdminCommand(done, d)?.detail ?? ''), 'audited, with the note');
  const t = listTickets({ dataDir, stateStore }).find((x) => x.n === 3);
  ok(t.status === 'resolved' && /English track/.test(t.note) && t.resolvedBy === 'Claude Code (for the operator)', 'the tab shows it resolved, with the note');
  ok(!manualTicketFindings({ state: state(), since: 0 }).some((x) => x.report.ticket === 3), 'and the hourly check leaves it alone');
  err = null;
  try { await runAdminCommand({ op: 'ticket-status', n: 999 }, deps); } catch (e) { err = e.message; }
  ok(err === 'no ticket has that number', 'an unknown number is refused');
}

console.log('=== the hourly check resolves a hand-added ticket it researched, and only that ===');
{
  const asked = [];
  const ask = async (dir, cmd) => { asked.push(cmd); return { ok: true, n: cmd.n, status: cmd.status, note: cmd.note }; };
  const s = { dataDir: '/data' };
  const ctx = { runId: 'R1', manualTickets: new Set([5]), rerunnable: new Set() };
  const a = await botRequest(s, { op: 'resolve-ticket', n: 5, note: 'Pixar subtitles were re-timed; they line up now.' }, ctx, { ask });
  ok(a.ok && asked[0]?.op === 'ticket-status' && asked[0].n === 5 && asked[0].status === 'resolved' && asked[0].by === 'hourly check R1',
    `asked the bot to resolve #0005, as the hourly check (${JSON.stringify(asked[0])})`);
  ok(/not a hand-added ticket/.test((await botRequest(s, { op: 'resolve-ticket', n: 5, note: 'again' }, ctx, { ask })).error ?? ''), 'once');
  ok(/not a hand-added ticket/.test((await botRequest(s, { op: 'resolve-ticket', n: 1, note: 'x' }, ctx, { ask })).error ?? ''),
    'a ticket this run\'s findings do not name is refused');
  ctx.manualTickets.add(6);
  ok(/needs a "note"/.test((await botRequest(s, { op: 'resolve-ticket', n: 6, note: ' ' }, ctx, { ask })).error ?? ''), 'and never without a note');
  ok(asked.length === 1, 'nothing else reached the bot');
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
