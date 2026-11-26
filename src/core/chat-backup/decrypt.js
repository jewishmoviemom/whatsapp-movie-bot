/**
 * WhatsApp's Android backups (msgstore.db.crypt12/14/15, wa.db.crypt15)
 * decrypted in Node, with nothing installed.
 *
 * A port of WhatsApp-Chat-Exporter's android_crypt.py (Knugi, MIT; see
 * NOTICE beside this file). The operator, 2026-11-26: "implement
 * https://github.com/KnugiHK/WhatsApp-Chat-Exporter ... but recode anything
 * that calls too many API's". What changed in the port:
 *
 *  - No Python packages. The original needs pycryptodome for AES and
 *    javaobj-py3 for the crypt15 key file; Node's crypto does AES-GCM, and the
 *    key file is a serialized Java byte[] whose last 32 bytes are the key.
 *  - The crypt14 offset search no longer decrypts the whole database for every
 *    guess. The original, when no known offset fits, tries 200 x 200 = 40,000
 *    (IV, start) pairs, each a full AES-GCM decrypt and inflate of a database
 *    that can be gigabytes, in a pool of ten processes. Here a guess costs one
 *    16-byte block: GCM is a counter mode, so the first block of plaintext is
 *    known at once, and a real database starts with a zlib header (0x78 and a
 *    second byte that makes the pair a multiple of 31). Only a guess that
 *    passes is decrypted in full and has its tag checked.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/** Offsets of crypt14's IV and database start seen in real backups (utility.py CRYPT14_OFFSETS). */
export const CRYPT14_OFFSETS = Object.freeze([
  { iv: 67, db: 191 }, { iv: 67, db: 190 }, { iv: 66, db: 99 }, { iv: 67, db: 193 },
  { iv: 67, db: 194 }, { iv: 67, db: 158 }, { iv: 67, db: 196 },
]);
const FOOTER = 32;
const SEARCH_MAX = 200;

export class DecryptionError extends Error {}

/** The crypt15 key: HMAC of HMAC over the 32-byte root key (android_crypt.py _derive_main_enc_key). */
export function crypt15Key(root) {
  const inter = crypto.createHmac('sha256', Buffer.alloc(32)).update(root).digest();
  return crypto.createHmac('sha256', inter).update(Buffer.from('backup encryption\x01', 'latin1')).digest();
}

/**
 * The key, from what the person has:
 *  - the 64 hex digits WhatsApp shows for an end-to-end encrypted backup
 *    (spaces allowed): crypt15;
 *  - the "encrypted_backup.key" file (a serialized Java byte[]): crypt15;
 *  - the 158-byte "key" file from /data/data/com.whatsapp/files: crypt12/14.
 */
export function readKey(input) {
  const text = Buffer.isBuffer(input) ? input.toString('latin1') : String(input);
  const hex = text.replace(/\s+/g, '');
  if (/^[0-9a-f]{64}$/i.test(hex)) return { kind: 'crypt15', root: Buffer.from(hex, 'hex') };
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'latin1');
  if (buf.length === 158) return { kind: 'legacy', file: buf, key: buf.subarray(126) };
  // A Java serialization stream (0xACED) of a byte[] (class "[B"): the array's
  // length is the four bytes before its contents, which end the stream.
  if (buf.length > 36 && buf[0] === 0xac && buf[1] === 0xed) {
    const len = buf.readInt32BE(buf.length - 36);
    if (len === 32) return { kind: 'crypt15', root: buf.subarray(buf.length - 32) };
  }
  throw new DecryptionError('not a WhatsApp backup key: give the 64-digit key, the encrypted_backup.key file, or the 158-byte key file');
}

/** Which crypt a file is, by its name, else by the key it came with. */
export function cryptOf(name, key) {
  const m = /\.crypt(1[245])$/i.exec(String(name ?? ''));
  if (m) return Number(m[1]);
  return key?.kind === 'crypt15' ? 15 : 14;
}

const looksZlib = (b) => b.length >= 2 && b[0] === 0x78 && ((b[0] << 8) | b[1]) % 31 === 0;

/** Only the first block: is this (IV, start) the right one? Cheap, unauthenticated. */
function firstBlockFits(file, key, ivAt, dbAt) {
  if (ivAt + 16 > file.length || dbAt + 16 > file.length - FOOTER) return false;
  const d = crypto.createDecipheriv('aes-256-gcm', key, file.subarray(ivAt, ivAt + 16));
  return looksZlib(d.update(file.subarray(dbAt, dbAt + 16)));
}

/** The whole database: authenticated, inflated, and a SQLite file (android_crypt.py _decrypt_database). */
function openDatabase(cipher, key, iv) {
  if (cipher.length <= FOOTER) throw new DecryptionError('too short to hold a GCM tag');
  const body = cipher.subarray(0, cipher.length - FOOTER);
  const tag = cipher.subarray(cipher.length - FOOTER, cipher.length - FOOTER + 16);
  let packed;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    packed = Buffer.concat([d.update(body), d.final()]);
  } catch {
    throw new DecryptionError('decryption failed: the key does not open this backup');
  }
  if (!looksZlib(packed)) throw new DecryptionError('the key is right, but what it opens is not compressed: is this a WhatsApp backup?');
  let db;
  try { db = zlib.inflateSync(packed); } catch (e) { throw new DecryptionError(`the backup is damaged: ${e.message}`); }
  if (!db.subarray(0, 6).equals(Buffer.from('SQLite'))) throw new DecryptionError('it opens, but it is not a SQLite database');
  return db;
}

/**
 * The decrypted SQLite database, as a Buffer.
 * `type` is 'message' (msgstore) or 'contact' (wa.db): crypt15 lays them out differently.
 */
export function decryptBackup(file, key, { crypt = cryptOf(null, key), type = 'message' } = {}) {
  if (crypt === 15) {
    if (key.kind !== 'crypt15') throw new DecryptionError('a crypt15 backup needs the 64-digit key or encrypted_backup.key');
    if (file.length < 131) throw new DecryptionError('a crypt15 file is at least 131 bytes');
    const k = crypt15Key(key.root);
    const [ivAt, dbAt] = type === 'contact' ? [7, file[0] + 1] : [8, file[0] + 2];
    return openDatabase(file.subarray(dbAt), k, file.subarray(ivAt, ivAt + 16));
  }
  if (key.kind !== 'legacy') throw new DecryptionError(`a crypt${crypt} backup needs the 158-byte key file`);
  if (crypt === 12) {
    if (file.length < 67) throw new DecryptionError('a crypt12 file is at least 67 bytes');
    if (!key.file.subarray(30, 62).equals(file.subarray(3, 35))) throw new DecryptionError('the key file is not this backup\'s (their signatures differ)');
    return openDatabase(file.subarray(67, file.length - 20), key.key, file.subarray(51, 67));
  }
  if (file.length < 191) throw new DecryptionError('a crypt14 file is at least 191 bytes');
  if (!key.file.subarray(30, 62).equals(file.subarray(15, 47))) throw new DecryptionError('the key file is not this backup\'s (their signatures differ)');
  const tried = new Set();
  const attempt = (iv, db) => {
    tried.add(`${iv}/${db}`);
    if (!firstBlockFits(file, key.key, iv, db)) return null;
    try { return openDatabase(file.subarray(db), key.key, file.subarray(iv, iv + 16)); } catch { return null; }
  };
  for (const o of CRYPT14_OFFSETS) {
    const db = attempt(o.iv, o.db);
    if (db) return db;
  }
  for (let iv = 0; iv < SEARCH_MAX; iv++) {
    for (let at = 0; at < SEARCH_MAX; at++) {
      if (tried.has(`${iv}/${at}`)) continue;
      const db = attempt(iv, at);
      if (db) return db;
    }
  }
  throw new DecryptionError('no IV and start in the first 200 bytes open this crypt14 backup');
}
