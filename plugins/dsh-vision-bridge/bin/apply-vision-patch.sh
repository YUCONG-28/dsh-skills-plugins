#!/usr/bin/env bash
# =============================================================================
# apply-vision-patch.sh — 放宽 dsh-host-apiproxy 的图像准入预检
#
# 背景：vision-bridge 的自动视觉路由（含图轮次→Qwen）需要图像能进入会话。
# 但 dsh-host-apiproxy 在 发送图片(prompt) 与 切换模型(selectModel) 两个入口
# 都会按"当前模型是否声明 inputModalities 含 image"拒绝图像。本脚本把两处
# 检查改为失效代码（if (false && ...)），准入交由路由层兜底。
#
# 目标文件（都会处理，幂等）：
#   <pkg>/lib/index.js             —— 包入口（main），运行实例实际加载的打包版
#   <pkg>/lib/types/api-proxy.js   —— 模块化源码（内部引用，一并保持一致性）
#
# 用法：
#   ./apply-vision-patch.sh          应用补丁（幂等，可重复执行）
#   ./apply-vision-patch.sh --revert 还原补丁
#
# 注意：补丁作用于当前 dsh 安装——通过 profile 根 node_modules 的符号链接定位
# （readlink 跟随），实际目标可能是 homebrew 全局安装
# （/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/...）
# 或 npx 缓存（~/.npm/_npx/<id>/node_modules/@deepseek-ai/...）。dsh 重装或
# `dsh plugin add` 触发 pnpm 重链后，符号链接会指向新副本，需重跑本脚本。
# =============================================================================
set -euo pipefail

MARKER='[vision-bridge:relaxed]'

# 定位 @deepseek-ai/dsh-host-apiproxy（profile 根 node_modules 是指向实际安装的链接）
PROFILE_ROOT="$HOME/.dsh/profiles/node_modules"
PKG="$PROFILE_ROOT/@deepseek-ai/dsh-host-apiproxy"
if [ ! -e "$PKG" ]; then
  echo "错误: 找不到 $PKG（请确认 dsh profile 已初始化）" >&2
  exit 1
fi
PKG_DIR="$(readlink "$PKG" 2>/dev/null || echo "$PKG")"

# 每份文件的锚点对（old -> new）
# bundle（lib/index.js）与 modular（lib/types/api-proxy.js）的格式化不同，需分别给出。
BUNDLE="$PKG_DIR/lib/index.js"
BUNDLE_PAIRS=(
  'if (hasImage) {'
  'if (false && hasImage) { // '"$MARKER"' prompt admission: model capability no longer gates image entry'
  'if ([...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content)) || messagesHaveImage(found.agent.session.deriveMessages())) {'
  'if (false && ([...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].some((message) => contentHasImage(message.content)) || messagesHaveImage(found.agent.session.deriveMessages()))) { // '"$MARKER"' selectModel admission: model capability no longer gates image history'
)
MODULAR="$PKG_DIR/lib/types/api-proxy.js"
MODULAR_PAIRS=(
  'if (hasImage) {'
  'if (false && hasImage) { // '"$MARKER"' prompt admission: model capability no longer gates image entry'
  'if (pendingImage || messagesHaveImage(found.agent.session.deriveMessages())) {'
  'if (false && (pendingImage || messagesHaveImage(found.agent.session.deriveMessages()))) { // '"$MARKER"' selectModel admission: model capability no longer gates image history'
)

patch_file() {
  local file="$1"; shift
  [ -f "$file" ] || { echo "跳过（不存在）: $file"; return; }
  python3 - "$file" "$MARKER" "$@" <<'PY'
import sys
path, marker = sys.argv[1:3]
pairs = list(zip(sys.argv[3::2], sys.argv[4::2]))
s = open(path, encoding='utf-8').read()
if marker in s:
    print(f'已打过补丁，跳过（幂等）: {path}')
    sys.exit(0)
for old, new in pairs:
    n = s.count(old)
    if n != 1:
        print(f'错误: 锚点不唯一或未找到: {old[:80]!r} (count={n})，文件可能已变化，请人工检查: {path}')
        sys.exit(2)
    s = s.replace(old, new)
open(path, 'w', encoding='utf-8').write(s)
print(f'已应用补丁: {path}（{len(pairs)} 处准入检查已放宽）')
PY
}

revert_file() {
  local file="$1"; shift
  [ -f "$file" ] || { echo "跳过（不存在）: $file"; return; }
  python3 - "$file" "$MARKER" "$@" <<'PY'
import sys
path, marker = sys.argv[1:3]
pairs = list(zip(sys.argv[3::2], sys.argv[4::2]))
s = open(path, encoding='utf-8').read()
if marker not in s:
    print(f'未发现补丁标记，无需还原: {path}')
    sys.exit(0)
for old, new in pairs:  # 还原时方向反转：new -> old
    if new not in s:
        print(f'警告: 未找到已补丁文本: {new[:80]!r}（跳过）')
        continue
    s = s.replace(new, old)
open(path, 'w', encoding='utf-8').write(s)
print(f'已还原补丁: {path}')
PY
}

case "${1:-}" in
  --revert)
    revert_file "$BUNDLE" "${BUNDLE_PAIRS[@]}"
    revert_file "$MODULAR" "${MODULAR_PAIRS[@]}"
    echo '请重启 dsh web 使还原生效。'
    ;;
  --check)
    # 检测补丁是否仍生效（dsh 重装 / dsh plugin add 触发 pnpm 重链后补丁会失效）
    stale=0
    for file in "$BUNDLE" "$MODULAR"; do
      if [ ! -f "$file" ]; then echo "MISS  $file（不存在）"; stale=1; continue; fi
      if grep -q "$MARKER" "$file" 2>/dev/null; then
        echo "OK    $file 补丁仍生效"
      else
        echo "STALE $file 补丁已失效 —— 请重跑 $0"
        stale=1
      fi
    done
    [ "$stale" -ne 0 ] && exit 1
    exit 0
    ;;
  -h|--help) sed -n '1,35p' "$0" ;;
  "")
    patch_file "$BUNDLE" "${BUNDLE_PAIRS[@]}"
    patch_file "$MODULAR" "${MODULAR_PAIRS[@]}"
    echo '请重启 dsh web 使补丁生效。'
    ;;
  *) echo "未知参数: $1（支持 --revert / --check）" >&2; exit 1 ;;
esac
