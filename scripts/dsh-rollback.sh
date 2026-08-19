#!/usr/bin/env bash
# =============================================================================
# dsh-rollback.sh —— 一键回滚到 LKG 快照
#
# 用法：
#   dsh-rollback.sh [latest|<TS>|<path>] [--yes] [--dry-run] [--force]
#                   [--profile web] [--home ~/.dsh] [--repo <path>] [--tag]
#
# 流程（--dry-run 只打印计划）：
#   1. 解析快照并校验 manifest + 文件 sha256
#   2. 当前损坏状态备份到 <home>/rollback/_broken-<TS>/
#   3. （--yes）停止当前 dsh web
#   4. 恢复 settings / patches / profile 文件
#   5. 仓库 checkout 到快照 repoCommit（工作区脏时需 --force 先 stash）
#   6. pnpm install --frozen-lockfile 精确还原依赖图
#   7. fix-web-profile.sh + sync-skills.sh 重同步自研插件/技能
#   8. 轻量冒烟（dsh --dump-config + 配置检查）→ 重启 → 健康检查
#   9. （--tag）创建 lkg-<TS>-<dshver> git tag
# =============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsh-lib.sh"

SNAP_REF="latest"
YES=0
DRY=0
FORCE=0
TAG=0
PROFILE="web"
HOME_DIR=""
REPO="${DSH_ROLLBACK_REPO:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --force) FORCE=1; shift ;;
    --tag) TAG=1; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    -*) die "未知参数: $1" ;;
    *) SNAP_REF="$1"; shift ;;
  esac
done

[ -z "$HOME_DIR" ] && HOME_DIR="$(resolve_home)"
[ -z "$REPO" ] && REPO="$REPO_ROOT"
PROFILE_DIR="$HOME_DIR/profiles/$PROFILE"
ROLLBACK_DIR="$HOME_DIR/rollback"

# ---------- 1. 解析快照 ----------
case "$SNAP_REF" in
  latest) SNAP_DIR="$ROLLBACK_DIR/latest" ;;
  /*) SNAP_DIR="$SNAP_REF" ;;
  *) SNAP_DIR="$ROLLBACK_DIR/$SNAP_REF" ;;
esac
[ -d "$SNAP_DIR" ] || die "快照不存在: $SNAP_DIR"
[ -f "$SNAP_DIR/manifest.json" ] || die "快照缺少 manifest.json: $SNAP_DIR"

MANIFEST="$SNAP_DIR/manifest.json"
[ -f "$PROFILE_DIR/package.json" ] || die "profile 目录无效: $PROFILE_DIR"

echo "== 回滚目标: $(basename "$SNAP_DIR")"
node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log("  repoCommit: " + (m.repoCommit || "?"));
console.log("  dsh:        " + (m.dshVersion || "?"));
console.log("  createdAt:  " + (m.createdAt || "?"));
console.log("  ownPlugins: " + JSON.stringify(m.ownPlugins || {}));
' "$MANIFEST"

# ---------- 2. 校验文件哈希 ----------
SUMS="$(mktemp)"
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const out = (m.files || []).map(f => f.sha256 + "  " + f.name).join("\n") + "\n";
fs.writeFileSync(process.argv[2], out);
' "$MANIFEST" "$SUMS"
if (cd "$SNAP_DIR" && $(sha_tool) -c "$SUMS" >/dev/null 2>&1); then
  log_ok "快照文件哈希校验通过"
else
  echo "--- 哈希校验失败明细 ---"
  (cd "$SNAP_DIR" && $(sha_tool) -c "$SUMS" 2>&1) | grep -v ': OK$' | head -20 || true
  rm -f "$SUMS"
  die "快照文件损坏，拒绝回滚"
fi
rm -f "$SUMS"

# ---------- 3. 备份当前（损坏）状态 ----------
BROKEN_TS="$(now_ts)"
BROKEN_DIR="$ROLLBACK_DIR/_broken-$BROKEN_TS"
plan_backup() {
  mkdir -p "$BROKEN_DIR"
  for f in settings.yaml cordis.patch.yml; do
    [ -f "$HOME_DIR/$f" ] && cp -p "$HOME_DIR/$f" "$BROKEN_DIR/$f"
  done
  for f in package.json pnpm-lock.yaml cordis.patch.yml cordis.yml pnpm-workspace.yaml; do
    [ -f "$PROFILE_DIR/$f" ] && cp -p "$PROFILE_DIR/$f" "$BROKEN_DIR/profile-$f"
  done
}

# ---------- 4. 停止 dsh web ----------
stop_web() {
  pids="$(find_dsh_web_pids | tr '\n' ' ')"
  [ -z "$pids" ] && { log_warn "未发现运行中的 dsh web（跳过停止）"; return 0; }
  echo "  停止 dsh web: $pids"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done
}

# ---------- 5. 恢复文件 ----------
restore_files() {
  [ -f "$SNAP_DIR/settings.yaml" ] && cp -p "$SNAP_DIR/settings.yaml" "$HOME_DIR/settings.yaml"
  [ -f "$SNAP_DIR/cordis.patch.yml" ] && cp -p "$SNAP_DIR/cordis.patch.yml" "$HOME_DIR/cordis.patch.yml"
  for pair in "package.json:package.json" "pnpm-lock.yaml:pnpm-lock.yaml" "profile-cordis.patch.yml:cordis.patch.yml" "profile-cordis.yml:cordis.yml" "profile-pnpm-workspace.yaml:pnpm-workspace.yaml"; do
    src="${pair%%:*}"; dst="${pair##*:}"
    [ -f "$SNAP_DIR/$src" ] && cp -p "$SNAP_DIR/$src" "$PROFILE_DIR/$dst"
  done
}

# ---------- 6. 仓库 checkout ----------
checkout_repo() {
  local target="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(m.repoCommit||"")' "$MANIFEST")"
  [ -z "$target" ] && { log_warn "manifest 无 repoCommit，跳过 checkout"; return 0; }
  local head; head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
  [ "$head" = "$target" ] && { log_ok "仓库已在目标 commit（${target:0:12}）"; return 0; }
  if ! git -C "$REPO" cat-file -e "$target^{commit}" 2>/dev/null; then
    echo "  目标 commit 本地缺失，尝试 fetch…"
    git -C "$REPO" fetch origin "$target" 2>/dev/null || git -C "$REPO" fetch origin 2>/dev/null || die "无法获取 commit $target"
  fi
  if [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
    if [ "$FORCE" -eq 1 ]; then
      echo "  工作区脏，--force：先 stash"
      git -C "$REPO" stash push -m "rollback-$BROKEN_TS" || die "stash 失败"
    else
      die "仓库工作区有未提交改动（回滚需要 checkout 到 ${target}）；先提交/stash，或 --force"
    fi
  fi
  git -C "$REPO" checkout --detach "$target" || die "checkout 失败: $target"
  log_ok "仓库已 checkout 到 ${target:0:12}"
}

# ---------- 7. 重装依赖 + 同步 ----------
reinstall_profile() {
  command -v pnpm >/dev/null 2>&1 || die "需要 pnpm"
  (cd "$PROFILE_DIR" && pnpm install --frozen-lockfile) || die "pnpm install --frozen-lockfile 失败（可重试；当前状态已备份于 ${BROKEN_DIR}）"
  bash "$REPO_ROOT/fix-web-profile.sh" || log_warn "fix-web-profile.sh 有告警（查看上方输出）"
  [ -f "$REPO_ROOT/sync-skills.sh" ] && bash "$REPO_ROOT/sync-skills.sh" || true
}

# ---------- 8. 轻量冒烟 + 重启 + 健康检查 ----------
smoke_and_restart() {
  local dsh_bin; dsh_bin="$(dsh_bin)"
  if [ -n "$dsh_bin" ]; then
    if (cd "$REPO_ROOT" && "$dsh_bin" --profile "$PROFILE" --dump-config >/dev/null 2>&1); then
      log_ok "dsh --dump-config 冒烟通过"
    else
      log_fail "dsh --dump-config 失败（配置/插件加载异常）"
      return 1
    fi
  fi
  [ -f "$REPO_ROOT/scripts/check-profile-patches.sh" ] && bash "$REPO_ROOT/scripts/check-profile-patches.sh" "$PROFILE_DIR" || true
  echo "  启动 dsh web…"
  local logdir="$HOME_DIR/logs"; mkdir -p "$logdir"
  local logf="$logdir/web.log"
  local launch="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(m.launchCommand||"")' "$MANIFEST")"
  if [ -n "$launch" ]; then
    nohup sh -c "$launch" >> "$logf" 2>&1 &
  else
    nohup "$dsh_bin" --profile "$PROFILE" >> "$logf" 2>&1 &
  fi
  if ! wait_for_boot "$logf" 60; then
    echo "--- 启动失败日志尾部 ---"; tail -30 "$logf" || true
    return 1
  fi
  local rpid; rpid="$(find_dsh_web_pids | head -1)"
  local port=""; [ -n "$rpid" ] && port="$(port_of_pid "$rpid")"
  if bash "$SCRIPT_DIR/dsh-healthcheck.sh" ${port:+--url "http://127.0.0.1:$port"} --log "$logf" --timeout 30; then
    log_ok "重启后健康检查通过"
  else
    log_fail "重启后健康检查失败（见上方输出）"
    return 1
  fi
}

# ========== 执行 ==========
echo ""
echo "== 回滚计划 =="
echo "  1. 备份当前状态 -> $BROKEN_DIR"
echo "  2. 停止 dsh web（--yes 时执行）"
echo "  3. 恢复快照文件 + checkout $REPO"
echo "  4. pnpm install --frozen-lockfile + fix-web-profile + sync-skills"
echo "  5. 冒烟 + 重启 + 健康检查"
if [ "$DRY" -eq 1 ]; then
  echo ""
  echo "[dry-run] 未执行任何修改。"
  exit 0
fi

plan_backup
if [ "$YES" -eq 1 ]; then stop_web; else log_warn "未 --yes：跳过停止 dsh web（回滚文件仍会恢复，重启需手动）"; fi
restore_files
log_ok "配置/依赖图已恢复（备份: ${BROKEN_DIR}）"
checkout_repo
reinstall_profile
if smoke_and_restart; then
  if [ "$TAG" -eq 1 ]; then
    dshv="$(dsh_version)"
    tag="lkg-$(now_ts)-${dshv:-unknown}"
    git -C "$REPO" tag -f "$tag" 2>/dev/null && log_ok "创建 tag $tag"
  fi
  echo ""
  echo "== 回滚完成 =="
else
  echo ""
  echo "== 回滚未完全成功：请检查上方日志；当前状态已备份于 $BROKEN_DIR =="
  exit 1
fi