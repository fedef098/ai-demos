# AI Demo Recorder — Claude Code plugin

Record narrated, subtitled product demo videos of the **live** app from a
**versioned script**: a `.demo.yml` that reads like a user story, a visible
interactive cursor, neural TTS narration that the pacing is built around,
one-line subtitles that pass by phrase-by-phrase, and one command to publish to
your own S3 bucket. Built on Playwright + Kokoro TTS + ffmpeg.

This repo is a self-contained Claude Code **plugin** you can enable/disable — and
it is also where **the demo scripts of every product** live, one workspace per
product under `demos/`. They do not live in the product's own repo: the tool
belongs to the company, and a product is one consumer of it. Recording never
needs the app's checkout anyway — it runs against a deployed URL and the seed
talks HTTP.

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
      runner/          # the engine — ONE copy, shared by every workspace
demos/
  <product>/           # one workspace per product
    README.md          # which environment and which account this product records against
    .env.example       # the NAMES of that product's variables — never the values
    <slug>.demo.yml    # the story
    selectors.yml      # named target → selector, for that product
    capabilities.yml   # what that product does, for the coverage catalog
    seeds/<slug>.mjs   # idempotent setup, over HTTP
    assets/            # images a script feeds the product (inputs, not output)
    <slug>/run.json    # duration, chapters, commit, sha256 and public video URL
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

## Use

One-time, in this repo:

```bash
npm audit && npm ci
npx playwright install ffmpeg      # NOT the system ffmpeg — without it there is simply no video
skills/product-demo/templates/runner/setup-voice.sh   # one-time Kokoro venv, outside the repo

npm run doctor                     # did all of that land? needs no script and no URL
```

Then work on a product's workspace. `DEMOS_DIR` is what points the single engine
at it, and **each workspace's README says which URL and which account it records
against** — those differ per product and are not guessable:

```bash
R=skills/product-demo/templates/runner

DEMOS_DIR=demos/wig DEMO_BASE_URL=https://qa.example.com "$R/demo.sh" <slug> --check  # ~20s, no recording
DEMOS_DIR=demos/wig DEMO_BASE_URL=https://qa.example.com "$R/demo.sh" <slug>          # record + publish
DEMOS_DIR=demos/wig "$R/demo.sh" --catalog                                           # what is not covered yet
DEMOS_DIR=demos/wig "$R/demo.sh" --page                                              # rebuild the HTML only
```

A new product is a new directory — nothing to install:

```bash
TPL=skills/product-demo/templates
mkdir -p demos/<product>/seeds demos/<product>/assets
cp "$TPL/selectors.example.yml"    demos/<product>/selectors.yml
cp "$TPL/capabilities.example.yml" demos/<product>/capabilities.yml
```

**Why not vendor the engine into each project.** It used to be copied into
`<project>/demos/.runner/` — 18 files per app, kept in sync by hand, which is the
mirror antipattern: it drifts. Nothing about recording needs the app's source
tree, so there is no reason for the copies to exist. `demo.sh` still defaults to
"the workspace is my parent directory", so an old vendored install keeps working
untouched; `DEMOS_DIR` is what lets one engine serve many workspaces.

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
