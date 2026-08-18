#!/usr/bin/env bash
# build-ocr.sh — compile scripts/ocr.swift into ~/.dsh/vision-bridge-ocr (swiftc -O).
# P3.2: 安装时编译成二进制；失败不阻断安装（插件会回退到 swift 解释执行）。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${VISION_BRIDGE_BIN_DIR:-$HOME/.dsh}"
OUT="$OUT_DIR/vision-bridge-ocr"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "vision-bridge: swiftc 不可用，跳过 OCR 二进制编译（将使用 swift 解释执行）" >&2
  exit 0
fi

mkdir -p "$OUT_DIR"
if swiftc -O -module-cache-path "${OUT_DIR}/.swift-module-cache" -o "$OUT" "$SCRIPT_DIR/ocr.swift" 2>/tmp/vb-ocr-build.err; then
  chmod +x "$OUT"
  echo "vision-bridge: OCR 工具已编译 -> $OUT"
else
  echo "vision-bridge: OCR 二进制编译失败（将使用 swift 解释执行）:" >&2
  cat /tmp/vb-ocr-build.err >&2
  rm -f /tmp/vb-ocr-build.err
  exit 0
fi