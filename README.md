# AI Demo Recorder — Claude Code plugin

Record narrated, subtitled product demo videos of the **live** app from a
**versioned script**: a `.demo.yml` that reads like a user story, a visible
interactive cursor, neural TTS narration that the pacing is built around,
one-line subtitles that pass by phrase-by-phrase, and one command to publish to
your own S3 bucket. Built on Playwright + Kokoro TTS + ffmpeg.

This repo is a self-contained Claude Code **plugin** you can enable/disable.

## What's inside

```
.claude-plugin/
  plugin.json          # plugin manifest
  marketplace.json     # local marketplace (lists this plugin)
skills/
  product-demo/
    SKILL.md           # the skill Claude follows
    archetypes/        # five demo shapes ready to copy
    references/        # storytelling, pacing, determinism, storage, lessons
    templates/
      runner/          # the engine (copied into <project>/demos per project)
```

## Install (as a plugin you can toggle)

From Claude Code, add this repo as a marketplace and install the plugin:

```
/plugin marketplace add fedef098/ai-demos          # or a local path to this repo
/plugin install demo-recording@ai-demos
```

Enable / disable it anytime:

```
/plugin enable  demo-recording@ai-demos
/plugin disable demo-recording@ai-demos
/plugin list
```

When enabled, ask Claude to "record a demo of \<feature\>" and it will follow
`SKILL.md`.

## Use (per project)

The engine is vendored into the target project so each app pins its own
Playwright:

```bash
cd <project>
TPL="${CLAUDE_PLUGIN_ROOT}/skills/product-demo/templates"
mkdir -p demos/.runner demos/seeds
cp -r "$TPL/runner/"* demos/.runner/
cp "$TPL/demos.README.md"           demos/README.md
cp "$TPL/selectors.example.yml"     demos/selectors.yml
cp "$TPL/capabilities.example.yml"  demos/capabilities.yml
cat "$TPL/demos.gitignore" >> .gitignore
chmod +x demos/.runner/demo.sh demos/.runner/setup-voice.sh

npm audit && npm i -D yaml @playwright/test
npx playwright install ffmpeg        # NOT the system ffmpeg — without it there is simply no video
./demos/.runner/setup-voice.sh       # one-time Kokoro venv, outside the repo

DEMO_BASE_URL=https://qa.example.com ./demos/.runner/demo.sh <slug> --check   # ~20s, no recording
DEMO_BASE_URL=https://qa.example.com ./demos/.runner/demo.sh <slug>           # record + publish
./demos/.runner/demo.sh --catalog                                            # what is not covered yet
```

## How it works

**The script is the artifact.** `<slug>.demo.yml` holds the story in plain
language — who the person is, what they get, what each scene proves — and carries
**no selectors**; those live once in `selectors.yml`. The story is reviewed in the
PR by whoever knows the product; the selectors are fixed by a dev in 20 seconds
when the UI moves.

**Narration drives the pacing, in three passes.** `narrate.mjs` synthesizes every
line and measures it *before* recording, `record.mjs` gives each beat at least
that long, and `build.mjs` drops each clip at its clapperboard-calibrated
timestamp. Synthesizing after the fact is the obvious trap: the voice does not
fit the hole that is left, and fixing it means either stretching the audio or
re-recording until it does. In this order there is **no sync loop**.

**A beat lasts `max(reading time, action time, narration time)`** and waits for a
*declared consequence* (`awaits:`), never for `networkidle` — which never fires in
an app with websockets and freezes the video on one screen for the whole timeout.

**Coverage is visible.** `capabilities.yml` lists what the product does, each
scene declares what it `covers:`, and `demo.sh --catalog` crosses that with what
is actually recorded to tell you **what you have nothing to show for**, by
priority. It also flags demos whose script changed after the recording.

**No binaries in git.** Git does not deltify H.264, so every re-recording would
leave a permanent blob. The mp4 goes to S3 under a content-addressed key and
`run.json` keeps the URL; with no bucket configured the run stays local and
marked `pending`, and can be published later without re-recording.

Failures that cost a re-recording each — debounced fields clobbering each other,
a streaming assistant that outlasts its beat, seeds that accumulate across takes
— are written down in `references/lessons.md`.

## Requirements

`node`, `python3`, `ffmpeg`/`ffprobe`, `espeak-ng` (system), Playwright's Chromium
**and** its separate ffmpeg helper. Records against an already-deployed app —
never a local dev server.
