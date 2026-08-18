#!/usr/bin/env bash
# ci/smoke-web-boot.sh — boot dsh web with the CURRENT plugin code in a
# workspace-local profile (.dsh-test), assert it starts, then stop it.
# Never touches ~/.dsh or any real profile.
set -uo pipefail
TARGET_NAME="$1"
DSH_BIN="${2:-dsh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_HOME="$ROOT/../../.dsh-test"
PROFILE_DIR="$TEST_HOME/profiles/web"
DEST="$PROFILE_DIR/node_modules/dsh-vision-bridge"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "[P7:${TARGET_NAME}] skip web boot: no .dsh-test web profile"
  exit 0
fi

# Install the CURRENT plugin code into the profile (no pnpm reinstall needed)
rm -rf "$DEST"
mkdir -p "$DEST"
(cd "$ROOT" && tar --exclude='./node_modules' --exclude='./.git' -cf - .) | (cd "$DEST" && tar -xf -)
# Provide the scoped schemastery the plugin imports (symlink to the dsh install's copy)
if [ -d "$ROOT/node_modules/@deepseek-ai" ]; then
  mkdir -p "$DEST/node_modules/@deepseek-ai"
  ln -sfn "$ROOT/node_modules/@deepseek-ai/schemastery" "$DEST/node_modules/@deepseek-ai/schemastery"
fi

export DSH_HOME="$TEST_HOME"
LOG="$(mktemp /tmp/vb-web-boot.XXXXXX)"
"$DSH_BIN" --profile web --port 0 >"$LOG" 2>&1 &
PID=$!
for i in $(seq 1 90); do
  if grep -qE 'dsh web: http' "$LOG"; then
    echo "[P7:${TARGET_NAME}] web boot OK (pid ${PID})"
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[P7:${TARGET_NAME}] web boot FAILED early:"; tail -25 "$LOG"
    exit 1
  fi
  sleep 1
done
echo "[P7:${TARGET_NAME}] web boot timeout; log tail:"; tail -25 "$LOG"
kill "$PID" 2>/dev/null || true
exit 1