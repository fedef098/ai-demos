#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
# Uploads every modules/*.mp4 (+ optional combined <PROJECT>-demo.mp4) to the
# PROJECT's OWN object storage (public, hashed name), prints public URLs, and
# refreshes a demos/index.json manifest (feature -> url -> commit -> date).
#
# TWO UPLOAD BACKENDS (pick with env):
#
#  A) IN-CLUSTER via kubectl exec (RECOMMENDED for k8s MinIO — reliable):
#       MINIO_POD=<minio pod name>   MINIO_NS=<namespace>
#       KUBECTL="sudo -n kubectl"    # how to run kubectl (default: kubectl)
#     Streams each file straight into the pod's mc with `mc pipe` — no
#     port-forward. Learned the hard way: `kubectl port-forward` in the
#     background is flaky/killed by sandboxes, and `kubectl cp` fails when the
#     MinIO image has no `tar`. `mc pipe` over `exec -i` avoids both.
#
#  B) PORT-FORWARD + docker minio/mc (fallback / non-k8s):
#       PF_CMD="kubectl -n <ns> port-forward svc/minio 9913:9000"
#       MINIO_PORT=9913
#
# Shared env (see .env.example): S3_BUCKET, S3_PUBLIC_URL, S3_ACCESS_KEY,
#   S3_SECRET_KEY, DEMO_DATE (ISO date stamped into the manifest).
[ -f .env ] && set -a && . ./.env && set +a

BUCKET="${S3_BUCKET:-demos}"
PUBLIC_BASE="${S3_PUBLIC_URL:?set S3_PUBLIC_URL to your public files base, e.g. https://app-files.example.com/bucket}"
AK="${S3_ACCESS_KEY:-minioadmin}"
SK="${S3_SECRET_KEY:-minioadmin}"
PORT="${MINIO_PORT:-9913}"
KUBECTL="${KUBECTL:-kubectl}"
DEMO_DATE="${DEMO_DATE:-$(date -u +%Y-%m-%d)}"
DEMO_COMMIT="${DEMO_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"

ctype() { case "$1" in *.mp4) echo video/mp4;; *.vtt) echo text/vtt;; *.json) echo application/json;; *) echo application/octet-stream;; esac; }

# --- Backend A: in-cluster kubectl exec + mc pipe -----------------------------
POD_READY=""
pod_setup() {
  [ -n "$POD_READY" ] && return 0
  $KUBECTL -n "$MINIO_NS" exec "$MINIO_POD" -- mc alias set me "http://127.0.0.1:9000" "$AK" "$SK" >/dev/null 2>&1 || return 1
  $KUBECTL -n "$MINIO_NS" exec "$MINIO_POD" -- mc anonymous set download "me/$BUCKET" >/dev/null 2>&1 || true
  POD_READY=1
}
upload_pod() { # <localfile> <key>
  pod_setup || return 1
  local ct; ct="$(ctype "$1")"
  $KUBECTL -n "$MINIO_NS" exec -i "$MINIO_POD" -- \
    mc pipe --attr "Content-Type=$ct" "me/$BUCKET/$2" < "$1" >/dev/null 2>&1
}

# --- Backend B: port-forward + docker minio/mc --------------------------------
PF=""
docker_start_pf() {
  [ -z "${PF_CMD:-}" ] && return 0
  bash -c "$PF_CMD" > /tmp/demo_publish_pf.log 2>&1 &
  PF=$!
  trap 'kill $PF 2>/dev/null' EXIT
  sleep 4
}
upload_docker() { # <localfile> <key>  (mounts the file's own dir so absolute paths work)
  local dir base ct; dir="$(cd "$(dirname "$1")" && pwd)"; base="$(basename "$1")"; ct="$(ctype "$1")"
  docker run --rm --network host -v "$dir:/f" --entrypoint /bin/sh minio/mc:latest -c \
    "mc alias set k http://localhost:$PORT $AK $SK >/dev/null 2>&1 && mc cp --attr 'Content-Type=$ct' /f/$base k/$BUCKET/$2 >/dev/null 2>&1 && mc anonymous set download k/$BUCKET >/dev/null 2>&1 && echo ok" 2>/dev/null
}

USE_POD=""
if [ -n "${MINIO_POD:-}" ] && [ -n "${MINIO_NS:-}" ]; then USE_POD=1; else docker_start_pf; fi

upload() { # <localfile> <key> -> echoes "ok" on success
  if [ -n "$USE_POD" ]; then upload_pod "$1" "$2" && echo ok; else
    [ "$(upload_docker "$1" "$2")" = "ok" ] && echo ok
  fi
}

files=(modules/*.mp4)
for extra in *-demo.mp4 combined.mp4; do [ -f "$extra" ] && files+=("$extra"); done

ROWS="$(mktemp)"
echo "name,url"
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  bytes="$(stat -c %s "$f" 2>/dev/null || echo 0)"
  hash="$(openssl rand -hex 6 2>/dev/null || date +%s%N | sha1sum | cut -c1-12)"
  key="demos/${hash}-${base}"
  if [ "$(upload "$f" "$key")" = "ok" ]; then
    vtt="${f%.mp4}.vtt"
    [ -f "$vtt" ] && upload "$vtt" "${key%.mp4}.vtt" >/dev/null
    url="${PUBLIC_BASE}/${key}"
    echo "${base},${url}"
    echo "${base},${url},${bytes}" >> "$ROWS"
  else
    echo "${base},UPLOAD_FAILED"
  fi
done

# Refresh + upload the manifest (merge with the one already in the bucket).
PREV="$(curl -fsS "${PUBLIC_BASE}/demos/index.json" 2>/dev/null || echo '{}')"
MANIFEST="$(printf '%s' "$PREV" | DEMO_COMMIT="$DEMO_COMMIT" DEMO_DATE="$DEMO_DATE" node write-manifest.mjs "$ROWS")"
printf '%s' "$MANIFEST" > /tmp/demos-index.json
[ "$(upload /tmp/demos-index.json demos/index.json)" = "ok" ] && echo "manifest,${PUBLIC_BASE}/demos/index.json"
rm -f "$ROWS"
