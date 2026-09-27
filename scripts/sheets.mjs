#!/usr/bin/env node
// Review sheets: every beat of a render, as it enters, at its peak and as it leaves — one row per beat.
//
//   node sheets.mjs <render.mp4> --plan edit.json --out review.jpg [--width 300]
//
// Row n of the sheet is the plan's beat n: its first moment (0.3 s in), the middle of its graphic (or
// of the beat), and 0.25 s before it ends. The legend printed (and written beside the sheet as .json)
// names each row. This is what a critique reads: an entrance that lands, a graphic that fits its box,
// captions clear of the mouth, a transition mid-flight.

import { parseArgs, die, readJson, num, isMain } from './common.mjs';
import { contactSheet } from './frames.mjs';

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const video = args._[0];
  if (!video || typeof args.plan !== 'string' || typeof args.out !== 'string') die('usage: sheets.mjs <render.mp4> --plan edit.json --out review.jpg [--width n]');
  const plan = readJson(args.plan);
  const beats = [...plan.beats].sort((a, b) => a.start - b.start);
  const times = [], legend = [];
  for (const b of beats) {
    const g0 = b.graphic?.at ?? b.start, g1 = b.graphic?.until ?? b.end;
    const row = [Math.min(b.end - 0.05, b.start + 0.3), (g0 + g1) / 2, Math.max(b.start + 0.05, b.end - 0.25)].map((t) => +Math.min(plan.duration - 0.05, t).toFixed(2));
    times.push(...row);
    legend.push({ beat: b.id, layout: b.layout || 'full', graphic: b.graphic?.component || (b.graphic?.scene ? 'scene' : null), times: row });
  }
  contactSheet(video, times, { sheet: args.out, width: num(args.width, 300), cols: 3 });
  const { writeJson } = await import('./common.mjs');
  writeJson(`${args.out}.json`, legend);
  console.log(`${beats.length} rows → ${args.out}`);
  legend.forEach((l, i) => console.log(`  row ${i + 1}: ${l.beat} (${l.layout}${l.graphic ? `, ${l.graphic}` : ''}) at ${l.times.join(', ')}`));
}
