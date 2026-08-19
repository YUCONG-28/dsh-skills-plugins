#!/usr/bin/env bash
# =============================================================================
# run-plugin-tests.sh —— 运行本仓库三个插件的全部自动化测试
#
# 覆盖：
#   dsh-web-pets    构建 + node:test（14 例）
#   dsh-vision-bridge  P6 审计 + node:test（unit+apply）+ import smoke + npm pack dry-run
#   dsh-computer-use  node:test（unit/batch/apply-smoke）+ python 单测（9 个文件）
#
# 用法：bash scripts/run-plugin-tests.sh [--skip-install] [--repo <path>]
# 退出码：0=全部 PASS；1=存在失败
# =============================================================================
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO=""
SKIP_INSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    *) REPO="$1"; shift ;;
  esac
done
[ -z "$REPO" ] && REPO="$SCRIPT_DIR/.."
REPO="$(cd "$REPO" && pwd)"

FAIL=0
run() { # run <描述> <命令...>
  local desc="$1"; shift
  echo ""
  echo "===== $desc ====="
  if "$@"; then echo "  ✓ $desc"; else echo "  ✗ $desc"; FAIL=1; fi
}

install_plugin() { # install_plugin <dir>
  local dir="$1"
  if [ "$SKIP_INSTALL" -eq 0 ]; then
    (cd "$dir" && pnpm install --frozen-lockfile) 2>/dev/null       || (cd "$dir" && pnpm install)       || { echo "  ✗ pnpm install 失败: $dir"; FAIL=1; return 1; }
  fi
  return 0
}

import_smoke() { # import_smoke <plugin-dir>
  local dir="$1"
  (cd "$dir" && node --input-type=module -e 'import("./lib/index.js").then(m => { if (!m.apply || !m.Config || !m.name) process.exit(1); }).catch(() => process.exit(1))')
}

# ---------- web-pets ----------
WP="$REPO/plugins/dsh-web-pets"
if [ -d "$WP" ]; then
  install_plugin "$WP" || true
  run "dsh-web-pets: pnpm test（build + node:test）" bash -c 'cd "$1" && pnpm test' bash "$WP"
else
  echo "跳过 dsh-web-pets（目录不存在）"; FAIL=1
fi

# ---------- vision-bridge ----------
VB="$REPO/plugins/dsh-vision-bridge"
if [ -d "$VB" ]; then
  install_plugin "$VB" || true
  run "dsh-vision-bridge: P6 静态审计" bash -c 'cd "$1" && node ci/check-p6.mjs .' bash "$VB"
  run "dsh-vision-bridge: node:test（unit + apply）" bash -c 'cd "$1" && node --test test/unit.test.mjs test/apply.test.mjs' bash "$VB"
  run "dsh-vision-bridge: import smoke" import_smoke "$VB"
  run "dsh-vision-bridge: npm pack dry-run" bash -c 'cd "$1" && npm pack --dry-run --cache /tmp/vb-npm-cache >/tmp/vb-pack.log 2>&1' bash "$VB"
else
  echo "跳过 dsh-vision-bridge（目录不存在）"; FAIL=1
fi

# ---------- computer-use ----------
CU="$REPO/plugins/dsh-computer-use"
if [ -d "$CU" ]; then
  install_plugin "$CU" || true
  run "dsh-computer-use: node:test（unit/batch/apply-smoke）" bash -c 'cd "$1" && node --test test/unit.test.mjs test/batch.test.mjs test/apply-smoke.mjs' bash "$CU"
  run "dsh-computer-use: python 单测（9 个文件）" bash -c '
    cd "$1" || exit 1
    fail=0
    for f in $(find . -name "test_*.py" | sort); do
      echo "  -- python3 $f"
      python3 "$f" >/dev/null 2>&1 || { echo "  ✗ $f"; fail=1; }
    done
    [ "$fail" -eq 0 ] || exit 1
  ' bash "$CU"
else
  echo "跳过 dsh-computer-use（目录不存在）"; FAIL=1
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "== run-plugin-tests: FAIL =="
  exit 1
fi
echo "== run-plugin-tests: 全部 PASS =="