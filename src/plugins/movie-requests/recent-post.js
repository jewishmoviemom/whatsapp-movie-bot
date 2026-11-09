/**
 * A film asked for again soon after it was posted.
 *
 * On 2026-11-08 Romeo and Juliet (1968) was posted at 16:16:51 New York time
 * and asked for again 95 seconds later; the "already asked for" check (🤥)
 * only covered a film still waiting or in progress, so it was converted and
 * posted a second time, ahead of A Cinderella Story asked for before it. The
 * operator, 2026-11-09:
 *
 *   "something that someone just requested within 24 hours should get the 🤥
 *    and of course be unfulfilled as there is already an existing file or
 *    request
 *    if it's within a week of that file getting posted should be conditional
 *    if user joined after file was posted item should be added to queue
 *    normally
 *    if user already received file but queue is empty assume that the old
 *    file doesnt work and just queue again cuz who cares queue is empty
 *    anyway
 *    otherwise let user know (in group do not PM) that file was already
 *    posted and when it was posted and if they have any further issues with
 *    this decision they can ask on 06 movie discussions"
 *
 * So, for the last time the same film (and the same copy - a smaller copy is
 * a different file) was posted:
 *   - under 24 hours ago: 🤥, not queued;
 *   - under a week ago: queued as usual if the member joined the posts group
 *     after it was posted, or if no film is waiting in the queue; otherwise
 *     🤥, not queued, and a reply in the request group says when it was
 *     posted and where to ask;
 *   - a week or more: queued as usual.
 */
export const DAY = 86_400_000;
export const WEEK = 7 * DAY;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The last time `movie` was posted, from the plugin's history rows: the
 * newest row with status 'sent' for the same film - by IMDb id, or by title
 * and year when either side has none - and the same copy (`quality`).
 * Answers { at, row } or null.
 */
export function lastPosted(rows, movie, quality = null) {
  let best = null;
  for (const r of rows ?? []) {
    if (r?.status !== 'sent') continue;
    const same = movie?.imdbId && r.imdbId
      ? r.imdbId === movie.imdbId
      : norm(r.title) === norm(movie?.title) && Number(r.year) === Number(movie?.year);
    if (!same || (r.quality ?? null) !== (quality ?? null)) continue;
    const at = Number(r.finishedAt ?? r.at) || 0;
    if (at && (!best || at > best.at)) best = { at, row: r };
  }
  return best;
}

/**
 * Whether to queue a film last posted at `postedAt` (null: never, or not
 * that copy). `joinedAt` is when the member last joined the posts group, or
 * null when no join was seen (they were there); `filmsWaiting` whether any
 * film is waiting in the queue. Answers { go, tell, why }: `go` queues it as
 * usual, `tell` says to reply in the group (only when it is refused).
 */
export function judgeRepost({ postedAt, now = Date.now(), joinedAt = null, filmsWaiting = false }) {
  if (!postedAt) return { go: true, tell: false, why: 'not posted before' };
  const age = now - postedAt;
  if (age < 0 || age >= WEEK) return { go: true, tell: false, why: 'posted over a week ago' };
  if (age < DAY) return { go: false, tell: false, why: 'posted less than 24 hours ago' };
  if (joinedAt != null && joinedAt > postedAt) return { go: true, tell: false, why: 'joined the posts group after it was posted' };
  if (!filmsWaiting) return { go: true, tell: false, why: 'posted this week, but no film is waiting' };
  return { go: false, tell: true, why: 'posted this week, before they joined, with films waiting' };
}

const digitsOf = (v) => String(v ?? '').replace(/[^0-9]/g, '');

/**
 * When the member last joined `groupJid`, from the group activity feed
 * (state 'group-activity' events, newest first - the feed the panel's member
 * pages show): the newest 'add' event there that names them, by WhatsApp id
 * or by number. Null when the feed has none: they were in the group before it
 * reaches back, which is weeks (index.js keeps 2,000 events).
 */
export function joinedAt(events, groupJid, { jid = null, number = null } = {}) {
  const n = digitsOf(number);
  let best = null;
  for (const ev of events ?? []) {
    if (ev?.action !== 'add' || ev.groupJid !== groupJid) continue;
    const hit = (ev.targets ?? []).some((t) => (jid && t?.jid === jid) || (n.length >= 7 && digitsOf(t?.number) === n));
    if (hit && (best == null || Number(ev.ts) > best)) best = Number(ev.ts);
  }
  return best;
}

/** "Sunday 8 Nov at 16:16" in the bot's time zone, on the 24-hour clock. */
export function postedWhen(at, timeZone = undefined) {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(d);
  return `${day} at ${time}`;
}

/** The reply in the request group (never a private message). `where` is the discussions group's name or tag. */
export function repostReply({ title, year, at, timeZone, where }) {
  return `🤥 *${title}${year ? ` (${year})` : ''}* was already posted on ${postedWhen(at, timeZone)}, `
    + 'so it was not sent again - it is in the posts group.\n'
    + `If you have any further issues with this decision, ask in ${where || 'the discussions group'}.`;
}
