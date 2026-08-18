#!/usr/bin/env bash
# RUNNER_VERSION 2
#
# Crea, una sola vez por máquina, el venv de Kokoro que usa voice.mjs.
#
#   ./demos/.runner/setup-voice.sh
#
# Baja torch (~700 MB) y, en la primera síntesis, los pesos del modelo (~350 MB).
# Después queda cacheado y grabar no vuelve a tocar la red.
#
# El venv vive FUERA del proyecto (~/.cache/demo-voice-venv) a propósito: es una
# dependencia de la máquina, no del repo, y se comparte entre todos los proyectos
# que graban demos. Se puede mover con DEMO_VOICE_VENV.

set -euo pipefail

VENV="${DEMO_VOICE_VENV:-$HOME/.cache/demo-voice-venv}"

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
dim() { printf '\033[2m%s\033[0m\n' "$*"; }
die() { red "✖ $*"; exit 1; }

command -v python3 >/dev/null || die "Falta python3."
command -v ffprobe >/dev/null || die "Falta ffprobe (viene con ffmpeg): voice.mjs lo usa para medir cada clip."

# Kokoro fonemiza con espeak-ng por debajo. Sin él importa pero no produce audio,
# y el error que tira no menciona espeak: falla acá, que se entiende.
command -v espeak-ng >/dev/null || die "Falta espeak-ng, que Kokoro usa para fonemizar.
    Debian/Ubuntu:  sudo apt-get install -y espeak-ng
    macOS:          brew install espeak-ng"

# torch necesita margen. En una VPS compartida, un pip install de 700 MB con poca
# RAM dispara el OOM killer y se lleva servicios de otra gente por delante.
if command -v free >/dev/null; then
  AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
  [ "$AVAIL_MB" -ge 2000 ] || die "Sólo ${AVAIL_MB} MB de RAM disponible (mínimo 2000 para instalar torch)."
fi

if [ -x "$VENV/bin/python" ]; then
  dim "El venv ya existe en $VENV — actualizo dependencias."
else
  dim "Creando venv en $VENV…"
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "kokoro==0.9.4" soundfile numpy

dim "Verificando que el modelo cargue…"
"$VENV/bin/python" - <<'PY'
from kokoro import KPipeline
KPipeline(lang_code="e")
print("ok")
PY

printf '\n✓ Voz lista. Probala:  node demos/.runner/narrate.mjs demos/<slug>.demo.yml\n\n'
