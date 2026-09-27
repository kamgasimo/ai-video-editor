#!/usr/bin/env node
// Voice first, music under it.
//
//   node mix.mjs --voice master.mov --music bed.wav --out master-music.mov
//        [--under 16] [--no-duck] [--target -14] [--tp -1.5]
//
// The music is set --under dB below the voice's measured loudness, then sidechained to the voice so it
// dips while someone speaks and recovers in the gaps. A track shorter than the voice loops; every track
// fades in over half a second and out over the last two. The sum is limited, then normalised two-pass
// to the target. With a video as --voice and a video --out, the picture is copied through untouched.
// The mix is stereo, so a stereo track keeps its width.

import { join, extname } from 'node:path';
import { parseArgs, die, run, probe, tempDir, num } from './common.mjs';
import { measure, normalize } from './loudness.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.voice || !args.music || !args.out) die('usage: mix.mjs --voice file --music file --out file [--under dB] [--no-duck] [--target n] [--tp n]');

const voice = probe(args.voice);
if (!voice.audio) die('the voice file has no audio');
const D = voice.audio.duration ?? voice.duration;
const under = num(args.under, 16);
const target = num(args.target, -14), tp = num(args.tp, -1.5);
const Iv = measure(args.voice).integrated, Im = measure(args.music).integrated;
if (!Number.isFinite(Im)) die('the music measures silent');
const gain = +((Iv - under) - Im).toFixed(2);

const chain = [
  '[0:a]aformat=channel_layouts=stereo,asplit=2[v][key]',
  `[1:a]aformat=channel_layouts=stereo,volume=${gain}dB,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, D - 2).toFixed(3)}:d=2[m0]`,
  args['no-duck'] ? '[m0]anull[m];[key]anullsink' : '[m0][key]sidechaincompress=threshold=0.03:ratio=3:attack=20:release=400:makeup=1[m]',
  '[v][m]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9:level=false[out]',
];
const withVideo = Boolean(voice.video) && ['.mov', '.mp4', '.mkv'].includes(extname(args.out).toLowerCase());

const tmp = tempDir('aive-mix-');
try {
  const raw = join(tmp.dir, withVideo ? 'raw.mov' : 'raw.wav');
  run('ffmpeg', ['-v', 'error', '-y', '-i', args.voice, '-stream_loop', '-1', '-i', args.music, '-filter_complex', chain.join(';'),
    ...(withVideo ? ['-map', '0:v', '-c:v', 'copy'] : []), '-map', '[out]', '-t', D.toFixed(3), '-ar', '48000', '-c:a', 'pcm_s16le', raw]);
  const m = normalize(raw, args.out, { target, tp });
  console.log(`voice ${Iv} LUFS + music ${Im} LUFS set ${under} dB under (${gain >= 0 ? '+' : ''}${gain} dB)${args['no-duck'] ? '' : ', ducked under speech'} → ${args.out}`);
  console.log(`integrated ${m.integrated} LUFS · true peak ${m.truePeak} dBTP (target ${target}, ≤ ${tp})`);
} finally {
  tmp.cleanup();
}
