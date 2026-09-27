#!/usr/bin/env node
// Burn captions into a video. The caption band is drawn on this machine (render_captions.py, with
// Pillow) and laid over the picture in one pass; the audio is copied untouched.
//
//   node burn-captions.mjs <video> --captions captions.json --out out.mov [--cuts cuts.json]
//        [--style highlight|color|simple] [--accent "#7C5CFF"] [--y 0.70] [--size 0.075] [--font path]
//        [--crf 16]
//
// Placement. Each shape has a home for its captions — 0.70 of the height on vertical video, 0.80 on
// square, 0.85 on landscape — and a lowest safe line, above the apps' own buttons and text (0.80,
// 0.86, 0.90). With --cuts, whose face carries the mouth's height, the captions move down until
// they clear the mouth by 5 % of the height, wherever the punch-ins and the reframe put it; they never
// go below the safe line. --y overrides all of this. --size is the text height as a fraction of the
// frame's shorter side. After burning, look at frames: the captions must not cover the mouth.

import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, die, run, probe, readJson, tempDir, num, findFont, captionPython, punchCrop } from './common.mjs';
import { cropFor } from './reframe.mjs';

const HOME = {
  vertical: { y: 0.70, lowest: 0.80, size: 0.075 },
  square: { y: 0.80, lowest: 0.86, size: 0.07 },
  landscape: { y: 0.85, lowest: 0.90, size: 0.055 },
};

// Where the mouth sits in this video, as a fraction of its height, at its lowest across the zoom levels
// the cut uses: the master is the source frame, punched in around the face on alternate segments, then
// cropped to this video's shape around the same face.
function mouthHeight(cuts, W, H) {
  const face = cuts.face;
  const src = probe(cuts.source).video;
  const crop = cropFor(src.width, src.height, W, H, face);
  const zooms = [...new Set([1, cuts.punchIn ?? 1, ...(cuts.keep || []).map((k) => k.zoom ?? 1)])];
  return Math.max(...zooms.map((z) => {
    let y = face.mouth;
    if (z > 1) { const c = punchCrop(src.width, src.height, face, z); y = (y - c.y0) * src.height / c.ch; }
    return (y - crop.y0) / crop.ch;
  }));
}

const args = parseArgs(process.argv.slice(2));
const video = args._[0];
if (!video || !args.captions || !args.out) die('usage: burn-captions.mjs <video> --captions captions.json --out out.mov [--cuts cuts.json] [--style s] [--accent #hex] [--y f] [--size f] [--font path] [--crf n]');

const p = probe(video);
if (!p.video) die('the input has no video stream');
const W = p.video.width, H = p.video.height;
const font = typeof args.font === 'string' ? args.font : findFont();
if (!font) die('no caption font found — pass --font /path/to/a/bold.ttf or set CAPTION_FONT');
const style = typeof args.style === 'string' ? args.style : 'highlight';
const chunks = readJson(args.captions).chunks || [];
if (!chunks.length) die('the captions file holds no chunks');

const shape = H > W * 1.3 ? 'vertical' : W > H * 1.3 ? 'landscape' : 'square';
const home = HOME[shape];
const size = num(args.size, home.size);
let y = home.y, placement = `the ${shape} default`;
if (args.y !== undefined) { y = num(args.y); placement = 'as given'; }
else if (args.cuts) {
  const cuts = readJson(args.cuts);
  if (cuts.face?.mouth !== undefined) {
    const mouth = mouthHeight(cuts, W, H);
    const clear = mouth + 0.05 + (0.5 * size * Math.min(W, H)) / H;
    if (clear <= y) placement = `the ${shape} default — clear of the mouth at ${mouth.toFixed(2)}`;
    else if (clear <= home.lowest) { y = +clear.toFixed(3); placement = `moved below the mouth at ${mouth.toFixed(2)}`; }
    else { y = home.lowest; placement = `the lowest safe line — the mouth sits low, at ${mouth.toFixed(2)}; captions may touch it, look at the frames`; }
  }
}

const tmp = tempDir('aive-captions-');
try {
  const py = [join(dirname(fileURLToPath(import.meta.url)), 'render_captions.py'), args.captions, '--out-dir', tmp.dir,
    '--width', String(W), '--height', String(H), '--fps', String(p.video.fps), '--duration', String(p.duration),
    '--font', font, '--style', style, '--y', String(y), '--size', String(size),
    ...(typeof args.accent === 'string' ? ['--accent', args.accent] : [])];
  const band = JSON.parse(run(captionPython(), py).stdout.toString().trim().split('\n').pop());

  const mp4 = extname(args.out).toLowerCase() === '.mp4';
  const audio = !p.audio ? ['-an'] : mp4 && p.audio.codec.startsWith('pcm') ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy'];
  run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-f', 'concat', '-safe', '0', '-i', join(tmp.dir, 'list.ffconcat'),
    '-filter_complex', `[1:v]format=rgba[c];[0:v][c]overlay=0:${band.y}:eof_action=pass:format=auto,format=yuv420p[v]`,
    '-map', '[v]', ...(p.audio ? ['-map', '0:a'] : []), '-c:v', 'libx264', '-crf', String(num(args.crf, 16)), '-preset', 'medium',
    ...audio, ...(mp4 ? ['-movflags', '+faststart'] : []), args.out]);

  const out = probe(args.out);
  console.log(`captions centred at ${y} of the height: ${placement}`);
  console.log(`${chunks.length} chunks · ${band.images} caption images · text ${band.fontSize.min === band.fontSize.base ? `${band.fontSize.base}px` : `${band.fontSize.min}–${band.fontSize.base}px`}`);
  console.log(`→ ${args.out}  (${out.duration.toFixed(3)}s, input ${p.duration.toFixed(3)}s)`);
} finally {
  tmp.cleanup();
}
