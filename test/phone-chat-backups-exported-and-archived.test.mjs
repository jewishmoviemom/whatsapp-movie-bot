// A phone's WhatsApp backup - Android's msgstore.db, encrypted (crypt14,
// crypt15) or not, or an iPhone's ChatStorage.sqlite - is read into chats
// and written as web pages that fetch nothing. The operator, 2026-11-26: "implement
// https://github.com/KnugiHK/WhatsApp-Chat-Exporter on both repos but recode
// anything that calls too many API's". The original installs five Python
// packages, asks PyPI for a newer version on every run, loads Tailwind from a
// CDN in every page it writes, and tries up to 40,000 full decryptions of the
// database to find a crypt14 backup's offsets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readKey, decryptBackup, crypt15Key, DecryptionError } from '../src/core/chat-backup/decrypt.js';
import { readBackup } from '../src/core/chat-backup/index.js';
import { pickChats, systemText } from '../src/core/chat-backup/model.js';
import { chatPages, indexPage } from '../src/core/chat-backup/html.js';

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failed++; console.log(`  FAIL ${msg}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-backup-test-'));
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' });

const GROUP = '120363000000000001@g.us';
const MEMBER_LID = '100000000000001@lid', MEMBER = '15550002222@s.whatsapp.net', DM = '15550001111@s.whatsapp.net';
const T = Date.UTC(2026, 10, 25, 20, 0);

// A msgstore.db in WhatsApp's current schema, LIDs mapped to phone numbers.
const android = path.join(tmp, 'msgstore.db');
py(`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript('''
CREATE TABLE jid (_id INTEGER PRIMARY KEY, raw_string TEXT, type INTEGER);
CREATE TABLE jid_map (lid_row_id INTEGER, jid_row_id INTEGER);
CREATE TABLE chat (_id INTEGER PRIMARY KEY, jid_row_id INTEGER, subject TEXT);
CREATE TABLE message (_id INTEGER PRIMARY KEY, chat_row_id INTEGER, from_me INTEGER, key_id TEXT, sender_jid_row_id INTEGER,
  status INTEGER, timestamp INTEGER, message_type INTEGER, text_data TEXT);
CREATE TABLE message_quoted (message_row_id INTEGER, key_id TEXT, text_data TEXT);
CREATE TABLE message_media (message_row_id INTEGER, file_path TEXT, mime_type TEXT);
CREATE TABLE message_system (message_row_id INTEGER, action_type INTEGER);
CREATE TABLE message_add_on (_id INTEGER PRIMARY KEY, parent_message_row_id INTEGER, from_me INTEGER, sender_jid_row_id INTEGER);
CREATE TABLE message_add_on_reaction (message_add_on_row_id INTEGER, reaction TEXT, sender_timestamp INTEGER);
CREATE TABLE wa_contacts (jid TEXT, display_name TEXT, wa_name TEXT, status TEXT);
''')
db.executemany('INSERT INTO jid VALUES (?,?,?)', [(1,'${GROUP}',1),(2,'${MEMBER_LID}',17),(3,'${MEMBER}',0),(4,'${DM}',0)])
db.execute('INSERT INTO jid_map VALUES (2,3)')
db.executemany('INSERT INTO chat VALUES (?,?,?)', [(1,1,'02 MOVIE REQUESTS'),(2,4,None)])
T=${T}
db.executemany('INSERT INTO message VALUES (?,?,?,?,?,?,?,?,?)', [
  (1,1,0,'3AAA',2,0,T,0,'#request Skyfall'),
  (2,1,1,'3AAB',0,0,T+60000,0,'Skyfall (2012) is on its way <b>soon</b>\\nline two'),
  (3,1,0,'3AAC',2,0,T+120000,1,'the poster'),
  (4,1,0,'3AAD',2,6,T+180000,7,None),
  (5,2,0,'3AAE',0,0,T+240000,0,'hi from a DM'),
])
db.execute("INSERT INTO message_quoted VALUES (2,'3AAA','#request Skyfall')")
db.execute("INSERT INTO message_media VALUES (3,'Media/WhatsApp Images/IMG-1.jpg','image/jpeg')")
db.execute('INSERT INTO message_system VALUES (4,5)')
db.execute('INSERT INTO message_add_on VALUES (1,1,1,0)')
db.execute("INSERT INTO message_add_on_reaction VALUES (1,'👍',${T + 70000})")
db.execute("INSERT INTO wa_contacts VALUES ('${MEMBER}','Test Member',NULL,NULL)")
db.commit()
`, android);
const plain = fs.readFileSync(android);

// --- decryption ---
const root = crypto.randomBytes(32);
const gcm = (key, iv, data) => {
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(zlib.deflateSync(data)), c.final()]);
  return Buffer.concat([enc, c.getAuthTag(), crypto.randomBytes(16)]); // the tag, then WhatsApp's 16-byte checksum
};
{
  const n = 40;
  const head = crypto.randomBytes(n + 2); head[0] = n;
  const file = Buffer.concat([head, gcm(crypt15Key(root), head.subarray(8, 24), plain)]);
  const hex = root.toString('hex').match(/.{4}/g).join(' ');
  ok(decryptBackup(file, readKey(hex), { crypt: 15 }).equals(plain), 'crypt15 opens with the 64-digit key, spaces and all');
  const javaKey = Buffer.concat([Buffer.from('aced0005757200025b42acf317f8060854e00200007870', 'hex'), Buffer.from([0, 0, 0, 32]), root]);
  ok(decryptBackup(file, readKey(javaKey), { crypt: 15 }).equals(plain), 'and with the encrypted_backup.key file');
  let e = null;
  try { decryptBackup(file, readKey(crypto.randomBytes(32).toString('hex')), { crypt: 15 }); } catch (err) { e = err; }
  ok(e instanceof DecryptionError && /key does not open/.test(e.message), 'a wrong key is said to be the key');
  fs.writeFileSync(path.join(tmp, 'msgstore.db.crypt15'), file);
}
{
  // crypt14 with offsets no known backup uses: found by the one-block test.
  const keyFile = crypto.randomBytes(158);
  const ivAt = 71, dbAt = 133;
  const head = crypto.randomBytes(dbAt);
  keyFile.copy(head, 15, 30, 62);
  const file = Buffer.concat([head, gcm(keyFile.subarray(126), head.subarray(ivAt, ivAt + 16), plain)]);
  const t0 = Date.now();
  ok(decryptBackup(file, readKey(keyFile), { crypt: 14 }).equals(plain), 'crypt14 at offsets outside the known list is found');
  ok(Date.now() - t0 < 5000, `by testing one block per guess, not decrypting the database 40,000 times (${Date.now() - t0} ms)`);
  const other = Buffer.from(keyFile); other[40] ^= 1;
  let e = null;
  try { decryptBackup(file, readKey(other), { crypt: 14 }); } catch (err) { e = err; }
  ok(/signatures differ/.test(e?.message), 'another backup\'s key file is refused before anything is tried');
}

// --- reading ---
const b = await readBackup(path.join(tmp, 'msgstore.db.crypt15'), { key: root.toString('hex') });
ok(b.device === 'android' && b.counts.chats === 2 && b.counts.messages === 5 && b.counts.reactions === 1, `the encrypted backup read: ${JSON.stringify(b.counts)}`);
ok(!fs.readdirSync(os.tmpdir()).some((d) => d.startsWith('wa-backup-') && fs.existsSync(path.join(os.tmpdir(), d, 'msgstore.db'))), 'the decrypted database is deleted once read');
const g = b.chats.get(GROUP);
ok(g.name === '02 MOVIE REQUESTS' && g.group, 'a group is named by its subject');
const [m1, m2, m3, m4] = g.messages;
ok(m1.sender === MEMBER && m1.senderName === 'Test Member', 'a sender\'s LID is mapped to their number, and named from the contacts');
ok(m2.fromMe && m2.replyTo?.id === '3AAA' && m2.replyTo.text === '#request Skyfall', 'a reply carries what it quoted');
ok(m1.reactions?.[0]?.emoji === '👍' && m1.reactions[0].fromMe, 'reactions sit on the message they were on');
ok(m3.type === 'image' && m3.media.path.endsWith('IMG-1.jpg') && m3.text === 'the poster', 'media: the type, the path in the phone\'s folder, the caption');
ok(m4.type === 'system' && m4.text === 'Test Member left the group', `a system line in words (${m4.text})`);
ok(b.chats.get(DM).name === '15550001111', 'a chat with no name is its number');
ok(pickChats(b.chats, ['movie']).length === 1 && pickChats(b.chats, ['15550001111']).length === 1, 'chats are picked by a piece of the name, or the number');
ok(systemText({ action_type: 1, text: 'New name' }, 'You') === 'You changed the group name to "New name"', 'a renamed group');

// --- the web pages ---
const pages = chatPages(g);
const html = pages[0].html + indexPage([...b.chats.values()]);
ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html) && !/<script|@import|url\(/i.test(html), 'the pages fetch nothing: no script, no CDN, no remote style');
ok(html.includes('&lt;b&gt;soon&lt;/b&gt;<br>line two'), 'what members wrote is escaped, not run as HTML');
ok(/>16:00</.test(pages[0].html) || />15:00</.test(pages[0].html), 'times on the 24-hour clock, New York');
ok(chatPages(g, { pageSize: 2 }).length === 2, 'a long chat is split into pages');

// --- iPhone ---
const ios = path.join(tmp, 'ChatStorage.sqlite');
py(`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript('''
CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT);
CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZMEMBERJID TEXT, ZCONTACTNAME TEXT);
CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZSTANZAID TEXT, ZISFROMME INTEGER,
  ZMESSAGEDATE REAL, ZTEXT TEXT, ZMESSAGETYPE INTEGER, ZGROUPINFO INTEGER);
''')
db.execute("INSERT INTO ZWACHATSESSION VALUES (1,'${GROUP}','Movie requests')")
db.execute("INSERT INTO ZWAGROUPMEMBER VALUES (1,'${MEMBER}','Member')")
db.execute("INSERT INTO ZWAMESSAGE VALUES (1,1,1,'3BBB',0,786139200.5,'#request Heat',0,1)")
db.commit()
`, ios);
const ib = await readBackup(ios);
const im = ib.chats.get(GROUP)?.messages[0];
ok(ib.device === 'ios' && im?.text === '#request Heat' && im.sender === MEMBER && im.senderName === 'Member', 'an iPhone\'s ChatStorage.sqlite is read');
ok(im?.at === Math.round((978307200 + 786139200.5) * 1000), 'its times counted from 2001, Apple\'s zero');

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
