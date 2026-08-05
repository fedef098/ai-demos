#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"

# Builds one narrated MP4 per module -> modules/<id>.mp4
# Usage: build-modules.sh [id1 id2 ...]   (default: all modules in modules.mjs)
#
# Env (see .env.example): DEMO_URL, DEMO_PASS, DEMO_VOICE/LANG, DEMO_W/H/FPS/CRF,
#   DEMO_SUBS (1=emit subs, default on), DEMO_BURN_SUBS (1=burn subs into video),
#   DEMO_SUB_FONTSIZE (burned-in subtitle size, default 12 — small so it doesn't
#   cover the UI), DEMO_SUB_MAXCHARS (phrase length for resegmentation, default 46),
#   KOKORO_VENV (path to the Kokoro venv created by setup-tts.sh).
#
# NOTE: .env is sourced as shell — values with spaces MUST be quoted in .env
#   (e.g. DEMO_SUBMIT_TEXT='Sign in'). An unquoted space silently drops the var
#   and the demo breaks (e.g. login never submits). See .env.example.
[ -f .env ] && set -a && . ./.env && set +a

KOKORO_VENV="${KOKORO_VENV:-./.kokoro-venv}"
PY="$KOKORO_VENV/bin/python"
[ -x "$PY" ] || { echo "Kokoro venv not found at $KOKORO_VENV — run ./setup-tts.sh first"; exit 1; }

FPS="${DEMO_FPS:-30}"
CRF="${DEMO_CRF:-22}"
EMIT_SUBS="${DEMO_SUBS:-1}"
BURN_SUBS="${DEMO_BURN_SUBS:-0}"
SUB_FONTSIZE="${DEMO_SUB_FONTSIZE:-12}"

ALL=$(node -e 'import("./modules.mjs").then(m=>console.log(m.MODULES.map(x=>x.id).join(" ")))')
IDS="${*:-$ALL}"
mkdir -p modules

for id in $IDS; do
  echo "==================== $id ===================="
  node emit-narration.mjs "$id" >/dev/null || { echo "[$id] emit failed"; continue; }
  "$PY" gen_audio.py "build/$id/narration.json" 2>/dev/null | tail -1
  node record-module.mjs "$id" || { echo "[$id] record failed"; continue; }
  LOAD_MS=$("$PY" -c "import json;print(int(json.load(open('build/$id/offset.json'))['loadTime']*1000))")

  # Subtitles from the narration timing (account for lead + login offset).
  SUBS_FILTER=""
  if [ "$EMIT_SUBS" = "1" ]; then
    node make-subtitles.mjs "$id" || true
    if [ "$BURN_SUBS" = "1" ] && [ -f "build/$id/$id.srt" ]; then
      # Small font + bottom margin so a single short phrase sits under the UI
      # instead of a 4-line block covering it.
      SUBS_FILTER=",subtitles=build/$id/$id.srt:force_style='FontSize=${SUB_FONTSIZE},Outline=1,Shadow=0,MarginV=16'"
    fi
  fi

  ffmpeg -y -loglevel error \
    -i "build/$id/raw.webm" -i "build/$id/narration.wav" \
    -filter_complex "[1:a]adelay=${LOAD_MS}|${LOAD_MS}[a];[0:v]format=yuv420p${SUBS_FILTER}[v]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf "$CRF" -pix_fmt yuv420p -r "$FPS" \
    -c:a aac -b:a 160k -shortest "modules/$id.mp4"

  # Ship the sidecar .vtt next to the mp4 for players that support external subs.
  [ -f "build/$id/$id.vtt" ] && cp "build/$id/$id.vtt" "modules/$id.vtt"
  echo "[$id] OK modules/$id.mp4 ($(du -h "modules/$id.mp4" | cut -f1))"
done
echo "DONE — $(ls modules/*.mp4 2>/dev/null | wc -l) videos in modules/"
