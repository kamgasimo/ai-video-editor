#!/usr/bin/env node
// A background music bed, synthesised on this machine: no service, no sample library, no licence to
// check. It is made to sit under a voice, not to be listened to on its own.
//
//   node synth.mjs --duration 22.09 --out bed.wav [--mood calm|upbeat] [--bpm n] [--seed 7] [--rate 48000]
//
// calm    84 bpm: a chord pad, a soft plucked arpeggio and a bass line
// upbeat  112 bpm: the same with hats, a kick and a clap
// Both open on the pad alone for a bar and fade over the last two seconds. Seeded, so the same
// settings render the same bed. mix.mjs sets its level under the voice.

import { parseArgs, die, writeWav, num } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.duration === undefined || !args.out) die('usage: synth.mjs --duration secs --out bed.wav [--mood calm|upbeat] [--bpm n] [--seed n] [--rate n]');

const mood = args.mood === 'upbeat' ? 'upbeat' : 'calm';
const SR = num(args.rate, 48000);
const duration = num(args.duration);
const N = Math.round(duration * SR);
const bpm = num(args.bpm, mood === 'upbeat' ? 112 : 84);
const B = 60 / bpm, BAR = 4 * B;
const PROGRESSION = mood === 'upbeat'
  ? [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]] // C G Am F
  : [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G

// ---------------------------------------------------------------- deterministic noise

let seed = num(args.seed, 7) >>> 0;
function rand() { // mulberry32
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = (n) => Float32Array.from({ length: n }, () => rand() * 2 - 1);

// ---------------------------------------------------------------- building blocks

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
function add(buf, t, sig, g = 1) {
  const i0 = Math.round(t * SR);
  for (let k = 0; k < sig.length; k++) { const i = i0 + k; if (i >= 0 && i < buf.length) buf[i] += sig[k] * g; }
}
function lowpass(x, cutoff) {
  const y = new Float32Array(x.length), a = Math.exp(-2 * Math.PI * cutoff / SR);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; }
  return y;
}
function diff(x) { const y = new Float32Array(x.length); for (let i = 1; i < x.length; i++) y[i] = x[i] - x[i - 1]; return y; }
function gen(dur, f) { const n = Math.round(dur * SR), y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = f(i / SR); return y; }
function chirp(dur, freqAt, env) { const n = Math.round(dur * SR), y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * freqAt(t) / SR; y[i] = Math.sin(ph) * env(t); } return y; }

// ---------------------------------------------------------------- the bed

const out = new Float32Array(N);
const drums = mood === 'upbeat';
for (let bar = 0, t0 = 0; t0 < duration; bar++, t0 += BAR) {
  const ch = PROGRESSION[bar % PROGRESSION.length], root = ch[0] - 12;
  const intro = bar === 0;
  // pad — detuned additive tones with a slow attack
  add(out, t0, gen(BAR, (t) => {
    const env = Math.min(1, t / 0.4) * Math.min(1, (BAR - t) / 0.3);
    let s = 0;
    for (const n of ch) for (const dt of [-0.004, 0.004]) for (const h of [1, 2, 3]) s += Math.sin(2 * Math.PI * midi(n) * h * (1 + dt) * t) / h;
    return s * env;
  }), 0.035);
  // plucked arpeggio in eighths
  for (let i = 0; i < 8; i++) {
    const t = t0 + i * B / 2;
    if (t >= duration) break;
    const f = midi(ch[i % ch.length] + 12 + (i % 4 === 3 ? 12 : 0));
    add(out, t, gen(0.25, (u) => (2 * Math.abs(2 * ((f * u) % 1) - 1) - 1) * Math.exp(-u * 14)), intro ? 0.025 : 0.04);
  }
  if (intro) continue;
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * B;
    if (t >= duration) break;
    if (b === 0 || b === 2) {
      const f = midi(root);
      add(out, t, gen(B * 1.8, (u) => Math.sin(2 * Math.PI * f * u) * Math.min(1, u / 0.01) * Math.exp(-u * 1.6)), 0.2);
    }
    if (!drums) continue;
    add(out, t + B / 2, diff(noise(Math.round(0.05 * SR))).map((v, k) => v * Math.exp(-(k / SR) * 90)), 0.05);
    add(out, t, chirp(0.35, (u) => 45 + 110 * Math.exp(-u * 28), (u) => Math.exp(-u * 9)), 0.5);
    if (b === 1 || b === 3) add(out, t, lowpass(noise(Math.round(0.18 * SR)), 3500).map((v, k) => v * Math.exp(-(k / SR) * 22)), 0.16);
  }
}
const fade = Math.min(N, Math.round(2 * SR));
for (let k = 0; k < fade; k++) out[N - 1 - k] *= k / fade;
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const g = peak > 0 ? 0.7 / peak : 1;
for (let i = 0; i < N; i++) out[i] *= g;

writeWav(args.out, [out], SR);
console.log(`${mood} bed · ${bpm} bpm · ${duration.toFixed(2)}s → ${args.out}`);
