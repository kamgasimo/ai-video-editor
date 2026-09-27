// Shared helpers for the ai-video-editor scripts: running tools, parsing flags, moving audio in and
// out of memory, and finding the transcriber, its model and the Python used for captions.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- processes

export function run(cmd, args, { input, allowFail = false, maxBuffer = 1 << 30, inherit = false } = {}) {
  const r = spawnSync(cmd, args, { input, maxBuffer, stdio: inherit ? 'inherit' : 'pipe' });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new Error(`${cmd} is not installed or not on PATH`);
    throw r.error;
  }
  if (r.status !== 0 && !allowFail) {
    const err = (r.stderr || Buffer.alloc(0)).toString().trim().split('\n').slice(-8).join('\n');
    throw new Error(`${cmd} exited ${r.status}\n${err}`);
  }
  return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0) };
}

export function hasCommand(cmd) {
  return spawnSync('sh', ['-c', `command -v "${cmd}"`]).status === 0;
}

export function tempDir(prefix = 'aive-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

// ---------------------------------------------------------------- flags

// --key value, --key=value, --flag; everything else is positional. Repeated keys collect into arrays.
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let key = a.slice(2), val;
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { val = argv[++i]; }
    else { val = true; }
    if (key in out) out[key] = [].concat(out[key], val);
    else out[key] = val;
  }
  return out;
}

export function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

export function num(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`not a number: ${v}`);
  return n;
}

export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function writeJson(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }

// ---------------------------------------------------------------- where things live

export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'ai-video-editor');
}

export function modelDirs() {
  const dirs = [];
  if (process.env.WHISPER_MODELS_DIR) dirs.push(process.env.WHISPER_MODELS_DIR);
  dirs.push(join(cacheDir(), 'models'), join(homedir(), '.cache', 'whisper.cpp'), join(homedir(), '.cache', 'whisper'),
    join(homedir(), '.whisper-models'), join(homedir(), 'models'));
  return dirs.filter((d, i) => dirs.indexOf(d) === i);
}

// Preference order when several models are present: accuracy first, then speed.
const MODEL_PREFERENCE = ['large-v3-turbo-q5_0', 'large-v3-turbo', 'large-v3', 'medium', 'small', 'base', 'base.en', 'small.en', 'medium.en', 'tiny', 'tiny.en'];

export function findModels() {
  const found = [];
  for (const d of modelDirs()) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/^ggml-.+\.bin$/.test(f)) found.push(join(d, f));
  }
  return found;
}

export function resolveModel(explicit) {
  if (explicit) { if (!existsSync(explicit)) die(`model not found: ${explicit}`); return explicit; }
  if (process.env.WHISPER_MODEL) { if (!existsSync(process.env.WHISPER_MODEL)) die(`WHISPER_MODEL points at a missing file: ${process.env.WHISPER_MODEL}`); return process.env.WHISPER_MODEL; }
  const found = findModels();
  if (!found.length) die(`no transcription model found — run: node ${join(SKILL_ROOT, 'scripts', 'doctor.mjs')} --download-model large-v3-turbo-q5_0`);
  const rank = (p) => { const name = p.split('/').pop().replace(/^ggml-|\.bin$/g, ''); const i = MODEL_PREFERENCE.indexOf(name); return i < 0 ? 99 : i; };
  return found.sort((a, b) => rank(a) - rank(b))[0];
}

// The transcriber names its alignment presets after the model, without the quantisation suffix.
export function dtwPreset(modelPath) {
  return modelPath.split('/').pop().replace(/^ggml-|\.bin$/g, '').replace(/-q\d_\d$/, '').replace(/-/g, '.');
}

export function whisperCli() {
  if (process.env.WHISPER_CLI) return process.env.WHISPER_CLI;
  for (const c of ['whisper-cli', 'whisper-cpp']) if (hasCommand(c)) return c;
  return 'whisper-cli';
}

// A heavy sans-serif for burned-in captions: the system's font matcher first, then known locations.
export function findFont() {
  if (process.env.CAPTION_FONT && existsSync(process.env.CAPTION_FONT)) return process.env.CAPTION_FONT;
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial Black.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  if (hasCommand('fc-match')) {
    const r = spawnSync('fc-match', ['-f', '%{file}', 'sans-serif:bold']);
    const f = r.stdout?.toString().trim();
    if (f && existsSync(f) && /\.(ttf|otf|ttc)$/i.test(f)) return f;
  }
  return null;
}

export function captionPython() {
  const venv = join(cacheDir(), 'venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

// ---------------------------------------------------------------- media

// The standard frame rate nearest a measured one, as the number arithmetic needs and the rational a
// filter or an editor timeline needs. A tie goes to the higher rate, which repeats a frame rather than
// dropping one.
const RATES = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]];
export function standardRate(fps) {
  let best = RATES[0];
  for (const r of RATES) if (Math.abs(r[0] / r[1] - fps) <= Math.abs(best[0] / best[1] - fps)) best = r;
  return { fps: best[0] / best[1], num: best[0], den: best[1], rational: `${best[0]}/${best[1]}` };
}

// The crop a punch-in of z takes around the face, in the frame's own pixels: the face centred where the
// frame allows, the crop never past an edge.
export function punchCrop(W, H, face, z) {
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const cw = even(W / z), ch = even(H / z);
  return { cw, ch, x0: clamp(Math.round(face.x - cw / 2), 0, W - cw), y0: clamp(Math.round(face.y - ch / 2), 0, H - ch) };
}

// A rate given on the command line: "25", "29.97" or "30000/1001".
export function parseRate(v) {
  const [a, b] = String(v).split('/').map(Number);
  const fps = b ? a / b : a;
  if (!Number.isFinite(fps) || fps <= 0) die(`not a frame rate: ${v}`);
  const std = standardRate(fps);
  return Math.abs(std.fps - fps) < 0.01 ? std : { fps, num: fps, den: 1, rational: String(fps) };
}

export function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels,duration,nb_frames',
    '-of', 'json', file]);
  const j = JSON.parse(r.stdout.toString());
  const rate = (s) => { if (!s || s === '0/0') return null; const [a, b] = s.split('/').map(Number); return b ? a / b : a; };
  // A constant-rate stream's average can read a frame short of its nominal rate; trust the nominal one
  // when the two agree to within 1 %.
  const fps = (s) => { const r = rate(s.r_frame_rate), avg = rate(s.avg_frame_rate); return r && avg && Math.abs(r - avg) / r < 0.01 ? r : avg || r; };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    path: resolve(file),
    format: j.format.format_name,
    duration: Number(j.format.duration),
    size: Number(j.format.size),
    streams: { video: j.streams.filter((s) => s.codec_type === 'video').length, audio: j.streams.filter((s) => s.codec_type === 'audio').length },
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: fps(v), fpsRational: v.r_frame_rate, duration: v.duration ? Number(v.duration) : null } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels, duration: a.duration ? Number(a.duration) : null } : null,
  };
}

export function readPcm(file, { rate = 16000, from, to } = {}) {
  const args = ['-v', 'error'];
  if (from !== undefined) args.push('-ss', String(from));
  if (to !== undefined) args.push('-to', String(to));
  args.push('-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-');
  const buf = run('ffmpeg', args).stdout;
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

export function writeWav(file, channels, rate) {
  const n = channels[0].length, ch = channels.length;
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    data.writeInt16LE(Math.round(s * 32767), (i * ch + c) * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}
