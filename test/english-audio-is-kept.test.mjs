// One-Punch Man S03E10 (an mkv, Japanese sound ahead of the English) was
// remuxed with `-map 0:a:0` and posted in Japanese on 2026-10-29; Bentzi
// Marinelli's report became ticket #7. The post now keeps the English sound.
import { pickAudioIndex, audioMap, buildEncodeArgs } from '../src/media/ffmpeg.js';
let fails = 0;
const ok = (c, n) => { if (!c) { fails++; console.error('FAIL', n); } else console.log('ok', n); };
const a = (language, extra = {}) => ({ codec_type: 'audio', tags: { language }, ...extra });
ok(pickAudioIndex([a('jpn'), a('eng')]) === 1, 'English second is chosen');
ok(pickAudioIndex([a('eng'), a('jpn')]) === 0, 'English first stays');
ok(pickAudioIndex([a('jpn'), a('fra')]) === 0, 'no English: the first');
ok(pickAudioIndex([a('jpn'), a('eng', { tags: { language: 'eng', title: 'Commentary' } }), a('en')]) === 2, 'commentary is skipped');
ok(pickAudioIndex([]) === 0, 'no sound at all');
ok(audioMap({ audio: { index: 1 } }) === '0:a:1?', 'map names the chosen stream');
ok(audioMap({ audio: null }) === '0:a:0?', 'map defaults to the first');
const args = buildEncodeArgs({ input: 'i', outPath: 'o', info: { duration: 100, audio: { index: 1 }, video: { height: 480 } },
  cfg: { audioCodec: 'aac', audioBitrateK: 96, videoCodec: 'libx264', preset: 'fast', maxOutputBytes: 1e9 }, encoder: 'cpu' });
ok(args.includes('0:a:1?'), 'the encode maps the chosen sound');
process.exit(fails ? 1 : 0);
