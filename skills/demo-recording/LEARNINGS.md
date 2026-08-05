# Demo-recording — hard-won lessons

Concrete failures hit while producing real demos, and the fix for each. Most are
now automated in the toolkit; the rest are authoring rules the model must follow.
Read this before recording — it's cheaper than rediscovering them.

## Subtitles

- **One cue per narration step is unreadable.** A whole step's text (2–4
  sentences) becomes a 4+ line block that covers the UI for ~20s.
  **Fix (automated):** `make-subtitles.mjs` re-segments each step into short
  one-line phrases (`DEMO_SUB_MAXCHARS`, default 46) and spreads their timings
  across the step in proportion to length, so subtitles *pass by* phrase-by-phrase
  in sync with the voice. Set `DEMO_SUB_MAXCHARS=0` to disable.
- **Burned-in font was too big.** `FontSize=18` dominated the frame.
  **Fix (automated):** `DEMO_SUB_FONTSIZE` (default **12**) + `MarginV=16` in the
  ffmpeg `subtitles` filter — one small phrase sits under the UI.
- You don't need to re-record to fix subtitles: `raw.webm` + `narration.wav` are
  kept in `build/<id>/`, so just re-run `make-subtitles.mjs` and the ffmpeg merge.

## Sync: scroll / actions vs narration

- **Scroll that races ahead of the words looks broken.** If a step's narration
  says "at the top you can see…" and the same step scrolls down, the page has
  already moved before the sentence finishes.
  **Fix (rule):** make each scroll **its own step** whose narration literally
  says "scrolling down…". `finish()` guarantees the previous step is fully spoken
  before the scroll step starts.
- **The `finish()` clock only pads; it never compresses.** If a step's actions
  take longer than its narration, the video falls behind the audio for the *rest*
  of the module. Keep per-step actions short, or lengthen the narration.
- **Verify at step boundaries**, not just mid-step: `ffmpeg -ss <t> -i out.mp4
  -frames:v 1 f.png` at a few timestamps and actually look — confirm the cursor
  is visible, the right screen is shown, and the subtitle matches what's on it.

## Live AI assistant (or any async response) in a demo

- **Responses are slower than one narration line**, and chat inputs are usually
  **disabled while a response streams** (so you can't pre-send several ahead).
  Naively "type, wait, next" desyncs: by the time answer N renders, narration is
  already on N+1.
  **Fix (rule, two parts):**
  1. **Pipeline by one:** send each question at the END of the *previous* step
     (`sendQuestion` returns the response promise); `await` it at the start of the
     step that describes it — so the answer is on screen when its narration plays.
  2. **Long narration:** give each assistant step ~15s of narration so it covers
     the response time even when the model is slow.
- Detect completion reliably with `page.waitForResponse(url includes /api/…)`,
  not a fixed sleep.

## Login / session

- **ONE login per video.** Don't split a walkthrough into modules and concat —
  each recording logs in again, so the final video logs in N times. Use a single
  continuous module that logs in once and `nav()`s everywhere.
- The recorder warms the login page and measures `loadTime`; the audio is delayed
  by that (`adelay`) so narration lines up with the first on-screen action.

## `.env` gotcha (silent, painful)

- `.env` is **sourced as shell**. `DEMO_SUBMIT_TEXT=Sign in` (unquoted space)
  makes bash run `in` as a command and **leaves the var unset** → the driver
  falls back to a default submit label → the login button is never clicked →
  every page bounces back to `/login` and the whole video is the login screen.
  **Fix:** single-quote any value with spaces / shell-special chars in `.env`
  (`DEMO_SUBMIT_TEXT='Sign in'`). `.env.example` now quotes them and warns.

## Publishing to in-cluster MinIO

- `kubectl port-forward` in the background is **flaky and gets killed** by
  sandboxes; timing races give "connection refused".
- `kubectl cp` **fails when the MinIO image has no `tar`** ("exec: tar not found").
- **Fix (automated, backend A):** stream the file straight into the pod's `mc`
  with `kubectl exec -i <pod> -- mc pipe --attr "Content-Type=…" me/<bucket>/<key>
  < file` (alias `me` set once inside the pod). Reliable, no port-forward, no tar.
  `publish.sh` uses this when `MINIO_POD`/`MINIO_NS` are set; the docker+port-forward
  path remains as a fallback.
- Always set the object's `Content-Type` (e.g. `video/mp4`) so it plays inline
  in the browser instead of downloading.

## Data & cleanup

- Turn on demo/seed data first so charts and funnels aren't empty — and say so in
  the narration (see the mock-data disclaimer above).
- Actions that persist (e.g. "create a record/funnel live") **accumulate across
  re-records**. Delete the leftovers before the final take so the UI isn't
  cluttered with duplicates from earlier attempts.

## Determinism / RAM

- Viewport, dsf, fps, crf are fixed in `config.mjs`; don't randomize per run.
- Record against the **already-deployed** app; never `next dev`/`next build`
  locally to record. Check `free -h` first (headless Chromium + ffmpeg + Kokoro
  peak ~1–2 GB); record one module at a time.
