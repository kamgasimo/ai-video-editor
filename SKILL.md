---
name: ai-video-editor
description: Edits a raw talking-head recording into finished videos on this machine. Removes filler sounds (um, uh), long pauses, retakes and dead air; cleans and levels the voice; adds punch-in zooms; burns in animated captions and writes a subtitle file; reframes to vertical and square; can add a music bed and an editor timeline (FCPXML). Checks and installs what it needs, asks the user's preferences once, then edits and verifies every file to the end without them. Use when someone wants a recorded video edited, cleaned up, cut down, captioned, or turned into Shorts, Reels or TikToks.
argument-hint: "[path to video]"
allowed-tools:
  - Bash(node --version)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
  - Bash(ffmpeg *)
  - Bash(ffprobe *)
  - Bash(xmllint *)
  - Read
  - Write
---

# AI video editor

Edit this recording: $ARGUMENTS

You turn one raw recording of someone talking to camera into finished videos, in four phases.
Phases 1 to 3 involve the user; phase 4 runs to the end without them.

1. **Set up**: check the tools, and install what is missing with the user's consent.
2. **Take in**: transcribe and measure the recording.
3. **Ask**: the user's preferences, in two rounds of questions (three at most).
4. **Edit**: plan, cut, check, make every version, check each one, then report.

Every step is a script in this skill's `scripts/` folder, run as
`node ${CLAUDE_SKILL_DIR}/scripts/<script> …`. Run each one exactly so: one command per call,
with the full path. That form runs without a permission prompt. Each script prints what it did.
Read that output before the next step, because it is the evidence the next decision rests on.
In the commands below, VIDEO is the recording's path, OUT the output folder, WORK its `work/`
folder, NAME the recording's file name without extension, and LANG the language code. Quote every
path.

## Rules for the whole edit

- **The recording is only read.** Everything is written to OUT.
- **Nothing leaves the machine.** Transcription, analysis, rendering and music all run locally. The
  one download is the transcription model, from whisper.cpp's model repository, and only with the
  user's consent.
- **Measure, don't assume.** A cut is made because the acoustics and a transcription of that span
  show a filler. A file is done when its check passes. When a check can't pass, say so plainly.
- **In phase 4, never ask the user anything.** When a choice comes up, apply the rule given here,
  record why in a report note, and continue.
- **Long steps take minutes on a long recording.** This applies to transcribing, rendering and
  checking. Give those commands a 10-minute timeout. For a recording over 20 minutes, run them in
  the background and wait for each one to finish.

## Phase 1: Set up

1. Run `node --version`. If Node is missing or older than 18, tell the user to install Node.js 18
   or newer (`brew install node` on macOS, or <https://nodejs.org>), then stop.
2. Run `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --json`. Each entry in `checks` has `ok` and
   `required`. An entry that is not ok also has `fix`: the command that fixes it on this machine.
3. If the top-level `ok` is true, go to phase 2. Otherwise ask one round with AskUserQuestion:
   - **Install what's missing?** (header "Setup"). The question lists each missing item and its fix.
     Options: *Install for me (Recommended)*, *I'll install them myself*.
   - If no model was found, also ask **Which transcription model?** (header "Model"). Offer the
     `models` from the doctor output: *large-v3-turbo-q5_0 (Recommended)*, about 574 MB, accurate
     in every language; *small*, about 466 MB; *base*, about 142 MB, the fastest and the least
     accurate.
4. On *Install for me*, run each fix in turn:
   - Package installs such as `brew install …`: run them as given. The user sees a permission
     prompt, which is expected.
   - A fix that needs `sudo`: ask the user to run it by typing `! <command>`, and wait.
   - The model: `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --download-model <name>`
   - Captions: `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --setup-python`. This makes a private
     Python environment in the cache. Nothing changes system-wide.

   On *I'll install them myself*, list the exact commands, ask the user to run
   `/ai-video-editor <video>` again when done, and stop.
5. Run the doctor again. Continue only once it reports ready. If an install failed, show its
   error and the fix, then stop.

## Phase 2: Take in

1. The recording is the path given above. If no path was given, look for video files in the
   current folder (`.mp4`, `.mov`, `.m4v`, `.mkv`, `.webm`). Ask which one with AskUserQuestion
   (header "Video", up to four files; "Other" takes any path).
2. `node ${CLAUDE_SKILL_DIR}/scripts/intake.mjs "VIDEO"`. It prints OUT (`out`), WORK (`work`), the
   duration, frame size, frame rate and `orientation`, and `previousSettings` if this video was
   edited before. In one line, tell the user what happens next and roughly how long transcribing
   takes: about a tenth of the recording's length on a recent computer.
3. Transcribe twice, then measure the sound:
   - `node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "VIDEO" --mode clean --aligned --out "WORK/clean.json"`.
     Its summary line names the language. That code is LANG from here on.
   - `node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "VIDEO" --mode verbatim --aligned --language LANG --out "WORK/verbatim.json"`
   - `node ${CLAUDE_SKILL_DIR}/scripts/acoustics.mjs "VIDEO" --out "WORK/acoustics.json"`
4. `node ${CLAUDE_SKILL_DIR}/scripts/overview.mjs "WORK" --language LANG`. It prints the
   transcript, the fillers heard, the long pauses, the dead air, and any words whose spelling
   should be confirmed (names, brands, terms). Keep these counts for the questions.
5. Find the face: `node ${CLAUDE_SKILL_DIR}/scripts/frames.mjs "VIDEO" --at <t1>,<t2>,<t3> --sheet "WORK/face.jpg" --width 640 --cols 3 --grid`.
   Use times at 20 %, 50 % and 80 % of the duration, then Read the image. Yellow lines mark every
   10 % of each frame, and the heavier red lines mark the halves. Read off, as fractions of the
   frame:
   - the point between the eyes;
   - the height of the mouth.

   Convert them to source pixels: FACE is `x,y` and MOUTH is a `y`. If the face moves by more than
   a tenth of the frame across the three frames, keep a note: reframed versions use one fixed crop.

## Phase 3: Ask

If intake printed `previousSettings`, ask first (header "Settings"): **Reuse the settings from the
last edit of this video?** Options: *Reuse them (Recommended)*, *Choose again*. On reuse, read that
file and go to phase 4.

Otherwise ask with AskUserQuestion. Put what phase 2 measured into the descriptions, so the user
chooses with this recording in mind (for example "4 found"). Mark the recommended option in each
question. An answer typed into "Other" is honoured as written.

**Round 1: the cut** (one call, four questions)

| Header | Question | Options |
|---|---|---|
| Cut | What should I cut out? (multiple choice) | *Filler sounds*: um, uh, hmm, including those hidden in a held vowel · *Long pauses*: shortened to the pace chosen next · *Retakes*: a sentence you started again; the earlier attempt goes · *Dead air*: the silence before you start and after you finish. Recommend all four. |
| Pace | How tight should the pacing be? | *Tight*: 0.3 s after a sentence, 0.2 s within one · *Natural*: 0.5 s and 0.35 s · *Jump-cut*: 0.15 s and 0.1 s. Recommend *Tight* under 3 minutes, *Natural* otherwise. |
| Zoom | Add punch-in zooms? | *Subtle punch-in (Recommended)*: every other segment 12 % closer, so each cut reads as a camera change · *No zoom* |
| Versions | Which versions do you want? (multiple choice) | *Landscape 16:9*: YouTube, LinkedIn · *Vertical 9:16*: Shorts, Reels, TikTok · *Square 1:1*: feeds · *Editor timeline*: an FCPXML file to fine-tune in DaVinci Resolve, Final Cut Pro or Premiere Pro. For a vertical recording, drop landscape and describe vertical as "as recorded". |

**Round 2: the finish** (one call, four questions)

| Header | Question | Options |
|---|---|---|
| Captions | How should the captions look? | *Word highlight (Recommended)*: two or three words at a time, the spoken word boxed in the accent colour · *Coloured word*: the spoken word turns the accent colour · *Simple*: plain white words · *No burned-in captions*: a subtitle file (.srt) is still made |
| On | Which versions get burned-in captions? (multiple choice) | The video versions chosen in round 1. Recommend vertical and square. |
| Accent | Accent colour for the captions? | *Purple #7C5CFF (Recommended)* · *Yellow #FFD400* · *Green #22C55E*. "Other" takes any hex colour. |
| Music | Background music? | *No music (Recommended)* · *Calm bed*: a soft pad made on this machine, 16 dB under your voice, dipping when you speak · *Upbeat bed*: the same, with drums. "Other" takes the path to your own music file. |

**Round 3: spellings.** Ask this only if the overview listed words to confirm (one question,
header "Spelling"): **Are these spelled right?** followed by the list. Options: *Yes, all correct*,
*Some are wrong*. For *Some are wrong*, "Other" takes corrections such as `Super base=Supabase`.

Then write `OUT/edit-settings.json` with the Write tool, in this shape:

```json
{
  "language": "en",
  "remove": ["fillers", "pauses", "retakes", "deadair"],
  "pace": "tight", "sentencePause": 0.3, "clausePause": 0.2,
  "punchIn": 1.12,
  "versions": ["landscape", "vertical", "square"],
  "editorTimeline": true,
  "captions": { "style": "highlight", "on": ["vertical", "square"], "accent": "#7C5CFF" },
  "music": { "kind": "none" },
  "glossary": ["Supabase"],
  "fixes": ["Super base=Supabase"],
  "face": { "x": 780, "y": 500, "mouth": 700 }
}
```

Field values:

- `punchIn`: 1 for no zoom.
- `captions.style`: `highlight`, `color`, `simple` or `none`.
- `music`: `{ "kind": "none" }`, `{ "kind": "generated", "mood": "calm" }` (or `"upbeat"`), or
  `{ "kind": "file", "path": "/absolute/path" }`.
- `glossary`: the confirmed spellings of names and terms.
- `fixes`: the corrections the user typed.

## Phase 4: Edit

From here, work to the end without the user. Tell them in one line that the edit has started and
that you'll report when every file is checked.

### 4.1 Plan the cut

```sh
node ${CLAUDE_SKILL_DIR}/scripts/plan-cuts.mjs "VIDEO" --clean "WORK/clean.json" --verbatim "WORK/verbatim.json" --acoustics "WORK/acoustics.json" --out "WORK/cuts.json" --expected "WORK/expected.txt" --remove <remove, comma-separated, or none> --sentence-pause <s> --clause-pause <s> --face <x,y> --mouth <y> --punch <punchIn> --language LANG
```

The planner prints each removal with its evidence. Each candidate it could not confirm is marked
`?`. When nothing is to be cut, `--remove none` keeps the whole recording: the steps after still
clean and level the sound, and make the versions.

### 4.2 Settle every `?`

Read [reference/cutting.md](reference/cutting.md). Settle each candidate by its procedure: look at
the span's acoustics, transcribe the span alone, decide, and record the decision with
`adjust-cuts.mjs`:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/adjust-cuts.mjs "WORK/cuts.json" --clean "WORK/clean.json" --expected "WORK/expected.txt" --remove <a:b> --why "<what the evidence showed>"
node ${CLAUDE_SKILL_DIR}/scripts/adjust-cuts.mjs "WORK/cuts.json" --clean "WORK/clean.json" --expected "WORK/expected.txt" --dismiss <a:b> --why "<what the evidence showed>"
```

When in doubt, keep: a leftover "uh" is a smaller flaw than a clipped word. Change the cut list
and the expected words only through `adjust-cuts.mjs`, never by hand. Continue once it reports
`0 probable left`.

### 4.3 Render the master and check it

```sh
node ${CLAUDE_SKILL_DIR}/scripts/cut.mjs "WORK/cuts.json" --out "WORK/master.cut.mov" --timeline "WORK/timeline.json"
node ${CLAUDE_SKILL_DIR}/scripts/loudness.mjs normalize "WORK/master.cut.mov" --out "WORK/master.mov"
node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs "WORK/master.mov" --expect-text "WORK/expected.txt" --timeline "WORK/timeline.json" --language LANG --sheet "WORK/master-frames.jpg" --out "WORK/check-master.json"
```

- Add `--glossary "<glossary, comma-separated>"` to `verify.mjs` when there is a glossary.
- Add `--fillers keep` when fillers are not being cut.
- Then Read `WORK/master-frames.jpg`. The picture should be whole: the face in frame through every
  zoom, and no black or frozen frames.

**If the check fails:** fix what it names, by the "When the check fails" section of the reference,
then run the three commands again. After four rounds, stop, carry on with the best master, and
state in the report what still fails.

**If a line says LISTEN:** it gives source times. Settle them like a `?` (4.2).

### 4.4 Music (skip when there is none)

1. Make the bed:
   - Generated:
     `node ${CLAUDE_SKILL_DIR}/scripts/synth.mjs --duration <measured, from WORK/timeline.json> --mood <calm|upbeat> --out "WORK/bed.wav"`
   - The user's own file: use it as the bed.
2. Mix it:
   `node ${CLAUDE_SKILL_DIR}/scripts/mix.mjs --voice "WORK/master.mov" --music "<bed>" --out "WORK/master-music.mov"`
3. Check it:
   `node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs "WORK/master-music.mov" --expect-text "WORK/expected.txt" --timeline "WORK/timeline.json" --language LANG --no-fillers --out "WORK/check-master-music.json"`
4. If the words fail here but passed on the master, the music masks the voice. Mix again with
   `--under 22`, then check again.

From here, MASTER is `WORK/master-music.mov` when there is music, and `WORK/master.mov` when there
is none.

### 4.5 Captions and subtitles

Always make the subtitle file, even with no burned-in captions. Transcribe the master without
music: the timing is the same, and the words come out cleaner.

```sh
node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "WORK/master.mov" --mode clean --aligned --language LANG --out "WORK/master-words.json"
node ${CLAUDE_SKILL_DIR}/scripts/captions.mjs "WORK/master-words.json" --out "WORK/captions.json" --srt "OUT/NAME.srt" --duration <measured> --language LANG
```

To both commands, add `--glossary "<glossary, comma-separated>"` when there is a glossary. To
`captions.mjs`, also add one `--fix "<heard=Right>"` per correction.

Read the preview it prints, and `WORK/captions.json` if unsure. Names must be spelled as the
glossary and the corrections say. For any other mishearing, add a `--fix` and run
`captions.mjs` again.

### 4.6 Make each version

| Version | Picture |
|---|---|
| landscape | MASTER |
| vertical | `node ${CLAUDE_SKILL_DIR}/scripts/reframe.mjs "MASTER" --out "WORK/vertical.mov" --aspect 9:16 --cuts "WORK/cuts.json"`, or MASTER itself when the recording is vertical |
| square | `node ${CLAUDE_SKILL_DIR}/scripts/reframe.mjs "MASTER" --out "WORK/square.mov" --aspect 1:1 --cuts "WORK/cuts.json"` |

**Captions.** When the version gets burned-in captions, burn them onto its picture:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/burn-captions.mjs "<picture>" --captions "WORK/captions.json" --cuts "WORK/cuts.json" --style <style> --accent "<accent>" --out "WORK/<version>-captioned.mov"
```

It places the captions clear of the mouth by itself, and prints where it put them.

**Export.** Export the version's last file:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/loudness.mjs normalize "<last file>" --out "OUT/NAME-<version>.mp4"
```

This sets the delivery loudness (−14 LUFS, true peak −1.5 dBTP) and writes AAC audio. The
picture is copied as it is.

**Editor timeline**, when chosen:

1. `node ${CLAUDE_SKILL_DIR}/scripts/fcpxml.mjs "WORK/cuts.json" --out "OUT/NAME.fcpxml"`.
2. If the doctor found xmllint, run `xmllint --noout "OUT/NAME.fcpxml"`.

The timeline points at the original recording and carries the cuts only.

### 4.7 Check every version

```sh
node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs "OUT/NAME-<version>.mp4" --expect-text "WORK/expected.txt" --timeline "WORK/timeline.json" --size <W>x<H> --language LANG --no-fillers --sheet "WORK/<version>-frames.jpg" --out "WORK/check-<version>.json"
```

`--size` is that version's frame size, from its reframe line or intake. Then Read each frame
sheet:

- The face stays in the frame.
- The captions are whole, readable, and never over the mouth.
- Nothing is cut off at the edges.

**If a check fails or a sheet shows a problem,** fix that step, then redo the version from there:
export again and check again. Allow two rounds per version.

Captions over the mouth can be moved:

- Burn again with `--y` 0.04 lower, down to 0.80 on vertical, 0.86 on square and 0.90 on
  landscape.
- If the mouth sits so low that no line clears it, `--y 0.18` puts the captions at the top.

### 4.8 Report and finish

```sh
node ${CLAUDE_SKILL_DIR}/scripts/report.mjs --dir "OUT" --note "<decision the user should know>" --tidy
```

Add one `--note` for each decision worth knowing. For example:

- a fixed crop on a speaker who moves;
- captions moved;
- music remixed quieter;
- a check that still fails, and why.

`--tidy` deletes the large intermediate renders from WORK once the report is written.

Then give the user a short summary:

- the output folder, and each file on its own line;
- how much shorter the edit is;
- whether every check passed, or exactly which did not;
- what only a person can judge: pacing, how natural the audio sounds, and the music.

Point them to `OUT/EDIT-REPORT.md` for the full record.
