#!/usr/bin/env bash
# check-profile-patches.sh —— 校验 profile 的 cordis.patch.yml 与上游 bundle patch 的一致性
#
# 场景：@linxin666/dsh-web-ui-all 等 bundle 升级后，insert 的 id 或 config 形状可能变化；
# 本脚本（只读）检测：
#   1) profile 中引用的 web-ui-* id 是否仍在 bundle patch 中（防静默失效）；
#   2) profile 与 bundle 是否存在重复 insert（防插件 id 冲突）。
#
# 用法：bash scripts/check-profile-patches.sh [profile目录，默认 ~/.dsh/profiles/web]
set -u
PROFILE_DIR="${1:-$HOME/.dsh/profiles/web}"
PROFILE_PATCH="$PROFILE_DIR/cordis.patch.yml"
BUNDLE_PATCH="$PROFILE_DIR/node_modules/@linxin666/dsh-web-ui-all/cordis.patch.yml"
PROFILE_PATCH_ALT="$HOME/.dsh/cordis.patch.yml"

if [ ! -f "$PROFILE_PATCH" ]; then echo "错误: 找不到 $PROFILE_PATCH"; exit 2; fi
if [ ! -f "$BUNDLE_PATCH" ]; then
  echo "警告: 找不到 bundle patch: ${BUNDLE_PATCH}（跳过 bundle 对比；仅检查用户级 patch）"
  BUNDLE_PATCH=""
fi

# 提取文件中的插件 id（insert 列表与顶层 id 行均覆盖）
ids_in() {
  grep -oE 'id: [A-Za-z0-9_.-]+' "$1" | awk '{print $2}' | sort -u
}

echo "== 检查 $PROFILE_PATCH"
profile_ids="$(ids_in "$PROFILE_PATCH")"
bundle_ids=""
if [ -n "$BUNDLE_PATCH" ]; then bundle_ids="$(ids_in "$BUNDLE_PATCH")"; fi

# 1) web-ui-* 引用是否仍被 bundle 覆盖
if [ -n "$BUNDLE_PATCH" ]; then
  stale=0
  for id in $profile_ids; do
    case "$id" in
      web-ui-*)
        if ! echo "$bundle_ids" | grep -qx "$id"; then
          echo "  STALE profile 引用 $id 但 bundle patch 中不存在 —— 上游可能已改名/移除，config override 已静默失效"
          stale=1
        fi
        ;;
    esac
  done
  [ "$stale" -eq 0 ] && echo "  OK   profile 引用的 web-ui-* id 均在 bundle 中"
fi

# 2) 重复 insert（同一 id 同时出现在 profile 的 insert 列表与 bundle 的 insert 列表）
insert_ids_in() {
  python3 -c '
import re, sys
path = sys.argv[1]
ids = []
in_insert = False
for line in open(path, encoding="utf-8"):
    s = line.rstrip("\n")
    stripped = s.strip()
    if re.match(r"^- insert:$", stripped):
        in_insert = True
        continue
    if in_insert and s and not s[0].isspace():
        in_insert = False
    if in_insert:
        m = re.match(r"^-\s+id:\s*([\w.-]+)", stripped)
        if m:
            ids.append(m.group(1))
print("\n".join(sorted(set(ids))))
' "$1"
}
if [ -n "$BUNDLE_PATCH" ]; then
  profile_inserts="$(insert_ids_in "$PROFILE_PATCH")"
  bundle_inserts="$(insert_ids_in "$BUNDLE_PATCH")"
  dup=0
  for id in $bundle_inserts; do
    if echo "$profile_inserts" | grep -qx "$id"; then
      echo "  DUP  $id 同时作为 insert 出现在 bundle 与 profile —— 会造成重复注册，请人工确认"
      dup=1
    fi
  done
  [ "$dup" -eq 0 ] && echo "  OK   无重复 insert id"
fi

# 3) 用户级 patch 检查（web-ui-* 引用）
if [ -f "$PROFILE_PATCH_ALT" ]; then
  echo "== 检查 ${PROFILE_PATCH_ALT}（用户级）"
  alt_ids="$(ids_in "$PROFILE_PATCH_ALT")"
  if [ -n "$BUNDLE_PATCH" ]; then
    for id in $alt_ids; do
      case "$id" in
        web-ui-*)
          if ! echo "$bundle_ids" | grep -qx "$id"; then
            echo "  STALE 用户级 patch 引用 $id 但 bundle 中不存在"
          fi
          ;;
      esac
    done
  fi
fi

echo ""
echo "检查完成。无输出即无问题。"
