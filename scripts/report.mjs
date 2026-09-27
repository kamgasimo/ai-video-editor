#!/usr/bin/env node
// The edit report: what was made, what every check measured, what was cut and why, and what only a
// person can judge — written from the edit's own records, so it says only what was measured.
//
//   node report.mjs --dir <output folder> [--note "…"] … [--tidy]
//
// Reads edit-settings.json, work/cuts.json, work/timeline.json and every work/check-*.json the
// checks wrote; writes EDIT-REPORT.md in the folder. --tidy then deletes the large intermediate
// renders in work/ (.mov and .wav), keeping the transcripts, cut list, checks and frame sheets.

import { existsSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { parseArgs, die, readJson, probe } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.dir !== 'string') die('usage: report.mjs --dir <output folder> [--note text] … [--tidy]');
const dir = args.dir, work = join(dir, 'work');
const load = (f) => (existsSync(f) ? readJson(f) : null);
const settings = load(join(dir, 'edit-settings.json')) || {};
const cuts = load(join(work, 'cuts.json'));
const timeline = load(join(work, 'timeline.json'));
// The masters first, in the order they were made, then the delivered files.
const order = (f) => (f === 'check-master.json' ? 0 : f.startsWith('check-master') ? 1 : 2);
const checks = existsSync(work) ? readdirSync(work).filter((f) => /^check-.+\.json$/.test(f))
  .sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((f) => readJson(join(work, f))) : [];
const label = (render) => (resolve(dirname(render)) === resolve(work) ? `work/${basename(render)}` : basename(render));
const notes = [].concat(args.note || []).filter((n) => typeof n === 'string');

const s2 = (x) => `${x.toFixed(2)}`;
const mb = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [];
const out = (...l) => lines.push(...l);

const src = cuts?.source && existsSync(cuts.source) ? probe(cuts.source) : null;
const name = src ? basename(src.path).replace(/\.[^.]+$/, '') : basename(dir).replace(/-edited$/, '');
out(`# Edit report: ${name}`, '');
out(`${new Date().toISOString().slice(0, 10)}${src ? ` · source \`${basename(src.path)}\`, ${s2(src.duration)} s, ${src.video ? `${src.video.width}×${src.video.height} at ${src.video.fps.toFixed(2)} fps` : 'audio only'}` : ''}`, '');

// ---------------------------------------------------------------- deliverables

const KIND = { '.mp4': 'video', '.mov': 'video', '.srt': 'subtitles', '.fcpxml': 'editor timeline' };
const files = readdirSync(dir).filter((f) => KIND[f.slice(f.lastIndexOf('.')).toLowerCase()] && statSync(join(dir, f)).isFile()).sort();
out('## What was made', '');
if (!files.length) out('No deliverables were found in this folder.', '');
else {
  out('| File | What | Length | Size |', '|---|---|---|---|');
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
    const size = statSync(join(dir, f)).size;
    let what = KIND[ext], length = '';
    if (what === 'video') {
      const p = probe(join(dir, f));
      what = p.video ? `${p.video.width}×${p.video.height} video` : 'audio';
      length = `${s2(p.duration)} s`;
    }
    out(`| ${cell(f)} | ${what} | ${length} | ${mb(size)} |`);
  }
  out('');
}
if (src && timeline) {
  const saved = src.duration - timeline.measured;
  out(`The edit runs ${s2(timeline.measured)} s: ${s2(saved)} s (${(saved / src.duration * 100).toFixed(0)} %) shorter than the recording.`, '');
}

// ---------------------------------------------------------------- checks

out('## Checks', '');
if (!checks.length) out('No checks were recorded.', '');
else {
  const mark = { pass: 'pass', fail: '**FAIL**', skipped: 'skipped', listen: 'listen', look: 'sheet' };
  const names = [...new Set(checks.flatMap((c) => c.checks.map((x) => x.name)))];
  out(`| File | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const c of checks) out(`| ${cell(label(c.render))} | ${names.map((n) => { const x = c.checks.find((y) => y.name === n); return x ? mark[x.status] : '—'; }).join(' | ')} |`);
  out('');
  const detail = checks.flatMap((c) => c.checks.filter((x) => ['fail', 'listen'].includes(x.status)).map((x) => `- ${label(c.render)}, ${x.name}: ${x.detail}`));
  if (detail.length) out('Needs attention:', '', ...detail, '');
  // The summary lines describe what was delivered, when a delivered file was checked.
  const delivered = checks.filter((c) => !label(c.render).startsWith('work/'));
  const first = (name) => [...delivered, ...checks].map((c) => c.checks.find((x) => x.name === name && x.status === 'pass')).find(Boolean);
  const words = first('words'), loud = first('loudness');
  if (words) out(`Words: ${words.detail}, heard back by transcribing the finished file.`);
  if (loud) out(`Loudness: ${loud.detail}.`);
  if (words || loud) out('');
}

// ---------------------------------------------------------------- the cut

if (cuts) {
  const removed = cuts.removed || [];
  const shown = removed.filter((r) => r.kind !== 'pause');
  const pauses = removed.filter((r) => r.kind === 'pause');
  out('## What was cut', '');
  if (shown.length) {
    out('| Source time | Length | What | Evidence |', '|---|---|---|---|');
    for (const r of shown) {
      const what = r.kind === 'filler' ? `filler${r.text && r.text !== 'hum' ? ` "${r.text}"` : r.text === 'hum' ? ' (hum)' : ''}${r.words?.length ? `, with "${r.words.join(' ')}"` : ''}` : r.kind.replace('-', ' ');
      out(`| ${s2(r.start)}–${s2(r.end)} s | ${s2(r.end - r.start)} s | ${cell(what)} | ${cell((r.evidence || []).join('; '))} |`);
    }
    out('');
  }
  if (pauses.length) {
    const total = pauses.reduce((s, r) => s + r.end - r.start, 0);
    out(`Pauses: ${pauses.length} shortened, ${s2(total)} s in all${cuts.settings ? `, to ${cuts.settings.sentencePause} s after a sentence and ${cuts.settings.clausePause} s within one` : ''}.`, '');
  }
  if (!shown.length && !pauses.length) out('Nothing was cut.', '');
  const kept = (cuts.checked || []).filter((c) => c.outcome === 'kept');
  const left = cuts.probable || [];
  if (kept.length || left.length) {
    out('### Looked at and kept', '');
    for (const c of kept) out(`- ${s2(c.start)}–${s2(c.end)} s, ${c.text ?? c.kind}: ${c.why}`);
    for (const p of left) out(`- ${s2(p.start)}–${s2(p.end)} s, ${p.text ?? p.kind}: not confirmed as a filler, so kept — ${p.evidence?.[p.evidence.length - 1] ?? ''}`);
    out('');
  }
}

// ---------------------------------------------------------------- for a person

const unverified = [...new Set(checks.flatMap((c) => c.unverified || []))];
out('## For you to judge', '', 'These cannot be measured. Watch the result for them:', '');
for (const u of unverified.length ? unverified : ['pacing and the feel of each cut', 'whether the audio sounds natural', 'overall taste']) out(`- ${u}`);
if (files.some((f) => f.endsWith('.fcpxml'))) out('- the editor timeline: it was checked as well-formed XML, not imported into an editor here');
out('');
if (notes.length) out('## Notes', '', ...notes.map((n) => `- ${n}`), '');

// ---------------------------------------------------------------- settings

if (Object.keys(settings).length) {
  out('## Settings used', '');
  const v = (x) => (Array.isArray(x) ? x.join(', ') || 'none' : typeof x === 'object' && x !== null ? Object.entries(x).map(([k, y]) => `${k} ${v(y)}`).join(', ') : String(x));
  for (const [k, x] of Object.entries(settings)) if (!['input'].includes(k)) out(`- ${k}: ${v(x)}`);
  out('', `Rerun with the same settings by running the skill again on the same video: it offers to reuse \`edit-settings.json\`.`, '');
}

writeFileSync(join(dir, 'EDIT-REPORT.md'), lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
console.log(`→ ${join(dir, 'EDIT-REPORT.md')}`);
if (args.tidy && existsSync(work)) {
  const big = readdirSync(work).filter((f) => /\.(mov|wav)$/i.test(f));
  let freed = 0;
  for (const f of big) { freed += statSync(join(work, f)).size; rmSync(join(work, f)); }
  console.log(`removed ${big.length} intermediate render(s) from work/, ${mb(freed)} freed`);
}
