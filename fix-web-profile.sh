#!/usr/bin/env bash
# fix-web-profile.sh —— 把已修复的 dsh-desktop-pets / dsh-web-pets / dsh-vision-bridge
# 插件源码同步进 ~/.dsh/profiles/web/node_modules（幂等；web-pets / vision-bridge 为
# 硬链接，源码编辑后硬链接可能断裂，此脚本强制用源码覆盖安装副本）。
#
# 背景：
#   - dsh-desktop-pets：插件把 Cordis 服务名写成了 'session'（单数），而官方
#     @deepseek-ai/dsh-session 注册的服务名是 'sessions'（复数），导致
#     "pending (waiting for service: session)"。源码已修复；这里同步安装副本。
#   - dsh-vision-bridge：含图轮次路由到 Qwen 时，pi-ai(rc.6) 对声明了 reasoning 的
#     视觉模型（如 qwen3.7-flash）把 systemPrompt 序列化为 role:'developer'，
#     DashScope 兼容端点不接受该角色（400）。源码已加"系统提示并入首条 user 消息"的
#     兼容处理；这里同步安装副本。
#   - 注意：直接用文本编辑器改 plugins/ 下的源码会把 node_modules 里的硬链接
#     "替换"成新 inode（旧链接仍指向旧内容），必须重跑本脚本或 pnpm install。
set -u
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_NM="$HOME/.dsh/profiles/web/node_modules"

cp "$WS/projects/desktop-pets/integration/dsh-plugin/lib/index.js" \
   "$PROFILE_NM/dsh-desktop-pets/lib/index.js"
cp "$WS/plugins/dsh-web-pets/lib/index.js" \
   "$PROFILE_NM/dsh-web-pets/lib/index.js"
cp "$WS/plugins/dsh-vision-bridge/lib/index.js" \
   "$PROFILE_NM/dsh-vision-bridge/lib/index.js"

echo "--- 校验注入/路由声明："
grep -H "export const inject" \
  "$PROFILE_NM/dsh-desktop-pets/lib/index.js" \
  "$PROFILE_NM/dsh-web-pets/lib/index.js"
grep -H "system: undefined" \
  "$PROFILE_NM/dsh-vision-bridge/lib/index.js" || echo "注意: vision-bridge 未找到 developer-role 兼容处理"

echo "--- 源码与安装副本一致性："
for pair in \
  "plugins/dsh-vision-bridge/lib/index.js:dsh-vision-bridge/lib/index.js" \
  "plugins/dsh-web-pets/lib/index.js:dsh-web-pets/lib/index.js" \
  "projects/desktop-pets/integration/dsh-plugin/lib/index.js:dsh-desktop-pets/lib/index.js"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  if diff -q "$WS/$src" "$PROFILE_NM/$dst" >/dev/null 2>&1; then
    echo "  OK  $src == $dst"
  else
    echo "  FAIL $src != $dst（请检查）"
  fi
done

echo ""
echo "完成。重启 dsh web 即可；自检：ls -l /tmp/desktop-pets-dsh.loaded"
