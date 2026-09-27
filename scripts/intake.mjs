#!/usr/bin/env node
// Take in a recording: check it can be edited, and make the folder the edit is written to.
//
//   node intake.mjs <video> [--out <folder>]
//
// The edit goes to <name>-edited/ beside the video, or to --out, with work/ inside it for
// transcripts, cut lists and checks. The video itself is only ever read. Prints the facts as JSON.

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs, die, probe } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input) die('usage: intake.mjs <video> [--out folder]');
if (!existsSync(input)) die(`not found: ${input}`);

const p = probe(input);
if (!p.video) die('this file has no video stream — the editor needs a recording with picture and sound');
if (!p.audio) die('this file has no audio stream — the editor cuts by what is said, so it needs sound');

const path = resolve(input);
const name = basename(path).replace(/\.[^.]+$/, '');
const out = typeof args.out === 'string' ? resolve(args.out) : join(dirname(path), `${name}-edited`), work = join(out, 'work');
mkdirSync(work, { recursive: true });

const { width, height, fps } = p.video;
const orientation = height > width * 1.3 ? 'vertical' : width > height * 1.3 ? 'landscape' : 'square';
console.log(JSON.stringify({
  input: path, name, out, work,
  duration: +p.duration.toFixed(3), width, height, fps: +fps.toFixed(3), orientation,
  audio: { codec: p.audio.codec, sampleRate: p.audio.sampleRate, channels: p.audio.channels },
  previousSettings: existsSync(join(out, 'edit-settings.json')) ? join(out, 'edit-settings.json') : null,
}, null, 2));
