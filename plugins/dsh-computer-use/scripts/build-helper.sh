#!/usr/bin/env bash
# =============================================================================
# build-helper.sh — 编译 cu-helper Swift 原生 helper（幂等）
#
# 产物：bin/cu-helper（本机架构，ad-hoc 签名）。
# 运行期优先使用编译二进制；缺失时插件回退 `swift scripts/cu-helper.swift`。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PLUGIN_ROOT/bin"
SOURCE="$PLUGIN_ROOT/scripts/cu-helper.swift"
OUTPUT="$BIN_DIR/cu-helper"

mkdir -p "$BIN_DIR"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "error: 未找到 swiftc（需要 Xcode Command Line Tools: xcode-select --install）" >&2
  exit 1
fi

echo "==> 编译 $SOURCE -> $OUTPUT"
swiftc -O "$SOURCE" -o "$OUTPUT"

# ad-hoc 签名（TCC 按 responsible process 检查宿主进程，签名非必需但更规范）
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$OUTPUT" >/dev/null 2>&1 || true
fi

echo "==> 自检: ping"
echo '{}' | "$OUTPUT" ping || { echo "error: helper 自检失败" >&2; exit 1; }

echo "==> 完成: $OUTPUT"
