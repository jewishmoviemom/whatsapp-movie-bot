/**
 * The chats as web pages to read: an index, and each chat in pages of
 * PAGE_SIZE messages.
 *
 * WhatsApp-Chat-Exporter's page (whatsapp.html) loads Tailwind's Play CDN,
 * a script that downloads and compiles the stylesheet in the browser every
 * time a page is opened, and its older page downloads w3.css from w3schools
 * at export time. Recoded here (the operator, 2026-11-26: "recode anything
 * that calls too many API's"): the style is inline, and a page fetches
 * nothing - no script, no web font, no image from anywhere. Media are linked
 * by their path in the phone's WhatsApp folder, relative, so they open when
 * the folder is copied beside the export, and are never fetched otherwise.
 */
export const PAGE_SIZE = 4000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (s) => esc(s).replace(/\r?\n/g, '<br>');
/** The day and time in New York, on the 24-hour clock (the operator's rule). */
const fmt = (t, opts) => (t ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', ...opts }).format(new Date(t)) : '');
const day = (t) => fmt(t, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const clock = (t) => fmt(t, { hour: '2-digit', minute: '2-digit' });
/** A file name for a chat: its JID's user part, which is unique and safe. */
export const chatFile = (c, page = 0) => `${String(c.jid).split('@')[0].replace(/[^\w.-]/g, '_')}${page ? `-${page + 1}` : ''}.html`;

const CSS = `
:root{--bg:#efeae2;--panel:#fff;--in:#fff;--out:#d9fdd3;--sys:#fff5c4;--ink:#111b21;--mute:#667781;--line:#d1d7db;--link:#027eb5}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--panel:#111b21;--in:#202c33;--out:#005c4b;--sys:#182229;--ink:#e9edef;--mute:#8696a0;--line:#2a3942;--link:#53bdeb}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line);padding:10px 16px;z-index:1}
header h1{font-size:17px;margin:0}header p{margin:2px 0 0;color:var(--mute);font-size:13px}
main{max-width:860px;margin:0 auto;padding:12px 16px 40px}a{color:var(--link)}
.day{text-align:center;margin:14px 0 6px}.day span{background:var(--panel);color:var(--mute);font-size:12.5px;padding:4px 10px;border-radius:8px}
.m{display:flex;margin:3px 0}.m.out{justify-content:flex-end}
.b{max-width:78%;background:var(--in);padding:6px 9px 4px;border-radius:8px;box-shadow:0 1px .5px rgba(0,0,0,.13);overflow-wrap:anywhere}
.out .b{background:var(--out)}.who{font-size:13px;font-weight:600;color:var(--link)}
.t{font-size:11.5px;color:var(--mute);text-align:right;margin-top:2px}.q{border-left:3px solid var(--link);padding:2px 8px;margin:2px 0 4px;color:var(--mute);font-size:13.5px;background:rgba(0,0,0,.04);border-radius:4px}
.sys{text-align:center;margin:6px 0}.sys span{display:inline-block;background:var(--sys);color:var(--mute);font-size:12.5px;padding:4px 10px;border-radius:8px;max-width:90%}
.r{font-size:13px;margin-top:2px}.media{font-size:13.5px;color:var(--mute)}
nav{display:flex;gap:12px;justify-content:center;margin:18px 0}
ul.chats{list-style:none;padding:0;margin:0;background:var(--panel);border-radius:10px}
ul.chats li{border-bottom:1px solid var(--line);padding:10px 14px}ul.chats li:last-child{border:0}ul.chats small{color:var(--mute)}
`;

const page = (title, sub, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header><main>${body}</main></body></html>\n`;

function messageHtml(c, m) {
  if (m.type === 'system') return m.text ? `<div class="sys"><span>${text(m.text)}</span></div>` : '';
  const who = !m.fromMe && c.group ? `<div class="who">${esc(m.senderName || (m.sender ? String(m.sender).split('@')[0] : 'Unknown'))}</div>` : '';
  const quote = m.replyTo ? `<div class="q">${text(m.replyTo.text || 'a message')}</div>` : '';
  const media = m.media?.path ? `<div class="media">${esc(m.type)}: <a href="${esc(m.media.path)}">${esc(String(m.media.path).split('/').pop())}</a></div>` : '';
  const reacts = m.reactions?.length ? `<div class="r">${m.reactions.map((r) => esc(r.emoji)).join(' ')}</div>` : '';
  return `<div class="m ${m.fromMe ? 'out' : 'in'}"><div class="b">${who}${quote}${media}${m.text ? `<div>${text(m.text)}</div>` : ''}${reacts}<div class="t">${clock(m.at)}</div></div></div>`;
}

/** Every page of one chat: [{ file, html }]. */
export function chatPages(c, { pageSize = PAGE_SIZE } = {}) {
  const pages = [];
  const n = Math.max(1, Math.ceil(c.messages.length / pageSize));
  for (let p = 0; p < n; p++) {
    const slice = c.messages.slice(p * pageSize, (p + 1) * pageSize);
    let lastDay = '';
    const body = slice.map((m) => {
      const d = day(m.at);
      const sep = d && d !== lastDay ? `<div class="day"><span>${esc(d)}</span></div>` : '';
      lastDay = d || lastDay;
      return sep + messageHtml(c, m);
    }).join('\n');
    const nav = n > 1 ? `<nav>${p ? `<a href="${chatFile(c, p - 1)}">← earlier</a>` : ''}<a href="index.html">all chats</a>${p < n - 1 ? `<a href="${chatFile(c, p + 1)}">later →</a>` : ''}</nav>` : '<nav><a href="index.html">all chats</a></nav>';
    const sub = `${c.messages.length} messages${n > 1 ? `, page ${p + 1} of ${n}` : ''}`;
    pages.push({ file: chatFile(c, p), html: page(c.name || c.jid, sub, nav + body + nav) });
  }
  return pages;
}

/** The index of every chat exported, newest first. */
export function indexPage(chats, { title = 'WhatsApp chats', exportedAt = Date.now() } = {}) {
  const items = [...chats].sort((a, b) => (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0)).map((c) => {
    const last = c.messages.at(-1)?.at;
    return `<li><a href="${chatFile(c)}">${esc(c.name || c.jid)}</a><br><small>${c.group ? 'group' : 'chat'} · ${c.messages.length} messages${last ? ` · last ${esc(day(last))}` : ''}</small></li>`;
  }).join('\n');
  return page(title, `${chats.length} chats, exported ${fmt(exportedAt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`, `<ul class="chats">${items}</ul>`);
}
