#!/usr/bin/env node
// Frames to look at: chosen timestamps, or evenly spaced ones, tiled into one contact sheet.
//
//   node frames.mjs <video> --at 0.6,2.7,4.4 --sheet sheet.jpg [--width 360] [--cols 6]
//   node frames.mjs <video> --count 8 --sheet sheet.jpg
//   node frames.mjs <video> --at 5 --sheet face.jpg --width 960 --grid
//
// The sheet reads left to right, top to bottom, in the order of the times printed and written to
// <sheet>.json beside it. --grid rules each frame every 10 % of its width and height in yellow, and at
// the halves in heavier red, to read positions off it: the third yellow line below the red one is
// 0.8 of the height.

import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { parseArgs, die, run, probe, writeJson, tempDir, num, isMain } from './common.mjs';

// Columns default to an even split — 8 frames lay out 4 by 2 — so no empty tile reads as a black frame.
export function contactSheet(video, times, { sheet, width = 360, cols = Math.ceil(times.length / Math.ceil(times.length / 6)), grid = false }) {
  const tmp = tempDir('aive-frames-');
  const rule = grid ? ',drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.75,drawgrid=w=iw/2:h=ih/2:t=3:c=red@0.9' : '';
  try {
    times.forEach((t, i) => run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2${rule}`, join(tmp.dir, `${String(i).padStart(3, '0')}.png`)]));
    const c = Math.min(cols, times.length), r = Math.ceil(times.length / c);
    mkdirSync(dirname(resolve(sheet)), { recursive: true });
    run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', join(tmp.dir, '%03d.png'), '-vf', `tile=${c}x${r}:padding=4:color=black`, '-frames:v', '1', sheet]);
    writeJson(`${sheet}.json`, { video: resolve(video), times });
    return sheet;
  } finally {
    tmp.cleanup();
  }
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const video = args._[0];
  if (!video || !args.sheet || (!args.at && !args.count)) die('usage: frames.mjs <video> (--at t1,t2,… | --count n) --sheet out.jpg [--width n] [--cols n] [--grid]');
  const d = probe(video).duration;
  const times = args.at ? String(args.at).split(',').map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t < d)
    : Array.from({ length: num(args.count, 8) }, (_, i) => +((i + 0.5) * d / num(args.count, 8)).toFixed(2));
  if (!times.length) die('no timestamps inside the video');
  contactSheet(video, times, { sheet: args.sheet, width: num(args.width, 360), ...(args.cols !== undefined ? { cols: num(args.cols) } : {}), grid: Boolean(args.grid) });
  console.log(`${times.length} frames → ${args.sheet}\n  at ${times.map((t) => t.toFixed(2)).join(', ')}`);
}
