#!/usr/bin/env node
/**
 * A phone's WhatsApp backup exported as web pages and JSON. WhatsApp-Chat-Exporter
 * (github.com/KnugiHK/WhatsApp-Chat-Exporter, Knugi, MIT) recoded for this
 * repo (the operator, 2026-11-26): no Python packages to install, no update
 * check against PyPI, no stylesheet or script fetched from a CDN, and a
 * crypt14 offset search that tries one block per guess instead of decrypting
 * the whole database 40,000 times. See src/core/chat-backup/.
 *
 *   node tools/export-chat-backup.mjs <backup> [options]
 *
 * <backup> is one of:
 *   msgstore.db.crypt15 / .crypt14 / .crypt12   Android, encrypted (needs its key)
 *   msgstore.db                                 Android, already decrypted
 *   ChatStorage.sqlite                          iPhone
 *   <folder>                                    an unencrypted iTunes/Finder backup of an iPhone
 *
 * Options:
 *   --key-file <file>   the key: a file holding the 64-digit key, encrypted_backup.key, or the 158-byte key
 *                       (or WA_BACKUP_KEY in the environment; asked for, hidden, when neither is given)
 *   --wa <wa.db>        Android's contacts database (plain or .crypt15), for names
 *   --chat <name|jid>   only this chat (any piece of its name, its number, or its JID); repeatable
 *   --out <dir>         where to write (default data/reports/chat-export/<day>-<time>/)
 *   --no-html / --no-json
 *   --keep-db <file>    keep the decrypted database there (0600); it is otherwise deleted at once
 *   --dry               read and count only
 *
 * Never put the key itself on the command line: a command line is kept in the
 * shell's history and shown by ps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackup, isEncrypted } from '../src/core/chat-backup/index.js';
import { pickChats, chatJson } from '../src/core/chat-backup/model.js';
import { chatPages, indexPage } from '../src/core/chat-backup/html.js';
import { askHidden } from '../src/core/sealed-backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const value = (n) => values(n)[0] ?? null;
const VALUED = new Set(['--key-file', '--wa', '--chat', '--out', '--keep-db']);
const input = args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]));

if (!input || flag('--help')) {
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(input ? 0 : 2);
}
if (args.includes('--key')) {
  console.error('--key is not taken: a key on the command line stays in the shell history. Use --key-file, or WA_BACKUP_KEY.');
  process.exit(2);
}

const needsKey = isEncrypted(input) || (value('--wa') && isEncrypted(value('--wa')));
let key = null;
if (needsKey) {
  if (value('--key-file')) key = fs.readFileSync(value('--key-file'));
  else if (process.env.WA_BACKUP_KEY) key = process.env.WA_BACKUP_KEY;
  else if (process.stdin.isTTY) key = await askHidden('Backup key (the 64 digits WhatsApp showed, spaces are fine): ');
  else { console.error('this backup is encrypted: --key-file <file>, or WA_BACKUP_KEY'); process.exit(2); }
}

const t0 = Date.now();
let backup;
try {
  backup = await readBackup(input, { key, contacts: value('--wa'), keepDb: value('--keep-db') });
} catch (err) {
  console.error(`could not read ${input}: ${err.message}`);
  process.exit(1);
}
const chats = pickChats(backup.chats, values('--chat'));
const total = chats.reduce((n, c) => n + c.messages.length, 0);
console.log(`${backup.device} backup: ${backup.counts.chats} chats, ${backup.counts.messages} messages, ${backup.counts.reactions} reactions, `
  + `${backup.counts.contacts} contacts, read in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (values('--chat').length) console.log(`picked ${chats.length} chat(s), ${total} messages: ${chats.map((c) => c.name).join(', ') || 'none'}`);
if (flag('--dry')) process.exit(0);
if (!chats.length) { console.error('no chat to export'); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = path.resolve(value('--out') ?? path.join(DATA, 'reports', 'chat-export', stamp));
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
if (!flag('--no-json')) {
  fs.writeFileSync(path.join(out, 'chats.json'), JSON.stringify({ exportedAt: new Date().toISOString(), device: backup.device, chats: chats.map(chatJson) }, null, 1), { mode: 0o600 });
}
if (!flag('--no-html')) {
  for (const c of chats) for (const p of chatPages(c)) fs.writeFileSync(path.join(out, p.file), p.html, { mode: 0o600 });
  fs.writeFileSync(path.join(out, 'index.html'), indexPage(chats), { mode: 0o600 });
}
console.log(`written to ${out}${flag('--no-html') ? '' : ' (open index.html)'}`);

