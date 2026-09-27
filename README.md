# ai-video-editor

A Claude Code skill that edits a raw talking-head recording into finished videos, on your own
machine.

Give it a recording. It cuts the ums, the long pauses, the retakes and the dead air. It levels
your voice, adds punch-in zooms, burns in captions, and reframes the video for Shorts, Reels and
TikTok. Then it checks every file it made before handing them over.

```text
/ai-video-editor ~/Movies/my-recording.mov
```

## What it does

- **Cuts.** It removes:
  - filler sounds, including the ones transcripts miss: a held "uhhh", or a low, creaky "uh";
  - long pauses, shortened to the pace you choose;
  - retakes: when you restart a sentence, the earlier attempt goes;
  - dead air at the start and the end.

  Every cut is placed on the measured sound, not on transcript timestamps, so no word gets
  clipped.
- **Sound.** Your voice gets a gentle clean-up: rumble removal, light denoise and compression. It
  is delivered at −14 LUFS with true peaks at −1.5 dBTP, a common loudness for online video. You
  can add a music bed, made on your machine, that dips while you speak.
- **Picture.** Optional punch-in zooms on alternate segments make each cut read as a camera change.
  Vertical 9:16 and square 1:1 versions are framed around your face.
- **Captions.** Word-by-word animated captions in three styles and your accent colour, placed clear
  of your mouth. You also get an `.srt` subtitle file.
- **Hand-off.** An FCPXML timeline lets you fine-tune the cut in DaVinci Resolve, Final Cut Pro or
  Premiere Pro.
- **Checks.** Each file is transcribed back and compared word for word with what should remain.
  Loudness, duration and audio/video sync are measured, and still frames are inspected for framing
  and caption placement. The report says what passed and what only you can judge.

## How a run goes

1. **Setup.** It checks for ffmpeg, whisper.cpp, a transcription model and Python for captions, and
   offers to install whatever is missing.
2. **Take in.** It transcribes your recording twice, once clean and once keeping every filler. It
   measures the audio and finds your face in the frame.
3. **Questions.** Two rounds of multiple-choice questions:
   - first: what to cut, the pace, zooms, and which versions you want;
   - then: caption style, accent colour, and music.

   If it finds names it can't be sure how to spell, it asks one more.
4. **The edit, unattended.** It plans the cut, renders it, and checks it, fixing and re-checking
   until the checks pass. Then it makes each version, checks each one, and writes a report.

## Requirements

The skill checks for these itself and offers to install what is missing:

- [Claude Code](https://code.claude.com)
- Node.js 18 or newer
- ffmpeg, with ffprobe
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-cli`) and a model. The first
  run downloads `large-v3-turbo-q5_0`, about 574 MB, with your consent.
- Python 3. Captions use Pillow, which is installed into a private environment under
  `~/.cache/ai-video-editor`.
- xmllint (optional), to check the editor timeline

It has been tested on macOS on Apple silicon, with Homebrew. On Linux, setup prints the commands
for your package manager. Windows is untested.

## Install

For all your projects:

```sh
git clone https://github.com/kamgasimo/ai-video-editor.git ~/.claude/skills/ai-video-editor
```

For one project only, from its root:

```sh
git clone https://github.com/kamgasimo/ai-video-editor.git .claude/skills/ai-video-editor
```

Then start a new Claude Code session. To update later:

```sh
git -C ~/.claude/skills/ai-video-editor pull
```

## Use

```text
/ai-video-editor path/to/recording.mp4
```

You can also just ask, for example "edit my video at ~/Movies/intro.mov". With no path, it looks
for videos in the current folder and asks which one to edit.

## What you get

```text
recording-edited/
├── recording-landscape.mp4
├── recording-vertical.mp4
├── recording-square.mp4
├── recording.srt
├── recording.fcpxml
├── EDIT-REPORT.md        what was made, every check, every cut and why
├── edit-settings.json    your answers, reused if you run it again on this video
└── work/                 transcripts, the cut list with its evidence, checks, frame sheets
```

Your recording itself is never modified.

## Privacy

Everything runs on your machine: transcription (whisper.cpp), analysis, rendering (ffmpeg) and
music. No audio or video is uploaded anywhere. The one download is the transcription model, from
the whisper.cpp model repository on Hugging Face.

Claude reads the transcript and a few still frames while it works, as it would any file in your
session.

## Limits

- It is made for one person talking to camera. It does not handle interviews with several
  speakers, music videos, or footage without speech.
- Reframing uses one fixed crop around the face. A speaker who walks across the frame can leave
  the vertical crop; the report says so when that is likely.
- Filler detection is tuned on English. It also knows the common hesitations in French, Spanish,
  German, Portuguese, Italian and Dutch. In other languages, only the acoustic detection applies.
- Pacing, how natural the audio sounds, and music taste can't be measured. The report lists them
  for you to judge.
- The editor timeline carries the cuts only. Zooms, captions and music are rendered into the
  videos.

## Troubleshooting

Run the checks yourself:

```sh
node ~/.claude/skills/ai-video-editor/scripts/doctor.mjs
```

| Problem | Fix |
|---|---|
| No transcription model found | `node ~/.claude/skills/ai-video-editor/scripts/doctor.mjs --download-model large-v3-turbo-q5_0` |
| Your model is somewhere else | Set `WHISPER_MODEL=/path/to/ggml-model.bin`, or `WHISPER_MODELS_DIR` to its folder |
| Your whisper.cpp command has another name | Set `WHISPER_CLI` to it |
| No caption font found, or you want another | Set `CAPTION_FONT=/path/to/font.ttf` |

## The scripts

The skill drives these, and each one also works on its own. Run any with no arguments to see its
usage.

| Script | Does |
|---|---|
| `doctor.mjs` | checks the requirements, downloads a model, sets up the captions' Python |
| `intake.mjs` | checks a recording and makes its output folder |
| `transcribe.mjs` | local transcription: clean or verbatim, word timings aligned to the audio, single spans |
| `acoustics.mjs` | loudness envelope, pauses, and held voiced sounds; a 30 ms view of any span |
| `overview.mjs` | the intake in one read: transcript, fillers, pauses, spellings to confirm |
| `plan-cuts.mjs` | the cut list, each removal with its evidence |
| `adjust-cuts.mjs` | changes the cut list with a recorded reason |
| `cut.mjs` | renders the cut list, with click-free joins and punch-ins |
| `loudness.mjs` | measures loudness, and normalises it in two passes |
| `verify.mjs` | the check: words, fillers, loudness, duration, sync, frames |
| `captions.mjs` | caption chunks and the `.srt` file |
| `burn-captions.mjs` | animated captions burned in, placed clear of the mouth |
| `reframe.mjs` | vertical and square crops around the face |
| `synth.mjs`, `mix.mjs` | a generated music bed, mixed and ducked under the voice |
| `fcpxml.mjs` | the editor timeline |
| `frames.mjs` | frame sheets, with an optional measuring grid |
| `report.mjs` | `EDIT-REPORT.md` |

## License

[MIT](LICENSE)
