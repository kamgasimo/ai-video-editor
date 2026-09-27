// The rendering engine: HyperFrames, pinned, installed in this skill's cache, and always called with its
// usage telemetry off. Everything that renders, cuts out the speaker, or reads the bundled sound
// effects goes through here.
//
//   node engine.mjs setup          install the engine, its browser and GSAP into the cache
//   node engine.mjs status [--json]
//
// The engine is HTML → video: a composition is a web page with a paused GSAP timeline, rendered frame
// by frame in headless Chrome. It never uploads anything when called through this file: telemetry is
// switched off by environment on every call, and the snapshot command's frame description (an outside
// vision service when an API key is present) is always disabled.

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, die, run, cacheDir, isMain } from './common.mjs';

export const ENGINE_VERSION = '0.8.80';
export const GSAP_VERSION = '3.14.2';
const PRIVATE_ENV = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };

export const engineDir = () => join(cacheDir(), 'engine');
export const hfBin = () => join(engineDir(), 'node_modules', '.bin', 'hyperframes');
export const gsapPath = () => join(engineDir(), 'vendor', `gsap-${GSAP_VERSION}.min.js`);
export const sfxLibraryDir = () => join(engineDir(), 'node_modules', 'hyperframes', 'dist', 'skills', 'media-use', 'audio', 'assets', 'sfx');
export const installed = () => existsSync(hfBin());

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '\n');

export function hf(args, { allowFail = false, cwd } = {}) {
  if (!installed()) throw new Error(`the rendering engine is not installed — run: node ${join(import.meta.dirname, 'engine.mjs')} setup`);
  const r = run(hfBin(), args, { env: PRIVATE_ENV, allowFail, cwd });
  return { status: r.status, out: strip(r.stdout.toString()), err: strip(r.stderr.toString()) };
}

export function version() {
  return installed() ? hf(['--version'], { allowFail: true }).out.trim() : null;
}

export function browserPath() {
  if (!installed()) return null;
  const r = hf(['browser', 'path'], { allowFail: true });
  const p = r.out.trim().split('\n').pop();
  return r.status === 0 && p && existsSync(p) ? p : null;
}

// Lint and check a project; returns the error and warning counts with the report text.
export function lint(dir) {
  const r = hf(['lint', dir], { allowFail: true });
  const m = (r.out + r.err).match(/(\d+) error\(s\), (\d+) warning\(s\)/);
  return { errors: m ? Number(m[1]) : r.status === 0 ? 0 : 1, warnings: m ? Number(m[2]) : 0, report: (r.out + r.err).trim() };
}
export function check(dir) {
  const r = hf(['check', dir], { allowFail: true });
  return { ok: r.status === 0, report: (r.out + r.err).trim() };
}

// Runtime validation in the headless browser: script errors, missing assets, unresolved targets.
export function validate(dir, { contrast = false } = {}) {
  const r = hf(['validate', dir, '--json', ...(contrast ? [] : ['--no-contrast'])], { allowFail: true });
  try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); return { ok: j.ok && !j.errors?.length, errors: j.errors || [], warnings: j.warnings || [], contrastFailures: j.contrastFailures || 0 }; }
  catch { return { ok: r.status === 0, errors: r.status === 0 ? [] : [{ text: (r.out + r.err).trim().split('\n').slice(-5).join(' ') }], warnings: [] }; }
}

export function render(dir, out, { fps, quality = 'looks', format = 'mp4', workers } = {}) {
  const a = ['render', dir, '-o', out, '--quiet', '--quality', quality, '--format', format];
  if (fps) a.push('--fps', String(fps));
  if (workers) a.push('--workers', String(workers));
  const r = hf(a, { allowFail: true });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`render failed:\n${(r.out + r.err).trim().split('\n').slice(-15).join('\n')}`);
  return out;
}

// Exact frames of a composition as PNG. Frame description by an outside vision service is always off.
export function snapshot(dir, times, outDir) {
  const r = hf(['snapshot', dir, '--at', times.map((t) => t.toFixed(3)).join(','), '--no-end', '-o', outDir, '--describe', 'false'], { allowFail: true });
  if (r.status !== 0) throw new Error(`snapshot failed:\n${(r.out + r.err).trim().split('\n').slice(-8).join('\n')}`);
  return outDir;
}

// Transparent cut-out of the person: VP9 WebM with alpha (or ProRes 4444 for .mov).
export function removeBackground(input, output, { quality } = {}) {
  const a = ['remove-background', input, '-o', output];
  if (quality) a.push('--quality', quality);
  const r = hf(a, { allowFail: true });
  if (r.status !== 0 || !existsSync(output)) throw new Error(`background removal failed:\n${(r.out + r.err).trim().split('\n').slice(-10).join('\n')}`);
  return output;
}

export function setup() {
  mkdirSync(engineDir(), { recursive: true });
  const pkg = join(engineDir(), 'package.json');
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: 'ai-video-editor-engine', private: true }, null, 2) + '\n');
  if (version() !== ENGINE_VERSION) {
    console.log(`installing the rendering engine (hyperframes ${ENGINE_VERSION})`);
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `hyperframes@${ENGINE_VERSION}`], { cwd: engineDir(), env: PRIVATE_ENV });
  }
  if (!browserPath()) {
    console.log('downloading the headless browser it renders with');
    hf(['browser', 'ensure']);
  }
  if (!existsSync(gsapPath())) {
    console.log(`fetching GSAP ${GSAP_VERSION}`);
    mkdirSync(join(engineDir(), 'vendor'), { recursive: true });
    run('curl', ['-sSfL', '-o', gsapPath(), `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VERSION}/dist/gsap.min.js`]);
  }
  return status();
}

export function status() {
  const v = version();
  return {
    engine: v, wanted: ENGINE_VERSION, ok: v === ENGINE_VERSION && Boolean(browserPath()) && existsSync(gsapPath()),
    browser: browserPath(), gsap: existsSync(gsapPath()) ? gsapPath() : null,
    sfxLibrary: existsSync(sfxLibraryDir()) ? sfxLibraryDir() : null,
    backgroundModel: (() => { const m = join(process.env.HOME || '', '.cache', 'hyperframes', 'background-removal', 'models', 'u2net_human_seg.onnx'); return existsSync(m) && statSync(m).size > 1e8 ? m : null; })(),
  };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'setup') { const s = setup(); console.log(s.ok ? `ready — hyperframes ${s.engine}, browser and GSAP in ${engineDir()}` : 'not ready'); process.exit(s.ok ? 0 : 1); }
  else if (cmd === 'status') { const s = status(); console.log(args.json ? JSON.stringify(s, null, 2) : `engine ${s.engine ?? 'not installed'} (wanted ${s.wanted}) · browser ${s.browser ? 'ok' : 'missing'} · GSAP ${s.gsap ? 'ok' : 'missing'} · sound library ${s.sfxLibrary ? 'ok' : 'missing'} · cut-out model ${s.backgroundModel ? 'downloaded' : 'downloads on first use (~168 MB)'}`); process.exit(s.ok ? 0 : 1); }
  else die('usage: engine.mjs setup | status [--json]');
}
