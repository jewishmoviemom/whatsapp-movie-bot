/**
 * A WhatsApp backup from a phone - Android's msgstore.db (plain or
 * .crypt12/14/15) or an iPhone's ChatStorage.sqlite or whole unencrypted
 * backup folder - read into chats (model.js), for tools/export-chat-backup.mjs.
 *
 * Nothing here touches the network: the backup is the phone's, decrypted on
 * this box with the key the person gives, and read with Python's own sqlite3.
 * The decrypted database is the person's whole chat history in the clear, so
 * it is written 0600 into a private temporary folder and removed as soon as
 * it is read, unless `keepDb` names where to keep it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readKey, decryptBackup, cryptOf } from './decrypt.js';
import { buildChats } from './model.js';

const READER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'chat-backup', 'read_db.py');
const python = () => process.env.CHAT_BACKUP_PYTHON || 'python3';

export const isEncrypted = (file) => /\.crypt1[245]$/i.test(file);

/** The ChatStorage.sqlite of an unencrypted iTunes/Finder backup folder. */
export function iosBackupDb(dir) {
  return execFileSync(python(), ['-I', READER, 'ios-backup', dir], { encoding: 'utf8' }).trim();
}

/** Decrypts `file` to a private temp file when it needs it; returns { db, cleanup }. */
export function openDatabaseFile(file, { key = null, type = 'message', keepDb = null } = {}) {
  if (!isEncrypted(file)) return { db: file, cleanup: () => {} };
  if (!key) throw new Error(`${path.basename(file)} is encrypted: give its key (--key-file, or WA_BACKUP_KEY)`);
  const k = typeof key === 'object' && key.kind ? key : readKey(key);
  const plain = decryptBackup(fs.readFileSync(file), k, { crypt: cryptOf(file, k), type });
  if (keepDb) {
    fs.writeFileSync(keepDb, plain, { mode: 0o600 });
    return { db: keepDb, cleanup: () => {} };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-backup-'));
  const db = path.join(dir, type === 'contact' ? 'wa.db' : 'msgstore.db');
  fs.writeFileSync(db, plain, { mode: 0o600 });
  return { db, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** read_db.py's rows, streamed. */
export async function* readRows(db, contactsDb = null) {
  const child = spawn(python(), ['-I', READER, 'auto', db, ...(contactsDb ? [contactsDb] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve) => child.on('close', resolve));
  for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (line) yield JSON.parse(line);
  }
  const code = await done;
  if (code !== 0) throw new Error(`reading ${path.basename(db)} failed: ${err.trim().split('\n').pop() || `exit ${code}`}`);
}

/**
 * The whole backup as chats: { chats, contacts, counts, device }.
 * `input` is a database, an encrypted backup, or an iOS backup folder;
 * `contacts` an optional wa.db (plain or .crypt15) for Android names.
 */
export async function readBackup(input, { key = null, contacts = null, keepDb = null } = {}) {
  let file = input;
  if (fs.statSync(input).isDirectory()) file = iosBackupDb(input);
  const main = openDatabaseFile(file, { key, keepDb });
  const wa = contacts ? openDatabaseFile(contacts, { key, type: 'contact' }) : null;
  try {
    const rows = [];
    let device = 'android';
    for await (const r of readRows(main.db, wa?.db)) {
      if (r.type === 'device') device = r.device;
      else rows.push(r);
    }
    return { ...buildChats(rows, { device }), device };
  } finally {
    main.cleanup();
    wa?.cleanup();
  }
}
