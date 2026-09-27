#!/usr/bin/env node
// Media facts, measured: duration, streams, frame size and rate.
//
//   node probe.mjs <file> [--json]

import { parseArgs, probe, die } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args._[0]) die('usage: probe.mjs <file> [--json]');
const p = probe(args._[0]);
if (args.json) console.log(JSON.stringify(p, null, 2));
else {
  console.log(p.path);
  console.log(`  duration  ${p.duration.toFixed(3)}s   ${(p.size / 1e6).toFixed(1)} MB`);
  if (p.video) console.log(`  video     ${p.video.codec} ${p.video.width}×${p.video.height} @ ${p.video.fps?.toFixed(3)} fps`);
  if (p.audio) console.log(`  audio     ${p.audio.codec} ${p.audio.sampleRate} Hz × ${p.audio.channels}`);
}
