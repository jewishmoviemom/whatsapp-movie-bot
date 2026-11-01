/**
 * "#request-480p <title>": a member asks for a smaller copy (the operator,
 * 2026-10-26: "Add option for users to request movies in lower quality so the
 * file size is in megabytes"; "Movie #request-480p moviename year", "TV
 * Request-480p the office s01").
 *
 * The tag is read once, as the message comes in (src/index.js): the message
 * goes on as a plain "#request <title>" marked `quality: '480p'`, so the
 * moderation, the movie/TV groups, pick lists, beta codes ("$beta006
 * #request-480p ...") and every place that reads the prefix work as they
 * did. The plugins honour the mark where the 'request-480p' beta feature is
 * on (wantedQuality), and encode with ffmpeg.js lowQualityMedia.
 */
import { LOW_QUALITY, lowQualityMedia } from '../media/ffmpeg.js';
import { isEnabled, featureGroup } from './beta.js';

export const QUALITY_FEATURE = 'request-480p';

// Exactly "#request-480p" (the operator, 2026-10-26: "person will have to
// say specifically #request-480p") - not "#request - 480p" or "#request-480"
// - after an optional "$beta006 " or "$stamtest " code. Any case, as
// "#request" itself is.
const TAG = /^(\s*(?:\$\w+\s+)?#request)-480p(?=\s|$)/i;

/** The message's text without the tag, and the quality it asked for (or null). */
export function readQualityTag(text) {
  const s = String(text ?? '');
  if (!TAG.test(s)) return { text: s, quality: null };
  return { text: s.replace(TAG, '$1'), quality: LOW_QUALITY };
}

/** Marks `msg` in place: its text loses the tag, `msg.quality` says 480p. */
export function markQuality(msg) {
  if (!msg || typeof msg.text !== 'string') return msg;
  const r = readQualityTag(msg.text);
  if (r.quality) { msg.text = r.text; msg.quality = r.quality; }
  return msg;
}

/** The quality a request should be made in: '480p' where it was asked and the feature is on here, else null. */
export function wantedQuality(config, msg) {
  if (msg?.quality !== LOW_QUALITY) return null;
  return isEnabled(config, QUALITY_FEATURE, featureGroup(msg)) ? LOW_QUALITY : null;
}

/** The file name a 480p copy goes out under: "Title (2010) 480p.mp4". */
export function qualityFileName(name, quality) {
  if (quality !== LOW_QUALITY) return name;
  return String(name).replace(/(\.\w+)?$/, (ext) => ` ${LOW_QUALITY}${ext ?? ''}`);
}

/** How a 480p copy is described to members: "in 480p, a smaller file under 950 MB". */
export function qualityWords(media = {}) {
  const mb = Math.round(lowQualityMedia(media).maxOutputBytes / 1024 ** 2);
  return `in ${LOW_QUALITY}, a smaller file under ${mb} MB`;
}
