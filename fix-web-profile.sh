#!/usr/bin/env bash
# fix-web-profile.sh —— 将本仓库全部 file: 插件的源码全量同步进 ~/.dsh/profiles/web/node_modules
# （幂等，可按需重复执行）。v2：staging + 原子替换 + 校验 + import smoke。
#
# 背景：
#   - pnpm 对 file: 依赖可能用硬链接安装。用编辑器“整文件替换”写源码时会生成新 inode，
#     旧硬链接仍指向旧内容 → 重启 dsh web 后运行的是旧代码。
#   - v1 用 cp -R 逐个覆盖：中途失败会留下“半新半旧”的 node_modules，且 cp -R 不会删除
#     新版已删除的旧文件。v2 改为：
#         source → staging（tar 复制，同文件系统）→ diff/hash 校验 → node --check
#         → rm dest + mv staging（同盘 mv 原子替换）
#   - 稳定运行环境的最终形态（版本化 tarball / npm immutable artifact）见
#     docs/ARTIFACT_MIGRATION.md。
#
# 用法：
#   bash fix-web-profile.sh               同步全部插件
#   bash fix-web-profile.sh --check       只校验不写入（退出码 1=存在差异）
#   bash fix-web-profile.sh --plugins a,b 只同步指定插件
set -u
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_NM="$HOME/.dsh/profiles/web/node_modules"
FAIL=0
CHECK=0
FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --plugins) FILTER="$2"; shift 2 ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 2 ;;
  esac
done

# 插件映射：源码相对路径:安装副本名
PLUGINS=(
  "plugins/dsh-vision-bridge:dsh-vision-bridge"
  "plugins/dsh-web-pets:dsh-web-pets"
  "plugins/dsh-computer-use:dsh-computer-use"
  "projects/desktop-pets/integration/dsh-plugin:dsh-desktop-pets"
)

sync_plugin() {
  local pair="$1"
  local src="${pair%%:*}" name="${pair##*:}"
  local srcdir="$WS/$src" dstdir="$PROFILE_NM/$name"
  echo "==== $name ($src)"
  if [ ! -d "$srcdir" ]; then echo "  FAIL 源码目录不存在: $src"; FAIL=1; return 1; fi
  if [ ! -d "$dstdir" ]; then echo "  WARN 安装副本不存在: $name —— 请先 cd ~/.dsh/profiles/web && pnpm install"; FAIL=1; return 1; fi

  # 1) 版本对比
  local srcv dstv
  srcv="$(node -p "require('$srcdir/package.json').version" 2>/dev/null || echo '?')"
  dstv="$(node -p "require('$dstdir/package.json').version" 2>/dev/null || echo '?')"
  if [ "$srcv" != "$dstv" ]; then
    echo "  NOTE 版本不一致: 源码 $srcv vs 副本 ${dstv}（本次同步会更新 package.json）"
  fi

  # 2) files 清单（缺省 lib）
  local FILES
  FILES="$(node -p "JSON.stringify(require('$srcdir/package.json').files || [])" 2>/dev/null | tr -d '[]"' | tr ',' '\n' | sed '/^$/d')"
  [ -z "$FILES" ] && FILES="lib"

  # 3) staging（tar 复制，含 package.json）
  local stage
  stage="$PROFILE_NM/.staging/$name-$$"
  rm -rf "$stage"
  mkdir -p "$stage"
  (cd "$srcdir" && tar --exclude='./node_modules' -cf - package.json $FILES) | (cd "$stage" && tar -xf -)     || { echo "  FAIL staging 复制失败: $name"; FAIL=1; rm -rf "$stage"; return 1; }

  # 4) import smoke：所有 JS/MJS 语法检查
  local js_bad=0
  while IFS= read -r f; do
    if ! node --check "$f" >/dev/null 2>&1; then
      echo "  FAIL 语法检查: ${f#$stage/}"; js_bad=1
    fi
  done < <(find "$stage" -name '*.js' -o -name '*.mjs' 2>/dev/null)
  [ "$js_bad" -ne 0 ] && { FAIL=1; rm -rf "$stage"; return 1; }

  # 5) 校验：源码 files 与 staging 一致性
  local bad=0
  for entry in $FILES; do
    if [ -e "$srcdir/$entry" ] && ! diff -rq "$srcdir/$entry" "$stage/$entry" >/dev/null 2>&1; then
      echo "  FAIL staging 与源码不一致: $entry"; bad=1
    fi
  done
  [ "$bad" -ne 0 ] && { FAIL=1; rm -rf "$stage"; return 1; }

  # 6) 校验：源码 vs 现副本（--check 只报告；否则原子替换）
  local sync_needed=0
  if [ ! -f "$dstdir/package.json" ] || ! diff -rq "$stage" "$dstdir" >/dev/null 2>&1; then
    sync_needed=1
  fi
  if [ "$sync_needed" -eq 0 ]; then
    echo "  OK   $name 与源码一致"
    rm -rf "$stage"
    return 0
  fi
  if [ "$CHECK" -eq 1 ]; then
    echo "  FAIL $name 源码 != 副本（--check 模式，未写入）"
    FAIL=1
    rm -rf "$stage"
    return 1
  fi

  # 7) 原子替换：rm + mv（同盘 rename，避免半新半旧）
  echo "  SYNC $name → staging → 原子替换"
  rm -rf "$dstdir" && mv "$stage" "$dstdir"     || { echo "  FAIL 替换失败: $name"; FAIL=1; rm -rf "$stage"; return 1; }

  # 8) 替换后一致性复核
  if diff -rq "$srcdir" "$dstdir" >/dev/null 2>&1; then
    echo "  OK   $name == 副本"
  else
    # node_modules 等非 files 内容差异属预期，仅对 files 清单复核
    local recheck=0
    for entry in $FILES package.json; do
      [ -e "$srcdir/$entry" ] || continue
      if ! diff -rq "$srcdir/$entry" "$dstdir/$entry" >/dev/null 2>&1; then
        echo "  FAIL 替换后 ${entry} != 副本"; recheck=1
      fi
    done
    [ "$recheck" -ne 0 ] && FAIL=1
  fi
}

for pair in "${PLUGINS[@]}"; do
  name="${pair##*:}"
  if [ -n "$FILTER" ]; then
    case ",$FILTER," in *",$name,"*) ;; *) continue ;; esac
  fi
  sync_plugin "$pair"
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
  echo "存在 FAIL/NOTE 项，请处理后重跑。"
  exit 1
fi
if [ "$CHECK" -eq 1 ]; then
  echo "检查通过：全部插件与源码一致。"
else
  echo "完成。重启 dsh web 即可生效。"
fi