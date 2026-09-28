---
name: ai-video-editor
description: Edits a raw talking-head recording into finished, social-ready videos on this machine, the way a skilled CapCut editor would. Cuts fillers, pauses, retakes and dead air; grades the picture face-first; adds motion graphics that land on the words, camera moves, transitions, animated keyword captions with emoji, text behind the speaker, B-roll, sound design and a music bed; reframes to vertical, square and landscape, following the speaker; makes a thumbnail and a cover; can cut a long video into Shorts. Checks and installs what it needs, asks the user's preferences once, then edits, reviews its own drafts and verifies every file without them. Use when someone wants a recorded video edited, made social-ready, captioned, or turned into Shorts, Reels or TikToks.
argument-hint: "[path to video]"
allowed-tools:
  - Bash(node --version)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
  - Bash(ffmpeg *)
  - Bash(ffprobe *)
  - Bash(xmllint *)
  - Read
  - Write
  - Edit
---

# AI video editor

Edit this recording: $ARGUMENTS

You turn one raw recording of someone talking to camera into finished videos that look made by a
skilled editor, in seven phases. Phases 1 to 3 involve the user; phases 4 to 7 run to the end
without them.

1. **Set up**: check the tools; install what is missing with the user's consent.
2. **Take in**: transcribe and measure the recording.
3. **Ask**: the user's preferences, in two rounds of questions (three at most).
4. **Cut**: remove fillers, pauses, retakes and dead air, and check the master.
5. **Finish**: grade, track, caption, score and design the edit; render drafts, critique them and
   fix them; render and check every version.
6. **Extras**: thumbnail, cover, editor timeline, Shorts.
7. **Report**.

Every step is a script in this skill's `scripts/` folder, run as
`node ${CLAUDE_SKILL_DIR}/scripts/<script> …`. Run each one exactly so: one command per call, with the
full path. That form runs without a permission prompt. Each script prints what it did. Read that
output before the next step, because it is the evidence the next decision rests on.

In the commands below:

- VIDEO is the recording's path.
- OUT is the output folder, and WORK its `work/` folder.
- NAME is the recording's file name without its extension.
- LANG is the language code.

Quote every path.

## Rules for the whole edit

- **The recording is only read.** Everything is written to OUT.
- **Nothing leaves the machine unless the user chose it.**
  - Transcription, analysis, cut-outs, rendering and generated music run locally. The engine's usage
    telemetry is switched off by the scripts.
  - Frames are never sent to any service.
  - Only what the user picked goes out:
    - the music library receives the mood words;
    - Pexels receives the search words;
    - a generation service receives its prompt, and only after the user agreed to its cost.
- **Measure, don't assume.** A cut is made because the acoustics and a transcription of that span
  show a filler. A file is done when its check passes. When a check can't pass, say so plainly.
- **Taste is a rule set.** [reference/craft.md](reference/craft.md) is the quality bar for every
  creative decision. Read it before phase 5.
- **From phase 4 on, never ask the user anything.** When a choice comes up, apply the rule given
  here, record why in a report note, and continue.
- **Long steps take minutes on a long recording.** This covers transcribing, rendering and checking.
  Give those commands a 10-minute timeout. For a recording over 20 minutes, run them in the
  background and wait for each one to finish.

## Phase 1: Set up

1. Run `node --version`. If Node is missing or older than 18, tell the user to install Node.js 22 or
   newer (`brew install node` on macOS, or <https://nodejs.org>), then stop.
2. Run `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --json`. Each entry in `checks` has `ok` and
   `required`. An entry that is not ok also has `fix`: the command that fixes it on this machine.
   - The required checks are what the cut needs.
   - "node for the finished looks", "rendering engine" and "person cut-out model" are what the
     finished looks need (every look but Minimal).
   - The music library and stock footage are optional services, offered in phase 3.
3. If anything required, or anything the finished looks need, is missing, ask one round with
   AskUserQuestion:
   - **Install what's missing?** (header "Setup"). The question lists each missing item and its fix.
     Options: *Install for me (Recommended)*, *I'll install them myself*.
   - If no model was found, also ask **Which transcription model?** (header "Model"). Options:
     - *large-v3-turbo-q5_0 (Recommended)*: about 574 MB, accurate in every language;
     - *small*: about 466 MB;
     - *base*: about 142 MB, the fastest and least accurate.
4. On *Install for me*, run each fix in turn:
   - **Package installs** such as `brew install …`: run them as given. The permission prompt is
     expected.
   - **A fix that needs `sudo`:** ask the user to run it by typing `! <command>`, and wait.
   - **The model:** `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --download-model <name>`
   - **Captions' Python:** `node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs --setup-python`
   - **The rendering engine:** `node ${CLAUDE_SKILL_DIR}/scripts/engine.mjs setup`. This installs
     HyperFrames, its browser and GSAP into the skill's cache; nothing changes system-wide.

   On *I'll install them myself*, list the exact commands, ask the user to run
   `/ai-video-editor <video>` again when done, and stop.
5. Run the doctor again. Continue once the required checks pass. If the engine could not be set up,
   continue with the Minimal look only, and say so in phase 3.

## Phase 2: Take in

1. **Find the recording.** It is the path given above. If none was given, look for video files in
   the current folder (`.mp4`, `.mov`, `.m4v`, `.mkv`, `.webm`) and ask which one (header "Video").
2. **Intake:** `node ${CLAUDE_SKILL_DIR}/scripts/intake.mjs "VIDEO"`. It prints:
   - OUT (`out`) and WORK (`work`);
   - the duration, frame size, frame rate and `orientation`;
   - `previousSettings`, if this video was edited before.

   Tell the user, in one line, what happens next.
3. **Transcribe twice, then measure the sound:**
   - `node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "VIDEO" --mode clean --aligned --out "WORK/clean.json"`.
     Its summary line names the language: that code is LANG.
   - `node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "VIDEO" --mode verbatim --aligned --language LANG --out "WORK/verbatim.json"`
   - `node ${CLAUDE_SKILL_DIR}/scripts/acoustics.mjs "VIDEO" --out "WORK/acoustics.json"`
4. **Overview:** `node ${CLAUDE_SKILL_DIR}/scripts/overview.mjs "WORK" --language LANG`. It prints:
   - the transcript;
   - the fillers, long pauses and dead air;
   - the words whose spelling should be confirmed.
5. **Find the face.** Run
   `node ${CLAUDE_SKILL_DIR}/scripts/frames.mjs "VIDEO" --at <t1>,<t2>,<t3> --sheet "WORK/face.jpg" --width 640 --cols 3 --grid`
   at 20 %, 50 % and 80 % of the duration, then Read the image. Yellow lines mark every 10 %, and
   red lines the halves. Read off, then convert to source pixels:
   - the point between the eyes: FACE, as `x,y`;
   - the height of the mouth: MOUTH, a `y`.

## Phase 3: Ask

If intake printed `previousSettings`, first ask (header "Settings"): **Reuse the settings from the
last edit of this video?** Options: *Reuse them (Recommended)*, *Choose again*. On reuse, read that
file and go to phase 4.

Otherwise ask with AskUserQuestion. Put what phase 2 measured into the descriptions, such as
"4 fillers found". Mark the recommended option. An answer typed into "Other" is honoured as written.

**Round 1: the edit** (four questions)

| Header | Question | Options |
|---|---|---|
| Look | How should the finished video look? | *Dynamic creator (Recommended)*: bold keyword captions with emoji, motion graphics on the words, snap zooms, transitions at topic changes, dense sound design, an upbeat bed · *Clean premium*: elegant captions, smooth push-ins, refined graphics, a calm bed · *Cinematic*: a film grade, slow moves, titles and lower thirds, ambient music · *Minimal*: the clean cut with simple captions, nothing added |
| Cut | What should I cut out? (multiple choice) | *Filler sounds* · *Long pauses* · *Retakes* · *Dead air*. Recommend all four. |
| Pace | How tight should the pacing be? | *Tight*: 0.3 s after a sentence, 0.2 s within · *Natural*: 0.5 s and 0.35 s · *Jump-cut*: 0.15 s and 0.1 s. Recommend *Tight* under 3 minutes, *Natural* otherwise. |
| Versions | Which versions do you want? (multiple choice) | *Vertical 9:16*: Shorts, Reels, TikTok · *Landscape 16:9*: YouTube, LinkedIn · *Square 1:1*: feeds · *Editor timeline*: FCPXML for DaVinci Resolve, Final Cut Pro or Premiere Pro. "Other" takes "4:5". For a vertical recording, drop landscape. |

**Round 2: the finish** (four questions; for Minimal, see below)

| Header | Question | Options |
|---|---|---|
| Music | Background music? | *Music library (Recommended)*: real tracks from HeyGen's free library, chosen by mood; needs a free HeyGen sign-in, and only mood words are sent · *Generated here*: made on this machine · *No music*. "Other" takes the path to your own track. |
| B-roll | What visuals besides you? (multiple choice) | *Motion graphics (Recommended)*: built on this machine · *Stock footage*: Pexels, free key; search words are sent · *AI-generated*: through a generation service connected to this session, with its cost shown first · *My own folder*: "Other" takes its path |
| Extras | Add these? (multiple choice) | *Burned-in captions (Recommended)* · *Text behind me*, when there is room above your head · *Thumbnail and cover* · *Call to action and progress bar* |
| Accent | Accent colour? | *The look's own (Recommended)* · *Purple #7C5CFF* · *Yellow #FFD400*. "Other" takes any hex colour. |

For **Minimal**, ask instead:

- *Captions*: word highlight, coloured word, simple, or none;
- *Captions on*: which versions;
- *Accent*;
- *Music*: generated, your own, or none.

**Round 3: only when needed** (one call)

- **Spelling**, if the overview listed words to confirm: **Are these spelled right?** Options: *Yes*,
  *Some are wrong*; "Other" takes corrections such as `Super base=Supabase`.
- **Shorts**, if the recording is over 3 minutes: **Also cut Shorts from the best moments?** Options:
  *3 Shorts (Recommended)*, *5 Shorts*, *No*.
- **Music sign-in**, if the library was chosen and the doctor said it is not signed in. Ask them to
  run `! heygen auth login --oauth`; if the `heygen` command is missing, run its install line from
  the doctor first. On refusal or failure, use generated music.
- **Pexels key**, if stock was chosen and no key is set. The user can paste a free key from
  pexels.com/api into "Other"; write it to the `config.json` the doctor named, as
  `{"pexelsKey": "…"}`, and never repeat it. Without a key, stock is dropped.

Then write `OUT/edit-settings.json` with the Write tool:

```json
{
  "language": "en", "look": "dynamic",
  "remove": ["fillers", "pauses", "retakes", "deadair"], "pace": "tight", "sentencePause": 0.3, "clausePause": 0.2,
  "versions": ["vertical", "landscape"], "editorTimeline": true,
  "music": { "kind": "library" }, "broll": ["graphics", "stock"], "brollFolder": null,
  "extras": ["captions", "textBehind", "thumbnail", "cta"], "accent": null,
  "glossary": [], "fixes": [], "shorts": 0,
  "face": { "x": 780, "y": 500, "mouth": 700 }
}
```

Field values:

- `music.kind`: `library`, `generated`, `file` (with `path`) or `none`.
- For Minimal, add `captions: { style, on, accent }`.

## Phase 4: Cut

Tell the user in one line that the edit has started and you will report when every file is checked.

1. **Plan the cut.** Use `--punch 1` for the finished looks (the camera moves come later) and
   `--punch 1.12` for Minimal. Use `--remove none` when nothing is to be cut.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/plan-cuts.mjs "VIDEO" --clean "WORK/clean.json" --verbatim "WORK/verbatim.json" --acoustics "WORK/acoustics.json" --out "WORK/cuts.json" --expected "WORK/expected.txt" --remove <list> --sentence-pause <s> --clause-pause <s> --face <x,y> --mouth <y> --punch <p> --language LANG
   ```

2. **Settle every `?`** by [reference/cutting.md](reference/cutting.md): look at the span's
   acoustics, transcribe the span alone, decide, and record the decision:

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/adjust-cuts.mjs "WORK/cuts.json" --clean "WORK/clean.json" --expected "WORK/expected.txt" --remove <a:b> --why "<evidence>"
   node ${CLAUDE_SKILL_DIR}/scripts/adjust-cuts.mjs "WORK/cuts.json" --clean "WORK/clean.json" --expected "WORK/expected.txt" --dismiss <a:b> --why "<evidence>"
   ```

   When in doubt, keep. Change the cut list only through `adjust-cuts.mjs`. Continue once it
   reports `0 probable left`.
3. **Render and check the master:**

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/cut.mjs "WORK/cuts.json" --out "WORK/master.cut.mov" --timeline "WORK/timeline.json"
   node ${CLAUDE_SKILL_DIR}/scripts/loudness.mjs normalize "WORK/master.cut.mov" --out "WORK/master.mov"
   node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs "WORK/master.mov" --expect-text "WORK/expected.txt" --timeline "WORK/timeline.json" --language LANG --sheet "WORK/master-frames.jpg" --out "WORK/check-master.json"
   ```

   - Add `--glossary "<comma-separated>"` when there is a glossary.
   - Add `--fillers keep` when fillers stay.
   - On FAILED, fix what it names by the reference's "When the check fails", and run the three
     commands again, four rounds at most.
   - A LISTEN line is settled like a `?`.
4. **Caption words:** transcribe the master for the words everything after is timed to.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "WORK/master.mov" --mode clean --aligned --language LANG --out "WORK/master-words.json"
   node ${CLAUDE_SKILL_DIR}/scripts/captions.mjs "WORK/master-words.json" --out "WORK/captions.json" --srt "OUT/NAME.srt" --duration <measured> --language LANG --max <n> --case <upper|spoken>
   ```

   - `--max` and `--case` come from the look: Dynamic 3 and `upper`, Clean 5 and `spoken`,
     Cinematic 6 and `spoken`, Minimal 3 and `upper`.
   - Add `--glossary` to both commands, and one `--fix "heard=Right"` per correction.
   - Read the preview; fix any other mishearing with another `--fix`.

## Phase 5: Finish

**Minimal** skips to "Minimal versions" below. Every other look continues here.

### 5.1 Grade, track and score

```sh
node ${CLAUDE_SKILL_DIR}/scripts/grade.mjs "WORK/master.mov" --out "WORK/aroll.mp4" --look <punchy|clean|film> --face <x,y> --json "WORK/grade.json"
node ${CLAUDE_SKILL_DIR}/scripts/track.mjs "WORK/aroll.mp4" --out "WORK/track.json" --face <x,y> --mouth <y> --at <the face sheet's middle time> --sheet "WORK/track.jpg"
node ${CLAUDE_SKILL_DIR}/scripts/music.mjs --duration <measured> --out "WORK/music.wav" --json "WORK/music.json" --work "WORK" --library "<the look's music intent>"
```

- The look picks the grade: Dynamic `punchy`, Clean `clean`, Cinematic `film`.
- Read `WORK/track.jpg`. The yellow box must sit on the face and the red line on the mouth; if they
  don't, read the face again and re-run the track.
- Music:
  - the intent words are the look's `music.intent` in `${CLAUDE_SKILL_DIR}/assets/styles/<look>.json`;
  - use `--file <path>` for the user's own track and `--generate <mood>` for generated music;
  - if the library exits with status 3, run `--generate` instead and note it in the report;
  - skip music when there is none.

### 5.2 Draft the plan

```sh
node ${CLAUDE_SKILL_DIR}/scripts/edit-plan.mjs draft --work "WORK" --out "WORK/edit.json" --style <dynamic|clean|cinematic> --formats <versions>
```

The draft places the mechanical layer:

- a camera change at every cut, pushes and snap zooms;
- topic transitions;
- caption emphasis and emoji;
- the call to action and progress bar.

It lists **graphic opportunities** in `notes`. Adjust the draft to the user's extras:

- no burned-in captions: set `captions.hide` to `[[0, duration]]`;
- no call to action: set `cta` and `progress` to null;
- a chosen accent: set `brand.accent`.

### 5.3 The creative pass

This is where the edit becomes memorable. Read [reference/craft.md](reference/craft.md),
[reference/graphics.md](reference/graphics.md) and [reference/composition.md](reference/composition.md).
Then edit `WORK/edit.json` with the Edit tool:

1. **Hook.** Write `hook.title` from what the speaker promises, in two lines joined by `|`. If
   *Text behind me* was chosen, put a short word behind the head on the first strong word:
   `textBehind` on the first beat. The composer drops it, with a warning, if there is no room, and
   shows the hook title instead.
2. **Sections.** Check `sections` are real topic changes, and move or remove them.
3. **Graphics.** Work through the opportunities and the transcript. Give a graphic to each beat
   whose words carry something to show, within the look's coverage.
   - Choose the layout and the component, and set every item's `word`.
   - Write **custom scenes** for the key beats (`scenes/<beat>.html`): at least one graphic beat in
     three, and most of them in a Short.
   - Split a beat where one idea ends and the next starts, keeping the beats tiled.
4. **B-roll**, from the user's sources:
   - their folder: `node ${CLAUDE_SKILL_DIR}/scripts/broll.mjs folder "<dir>" --sheet "WORK/broll-folder.jpg"`,
     then choose by looking;
   - stock, for concrete nouns only:
     `node ${CLAUDE_SKILL_DIR}/scripts/broll.mjs pexels --query "<concrete words>" --out "WORK/broll/<beat>.mp4" --orientation <portrait|landscape>`;
   - generated: a generation tool connected to this session, only if the user chose it; save the
     file under `WORK/broll/`.

   Point the beat's `broll` at the file, on a `cutaway` or `pip` layout.
5. **Emphasis and emoji.** Remove weak emphasised words and any emoji that doesn't depict its word.
6. **Check:** `node ${CLAUDE_SKILL_DIR}/scripts/edit-plan.mjs check "WORK/edit.json"`. Fix every
   error, and every craft warning that a change can fix.
7. **Cut-outs**, if any beat has `textBehind`:
   `node ${CLAUDE_SKILL_DIR}/scripts/cutouts.mjs "WORK/edit.json"`.

### 5.4 Draft, critique, fix

Render a draft of the first version, then review it by [reference/review.md](reference/review.md):

```sh
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs "WORK/edit.json" --out-dir "WORK/drafts" --name NAME --formats <first version> --draft
node ${CLAUDE_SKILL_DIR}/scripts/sheets.mjs "WORK/render/<first version>-draft.mp4" --plan "WORK/edit.json" --out "WORK/review-<n>.jpg"
```

- Read the sheet and go through the checklist row by row.
- Fix `edit.json` and the scenes, check the plan again, render again.
- Stop after three rounds, when nothing on the checklist fails.
- The render's warnings (captions held at the safe line, text-behind without room) are findings too.

### 5.5 Final render and checks

```sh
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs "WORK/edit.json" --out-dir "OUT" --name NAME
```

It renders every version in the plan and cues the sound effects. It also mixes the voice, music and
effects. It prints the voice-over-music margin: if the worst tenth is under 12 dB, render again with
`--under <the look's value + 4>`. Then check each file:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs "OUT/NAME-<version>.mp4" --expect-text "WORK/expected.txt" --timeline "WORK/timeline.json" --size <W>x<H> --language LANG --no-fillers --sheet "WORK/<version>-frames.jpg" --out "WORK/check-<version>.json"
```

| Version | Size |
|---|---|
| vertical | 1080x1920 |
| portrait | 1080x1350 |
| square | 1080x1080 |
| landscape | 1920x1080 |

Read every frame sheet. A failure goes back to its step. Allow two rounds per version.

### Minimal versions

This path is the clean cut with Pillow captions; it needs no engine.

1. **Picture.** The landscape picture is `WORK/master.mov` (or the vertical one, for a vertical
   recording). Make the others with
   `node ${CLAUDE_SKILL_DIR}/scripts/reframe.mjs "WORK/master.mov" --out "WORK/<version>.mov" --aspect <9:16|1:1|4:5> --cuts "WORK/cuts.json"`.
2. **Captions.** Burn them where chosen:
   `node ${CLAUDE_SKILL_DIR}/scripts/burn-captions.mjs "<picture>" --captions "WORK/captions.json" --cuts "WORK/cuts.json" --style <style> --accent "<accent>" --out "WORK/<version>-captioned.mov"`.
3. **Music.** With music:
   - `node ${CLAUDE_SKILL_DIR}/scripts/music.mjs … --generate calm` (or `--file`);
   - `node ${CLAUDE_SKILL_DIR}/scripts/mix.mjs --voice "<file>" --music "WORK/music.wav" --out "<file>-music.mov"`.
4. **Export** each:
   `node ${CLAUDE_SKILL_DIR}/scripts/loudness.mjs normalize "<last file>" --out "OUT/NAME-<version>.mp4"`.
5. **Check** each version as in 5.5.

## Phase 6: Extras

- **Thumbnail and cover**, if chosen:
  1. `node ${CLAUDE_SKILL_DIR}/scripts/thumbnail.mjs candidates "WORK/aroll.mp4" --words "WORK/master-words.json" --out "WORK/thumb-candidates.jpg"`
     (use `WORK/master.mov` for Minimal).
  2. Read the sheet and pick the most expressive frame: eyes open, mouth mid-word.
  3. Write a title of 2 to 5 words.
  4. `node ${CLAUDE_SKILL_DIR}/scripts/thumbnail.mjs make "WORK/aroll.mp4" --at <t> --title "<A|B>" --style <look> --out "OUT/NAME-thumbnail.jpg"`
  5. The same with `--kind cover --out "OUT/NAME-cover.jpg"`.
  6. Read both.
- **Editor timeline**, if chosen:
  `node ${CLAUDE_SKILL_DIR}/scripts/fcpxml.mjs "WORK/cuts.json" --out "OUT/NAME.fcpxml"`, then
  `xmllint --noout "OUT/NAME.fcpxml"` where xmllint is present. It carries the cuts only.
- **Shorts**, if chosen: follow [reference/shorts.md](reference/shorts.md).

## Phase 7: Report

```sh
node ${CLAUDE_SKILL_DIR}/scripts/report.mjs --dir "OUT" --note "<decision the user should know>" --tidy
```

Add one `--note` per decision worth knowing:

- the hook you wrote, and the custom scenes;
- a fallback: generated music instead of the library, stock dropped;
- captions held at the safe line;
- a check that still fails, and why.

`--tidy` deletes the large intermediate renders once the report is written.

Then give the user a short summary:

- the output folder, and each file on its own line;
- how much shorter the edit is;
- whether every check passed, or exactly which did not;
- what only a person can judge: the pacing, the feel of the graphics and transitions, and the music.

Point them to `OUT/EDIT-REPORT.md`.
