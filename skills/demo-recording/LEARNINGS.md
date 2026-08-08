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
- **The `finish()` clock only pads; it never compresses** (this is THE cause of
  progressive desync). `finish(id)` does `waitForTimeout(max(0, clock + acc -
  now))`. If a step's on-screen actions take LONGER than its narration slot,
  `now` is already past the target, the wait is 0, and the video is behind — and
  it **stays** behind for every later step, so "it talks about the next section
  while still on the current one" gets worse toward the end. One slow step poisons
  the whole rest of the video.

### The deterministic fix — measure, then force the slot (automated)

Guessing narration lengths (or measuring with a `run_code` dry-run) is NOT enough:
the real recording adds cursor-move animation + real network latency, so actions
run **several seconds longer** than a bare dry-run suggests. Measure from a real
recording and let the audio pad to fit:

1. **`record-module.mjs` writes `build/<id>/sync-report.json`** — per step
   `{actionMs, slotMs, overrunMs}` (actual action wall-time vs allocated slot).
   `overrunMs > 0` == that step overran and desynced everything after it. It also
   prints `sync: N overrun step(s)`.
2. **`minSlot` per step** (`gen_audio.py` honours `step.minSlot`, merged from
   `minslots.json` by `emit-narration.mjs`). Setting `minSlot >= actionMs/1000 +
   ~0.7s buffer` forces the slot to be long enough, so `finish()` can always pad.
   The narration finishes and the video quietly completes the action in the
   remaining slot — no desync. `update-minslots.mjs` writes it straight from the
   report.
3. **Loop until clean:** record → `update-minslots.mjs` → record → repeat until
   `sync-report.json` shows **0 overruns**. Usually 2 passes. Deterministic; no
   eyeballing.

### Overrun causes actually hit (fix these at the source, don't just pad)

- **The UI login sat inside the first timed step.** The multi-second
  email→password→submit→wait-for-dashboard flow ran during the `intro` slot, so
  the intro narration (talking about the sidebar) played over the *login screen*
  and everything after was ~8s behind from frame one.
  **Fix:** log in **without the UI** — `page.request.post('/auth/login', …)`; the
  APIRequestContext shares the browser cookie jar, so the session cookie lands and
  `nav()` to the app is already authenticated. The intro then starts on the real
  page. (Keep the shared-secret / test-mode bypass in mind for Turnstile-gated
  forms.)
- **A modal-close click hung for 30s.** Adding a *charity preset* auto-closes its
  picker modal, so the follow-up "click the X" waited 30s for a button that no
  longer existed → one step ballooned to 34s and desynced the rest.
  **Fix:** close modals with `Escape` first, then an X click with a **short**
  timeout (`click({timeout:1200}).catch(()=>{})`); and know per-modal whether
  adding an item auto-closes it (don't close what already closed).
- **Debounced text fields clobber each other.** Filling name then headline saved
  only the headline (the debounced patch replaces the pending one). **Wait ~1.7s
  between debounced fields** so each flush lands (and it costs slot time — budget
  for it).
- **Collapsed panels / hidden controls.** The obituary templates panel is
  collapsed by default; the "Use this template" button isn't clickable until you
  toggle it open. Real content beats a template full of `[Name]` placeholders —
  type a short real bio into the editor instead.
- **Show the navigation.** Between editor steps, `window.scrollTo({top:0})` first
  so the step tabs are visible and the click is on screen (otherwise you're still
  scrolled down in the previous section when the next one is selected).
- **Verify at step boundaries**, not just mid-step: compute each step's audio
  midpoint from `timing.json` (`lead + Σslots`), `ffmpeg -ss <t> -frames:v 1`, and
  confirm the subtitle matches the screen. But `sync-report.json` (0 overruns) is
  the authoritative check — frames just confirm it.
- **Non-sync re-records are usually "the flow ran but the result looks wrong":**
  empty sections (fill every section, via presets where they exist), placeholder
  images (fetch real photos — `curl` may need the sandbox off), or a background
  that only breaks on the *rendered public page*. Always screenshot the final
  rendered artifact, not just the editor.

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
