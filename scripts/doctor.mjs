#!/usr/bin/env node
// Check everything the editor needs, and set up what can be set up without an administrator.
//
//   node doctor.mjs [--json]                      report every requirement and how to fix what is missing
//   node doctor.mjs --setup-python                create the private Python environment captions use
//   node doctor.mjs --download-model <name> [--dir <dir>]
//                                                 download a transcription model (default dir: the cache)
//
// Nothing here uploads anything. The model download is the only network access, from the
// transcriber's own model repository, and only when asked for.

import { existsSync, mkdirSync, createWriteStream, statSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, die, run, hasCommand, cacheDir, findModels, whisperCli, captionPython, findFont, SKILL_ROOT } from './common.mjs';
import { status as engineStatus, ENGINE_VERSION } from './engine.mjs';

const args = parseArgs(process.argv.slice(2));

const MODELS = {
  'large-v3-turbo-q5_0': { size: 'about 574 MB', note: 'recommended — accurate and fast, every language' },
  'small': { size: 'about 466 MB', note: 'good accuracy, every language' },
  'base': { size: 'about 142 MB', note: 'fastest, every language, less accurate' },
  'base.en': { size: 'about 142 MB', note: 'fastest, English only' },
};
const MODEL_URL = (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;

const FILTERS = ['ebur128', 'loudnorm', 'sidechaincompress', 'afftdn', 'acompressor', 'highpass', 'alimiter', 'amix', 'crop', 'scale', 'overlay', 'concat', 'tile', 'apad', 'afade', 'drawgrid'];
const ENCODERS = ['libx264', 'aac'];
const DEMUXERS = ['concat', 'image2'];
const DECODERS = ['png'];

function packageManager() {
  for (const pm of ['brew', 'apt-get', 'dnf', 'pacman', 'zypper', 'winget']) if (hasCommand(pm)) return pm;
  return null;
}

const INSTALL = {
  ffmpeg: { brew: 'brew install ffmpeg', 'apt-get': 'sudo apt-get install -y ffmpeg', dnf: 'sudo dnf install -y ffmpeg', pacman: 'sudo pacman -S --noconfirm ffmpeg', zypper: 'sudo zypper install -y ffmpeg', winget: 'winget install Gyan.FFmpeg' },
  whisper: {
    brew: 'brew install whisper-cpp',
    other: 'git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp && cmake -B build && cmake --build build -j --config Release  # then put build/bin on your PATH',
  },
  python: { brew: 'brew install python', 'apt-get': 'sudo apt-get install -y python3 python3-venv', dnf: 'sudo dnf install -y python3', pacman: 'sudo pacman -S --noconfirm python', zypper: 'sudo zypper install -y python3', winget: 'winget install Python.Python.3.12' },
  font: { 'apt-get': 'sudo apt-get install -y fonts-dejavu-core', dnf: 'sudo dnf install -y dejavu-sans-fonts', pacman: 'sudo pacman -S --noconfirm ttf-dejavu', zypper: 'sudo zypper install -y dejavu-fonts' },
  xmllint: { brew: 'brew install libxml2', 'apt-get': 'sudo apt-get install -y libxml2-utils', dnf: 'sudo dnf install -y libxml2', pacman: 'sudo pacman -S --noconfirm libxml2' },
};
function fixFor(tool, pm) {
  const t = INSTALL[tool] || {};
  return t[pm] || t.other || (pm ? `install ${tool} with ${pm}` : `install ${tool} with your system's package manager`);
}

// ---------------------------------------------------------------- setup actions

async function download(name, dir) {
  if (!MODELS[name] && !/^[a-z0-9.\-_]+$/.test(name)) die(`unknown model name: ${name}`);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `ggml-${name}.bin`);
  if (existsSync(dest) && statSync(dest).size > 10e6) { console.log(`already present: ${dest}`); return dest; }
  const url = MODEL_URL(name);
  console.log(`downloading ${name}${MODELS[name] ? ` (${MODELS[name].size})` : ''}\n  from ${url}\n  to   ${dest}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) die(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  let got = 0, lastPct = -1;
  for await (const chunk of res.body) {
    out.write(chunk); got += chunk.length;
    if (total) { const pct = Math.floor(got / total * 100); if (pct !== lastPct && pct % 5 === 0) { process.stdout.write(`\r  ${pct}%  ${(got / 1e6).toFixed(0)} MB`); lastPct = pct; } }
  }
  await new Promise((r) => out.end(r));
  if (statSync(part).size < 10e6) die('the downloaded file is too small to be a model — try again');
  renameSync(part, dest);
  console.log(`\n  done → ${dest}`);
  return dest;
}

function setupPython() {
  if (!hasCommand('python3')) die(`python3 is missing — ${fixFor('python', packageManager())}`);
  const venv = join(cacheDir(), 'venv');
  if (!existsSync(join(venv, 'bin', 'python'))) {
    console.log(`creating ${venv}`);
    run('python3', ['-m', 'venv', venv]);
  }
  const py = join(venv, 'bin', 'python');
  const have = spawnSync(py, ['-c', 'import PIL']).status === 0;
  if (!have) { console.log('installing Pillow into it'); run(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', 'pillow']); }
  const v = run(py, ['-c', 'import PIL; print(PIL.__version__)']).stdout.toString().trim();
  console.log(`Pillow ${v} ready in ${venv}`);
}

// ---------------------------------------------------------------- checks

function checks() {
  const pm = packageManager();
  const out = [];
  const add = (id, required, ok, detail, fix) => out.push({ id, required, ok, detail, fix: ok ? null : fix });

  const [major] = process.versions.node.split('.').map(Number);
  add('node', true, major >= 18, `Node ${process.versions.node}`, 'install Node 18 or newer');
  add('node for the finished looks', false, major >= 22, major >= 22 ? `Node ${major} — the rendering engine runs` : `Node ${major} — the rendering engine needs 22 or newer`, pm === 'brew' ? 'brew install node' : 'install Node 22 or newer from https://nodejs.org');

  for (const tool of ['ffmpeg', 'ffprobe']) {
    const ok = hasCommand(tool);
    add(tool, true, ok, ok ? run(tool, ['-version']).stdout.toString().split('\n')[0] : 'not found', fixFor('ffmpeg', pm));
  }
  if (hasCommand('ffmpeg')) {
    const f = run('ffmpeg', ['-hide_banner', '-filters']).stdout.toString();
    const e = run('ffmpeg', ['-hide_banner', '-encoders']).stdout.toString();
    const dm = run('ffmpeg', ['-hide_banner', '-demuxers']).stdout.toString();
    const dc = run('ffmpeg', ['-hide_banner', '-decoders']).stdout.toString();
    const missing = (names, list) => names.filter((x) => !new RegExp(`\\s${x}\\s`).test(list));
    const miss = [...missing(FILTERS, f), ...missing(ENCODERS, e), ...missing(DEMUXERS, dm), ...missing(DECODERS, dc)];
    add('ffmpeg features', true, !miss.length,
      miss.length ? `missing: ${miss.join(', ')}` : `${FILTERS.length} filters, ${ENCODERS.length} encoders, ${DEMUXERS.length} demuxers and ${DECODERS.length} decoder present`,
      'install a full ffmpeg build — your package manager\'s default ffmpeg usually has everything');
  }

  const cli = whisperCli();
  const cliOk = hasCommand(cli);
  add('transcriber', true, cliOk, cliOk ? `${cli} (whisper.cpp)` : 'whisper.cpp command line not found', fixFor('whisper', pm));

  const models = findModels();
  const envModel = process.env.WHISPER_MODEL && existsSync(process.env.WHISPER_MODEL) ? process.env.WHISPER_MODEL : null;
  add('model', true, Boolean(envModel || models.length), envModel ? `WHISPER_MODEL → ${envModel}` : models.length ? models.join(', ') : 'no ggml model found',
    `node ${join(SKILL_ROOT, 'scripts', 'doctor.mjs')} --download-model large-v3-turbo-q5_0`);

  const py = captionPython();
  const pyOk = hasCommand(py) || existsSync(py);
  const pil = pyOk && spawnSync(py, ['-c', 'import PIL']).status === 0;
  add('captions (Python + Pillow)', true, pil, pil ? `Pillow via ${py}` : pyOk ? 'Python found, Pillow missing' : 'python3 not found',
    pyOk ? `node ${join(SKILL_ROOT, 'scripts', 'doctor.mjs')} --setup-python` : fixFor('python', pm));

  const font = findFont();
  add('caption font', true, Boolean(font), font || 'no bold sans-serif font found', fixFor('font', pm));

  // the finished looks (graphics, transitions, captions, music): the rendering engine
  let eng = { ok: false };
  try { eng = engineStatus(); } catch {}
  add('rendering engine', false, eng.ok, eng.ok ? `hyperframes ${eng.engine}, its browser and GSAP` : `not set up (wanted hyperframes ${ENGINE_VERSION})`, `node ${join(SKILL_ROOT, 'scripts', 'engine.mjs')} setup`);
  add('person cut-out model', false, Boolean(eng.backgroundModel), eng.backgroundModel ? 'downloaded' : 'downloads on first use, about 168 MB', null);
  // optional services, each asked for by name before it is used
  const hg = hasCommand('heygen');
  let signedIn = false;
  if (hg) { const r = spawnSync('heygen', ['auth', 'status'], { encoding: 'utf8' }); signedIn = r.status === 0 && !/not (signed|logged) in/i.test((r.stdout || '') + (r.stderr || '')); }
  add('music library (HeyGen, free account)', false, hg && signedIn, hg ? (signedIn ? 'signed in — real tracks by mood' : 'installed, not signed in') : 'not installed — music is generated on this machine instead',
    hg ? 'heygen auth login --oauth' : 'curl -fsSL https://static.heygen.ai/cli/install.sh | bash && heygen auth login --oauth');
  const cfg = join(cacheDir(), 'config.json');
  const pexels = Boolean(process.env.PEXELS_API_KEY) || (existsSync(cfg) && Boolean(JSON.parse(readFileSync(cfg, 'utf8')).pexelsKey));
  add('stock footage (Pexels, free key)', false, pexels, pexels ? 'a Pexels key is set' : 'no Pexels key — B-roll comes from graphics and your own folder', `get a free key at https://www.pexels.com/api/, then export PEXELS_API_KEY=… or save {"pexelsKey": "…"} in ${cfg}`);
  const xml = hasCommand('xmllint');
  add('xmllint (optional)', false, xml, xml ? 'present — checks editor timelines' : 'absent — editor timelines are written unchecked', fixFor('xmllint', pm));

  return { platform: process.platform, packageManager: pm, cacheDir: cacheDir(), checks: out, ok: out.every((c) => !c.required || c.ok), models: Object.entries(MODELS).map(([name, m]) => ({ name, ...m })) };
}

// ---------------------------------------------------------------- run

if (args['setup-python']) setupPython();
else if (args['download-model']) await download(String(args['download-model']), typeof args.dir === 'string' ? args.dir : join(cacheDir(), 'models'));
else {
  const r = checks();
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`platform ${r.platform} · package manager ${r.packageManager || 'none found'}\n`);
    for (const c of r.checks) console.log(`${c.ok ? '✓' : c.required ? '✗' : '–'} ${c.id.padEnd(28)} ${c.detail}${c.fix ? `\n    fix: ${c.fix}` : ''}`);
    console.log(r.ok ? '\nready' : '\nnot ready — fix the ✗ lines above');
  }
  process.exit(r.ok ? 0 : 1);
}
