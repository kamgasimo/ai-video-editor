#!/usr/bin/env node
// Speech to words, locally.
//
//   node transcribe.mjs <media> [--mode clean|verbatim] [--aligned] [--out words.json] [--text]
//                        [--glossary "Name, Brand"] [--language auto] [--model path]
//   node transcribe.mjs <media> --slice 8.78:9.20 [--slice …]
//
// clean     primed with one neutral, well-punctuated sentence, so the transcript comes back in
//           sentences — captions, sentence ends and the expected words of a cut
// verbatim  primed with a generic run of hesitations, so fillers are kept — cut candidates only
// Both primings are in the recording's language: with --language auto (the default) the language is
// detected first, and the summary line names it. Where the transcriber supports it, the priming is
// carried into every 30-second window, not only the first.
// --aligned token-level timings, corrected by an offset measured against this recording's own
//           speech onsets
// --slice   transcribe only a span, padded with silence; a stock phrase where nothing was said
//           ("Thank you.") means the span holds a non-word sound. Pass --language with the code the
//           full transcription reported: a short span misdetects its language on its own
//
// Never prime the transcriber with the recording's own words: it treats them as already said and
// skips them. The only prompts used are the two primings and the glossary's spellings; a slice gets
// the glossary alone.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, run, tempDir, readPcm, writeJson, resolveModel, dtwPreset, whisperCli } from './common.mjs';

const STYLE = {
  en: 'The following is a clear, well-punctuated transcript.',
  fr: 'Voici une transcription claire et bien ponctuée.',
  es: 'La siguiente es una transcripción clara y bien puntuada.',
  de: 'Das Folgende ist eine klare, gut interpunktierte Abschrift.',
  pt: 'A seguir está uma transcrição clara e bem pontuada.',
  it: 'Quella che segue è una trascrizione chiara e ben punteggiata.',
  nl: 'Het volgende is een duidelijke, goed gepunctueerde transcriptie.',
};
const DISFLUENCY = {
  en: 'Umm, uh, hmm. So, um, I mean, uh...',
  fr: 'Euh, hum, euh. Alors, euh, je veux dire, euh...',
  es: 'Eh, mmm, eh. Pues, eh, o sea, eh...',
  de: 'Äh, ähm, hm. Also, äh, ich meine, ähm...',
  pt: 'Hã, hum, hã. Então, hã, quer dizer, é...',
  it: 'Ehm, eh, mmm. Allora, ehm, cioè, eh...',
  nl: 'Eh, uhm, hmm. Dus, eh, ik bedoel, uhm...',
};
const NON_SPEECH = ['thank you', 'thanks for watching', 'oh, yeah', 'oh yeah', "i don't know", 'bye', 'you', 'yeah'];

const args = parseArgs(process.argv.slice(2));
const media = args._[0];
if (!media) die('usage: transcribe.mjs <media> [--mode clean|verbatim] [--aligned] [--out words.json] [--text] [--slice a:b] [--glossary list] [--language code] [--model path]');
if (!existsSync(media)) die(`not found: ${media}`);

const mode = args.mode === 'verbatim' ? 'verbatim' : 'clean';
let language = typeof args.language === 'string' ? args.language : 'auto';
const modelFile = resolveModel(typeof args.model === 'string' ? args.model : undefined);
const cli = whisperCli();
const glossary = typeof args.glossary === 'string' ? args.glossary.split(',').map((s) => s.trim()).filter(Boolean) : [];

function prompt(forMode) {
  const g = glossary.length ? ` Glossary: ${glossary.join(', ')}.` : '';
  const lang = language.slice(0, 2);
  if (forMode === 'verbatim') return (DISFLUENCY[lang] || DISFLUENCY.en) + g;
  if (forMode === 'clean' && STYLE[lang]) return STYLE[lang] + g;
  return g.trim() || null;
}

let carries;
function carriesPrompt() {
  if (carries === undefined) { const h = run(cli, ['--help'], { allowFail: true }); carries = (h.stdout.toString() + h.stderr.toString()).includes('--carry-initial-prompt'); }
  return carries;
}

function detectLanguage(wav) {
  const r = run(cli, ['-m', modelFile, '-f', wav, '-l', 'auto', '-dl'], { allowFail: true });
  const m = (r.stderr.toString() + r.stdout.toString()).match(/auto-detected language:\s*([a-z]{2,3})/);
  return m ? m[1] : 'auto';
}

function whisper(wav, { outBase, forMode, aligned, textOnly }) {
  const a = ['-m', modelFile, '-f', wav, '-l', language, '-np'];
  const p = prompt(forMode);
  if (p) a.push('--prompt', p);
  if (p && forMode !== 'slice' && carriesPrompt()) a.push('--carry-initial-prompt');
  if (textOnly) a.push('-nt'); else a.push('-ojf', '-of', outBase);
  if (aligned) a.push('-nfa', '--dtw', dtwPreset(modelFile));
  return run(cli, a).stdout.toString();
}

function toWav(src, dst, from, to, pad = 0) {
  const a = ['-v', 'error', '-y'];
  if (from !== undefined) a.push('-ss', String(from));
  if (to !== undefined) a.push('-to', String(to));
  a.push('-i', src, '-ar', '16000', '-ac', '1');
  if (pad) a.push('-af', `apad=pad_dur=${pad}`);
  a.push(dst);
  run('ffmpeg', a);
}

function wordsFrom(json, aligned) {
  const words = [];
  for (const seg of json.transcription || []) for (const t of seg.tokens || []) {
    const text = t.text || '';
    if (text.startsWith('[_') || text.trim() === '') continue;
    const from = t.offsets.from / 1000, to = t.offsets.to / 1000;
    const dtw = aligned && t.t_dtw !== undefined && t.t_dtw >= 0 ? t.t_dtw / 100 : null;
    if (text.startsWith(' ') || !words.length) words.push({ text: text.trim(), start: from, end: to, dtw });
    else { const w = words[words.length - 1]; w.text += text; w.end = to; }
  }
  return words;
}

// Aligned times run late by a steady offset; measure it against this recording's own onsets.
function calibrate(words, wav) {
  const pcm = readPcm(wav, { rate: 16000 });
  const db = [];
  for (let i = 0; i + 160 <= pcm.length; i += 160) { let s = 0; for (let k = i; k < i + 160; k++) s += pcm[k] * pcm[k]; db.push(20 * Math.log10(Math.sqrt(s / 160) / 32768 + 1e-9)); }
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.05)], speech = sorted[Math.floor(sorted.length * 0.9)];
  const thr = floor + (speech - floor) * 0.3;
  const diffs = [];
  for (const w of words) {
    if (diffs.length >= 24) break;
    if (w.dtw === null) continue;
    const lo = Math.max(1, Math.round((w.dtw - 0.7) * 100)), hi = Math.min(db.length - 1, Math.round((w.dtw + 0.1) * 100));
    let onset = null;
    for (let k = hi; k > lo; k--) if (db[k] >= thr && db[k - 1] < thr) { onset = k / 100; break; }
    if (onset !== null && w.dtw - onset >= -0.05 && w.dtw - onset < 0.6) diffs.push(w.dtw - onset);
  }
  if (diffs.length < 3) return { offset: null, samples: diffs.length };
  diffs.sort((a, b) => a - b);
  return { offset: diffs[Math.floor(diffs.length / 2)], samples: diffs.length };
}

const tmp = tempDir('aive-asr-');
try {
  if (args.slice) {
    for (const s of [].concat(args.slice)) {
      const [a, b] = String(s).split(':').map(Number);
      if (!(b > a)) die(`bad slice ${s} — expected start:end in seconds`);
      const wav = join(tmp.dir, 'slice.wav');
      toWav(media, wav, a, b, 0.6);
      const text = whisper(wav, { forMode: 'slice', textOnly: true }).replace(/\s+/g, ' ').trim();
      const norm = text.toLowerCase().replace(/[.!?]/g, '').trim();
      const flag = !text ? '  [nothing decoded]' : NON_SPEECH.includes(norm) ? '  [stock phrase — likely non-speech]' : '';
      console.log(`${a.toFixed(2)}-${b.toFixed(2)}  ${text}${flag}`);
    }
  } else {
    const wav = join(tmp.dir, 'audio.wav');
    toWav(media, wav);
    if (language === 'auto') language = detectLanguage(wav);
    const base = join(tmp.dir, 'asr');
    const aligned = Boolean(args.aligned);
    whisper(wav, { outBase: base, forMode: mode, aligned });
    const json = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    const detected = json.result?.language || language;
    let words = wordsFrom(json, aligned);
    let cal = null;
    if (aligned) {
      cal = calibrate(words, wav);
      const off = cal.offset ?? 0;
      words = words.map((w) => ({ ...w, start: w.dtw !== null ? Math.max(0, w.dtw - off) : w.start }));
      for (let i = 0; i < words.length; i++) words[i].end = i + 1 < words.length ? Math.max(words[i].start, words[i + 1].start) : words[i].end;
    }
    const out = words.map(({ text, start, end }) => ({ text, start: +start.toFixed(3), end: +end.toFixed(3) }));
    if (args.out) {
      writeJson(args.out, out);
      console.error(`${out.length} words (${mode}, language ${detected}${aligned ? `, aligned, offset ${cal.offset === null ? 'not measurable' : cal.offset.toFixed(3) + 's from ' + cal.samples + ' onsets'}` : ''}) → ${args.out}`);
    }
    if (args.text || !args.out) console.log(out.map((w) => w.text).join(' '));
  }
} finally {
  tmp.cleanup();
}
