#!/usr/bin/env bash
# ci/compat-matrix.sh — P7 compatibility matrix.
#
# Targets (DSH_TARGETS, comma separated):
#   local  — the dsh install on PATH (current stable)
#   latest — requires DSH_LATEST_HOME (dsh install root)
#   next   — requires DSH_NEXT_HOME
#
# Each target runs:
#   - P6 static audit (schemastery-only schema, no internal @deepseek-ai imports)
#   - unit + integration tests (mock DSH: plugin load, text/image request, OCR,
#     remote vision, cache hit, fallback, missing provider/OCR, invalid config,
#     vision timeout, API failure, clean shutdown paths)
#   - plugin entry import smoke (no DSH package imports at module scope)
#   - npm pack dry-run
#   - optional real dsh web boot smoke (WEB_BOOT=1)
#
# The most important assertion: a vision-bridge fault must never stop dsh from
# booting — covered by the fail-soft apply test and the real web boot smoke.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT"
TARGETS="${DSH_TARGETS:-local}"
fail=0

run_target() {
  local name="$1" dsh_bin="$2"
  echo "== [P7] target: ${name} (dsh: ${dsh_bin}) =="
  if ! (cd "$PLUGIN" && node ci/check-p6.mjs .); then fail=1; fi
  if ! (cd "$PLUGIN" && node --test test/unit.test.mjs test/apply.test.mjs); then fail=1; fi
  if ! (cd "$PLUGIN" && node -e "import('./lib/index.js').then(m => { if (!m.apply || !m.Config || !m.name) process.exit(1); }).catch(e => { console.error(e); process.exit(1); })"); then
    fail=1
  fi
  if ! (cd "$PLUGIN" && npm pack --dry-run --cache /tmp/vb-npm-cache >/tmp/vb-pack.log 2>&1); then
    cat /tmp/vb-pack.log
    fail=1
  fi
  if [ "${WEB_BOOT:-0}" = "1" ] && [ -d "$ROOT/../../.dsh-test/profiles/web" ]; then
    if ! bash "$ROOT/ci/smoke-web-boot.sh" "$name" "$dsh_bin"; then fail=1; fi
  fi
}

if [[ "$TARGETS" == *local* ]] && command -v dsh >/dev/null 2>&1; then
  run_target local "$(command -v dsh)"
fi
if [[ "$TARGETS" == *latest* ]] && [ -n "${DSH_LATEST_HOME:-}" ] && [ -x "$DSH_LATEST_HOME/bin/dsh" ]; then
  run_target latest "$DSH_LATEST_HOME/bin/dsh"
fi
if [[ "$TARGETS" == *next* ]] && [ -n "${DSH_NEXT_HOME:-}" ] && [ -x "$DSH_NEXT_HOME/bin/dsh" ]; then
  run_target next "$DSH_NEXT_HOME/bin/dsh"
fi

if [ "$fail" -ne 0 ]; then
  echo "== [P7] FAIL (targets: ${TARGETS}) =="
  exit 1
fi
echo "== [P7] PASS (targets: ${TARGETS}) =="