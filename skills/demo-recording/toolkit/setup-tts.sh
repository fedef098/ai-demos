#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Bootstraps the Kokoro TTS venv used by gen_audio.py. Idempotent: re-running
# only installs what's missing. Creates ./.kokoro-venv (override with KOKORO_VENV).
#
#   ./setup-tts.sh
#
# Kokoro is the house voice (non-negotiable). Voice ef_dora / lang e = Spanish.
# NOTE (shared VPS RAM): this downloads torch (~hundreds of MB) and, on first
# `gen_audio.py` run, the Kokoro model weights. The install itself is light on
# RAM; the model load at synth time uses ~1-2 GB. Check `free -h` first.

KOKORO_VENV="${KOKORO_VENV:-./.kokoro-venv}"
PY_BIN="${PYTHON:-python3}"

echo "==> espeak-ng (system dependency)"
if ! command -v espeak-ng >/dev/null 2>&1; then
  echo "espeak-ng not found. Install it system-wide, e.g.:"
  echo "    sudo apt-get update && sudo apt-get install -y espeak-ng"
  echo "(re-run this script afterwards)"
  exit 1
fi
echo "    found: $(command -v espeak-ng)"

echo "==> ffmpeg (needed by build-modules.sh)"
command -v ffmpeg >/dev/null 2>&1 \
  && echo "    found: $(command -v ffmpeg)" \
  || echo "    WARNING: ffmpeg not found — install it before build-modules.sh"

echo "==> venv at $KOKORO_VENV"
if [ ! -x "$KOKORO_VENV/bin/python" ]; then
  "$PY_BIN" -m venv "$KOKORO_VENV"
fi
"$KOKORO_VENV/bin/python" -m pip install --upgrade pip >/dev/null

echo "==> installing Kokoro stack (this can take a few minutes — torch is large)"
"$KOKORO_VENV/bin/pip" install -r requirements.txt

echo "==> smoke check"
"$KOKORO_VENV/bin/python" - <<'PY'
import importlib
for m in ("kokoro", "soundfile", "numpy", "torch"):
    importlib.import_module(m)
print("    kokoro stack import OK")
PY

echo "DONE. Kokoro venv ready at $KOKORO_VENV"
echo "Set KOKORO_VENV=$KOKORO_VENV (or keep the default) for build-modules.sh."
