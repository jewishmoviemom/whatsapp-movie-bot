/**
 * The rows tools/chat-backup/read_db.py writes, made into chats: names,
 * messages with their sender, reply, media and reactions, and the system
 * lines ("X left the group") in words. Ported from WhatsApp-Chat-Exporter's
 * android_handler.py, ios_handler.py and utility.py determine_metadata()
 * (Knugi, MIT; see NOTICE).
 *
 * The output is plain data: JSON for the export, and HTML (html.js) to read.
 */

/** Android message_type values (WhatsApp's own numbering). */
export const ANDROID_TYPES = Object.freeze({
  0: 'text', 1: 'image', 2: 'audio', 3: 'video', 4: 'contact', 5: 'location', 7: 'system', 9: 'document',
  10: 'missed-call', 13: 'gif', 15: 'deleted', 16: 'live-location', 20: 'sticker', 42: 'view-once-image',
  43: 'view-once-video', 46: 'poll', 64: 'deleted-by-admin', 66: 'poll',
});
/** iOS ZMESSAGETYPE values. */
export const IOS_TYPES = Object.freeze({
  0: 'text', 1: 'image', 2: 'video', 3: 'audio', 4: 'contact', 5: 'location', 6: 'system', 7: 'link', 8: 'document',
  10: 'system', 11: 'gif', 14: 'deleted', 15: 'sticker', 46: 'poll',
});

const user = (jid) => (jid && String(jid).includes('@') ? String(jid).split('@')[0] : jid ?? null);
const isGroupJid = (jid) => /@g\.us$/.test(String(jid ?? ''));

/** A system message in words (utility.py determine_metadata). */
export function systemText(r, who) {
  const name = who || 'Someone';
  if (r.is_me_joined === 1) return `You were added into the group by ${name}`;
  switch (r.action_type) {
    case 1: return `${name} changed the group name to "${r.text ?? ''}"`;
    case 4: return `${name} was added to the group`;
    case 5: return `${name} left the group`;
    case 6: return `${name} changed the group icon`;
    case 7: return 'You were removed';
    case 9: return `${name} created a broadcast list`;
    case 10: return r.old_jid && r.new_jid ? `${user(r.old_jid)} changed their number to ${user(r.new_jid)}` : null;
    case 11: return `${name} created a group with name: "${r.text ?? ''}"`;
    case 12: return `${name} added someone`;
    case 14: return `${name} removed someone`;
    case 18: return name === 'You' ? 'The security code in this chat changed' : `The security code between you and ${name} changed`;
    case 19: return 'This chat is now end-to-end encrypted';
    case 20: return 'Someone joined this group by using an invite link';
    case 27: return `${name} changed the group description to:\n${r.text ?? 'Unknown'}`;
    case 28: return r.old_jid && r.new_jid ? `${user(r.old_jid)} changed their number to ${user(r.new_jid)}` : null;
    case 46: return 'This business account has now registered as a standard account';
    case 47: return 'This business account has now registered as a business account';
    case 50: return `${name} changed the group settings`;
    case 67: return 'Messages and calls are end-to-end encrypted';
    default: return null;
  }
}

/**
 * Builds the chats from read_db.py's rows, in one pass.
 * Returns { chats: Map(jid -> chat), contacts: Map(jid -> name), counts }.
 */
export function buildChats(rowsIter, { device = 'android' } = {}) {
  const contacts = new Map();
  const chats = new Map();
  const byRow = new Map();      // database row id -> message, for reactions
  const counts = { messages: 0, reactions: 0, chats: 0, contacts: 0 };
  const chatOf = (jid, name = null) => {
    let c = chats.get(jid);
    if (!c) {
      c = { jid, name: name || null, group: isGroupJid(jid), messages: [] };
      chats.set(jid, c);
    } else if (name && !c.name) c.name = name;
    return c;
  };
  const types = device === 'ios' ? IOS_TYPES : ANDROID_TYPES;
  for (const r of rowsIter) {
    if (r.type === 'contact') {
      if (r.jid && r.name) contacts.set(r.jid, r.name);
    } else if (r.type === 'chat') {
      if (r.jid) chatOf(r.jid, r.name);
    } else if (r.type === 'message') {
      if (!r.chat) continue;
      const chat = chatOf(r.chat, r.subject ?? null);
      const fromMe = !!r.from_me;
      const kind = types[device === 'ios' ? r.ios_type : r.mtype] ?? (r.mtype ?? r.ios_type ?? 'unknown');
      const system = device === 'ios' ? kind === 'system' : (r.mtype === 7 || r.status === 6);
      const m = {
        id: r.key_id ? String(r.key_id) : null,
        at: Number(r.timestamp) || null,
        fromMe,
        sender: fromMe ? null : (r.sender || (chat.group ? null : r.chat)),
        senderName: r.sender_name ?? null,
        type: system ? 'system' : kind,
        text: null,
        ...(r.quoted ? { replyTo: { id: String(r.quoted), text: r.quoted_text ? String(r.quoted_text).slice(0, 500) : null } } : {}),
        ...(r.media_path ? { media: { path: r.media_path, mime: r.mime ?? null } } : {}),
      };
      if (system) {
        // Worded once the names are known, after every row is read.
        Object.defineProperty(m, 'sys', { value: { ...r }, enumerable: false });
      } else if (kind === 'deleted' || kind === 'deleted-by-admin') {
        m.text = 'Message deleted';
      } else if (kind === 'location' || (r.latitude && r.longitude && !r.text)) {
        m.text = `Location shared: ${r.latitude}, ${r.longitude}`;
      } else {
        const caption = r.caption ?? (kind !== 'text' ? r.text : null);
        m.text = kind === 'text' ? (r.text ?? '') : (caption ?? '');
        if (kind === 'audio' && r.transcription) m.text = `"${r.transcription}"`;
      }
      chat.messages.push(m);
      if (r.row != null) byRow.set(r.row, m);
      counts.messages += 1;
    } else if (r.type === 'reaction') {
      const m = byRow.get(r.row);
      if (!m || !r.reaction) continue;
      (m.reactions ??= []).push({ by: r.from_me ? null : r.sender ?? null, fromMe: !!r.from_me, emoji: r.reaction, at: Number(r.timestamp) || null });
      counts.reactions += 1;
    }
  }
  // Names: a contact's from wa.db or the push names, a group's its subject.
  for (const c of chats.values()) {
    if (!c.name) c.name = contacts.get(c.jid) ?? user(c.jid);
    for (const m of c.messages) {
      if (m.sender && !m.senderName) m.senderName = contacts.get(m.sender) ?? null;
      if (m.sys) {
        const r = m.sys;
        m.text = systemText(r, m.fromMe || !r.sender ? 'You' : (m.senderName ?? user(r.sender)));
        if (m.text == null && r.video_call != null) m.text = r.video_call ? 'A video call was missed' : 'A voice call was missed';
      }
    }
    c.messages.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }
  counts.chats = [...chats.values()].filter((c) => c.messages.length).length;
  counts.contacts = contacts.size;
  return { chats, contacts, counts };
}

/** Picks chats by jid, or by a piece of their name (any case). */
export function pickChats(chats, filters = []) {
  const all = [...chats.values()].filter((c) => c.messages.length);
  if (!filters.length) return all;
  const want = filters.map((f) => String(f).toLowerCase());
  return all.filter((c) => want.some((f) => c.jid.toLowerCase() === f || user(c.jid) === f || (c.name ?? '').toLowerCase().includes(f)));
}

/** A chat as the JSON export holds it. */
export function chatJson(c) {
  return { jid: c.jid, name: c.name, group: c.group, messages: c.messages };
}

