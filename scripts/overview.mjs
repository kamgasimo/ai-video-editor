#!/usr/bin/env node
// What the intake measured, in one read: the transcript, the fillers heard, the long pauses, the held
// sounds that can hide a filler, and the words whose spelling is worth confirming.
//
//   node overview.mjs <work folder> [--language en]
//
// Reads clean.json, verbatim.json and acoustics.json from the work folder.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, readJson } from './common.mjs';
import { fillerWords, norm } from './cutlist.mjs';

const args = parseArgs(process.argv.slice(2));
const work = args._[0];
if (!work) die('usage: overview.mjs <work folder> [--language code]');
const need = (f) => { const p = join(work, f); if (!existsSync(p)) die(`missing ${p} — run the intake steps first`); return readJson(p); };
const clean = need('clean.json'), verbatim = need('verbatim.json'), ac = need('acoustics.json');
const fillers = fillerWords(typeof args.language === 'string' ? args.language : undefined);
const t = (x) => `${x.toFixed(2)}s`;

console.log(`${clean.length} words · ${t(ac.duration)} recorded`);
console.log(`\ntranscript:\n${clean.map((w) => w.text).join(' ').replace(/(.{1,100})(\s|$)/g, '  $1\n').trimEnd()}`);

const heard = verbatim.filter((w) => fillers.has(norm(w.text)));
console.log(`\nfiller words heard: ${heard.length}${heard.length ? ` — ${heard.map((w) => `"${norm(w.text)}" ${t(w.start)}`).join(', ')}` : ''}`);

const first = clean.length ? clean[0].start : 0, last = clean.length ? clean[clean.length - 1].end : ac.duration;
const long = ac.pauses.filter((p) => p.duration >= 0.6 && p.end > first && p.start < last);
console.log(`pauses of 0.6 s or more between words: ${long.length}${long.length ? ` — ${long.map((p) => `${t(p.start)} (${p.duration.toFixed(2)}s)`).join(', ')}` : ''}`);
console.log(`dead air: ${t(Math.max(0, first))} before the first word, ${t(Math.max(0, ac.duration - last))} after the last`);
console.log(`held voiced sounds (a filler can hide in one): ${ac.steadyRuns.length}${ac.steadyRuns.length ? ` — ${ac.steadyRuns.map((r) => `${r.start.toFixed(2)}–${r.end.toFixed(2)}s`).join(', ')}` : ''}`);

// Capitalised words that do not open a sentence, and words with digits or inner capitals: names,
// brands and terms, where a transcriber's spelling is least reliable. Short acronyms (AI, TV, CEO)
// are left out: they come out right.
const COMMON = new Set(['i', "i'm", "i've", "i'll", "i'd", 'ok', 'okay']);
const counts = new Map();
clean.forEach((w, i) => {
  const bare = w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!bare || COMMON.has(bare.toLowerCase()) || /^\p{Lu}{2,3}s?$/u.test(bare)) return;
  const opens = i === 0 || /[.?!]$/.test(clean[i - 1].text);
  const marked = /\p{N}/u.test(bare) || /\p{Ll}\p{Lu}/u.test(bare) || (/^\p{Lu}/u.test(bare) && !opens);
  if (marked) counts.set(bare, (counts.get(bare) || 0) + 1);
});
console.log(`words to confirm the spelling of: ${counts.size ? [...counts].map(([w, n]) => (n > 1 ? `${w} (×${n})` : w)).join(', ') : 'none found'}`);
