#!/usr/bin/env bash
# sync-skills.sh —— 将仓库 skills/ 全量同步进 ~/.dsh/skills/（幂等，差异同步）
#
# 背景：skills 采用复制安装（cp -R），仓库更新后本地副本会漂移；
# 本脚本对比差异后同步，并清理仓库已删除的本地副本。
#
# 用法：bash sync-skills.sh   （仓库 skills/ 更新后执行；新会话生效）
set -u
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.dsh/skills"
mkdir -p "$DEST"
FAIL=0

for skill in "$WS"/skills/*/; do
  [ -d "$skill" ] || continue
  name="$(basename "$skill")"
  [ -f "$skill/SKILL.md" ] || { echo "SKIP ${name}（无 SKILL.md）"; continue; }
  if [ -d "$DEST/$name" ]; then
    if diff -rq "$skill" "$DEST/$name" >/dev/null 2>&1; then
      echo "OK   $name 已同步"
    else
      echo "SYNC $name 检测到差异 → 更新"
      cp -R "$skill/." "$DEST/$name/" || FAIL=1
    fi
  else
    echo "NEW  $name 首次安装"
    cp -R "$skill" "$DEST/$name" || FAIL=1
  fi
done

# 清理本地存在但仓库已删除的 skill
for d in "$DEST"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  if [ ! -d "$WS/skills/$name" ]; then
    echo "RM   $name 仓库已删除 → 移除本地副本"
    rm -rf "$d"
  fi
done

[ "$FAIL" -ne 0 ] && { echo "存在同步失败项，请检查。"; exit 1; }
echo ""
echo "完成。新会话生效（DSH skill watcher 自动发现）。"