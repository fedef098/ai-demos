# AI Demo Recorder — Claude Code plugin

Record narrated, subtitled product demo videos of the **live** app: a visible
interactive cursor, Kokoro TTS narration synced to the action, small subtitles
that pass by phrase-by-phrase, and one-command publish to your own object
storage. Built on Playwright + Kokoro TTS + ffmpeg.

This repo is a self-contained Claude Code **plugin** you can enable/disable.

## What's inside

```
.claude-plugin/
  plugin.json          # plugin manifest
  marketplace.json     # local marketplace (lists this plugin)
skills/
  demo-recording/
    SKILL.md           # the skill Claude follows
    LEARNINGS.md       # hard-won lessons (read this)
    toolkit/           # the scripts (copied into <project>/demos per project)
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

When enabled, ask Claude to "record a demo of <feature>" (or invoke the
`demo-recording` skill) and it will follow `SKILL.md`.

## Use (per project)

The toolkit is copied into the target project so each app keeps its own config:

```bash
cp -r "${CLAUDE_PLUGIN_ROOT}/skills/demo-recording/toolkit" <project>/demos && cd <project>/demos
cp .env.example .env                 # DEMO_URL/PASS, login selectors, storage
cp modules.example.mjs modules.mjs   # your modules (start from the template)
./setup-tts.sh                       # one-time Kokoro venv (check `free -h` first)
npm i && npx playwright install chromium
./build-modules.sh <module-id>       # record
./publish.sh                         # upload + manifest
```

## What it gets right (so you don't rediscover it)

See `skills/demo-recording/LEARNINGS.md`. Highlights, mostly automated:

- **Subtitles** re-segmented into short one-line phrases at a small font — no more
  4-line blocks covering the UI.
- **Narration synced to motion** — scrolls are their own steps so they never race
  ahead of the words.
- **One login** per continuous walkthrough.
- **Live AI assistants** handled with pipelined questions + long narration (chat
  inputs disable while a response streams).
- **Reliable publish** to in-cluster MinIO via `kubectl exec` + `mc pipe` (no
  flaky port-forward, no `tar` dependency).
- **`.env` quoting** guardrail (an unquoted space silently breaks login).

## Requirements

`node`, `python3`, `ffmpeg`/`ffprobe`, `espeak-ng` (system), and Playwright's
Chromium. Records against an already-deployed app — never a local dev server.
