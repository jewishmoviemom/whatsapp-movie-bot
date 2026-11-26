#!/usr/bin/env python3
"""
Reads a WhatsApp database and writes its chats, contacts, messages and
reactions to stdout as JSON lines, for src/core/chat-backup/model.js.

    python3 -I tools/chat-backup/read_db.py android <msgstore.db> [<wa.db>]
    python3 -I tools/chat-backup/read_db.py ios <ChatStorage.sqlite> [<ContactsV2.sqlite>]
    python3 -I tools/chat-backup/read_db.py auto <either>        (says which first, as a "device" line)
    python3 -I tools/chat-backup/read_db.py ios-backup <dir>     (the path of ChatStorage.sqlite in an iTunes backup)

The queries are WhatsApp-Chat-Exporter's (Knugi, MIT; see
src/core/chat-backup/NOTICE), recoded for the bot (the operator, 2026-11-26):
the Python standard library only - the original needs jinja2, bleach, tqdm,
pycryptodome and javaobj-py3, and asks PyPI for a newer version of itself on
every run - and one pass over each table, the rows streamed out as they are
read rather than held in memory. Each join is made only when its table is
there, since WhatsApp adds and drops tables between versions: the original
tries the old schema, catches the error, and tries the new one.

The database is opened read-only (mode=ro): it is the person's only copy.
"""
import json
import sqlite3
import sys

APPLE_EPOCH = 978307200  # 2001-01-01, iOS's zero, in Unix seconds


def out(kind, **row):
    sys.stdout.write(json.dumps({'type': kind, **row}, ensure_ascii=False, default=str) + '\n')


def connect(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.text_factory = lambda b: b.decode('utf-8', 'replace')
    return db


def tables(db):
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def columns(db, table):
    return {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}


def rows(cur):
    while True:
        try:
            r = cur.fetchone()
        except sqlite3.OperationalError:
            continue  # a damaged row: skipped, as the original does
        if r is None:
            return
        yield dict(r)


# --------------------------------------------------------------- Android ---

def android_contacts(path):
    db = connect(path)
    if 'wa_contacts' not in tables(db):
        return
    cols = columns(db, 'wa_contacts')
    name = 'COALESCE(display_name, wa_name)' if 'wa_name' in cols else 'display_name'
    status = 'status' if 'status' in cols else 'NULL'
    for r in rows(db.execute(f'SELECT jid, {name} AS name, {status} AS status FROM wa_contacts')):
        out('contact', jid=r['jid'], name=r['name'], status=r['status'])


def android(path, wa=None):
    if wa:
        android_contacts(wa)
    db = connect(path)
    t = tables(db)
    if 'wa_contacts' in t:
        android_contacts(path)
    if 'message' in t:
        android_new(db, t)
    elif 'messages' in t:
        android_legacy(db, t)
    else:
        raise SystemExit('no message table: is this a msgstore.db?')


def android_new(db, t):
    mapped = 'jid_map' in t
    chat_jid = 'COALESCE(lid_global.raw_string, jid_global.raw_string)' if mapped else 'jid_global.raw_string'
    sender_jid = 'COALESCE(lid_group.raw_string, jid_group.raw_string)' if mapped else 'jid_group.raw_string'
    sel = [f'{chat_jid} AS chat', 'jid_global.raw_string AS chat_raw', 'jid_global.type AS jid_type', 'message._id AS row',
           'message.key_id', 'message.from_me', 'message.timestamp', 'message.text_data AS text',
           'message.message_type AS mtype', 'message.status', f'{sender_jid} AS sender', 'chat.subject']
    joins = ['LEFT JOIN chat ON chat._id = message.chat_row_id',
             'INNER JOIN jid jid_global ON jid_global._id = chat.jid_row_id',
             'LEFT JOIN jid jid_group ON jid_group._id = message.sender_jid_row_id']
    if mapped:
        joins += ['LEFT JOIN jid_map jid_map_global ON chat.jid_row_id = jid_map_global.lid_row_id',
                  'LEFT JOIN jid lid_global ON jid_map_global.jid_row_id = lid_global._id',
                  'LEFT JOIN jid_map jid_map_group ON message.sender_jid_row_id = jid_map_group.lid_row_id',
                  'LEFT JOIN jid lid_group ON jid_map_group.jid_row_id = lid_group._id']
    if 'message_quoted' in t:
        sel += ['message_quoted.key_id AS quoted', 'message_quoted.text_data AS quoted_text']
        joins.append('LEFT JOIN message_quoted ON message_quoted.message_row_id = message._id')
    if 'message_media' in t:
        mc = columns(db, 'message_media')
        sel += ['message_media.file_path AS media_path', 'message_media.mime_type AS mime',
                'message_media.raw_transcription_text AS transcription' if 'raw_transcription_text' in mc else 'NULL AS transcription']
        joins.append('LEFT JOIN message_media ON message_media.message_row_id = message._id')
    if 'message_location' in t:
        sel += ['message_location.latitude', 'message_location.longitude']
        joins.append('LEFT JOIN message_location ON message_location.message_row_id = message._id')
    if 'message_system' in t:
        sel.append('message_system.action_type')
        joins.append('LEFT JOIN message_system ON message_system.message_row_id = message._id')
    if 'message_system_group' in t:
        sel.append('message_system_group.is_me_joined')
        joins.append('LEFT JOIN message_system_group ON message_system_group.message_row_id = message._id')
    if 'message_system_number_change' in t:
        sel += ['jid_old.raw_string AS old_jid', 'jid_new.raw_string AS new_jid']
        joins += ['LEFT JOIN message_system_number_change ON message_system_number_change.message_row_id = message._id',
                  'LEFT JOIN jid jid_old ON jid_old._id = message_system_number_change.old_jid_row_id',
                  'LEFT JOIN jid jid_new ON jid_new._id = message_system_number_change.new_jid_row_id']
    if 'missed_call_logs' in t:
        sel.append('missed_call_logs.video_call')
        joins.append('LEFT JOIN missed_call_logs ON missed_call_logs.message_row_id = message._id')
    q = f"SELECT {', '.join(sel)} FROM message {' '.join(joins)} WHERE jid_global.raw_string <> '-1' GROUP BY message._id ORDER BY message.timestamp"
    chats = {}
    for r in rows(db.execute(q)):
        if r['chat'] and r['chat'] not in chats:
            chats[r['chat']] = True
            out('chat', jid=r['chat'], name=r.get('subject'))
        out('message', **r)
    if 'message_add_on' in t and 'message_add_on_reaction' in t:
        q = """SELECT message_add_on.parent_message_row_id AS row, message_add_on_reaction.reaction, message_add_on.from_me,
                      jid.raw_string AS sender, message_add_on_reaction.sender_timestamp AS timestamp
               FROM message_add_on
                 INNER JOIN message_add_on_reaction ON message_add_on._id = message_add_on_reaction.message_add_on_row_id
                 LEFT JOIN jid ON message_add_on.sender_jid_row_id = jid._id"""
        for r in rows(db.execute(q)):
            out('reaction', **r)


def android_legacy(db, t):
    mc = columns(db, 'messages')
    opt = lambda c, alias=None: f'messages.{c}' + (f' AS {alias}' if alias else '') if c in mc else f'NULL AS {alias or c}'
    sel = ['messages.key_remote_jid AS chat', 'messages.key_remote_jid AS chat_raw', 'messages._id AS row', 'messages.key_id',
           'messages.key_from_me AS from_me', 'messages.timestamp', 'messages.data AS text',
           'CAST(messages.media_wa_type AS INTEGER) AS mtype', 'messages.status', 'messages.remote_resource AS sender',
           opt('media_caption', 'caption'), opt('latitude'), opt('longitude'), opt('media_mime_type', 'mime'), opt('media_name', 'media_path')]
    joins = []
    if 'jid' in t and 'chat' in t:
        sel += ['jid.type AS jid_type', 'chat.subject']
        joins += ['LEFT JOIN jid ON messages.key_remote_jid = jid.raw_string', 'LEFT JOIN chat ON chat.jid_row_id = jid._id']
    if 'messages_quotes' in t and 'quoted_row_id' in mc:
        sel += ['messages_quotes.key_id AS quoted', 'messages_quotes.data AS quoted_text']
        joins.append('LEFT JOIN messages_quotes ON messages.quoted_row_id = messages_quotes._id')
    if 'message_system' in t:
        sel.append('message_system.action_type')
        joins.append('LEFT JOIN message_system ON message_system.message_row_id = messages._id')
    q = f"SELECT {', '.join(sel)} FROM messages {' '.join(joins)} WHERE messages.key_remote_jid <> '-1' GROUP BY messages._id ORDER BY messages.timestamp"
    chats = {}
    for r in rows(db.execute(q)):
        if r['chat'] and r['chat'] not in chats:
            chats[r['chat']] = True
            out('chat', jid=r['chat'], name=r.get('subject'))
        out('message', **r)


# ------------------------------------------------------------------- iOS ---

def ios(path, contacts=None):
    db = connect(path)
    t = tables(db)
    if 'ZWAMESSAGE' not in t:
        raise SystemExit('no ZWAMESSAGE table: is this a ChatStorage.sqlite?')
    push = 'ZWAPROFILEPUSHNAME' in t
    q = f"""SELECT ZCONTACTJID AS jid, ZPARTNERNAME AS name{', ZWAPROFILEPUSHNAME.ZPUSHNAME AS push' if push else ''}
            FROM ZWACHATSESSION {'LEFT JOIN ZWAPROFILEPUSHNAME ON ZWACHATSESSION.ZCONTACTJID = ZWAPROFILEPUSHNAME.ZJID' if push else ''}"""
    for r in rows(db.execute(q)):
        out('chat', jid=r['jid'], name=r['name'])
    if push:
        for r in rows(db.execute('SELECT ZJID AS jid, ZPUSHNAME AS name FROM ZWAPROFILEPUSHNAME')):
            out('contact', jid=r['jid'], name=r['name'])
    media = 'ZWAMEDIAITEM' in t
    mcols = columns(db, 'ZWAMEDIAITEM') if media else set()
    mopt = lambda c, alias: f'ZWAMEDIAITEM.{c} AS {alias}' if c in mcols else f'NULL AS {alias}'
    gname = 'ZWAGROUPMEMBER.ZCONTACTNAME' if 'ZCONTACTNAME' in columns(db, 'ZWAGROUPMEMBER') else 'NULL'
    q = f"""SELECT ZWACHATSESSION.ZCONTACTJID AS chat, ZWAMESSAGE.Z_PK AS row, ZWAMESSAGE.ZSTANZAID AS key_id,
                   ZWAMESSAGE.ZISFROMME AS from_me, ZWAMESSAGE.ZMESSAGEDATE AS apple_date, ZWAMESSAGE.ZTEXT AS text,
                   ZWAMESSAGE.ZMESSAGETYPE AS ios_type, ZWAGROUPMEMBER.ZMEMBERJID AS sender, {gname} AS sender_name,
                   ZWAMESSAGE.ZGROUPINFO IS NOT NULL AS is_group
                   {(', ' + ', '.join([mopt('ZMEDIALOCALPATH', 'media_path'), mopt('ZTITLE', 'caption'), mopt('ZLATITUDE', 'latitude'), mopt('ZLONGITUDE', 'longitude')])) if media else ''}
            FROM ZWAMESSAGE
              INNER JOIN ZWACHATSESSION ON ZWAMESSAGE.ZCHATSESSION = ZWACHATSESSION.Z_PK
              LEFT JOIN ZWAGROUPMEMBER ON ZWAMESSAGE.ZGROUPMEMBER = ZWAGROUPMEMBER.Z_PK
              {'LEFT JOIN ZWAMEDIAITEM ON ZWAMESSAGE.Z_PK = ZWAMEDIAITEM.ZMESSAGE' if media else ''}
            GROUP BY ZWAMESSAGE.Z_PK ORDER BY ZWAMESSAGE.ZMESSAGEDATE"""
    for r in rows(db.execute(q)):
        r['timestamp'] = int((APPLE_EPOCH + (r.pop('apple_date') or 0)) * 1000)
        out('message', **r)


def ios_backup_file(backup_dir, domain_file='AppDomainGroup-group.net.whatsapp.WhatsApp.shared', rel='ChatStorage.sqlite'):
    """The ChatStorage.sqlite inside an unencrypted iTunes/Finder backup, by Manifest.db."""
    import os
    m = connect(os.path.join(backup_dir, 'Manifest.db'))
    for dom in (domain_file, domain_file.replace('WhatsApp.shared', 'WhatsAppSMB.shared')):
        r = m.execute('SELECT fileID FROM Files WHERE domain = ? AND relativePath = ?', (dom, rel)).fetchone()
        if r:
            return os.path.join(backup_dir, r[0][:2], r[0])
    raise SystemExit('no WhatsApp ChatStorage.sqlite in this backup (is it encrypted? turn "Encrypt local backup" off)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    kind, path, *rest = sys.argv[1:]
    if kind == 'auto':
        found = tables(connect(path))
        kind = 'ios' if 'ZWAMESSAGE' in found else 'android'
        out('device', device=kind)
    if kind == 'android':
        android(path, rest[0] if rest else None)
    elif kind == 'ios':
        ios(path, rest[0] if rest else None)
    elif kind == 'ios-backup':
        print(ios_backup_file(path))
    else:
        raise SystemExit(f'unknown kind {kind}')
