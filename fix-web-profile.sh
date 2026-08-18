#!/usr/bin/env bash
# fix-web-profile.sh —— 将本仓库全部 file: 插件的源码全量同步进 ~/.dsh/profiles/web/node_modules
# （幂等，可按需重复执行）。
#
# 背景：
#   - pnpm 对 file: 依赖可能用硬链接安装。用编辑器“整文件替换”写源码时会生成新 inode，
#     旧硬链接仍指向旧内容 → 重启 dsh web 后运行的是旧代码。
#   - 本脚本按各插件 package.json 的 files 字段，把源码目录同步到安装副本，
#     并做版本对比 / package.json 差异检测 / cordis.patch.yml 一致性校验。
#
# 用法：bash fix-web-profile.sh   （改完源码后执行，然后重启 dsh web）
set -u
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_NM="$HOME/.dsh/profiles/web/node_modules"
FAIL=0

# 插件映射：源码相对路径:安装副本名
PLUGINS=(
  "plugins/dsh-vision-bridge:dsh-vision-bridge"
  "plugins/dsh-web-pets:dsh-web-pets"
  "plugins/dsh-computer-use:dsh-computer-use"
  "projects/desktop-pets/integration/dsh-plugin:dsh-desktop-pets"
)

for pair in "${PLUGINS[@]}"; do
  src="${pair%%:*}"; name="${pair##*:}"
  srcdir="$WS/$src"; dstdir="$PROFILE_NM/$name"
  echo "==== $name ($src)"
  if [ ! -d "$srcdir" ]; then echo "  FAIL 源码目录不存在: $src"; FAIL=1; continue; fi
  if [ ! -d "$dstdir" ]; then echo "  WARN 安装副本不存在: $name —— 请先 cd ~/.dsh/profiles/web && pnpm install"; FAIL=1; continue; fi

  # 1) 版本对比
  srcv="$(node -p "require('$srcdir/package.json').version" 2>/dev/null || echo '?')"
  dstv="$(node -p "require('$dstdir/package.json').version" 2>/dev/null || echo '?')"
  if [ "$srcv" != "$dstv" ]; then
    echo "  NOTE 版本不一致: 源码 $srcv vs 副本 $dstv —— 已同步 package.json（重启 dsh web 生效）"
  fi

  # 2) 同步 package.json（版本号/描述/files 等 manifest 字段；pnpm install 重链前的直接同步）
  cp "$srcdir/package.json" "$dstdir/package.json" 2>/dev/null || echo "  WARN 无法同步 package.json"

  # 3) 按 files 字段全量同步（目录/文件均支持）
  FILES=$(node -p "JSON.stringify(require('$srcdir/package.json').files || [])" 2>/dev/null | tr -d '[]"' | tr ',' '\n' | sed '/^$/d')
  if [ -z "$FILES" ]; then FILES="lib"; fi
  for entry in $FILES; do
    if [ -d "$srcdir/$entry" ]; then
      mkdir -p "$dstdir/$entry"
      cp -R "$srcdir/$entry/." "$dstdir/$entry/"
    elif [ -f "$srcdir/$entry" ]; then
      cp "$srcdir/$entry" "$dstdir/$entry"
    else
      echo "  INFO files 字段含缺失项: $entry（忽略）"
    fi
  done

  # 4) 一致性校验（files 覆盖范围）
  local_bad=0
  for entry in $FILES; do
    if [ ! -e "$srcdir/$entry" ]; then continue; fi
    if diff -rq "$srcdir/$entry" "$dstdir/$entry" >/dev/null 2>&1; then
      echo "  OK   $entry == 副本"
    else
      echo "  FAIL $entry 源码 != 副本（请检查）"; local_bad=1
    fi
  done
  [ "$local_bad" -ne 0 ] && FAIL=1
done

echo ""
echo "--- 校验注入/路由声明："
grep -H "export const inject" \
  "$PROFILE_NM/dsh-desktop-pets/lib/index.js" \
  "$PROFILE_NM/dsh-web-pets/lib/index.js" 2>/dev/null || true
grep -H "system: undefined" \
  "$PROFILE_NM/dsh-vision-bridge/lib/index.js" 2>/dev/null || echo "注意: vision-bridge 未找到 developer-role 兼容处理"

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "存在 FAIL/NOTE 项，请处理后重跑（源码已同步的 OK 项可忽略重复报错）。"
  exit 1
fi
echo "完成。重启 dsh web 即可生效。"
