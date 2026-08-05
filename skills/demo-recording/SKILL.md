---
name: demo-recording
description: >
  Record narrated, per-feature product demo videos with a visible interactive
  cursor and burned-in subtitles (Playwright + Kokoro TTS + ffmpeg). Analyze what
  the app does, confirm scope, drive the LIVE deployed app with real data, keep
  narration in sync with the action, and publish to the project's own storage.
  Use when asked to create/record demos, walkthrough videos, or feature showcases.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node *), Bash(python3 *), Bash(npx *), Bash(ffmpeg *), Bash(ffprobe *), Bash(bash *), Bash(curl *), Bash(./*.sh *), Bash(kubectl *), Bash(sudo *), Bash(docker *), Bash(mc *), Bash(aws *), Bash(git *), Bash(free *), Bash(openssl *), Bash(rsync *)
argument-hint: [feature or module to demo]
---

# Demo Recording — narrated product demos

Produce narrated MP4s from the **live** app with a visible cursor, burned-in
subtitles, and narration synced to the action. The packaged toolkit lives at
**`${CLAUDE_PLUGIN_ROOT}/skills/demo-recording/toolkit`** — copy it into the
target project's `demos/` and adapt `modules.mjs` + `.env`.

> **Read `${CLAUDE_PLUGIN_ROOT}/skills/demo-recording/LEARNINGS.md` first.** It
> lists the mistakes that ruin a demo (giant subtitles, scroll racing ahead of
> the voice, double logins, a live-LLM answering out of sync, an unquoted `.env`
> breaking login, flaky uploads) and the fix for each. Most are now automated in
> the toolkit; the rest are authoring rules below.

## RAM / shared-host safety (read first)

The recorder runs against the **already-deployed** app — never start
`next dev`/`next build` to record. The pipeline still peaks ~1–2 GB (headless
Chromium + ffmpeg + Kokoro). **Check `free -h`; if < 5 GB available, don't start.**
Keep `workers: 1`; record one module at a time.

## Non-negotiables (every demo)

- **Narration is Kokoro TTS**, one voice throughout. Spanish = `ef_dora`/lang `e`;
  English = `af_heart`/lang `a`. Never ship a silent demo.
- **Visible cursor + visible clicks.** The overlay (`CURSOR_INIT`) is injected and
  driven with `page.mouse.move` before every action; every click shows a ripple.
- **ONE login per video.** A single continuous module logs in once and `nav()`s —
  don't concat separately-recorded modules (each re-logs in).
- **Sync the motion to the words.** Every scroll is **its own narration step**
  ("scrolling down…"); per-step actions must fit inside that step's narration
  (the `finish()` clock only pads, never compresses).
- **If the data is seeded/mock, say so up front** and point at the real-data
  toggle. Turn seed data on first so charts/funnels aren't empty.
- **Subtitles small and passing by** — automated: short one-line phrases
  (`DEMO_SUB_MAXCHARS`) at a small font (`DEMO_SUB_FONTSIZE`), burned in
  (`DEMO_BURN_SUBS=1`).
- **Live AI / async responses: pipeline + long narration** (see LEARNINGS.md).
- **Verify before delivering.** Extract frames at step boundaries with `ffmpeg
  -ss <t> -frames:v 1` and confirm cursor, screen, and subtitle all match.
- **CRUD apps:** create AND modify real data, fill ALL fields, exercise an
  RBAC-restricted role.

## Golden flow

1. **Analyze** routes, roles, and what each screen does. Don't demo what you
   haven't verified. Find the login selectors and any auth/mock-data toggles.
2. **Confirm scope** with the user: which features, which order, English/Spanish,
   emphasis. Never assume.
3. **Set up** (per project): copy the toolkit, fill `.env`, define `modules.mjs`.
4. **Smoke-test** login + a couple of nav/selectors with a tiny script *inside the
   project dir* (ESM won't resolve Playwright via NODE_PATH) before the slow
   TTS+record pipeline.
5. **Record → verify → fix.** `./build-modules.sh <id>`; check frames; iterate.
6. **Publish** to the project's own storage; hand back the URLs.

## The toolkit (`toolkit/`)

| File | What |
|---|---|
| `config.mjs` | Env-driven config: target, login selectors, voice, fixed viewport/dsf/fps/crf, subtitles. |
| `lib-driver.mjs` | Playwright driver + injected gold cursor + click ripple: `login/logout/nav/clickLoc/typeInto/hover/pickSelect/pressVisible`. |
| `modules.example.mjs` | **Copy to `modules.mjs`.** Template encoding the three sync patterns: single-login continuous module, scroll-as-its-own-step, and pipelined live-assistant Q&A. |
| `gen_audio.py` | Kokoro TTS → `narration.wav` + `timing.json` (per-step text for subtitles). |
| `emit-narration.mjs` / `record-module.mjs` | Emit narration JSON; record the scene from the live URL → `raw.webm` + `offset.json`. |
| `make-subtitles.mjs` | `timing.json` → `.srt`/`.vtt`, **re-segmented into short one-line phrases** (`DEMO_SUB_MAXCHARS`) spread across each step. |
| `build-modules.sh` | Orchestrates emit → audio → record → subtitles → ffmpeg merge (small burned-in subs via `DEMO_SUB_FONTSIZE`). |
| `publish.sh` | Upload each MP4 (+ `.vtt`) to the project's MinIO/S3, public, hashed name, + `demos/index.json` manifest. **Backend A** = in-cluster `kubectl exec` + `mc pipe` (reliable); **B** = port-forward + docker (fallback). |
| `setup-tts.sh` + `requirements.txt` | Reproducible Kokoro venv. |
| `flows/` | `playwright.config` + `support/actions` + example spec templates. |

## Prerequisites (not bundled — set up once per machine)

The plugin ships the skill + scripts, but recording needs these locally first:

- **System tools:** `node`, `python3`, `ffmpeg` + `ffprobe`, `espeak-ng`. On the
  target project also `npm i` + `npx playwright install chromium`.
- **Kokoro TTS venv:** `./setup-tts.sh` (downloads torch + the model, heavy;
  gitignored, so recreated per machine). It checks for `espeak-ng`/`ffmpeg` first.
- **Per-target config:** the copied `.env` (target URL, creds, login selectors,
  storage) and `modules.mjs` (your scenes). Nothing works until these are filled.

Installing the plugin does NOT make it turnkey — it makes Claude able to *do* the
setup and recording. Walk the user through anything missing above.

## Quickstart (per project)

```bash
cp -r "${CLAUDE_PLUGIN_ROOT}/skills/demo-recording/toolkit" <project>/demos && cd <project>/demos
cp .env.example .env            # fill DEMO_URL/PASS, login selectors, S3_*/MINIO_POD
cp modules.example.mjs modules.mjs   # define your modules (start from the template)
./setup-tts.sh                  # one-time Kokoro venv (check `free -h` first)
npm i && npx playwright install chromium
# smoke-test login+nav in a tiny script here, THEN:
./build-modules.sh walkthrough  # record one module
./publish.sh                    # upload + manifest
```

## Recording conventions (quick)

- **One phrase, one step.** Fine-grained steps = easy sync. A step that both
  "describes the top" and "scrolls down" will desync — split it.
- **Cursor**: drive with `page.mouse.move` before every click; click key controls
  via the cursor, bulk-fill secondary fields with `page.fill`.
- **Selectors**: forms by `#id` or `[type=…]`; Radix selects need
  click-trigger-then-option (`pickSelect`) — flaky, prefer valid defaults; a slow
  select can overrun its step, so keep it optional.
- **Publish** sets `Content-Type` so videos play inline; keep intermediates
  (`*.wav`, `*.webm`, `build/`, `modules/`) gitignored.

## docs/flows — core business flows (CRUD apps)

Persist each core flow under `docs/flows/` (one `.md` per feature + a `.spec.ts`
next to it; shared helpers in `support/actions.ts`). The flow doc is the source
of truth for both the demo and the manual test. Writing the spec first surfaces
real backend bugs before recording — fix the app, not the demo.
