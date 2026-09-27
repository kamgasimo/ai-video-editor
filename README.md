# ai-video-editor

A Claude Code skill that turns a raw talking-head recording into finished, social-ready videos on
your own machine — edited the way a skilled CapCut editor would edit them.

```text
/ai-video-editor ~/Movies/my-recording.mov
```

It asks what you want once, then works on its own: it cuts the recording, designs the edit, renders
drafts, critiques them against an editor's checklist, fixes them, and checks every file it delivers.

## What it does

### The cut

- Removes filler sounds, including the ones transcripts miss (a held "uhhh", a creaky "uh"), long
  pauses, retakes and dead air. Every cut is placed on the measured sound, so no word is clipped.
- Checks the result by transcribing it back and comparing it word for word.

### The finish

- **Grade**: a face-first colour correction (a face that sits dark against a bright wall is lifted,
  never darkened) and the look's grade.
- **Camera**: a change of framing at every cut so no jump cut shows, slow push-ins, snap zooms on the
  words that matter, a shake on an impact.
- **Motion graphics that land on the words**: icon cards with living content (code typing, a video
  playing, likes counting up, a timeline being cut), kinetic titles, lists, counters, charts,
  comparisons, steps, quotes, interface mock-ups, lower thirds, stickers — plus bespoke scenes
  designed for the key moments.
- **Layouts**: split screen, overlay, picture-in-picture, cutaway.
- **Transitions at topic changes**: whip-pan, zoom, flash, glitch, light leak, dip.
- **Captions**: word by word, in the look's style, keywords coloured, rare emoji, placed below your
  mouth and clear of each app's buttons. Plus an `.srt` file.
- **Text behind you**, when there is room above your head.
- **B-roll**: from your own folder, Pexels stock footage, or a generation service you choose.
- **Sound design**: a whoosh on every transition, a hit on every title, a pop on every card — from a
  library of recorded effects — and a music bed that dips under your voice. The voice is measured to
  stay at least 12 dB above the music.
- **Formats**: vertical 9:16, landscape 16:9, square 1:1 and 4:5, each framed on you and following
  you as you move.
- **Thumbnail and cover**: your most expressive frame, cut out and outlined, with a bold title.
- **Long video → Shorts**: finds the strongest self-contained moments and edits each one.
- **Editor timeline**: an FCPXML of the cut for DaVinci Resolve, Final Cut Pro or Premiere Pro.

## The looks

| Look | Feel |
|---|---|
| **Dynamic creator** (default) | Bold keyword captions with emoji, motion graphics on the words, snap zooms, transitions at topic changes, dense sound design, an upbeat bed. Built for Shorts, Reels and TikTok. |
| **Clean premium** | Elegant captions, smooth push-ins, refined graphics, soft transitions, a calm bed. |
| **Cinematic** | A film grade with grain and vignette, slow moves, titles and lower thirds, light leaks, ambient music. |
| **Minimal** | The clean cut with simple captions and punch-ins. Needs no rendering engine. |

## How a run goes

1. **Setup** checks everything it needs and offers to install what is missing.
2. **Take in** transcribes the recording twice (clean, and keeping every filler), measures the sound,
   and finds your face.
3. **Questions**, in two rounds of multiple choice:
   - the look, what to cut, the pace and the versions;
   - music, B-roll sources, extras (captions, text behind you, thumbnail, call to action) and an
     accent colour.

   A third round asks only when needed: name spellings, Shorts, a sign-in.
4. **The edit, unattended.** It cuts and checks the master. It grades, tracks you, captions and
   scores it. It drafts an edit plan, adds the creative layer, renders a draft, reviews it frame by
   frame, fixes what fails, renders every version, and checks each one. Then it makes the thumbnail
   and cover and writes a report.

## Requirements

The skill checks for these itself and offers to install what is missing:

- [Claude Code](https://code.claude.com)
- Node.js 22 or newer (18 for the Minimal look)
- ffmpeg, with ffprobe
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-cli`) and a transcription model:
  `large-v3-turbo-q5_0`, about 574 MB, downloaded with your consent
- Python 3 with Pillow (installed into a private environment), for the Minimal look's captions
- The rendering engine, [HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.80, with its
  headless browser and GSAP. Setup installs these into `~/.cache/ai-video-editor/engine`. Its person
  cut-out model, about 168 MB, downloads on first use.

**Optional, asked for only when you choose them:**

- **Music library:** a free [HeyGen](https://www.heygen.com) account signed in through its command
  line (`heygen auth login --oauth`). Without it, music is generated on your machine.
- **Stock footage:** a free [Pexels API key](https://www.pexels.com/api/).
- **AI-generated B-roll:** a generation service connected to your Claude Code session.

Tested on macOS on Apple silicon, with Homebrew. On Linux, setup prints the commands for your package
manager. Windows is untested.

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

You can also just ask: "edit my video at ~/Movies/intro.mov into a Short". With no path, it looks for
videos in the current folder.

## What you get

```text
recording-edited/
├── recording-vertical.mp4
├── recording-landscape.mp4
├── recording-square.mp4
├── recording-thumbnail.jpg     1280×720, for YouTube
├── recording-cover.jpg         1080×1920, for Shorts, Reels, TikTok
├── recording.srt
├── recording.fcpxml
├── recording-short-1.mp4 …     when you asked for Shorts
├── EDIT-REPORT.md              what was made, every check, every cut and why, the finish
├── edit-settings.json          your answers, reused if you run it again on this video
└── work/                       transcripts, the cut list with its evidence, the edit plan, scenes, checks, review sheets
```

Your recording itself is never modified.

## Privacy

Everything runs on your machine:

- transcription, analysis, the person cut-out and the grade;
- rendering and generated music.

The rendering engine's anonymous usage telemetry is switched off on every call, and no frame of your
video is ever sent to a service.

The downloads are the transcription model, the rendering engine with its browser and the cut-out
model, all at setup and with your consent.

Only what you choose goes out:

- the music library receives mood words;
- Pexels receives search words;
- a generation service receives its prompt, after its cost is shown.

Claude reads the transcript and still frames while it works, as it would any file in your session.

## Limits

- It is made for one person talking to camera. It does not handle interviews with several speakers,
  music videos, or footage without speech.
- Text behind you needs room above your head. In a tight close-up the skill uses a title instead, and
  says so.
- Generated music is decent but simpler than real tracks; the music library or your own track sound
  better.
- Filler detection is tuned on English, and knows the common hesitations in French, Spanish, German,
  Portuguese, Italian and Dutch.
- Pacing, how the graphics feel, and music taste can't be measured. The report lists them for you to
  judge.
- The editor timeline carries the cuts only; graphics, captions and music are rendered into the
  videos.

## Troubleshooting

Run the checks yourself:

```sh
node ~/.claude/skills/ai-video-editor/scripts/doctor.mjs
```

| Problem | Fix |
|---|---|
| No transcription model found | `node ~/.claude/skills/ai-video-editor/scripts/doctor.mjs --download-model large-v3-turbo-q5_0` |
| Rendering engine not set up | `node ~/.claude/skills/ai-video-editor/scripts/engine.mjs setup` |
| Your model is somewhere else | Set `WHISPER_MODEL=/path/to/ggml-model.bin`, or `WHISPER_MODELS_DIR` to its folder |
| Your whisper.cpp command has another name | Set `WHISPER_CLI` to it |
| Music library unavailable | Install and sign in to HeyGen's command line: `curl -fsSL https://static.heygen.ai/cli/install.sh \| bash`, then `heygen auth login --oauth` |
| Stock footage unavailable | Get a free key at <https://www.pexels.com/api/> and `export PEXELS_API_KEY=…` |

## The scripts

The skill drives these, and each also works on its own. Run any with no arguments for its usage.

| Script | Does |
|---|---|
| `doctor.mjs`, `engine.mjs` | check the requirements; set up the model, the captions' Python, the rendering engine |
| `intake.mjs`, `transcribe.mjs`, `acoustics.mjs`, `overview.mjs` | take in the recording |
| `plan-cuts.mjs`, `adjust-cuts.mjs`, `cut.mjs`, `loudness.mjs`, `verify.mjs` | the cut and its checks |
| `grade.mjs`, `track.mjs` | the face-first grade; the speaker's track |
| `captions.mjs` | caption chunks and the `.srt` |
| `music.mjs`, `synth.mjs`, `sfx.mjs`, `mix.mjs` | the music bed, the sound effects, the mix with its measured margin |
| `edit-plan.mjs` | drafts and checks the edit plan |
| `compose.mjs`, `render.mjs` | the plan → a composition per format → finished files |
| `cutouts.mjs`, `broll.mjs` | text-behind cut-outs; B-roll from a folder or Pexels |
| `sheets.mjs`, `frames.mjs` | review sheets and frame sheets |
| `thumbnail.mjs` | thumbnail and cover |
| `moments.mjs` | long video → Short candidates |
| `reframe.mjs`, `burn-captions.mjs`, `render_captions.py` | the Minimal look's versions and captions |
| `fcpxml.mjs`, `report.mjs` | the editor timeline; `EDIT-REPORT.md` |

## Licences

The skill is [MIT](LICENSE). It bundles:

- fonts under the SIL Open Font License: Montserrat, Inter, Anton, Playfair Display, JetBrains Mono
  (`assets/fonts/`);
- Lucide icons under the ISC licence (`assets/icons/`).

Setup installs, and does not bundle:

- HyperFrames (Apache 2.0);
- GSAP (its standard no-charge licence);
- the rembg person-segmentation model.

The recorded sound effects come with HyperFrames, under the Pixabay Content License: free for
commercial use in videos, no attribution needed.
