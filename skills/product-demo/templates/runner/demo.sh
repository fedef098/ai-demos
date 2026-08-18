#!/usr/bin/env bash
# RUNNER_VERSION 1
#
# Orquesta el pipeline completo.
#
#   ./demos/.runner/demo.sh <slug>            graba, monta, publica y arma la página
#   ./demos/.runner/demo.sh <slug> --check    sólo lint + targets (sin grabar, ~20 s)
#   ./demos/.runner/demo.sh --page            sólo regenera el HTML desde los run.json
#   ./demos/.runner/demo.sh --catalog         sólo el inventario de cobertura
#
# Etapas: preflight → lint → targets → narrate → seed → record → build → catalog → page
# Si una falla, corta y limpia. Nunca queda medio video.
#
# `narrate` va ANTES de `record` a propósito: sintetiza toda la locución primero
# para que la grabación pueda darle a cada beat el tiempo que la voz necesita.
# Ver references/pacing.md.

set -euo pipefail

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_DIR="$(dirname "$RUNNER_DIR")"
TMP_ROOT="${TMPDIR:-/tmp}"

red()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
die()  { red "✖ $*"; exit 1; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ── Atajos que no graban nada ────────────────────────────────────────────────
if [ "${1:-}" = "--page" ]; then
  node "$RUNNER_DIR/catalog.mjs" "$DEMOS_DIR"
  node "$RUNNER_DIR/page.mjs" "$DEMOS_DIR"
  exit 0
fi

if [ "${1:-}" = "--catalog" ]; then
  node "$RUNNER_DIR/catalog.mjs" "$DEMOS_DIR"
  exit 0
fi

SLUG="${1:-}"
[ -n "$SLUG" ] || die "Uso: demo.sh <slug> [--check]"
CHECK_ONLY=false
[ "${2:-}" = "--check" ] && CHECK_ONLY=true

GUION="$DEMOS_DIR/$SLUG.demo.yml"
[ -f "$GUION" ] || die "No existe $GUION"

# ── 1. Preflight ─────────────────────────────────────────────────────────────
step "preflight"

[ -n "${DEMO_BASE_URL:-}" ] || die "Falta DEMO_BASE_URL. La app tiene que estar desplegada: el grabador NUNCA levanta un dev server."

# Esta VPS es compartida. Un proceso pesado dispara el OOM killer y se lleva
# servicios de otra gente — ver mira/CLAUDE.local.md.
AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
if [ "$AVAIL_MB" -lt 3000 ]; then
  die "Sólo ${AVAIL_MB} MB de RAM disponible (mínimo 3000). Grabar ahora puede tirar servicios de otros en esta VPS compartida."
fi
dim "  RAM disponible: ${AVAIL_MB} MB"

DISK_AVAIL_MB=$(df -Pm "$TMP_ROOT" | awk 'NR==2 {print $4}')
if [ "$DISK_AVAIL_MB" -lt 2000 ]; then
  die "Sólo ${DISK_AVAIL_MB} MB libres en $TMP_ROOT (mínimo 2000)."
fi
dim "  disco en $TMP_ROOT: ${DISK_AVAIL_MB} MB"

command -v ffmpeg  >/dev/null || die "Falta ffmpeg."
command -v ffprobe >/dev/null || die "Falta ffprobe."

if [ "${DEMO_BROWSER:-}" != "chromium" ]; then
  command -v google-chrome >/dev/null || die "No encontré google-chrome. Instalalo, o usá DEMO_BROWSER=chromium (baja ~170 MB)."
fi

# ⚠ LA TRAMPA Nº1. El ffmpeg que Playwright usa para grabar NO es el del
# sistema: es un helper propio que se instala aparte del browser. Sin él,
# recordVideo no produce NINGÚN archivo y no avisa: la corrida "funciona" y no
# hay video al final.
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ! ls "$PW_CACHE" 2>/dev/null | grep -qi '^ffmpeg'; then
  die "Falta el helper ffmpeg de Playwright: sin él recordVideo no graba nada y falla en silencio.
    Instalalo:  npx playwright install ffmpeg"
fi
dim "  helper ffmpeg de Playwright: ok"

if ! curl -fsS -o /dev/null --max-time 15 "$DEMO_BASE_URL"; then
  die "$DEMO_BASE_URL no responde."
fi
dim "  $DEMO_BASE_URL responde"

# ── 2. Lint ──────────────────────────────────────────────────────────────────
step "lint"
node "$RUNNER_DIR/lint.mjs" "$GUION"

# ── 3. Targets ───────────────────────────────────────────────────────────────
step "targets (sin grabar)"
node "$RUNNER_DIR/preflight.mjs" "$GUION"

if $CHECK_ONLY; then
  printf '\n✓ El guion está listo. Corré sin --check para grabar.\n\n'
  exit 0
fi

# ── 4. Narrate ───────────────────────────────────────────────────────────────
# Toda la locución se sintetiza acá, antes de abrir el browser, porque el audio
# manda: record.mjs le pide a narrate.mjs cuánto dura cada cue y le da al beat al
# menos ese tiempo. Sintetizar después obligaría a estirar o acelerar la voz.
# El resultado se cachea por hash del texto: si el guion no cambió, esto es
# instantáneo. La primera corrida de la máquina necesita ./setup-voice.sh.
step "narrate"
node "$RUNNER_DIR/narrate.mjs" "$GUION"

# ── 5. Seed ──────────────────────────────────────────────────────────────────
SEED=$(node --input-type=module -e "
  import { loadDemo } from '$RUNNER_DIR/lint.mjs';
  const { demo } = loadDemo('$GUION');
  process.stdout.write(demo.world?.seed ?? '');
")
if [ -n "$SEED" ]; then
  step "seed"
  node "$DEMOS_DIR/${SEED#./}"
fi

# ── 6. Record ────────────────────────────────────────────────────────────────
step "record"
# El directorio temporal se fija acá y se le pasa al runner, para que el trap
# borre exactamente el que se creó. El .webm crudo pesa ~10 MB/min y el disco
# de esta VPS está al 90%: dejarlo tirado no es una opción.
export DEMO_TMPDIR="$TMP_ROOT/demo-$SLUG-$$"
mkdir -p "$DEMO_TMPDIR"
cleanup() { rm -rf "$DEMO_TMPDIR"; }
trap cleanup EXIT

TIMELINE=$(node "$RUNNER_DIR/record.mjs" "$GUION" | tail -1)
[ -f "$TIMELINE" ] || die "No se generó el timeline: la grabación falló."

# ── 7. Build ─────────────────────────────────────────────────────────────────
# Monta el mp4, le mezcla la locución en el tiempo ya calibrado y lo sube al
# bucket. En git no queda ningún binario.
step "build"
node "$RUNNER_DIR/build.mjs" "$TIMELINE"

# ── 8. Catálogo y página ─────────────────────────────────────────────────────
step "catálogo"
node "$RUNNER_DIR/catalog.mjs" "$DEMOS_DIR"

step "page"
node "$RUNNER_DIR/page.mjs" "$DEMOS_DIR"

printf '\n✓ Listo: %s\n\n' "$DEMOS_DIR/$SLUG/index.html"
