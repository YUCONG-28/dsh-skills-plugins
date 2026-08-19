#!/usr/bin/env bash
# =============================================================================
# dsh-safe-upgrade.sh —— 事务式升级：preflight → snapshot → tests → canary →
#                        apply → canary → health-check → promote / auto-rollback
#
# 用法：
#   dsh-safe-upgrade.sh [--profile web] [--home ~/.dsh] [--repo <path>]
#     [--dsh-target <0.1.0-rc.8|next>]   # 升级全局 dsh（npm install -g @deepseek-ai/dsh@<target>）
#     [--profile-deps "<spec>..."]       # profile 依赖升级（cd profile && pnpm install <specs>）
#     [--repo-update]                    # git fetch + ff-only merge origin/main
#     [--dry-run] [--skip-tests] [--skip-canary] [--yes] [--no-tag] [--update-lock]
#     [--keep-snapshots N]
#
# 核心保证：apply 之后的任何一步失败 → 自动 dsh-rollback.sh latest --yes。
# =============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsh-lib.sh"

PROFILE="web"
HOME_DIR=""
REPO="${DSH_SAFE_UPGRADE_REPO:-}"
DSH_TARGET=""
PROFILE_DEPS=""
REPO_UPDATE=0
DRY=0
SKIP_TESTS=0
SKIP_CANARY=0
YES=0
NO_TAG=0
UPDATE_LOCK=0
KEEP_SNAPSHOTS=8

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dsh-target) DSH_TARGET="$2"; shift 2 ;;
    --profile-deps) PROFILE_DEPS="$2"; shift 2 ;;
    --repo-update) REPO_UPDATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --skip-canary) SKIP_CANARY=1; shift ;;
    --yes) YES=1; shift ;;
    --no-tag) NO_TAG=1; shift ;;
    --update-lock) UPDATE_LOCK=1; shift ;;
    --keep-snapshots) KEEP_SNAPSHOTS="$2"; shift 2 ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

[ -z "$HOME_DIR" ] && HOME_DIR="$(resolve_home)"
[ -z "$REPO" ] && REPO="$REPO_ROOT"
PROFILE_DIR="$HOME_DIR/profiles/$PROFILE"
CANARY_ROOT="$REPO/.dsh-canary"

# ---------- 1. preflight ----------
echo "== [1/8] preflight =="
[ -n "$(dsh_bin)" ] || die "需要 dsh 可执行（command -v dsh）"
command -v pnpm >/dev/null 2>&1 || die "需要 pnpm"
command -v node >/dev/null 2>&1 || die "需要 node"
[ -f "$PROFILE_DIR/package.json" ] || die "profile 目录无效: $PROFILE_DIR"
node "$SCRIPT_DIR/check-versions.mjs" --repo "$REPO" --profile "$PROFILE_DIR" || die "versions.lock 与仓库/profile 不一致（可先运行 scripts/update-versions-lock.mjs --write）"
if [ "$REPO_UPDATE" -eq 1 ]; then
  if [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
    die "--repo-update 要求仓库工作区干净（先 commit/stash）"
  fi
fi
log_ok "preflight 通过"

# ---------- 2. snapshot ----------
echo ""
echo "== [2/8] 创建 LKG snapshot =="
SNAP_ARGS=(--profile "$PROFILE" --home "$HOME_DIR" --repo "$REPO" --label pre-upgrade --keep "$KEEP_SNAPSHOTS")
if [ "$DRY" -eq 1 ]; then SNAP_ARGS+=(--dry-run); fi
bash "$SCRIPT_DIR/dsh-snapshot.sh" "${SNAP_ARGS[@]}" || die "snapshot 失败"
log_ok "LKG snapshot 完成"

# ---------- 3. tests ----------
if [ "$SKIP_TESTS" -eq 0 ]; then
  echo ""
  echo "== [3/8] 全插件测试 =="
  bash "$SCRIPT_DIR/run-plugin-tests.sh" --repo "$REPO" --skip-install || die "升级前测试失败，中止（未修改任何生产状态）"
  log_ok "全插件测试通过"
else
  echo "== [3/8] 跳过测试（--skip-tests）=="
fi

# ---------- 4. canary（旧状态基线） ----------
canary_check() { # canary_check <label> <home-dir>
  local label="$1" c_home="$2"
  echo ""
  echo "== canary[$label]: 隔离 DSH_HOME=$c_home =="
  rm -rf "$c_home"
  mkdir -p "$c_home/profiles/$PROFILE"
  # 复制配置骨架（settings.yaml 可能含本地密钥，仅本地使用，.dsh-canary 已 gitignore）
  [ -f "$HOME_DIR/settings.yaml" ] && cp -p "$HOME_DIR/settings.yaml" "$c_home/settings.yaml" || true
  [ -f "$HOME_DIR/cordis.patch.yml" ] && cp -p "$HOME_DIR/cordis.patch.yml" "$c_home/cordis.patch.yml" || true
  # 注意：不复制 pnpm-lock.yaml——lockfile 里的 file: 依赖是相对真实 profile 路径解析的，
  # 复制到 canary 后会错位；canary 用 package.json（绝对 file: 路径）重新解析安装。
  for f in package.json cordis.patch.yml cordis.yml pnpm-workspace.yaml; do
    [ -f "$PROFILE_DIR/$f" ] && cp -p "$PROFILE_DIR/$f" "$c_home/profiles/$PROFILE/$f"
  done
  # pnpm 11 默认阻断未批准的生命周期脚本（ERR_PNPM_IGNORED_BUILDS），对 file: 依赖
  # 会生成 "set this to true or false" 占位并要求交互式 approve-builds。
  # canary 是隔离验证环境，直接开启 dangerouslyAllowAllBuilds（vision-bridge 的
  # postinstall 编译 OCR 本身 fail-soft；node-pty/ssh2 原生构建按需执行）。
  if [ -f "$c_home/profiles/$PROFILE/pnpm-workspace.yaml" ]; then
    perl -pi -e 's/set this to true or false/true/g' "$c_home/profiles/$PROFILE/pnpm-workspace.yaml"
    grep -q '^dangerouslyAllowAllBuilds' "$c_home/profiles/$PROFILE/pnpm-workspace.yaml" \
      || printf '\ndangerouslyAllowAllBuilds: true\n' >> "$c_home/profiles/$PROFILE/pnpm-workspace.yaml"
    grep -q '^packageImportMethod' "$c_home/profiles/$PROFILE/pnpm-workspace.yaml" \
      || printf 'packageImportMethod: copy\n' >> "$c_home/profiles/$PROFILE/pnpm-workspace.yaml"
  else
    printf 'packages:\n  - .\n\ndangerouslyAllowAllBuilds: true\npackageImportMethod: copy\n' > "$c_home/profiles/$PROFILE/pnpm-workspace.yaml"
  fi
  (cd "$c_home/profiles/$PROFILE" && pnpm install) || { log_fail "canary pnpm install 失败"; return 1; }
  local logf; logf="$(mktemp /tmp/dsh-canary.$label.XXXXXX)"
  DSH_HOME="$c_home" "$(dsh_bin)" --profile "$PROFILE" --port 0 > "$logf" 2>&1 &
  local cpid=$!
  if ! wait_for_boot "$logf" 90; then
    echo "--- canary 启动失败日志尾部 ---"; tail -30 "$logf" || true
    kill "$cpid" 2>/dev/null || true
    return 1
  fi
  local url; url="$(grep -oE 'http://[^ ]+' "$logf" | head -1)"
  # canary 校验：dsh boot 日志很安静（不含插件名/session 标记），
  # 因此用 --dump-config 校验插件组合、--plugins "" 跳过日志插件 grep。
  bash "$SCRIPT_DIR/dsh-healthcheck.sh" --url "$url" --log "$logf" --require-log --pid "$cpid" \
    --plugins "" --skip session --dump-config --dump-home "$c_home" --timeout 30 \
    || { kill "$cpid" 2>/dev/null || true; return 1; }
  kill "$cpid" 2>/dev/null || true
  wait "$cpid" 2>/dev/null || true
  return 0
}

if [ "$SKIP_CANARY" -eq 0 ]; then
  canary_check before "$CANARY_ROOT/before" || die "旧状态 canary 失败，中止"
  log_ok "旧状态 canary 通过"
else
  echo "== [4/8] 跳过 canary（--skip-canary）=="
fi

# ---------- 5. apply ----------
echo ""
echo "== [5/8] apply =="
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] 不执行任何升级动作；本次仅验证 preflight/snapshot/tests/canary。"
  echo ""
  echo "== safe-upgrade（dry-run）完成 =="
  exit 0
fi
[ -n "$DSH_TARGET" ] && { echo "  npm install -g @deepseek-ai/dsh@$DSH_TARGET"; npm install -g "@deepseek-ai/dsh@$DSH_TARGET" || die "dsh 升级失败"; }
if [ "$REPO_UPDATE" -eq 1 ]; then
  git -C "$REPO" fetch origin || die "git fetch 失败"
  git -C "$REPO" merge --ff-only origin/main || die "ff-only merge origin/main 失败（工作区可能有改动）"
  echo "  仓库已更新到 origin/main"
fi
if [ -n "$PROFILE_DEPS" ]; then
  (cd "$PROFILE_DIR" && pnpm install $PROFILE_DEPS) || die "profile 依赖升级失败"
fi
bash "$REPO_ROOT/fix-web-profile.sh" || log_warn "fix-web-profile.sh 有告警"
[ -f "$REPO_ROOT/sync-skills.sh" ] && bash "$REPO_ROOT/sync-skills.sh" || true
log_ok "apply 完成（dsh/仓库/profile 依赖已更新，副本已同步）"

# ---------- 6. canary（新状态） ----------
if [ "$SKIP_CANARY" -eq 0 ]; then
  if canary_check after "$CANARY_ROOT/after"; then
    log_ok "新状态 canary 通过"
  else
    echo ""
    echo "== 新状态 canary 失败 → 自动回滚 latest =="
    bash "$SCRIPT_DIR/dsh-rollback.sh" latest --yes --profile "$PROFILE" --home "$HOME_DIR" --repo "$REPO" || true
    exit 1
  fi
else
  echo "== [6/8] 跳过新状态 canary =="
fi

# ---------- 7. promote ----------
echo ""
echo "== [7/8] promote（同步真实 profile） =="
if [ "$YES" -eq 1 ]; then
  pids="$(find_dsh_web_pids | tr '\n' ' ')"
  if [ -n "$pids" ]; then
    echo "  停止旧 dsh web: $pids"
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    sleep 2
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true; done
  fi
  mkdir -p "$HOME_DIR/logs"
  nohup "$(dsh_bin)" --profile "$PROFILE" >> "$HOME_DIR/logs/web.log" 2>&1 &
  if ! wait_for_boot "$HOME_DIR/logs/web.log" 60; then
    echo "--- 新实例启动失败日志尾部 ---"; tail -30 "$HOME_DIR/logs/web.log" || true
    echo "== promote 失败 → 自动回滚 latest =="
    bash "$SCRIPT_DIR/dsh-rollback.sh" latest --yes --profile "$PROFILE" --home "$HOME_DIR" --repo "$REPO" || true
    exit 1
  fi
  rpid="$(find_dsh_web_pids | head -1)"
  port=""; [ -n "$rpid" ] && port="$(port_of_pid "$rpid")"
  if bash "$SCRIPT_DIR/dsh-healthcheck.sh" ${port:+--url "http://127.0.0.1:$port"} ${rpid:+--pid "$rpid"} \
      --log "$HOME_DIR/logs/web.log" --require-log --plugins "" --skip session \
      --dump-config --dump-home "$HOME_DIR" --timeout 30; then
    log_ok "生产实例健康检查通过"
  else
    echo "== 生产健康检查失败 → 自动回滚 latest =="
    bash "$SCRIPT_DIR/dsh-rollback.sh" latest --yes --profile "$PROFILE" --home "$HOME_DIR" --repo "$REPO" || true
    exit 1
  fi
else
  log_warn "未 --yes：跳过真实实例重启（副本已同步，手动重启 dsh web 后生效）"
fi

# ---------- 8. tag + versions.lock ----------
echo ""
echo "== [8/8] 收尾 =="
if [ "$NO_TAG" -eq 0 ] && [ "$YES" -eq 1 ]; then
  dshv="$(dsh_version)"
  tag="lkg-$(now_ts)-${dshv:-unknown}"
  git -C "$REPO" tag -f "$tag" 2>/dev/null && log_ok "创建 LKG tag $tag" || log_warn "创建 tag 失败"
fi
if [ "$UPDATE_LOCK" -eq 1 ]; then
  node "$SCRIPT_DIR/update-versions-lock.mjs" --repo "$REPO" --profile "$PROFILE_DIR" --write || log_warn "update-versions-lock 失败"
  log_ok "versions.lock.json 已更新（记得提交）"
fi
echo ""
echo "== safe-upgrade 完成 =="