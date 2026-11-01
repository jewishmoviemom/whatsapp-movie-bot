/* "#request-480p": the encode a small copy gets. Run:
   node test/request-480p-encode.test.mjs

   The operator, 2026-10-26: "Add option for users to request movies in lower
   quality so the file size is in megabytes". */
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { lowQualityMedia, planConversion, targetVideoBitrate, effectiveEncode, LOW_QUALITY, maxVideoBps } from '../src/media/ffmpeg.js';
import { settingsHash } from '../src/media/segmented.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ok   ${m}`)) : (fail++, console.log(`  FAIL ${m}`)); };
const MB = 1024 ** 2;
const media = DEFAULT_CONFIG.media;
const lq = lowQualityMedia(media);

console.log('=== the settings ===');
ok(media.lowQuality && media.lowQuality.maxHeight === 480 && media.lowQuality.maxMB === 950, 'media.lowQuality: 480p, under 950 MB by default');
ok(lq.quality === LOW_QUALITY && LOW_QUALITY === '480p', 'a 480p job is marked as one');
ok(effectiveEncode(lq).maxHeight === 480, 'at most 480 lines tall, whatever the encode profile is');
ok(lq.maxOutputBytes === 950 * MB, 'its cap is 950 MB, not the 1.8 GB a full copy gets');
ok(maxVideoBps(lq) === 800_000 && lq.audioBitrateK === 96, '800 kbps video, 96 kbps sound');
ok(media.maxOutputBytes === DEFAULT_CONFIG.media.maxOutputBytes && media.quality === undefined, 'the shared media settings are not changed');
ok(lowQualityMedia({ ...media, lowQuality: { maxMB: 500 } }).maxOutputBytes === 500 * MB, 'the cap can be set');
ok(lowQualityMedia({ ...media, maxOutputBytes: 300 * MB }).maxOutputBytes === 300 * MB, 'never above the main cap when that is lower');

console.log('=== always encoded ===');
const small1080 = { size: 1.2 * 1024 * MB, container: 'mp4', video: { codec: 'h264', height: 1080 }, audio: { codec: 'aac' }, duration: 7200 };
ok(planConversion(small1080, media).action === 'copy', 'a full request sends a 1.2 GB mp4 as it is');
ok(planConversion(small1080, lq).action === 'encode', 'a 480p request encodes it');

console.log('=== the size it comes to ===');
{
  const film = 2 * 3600; const episode = 30 * 60; const epic = 3.5 * 3600;
  const size = (sec) => ((targetVideoBitrate(sec, lq) + lq.audioBitrateK * 1000) * sec) / 8 / MB;
  ok(Math.round(targetVideoBitrate(film, lq) / 1000) === 800, 'a two-hour film is encoded at the 800 kbps cap');
  ok(size(film) > 700 && size(film) < 830, `a two-hour film comes to about ${Math.round(size(film))} MB`);
  ok(size(episode) < 210, `a half-hour episode to about ${Math.round(size(episode))} MB`);
  ok(size(epic) < 950 * 0.95, `a 3.5-hour film is fitted under the cap (${Math.round(size(epic))} MB)`);
  ok(targetVideoBitrate(film, media) > 1_500_000, 'a full request keeps its bitrate');
}

console.log('=== kept pieces are not mixed ===');
ok(settingsHash(lq, { text: '6.1' }) !== settingsHash(media, { text: '6.1' }), 'a 480p encode\'s pieces are not joined to a full encode\'s');
ok(settingsHash(media, { text: '6.1' }) === settingsHash({ ...media }, { text: '6.1' }), 'a full encode keeps the hash it had');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
