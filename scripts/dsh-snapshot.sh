#!/usr/bin/env bash
# =============================================================================
# dsh-snapshot.sh —— 创建 LKG（last-known-good）快照
#
# 快照目录：<home>/rollback/<TS>-<label>/
#   含 manifest.json、settings.yaml、cordis.patch.yml（用户级）、
#   profiles/<profile>/ 的 package.json / pnpm-lock.yaml / cordis.patch.yml /
#   cordis.yml / pnpm-workspace.yaml、repo.sha、config-dump.yaml（可选）
# 并维护 <home>/rollback/latest -> 最新快照 符号链接。
#
# 用法：
#   dsh-snapshot.sh [--profile web] [--home ~/.dsh] [--repo <path>]
#                   [--label <name>] [--keep N] [--dry-run] [--allow-unhealthy]
# =============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsh-lib.sh"

PROFILE="web"
HOME_DIR=""
REPO="${DSH_SNAPSHOT_REPO:-}"
LABEL="snapshot"
KEEP=8
DRY=0
ALLOW_UNHEALTHY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --allow-unhealthy) ALLOW_UNHEALTHY=1; shift ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

[ -z "$HOME_DIR" ] && HOME_DIR="$(resolve_home)"
[ -z "$REPO" ] && REPO="$REPO_ROOT"
PROFILE_DIR="$HOME_DIR/profiles/$PROFILE"
ROLLBACK_DIR="$HOME_DIR/rollback"

# ---------- preflight ----------
[ -d "$REPO/.git" ] || die "仓库目录无效: $REPO"
[ -f "$PROFILE_DIR/package.json" ] || die "profile 目录无效: ${PROFILE_DIR}（缺 package.json）"
[ -f "$PROFILE_DIR/pnpm-lock.yaml" ] || log_warn "profile 缺少 pnpm-lock.yaml（仍会快照，但依赖图不完整）"
command -v node >/dev/null 2>&1 || die "需要 node"
command -v shasum >/dev/null 2>&1 || die "需要 shasum"

# 若有运行中的 dsh web 且未 --allow-unhealthy：先做一次健康检查
if [ "$ALLOW_UNHEALTHY" -eq 0 ]; then
  pids="$(find_dsh_web_pids | tr '\n' ' ')"
  if [ -n "$pids" ]; then
    echo "== 快照前健康检查 =="
    if bash "$SCRIPT_DIR/dsh-healthcheck.sh" --pid "${pids%% *}" --timeout 15; then
      log_ok "当前实例健康（pid ${pids%% *}）"
    else
      die "当前 dsh web 不健康，拒绝创建 LKG 快照（确认没问题可 --allow-unhealthy）"
    fi
  else
    log_warn "未发现运行中的 dsh web，跳过在线健康检查（快照仍会记录当前文件状态）"
  fi
fi

TS="$(now_ts)"
DIR="$ROLLBACK_DIR/$TS-$LABEL"
mkdir -p "$DIR"

echo "== 快照: $DIR"
echo "  profile: $PROFILE_DIR"
echo "  repo:    $REPO ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?'))"

# ---------- 收集元数据 ----------
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPO_COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo '')"
REPO_BRANCH="$(git -C "$REPO" branch --show-current 2>/dev/null || echo '')"
DIRTY=$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
REPO_DIRTY="$([ "$DIRTY" -gt 0 ] && echo true || echo false)"
DSH_BIN="$(dsh_bin)"
DSH_VER="$(dsh_version)"
DSH_ROOT="$(dsh_install_root)"

LAUNCH_CMD=""
pids="$(find_dsh_web_pids | tr '\n' ' ')"
if [ -n "$pids" ]; then
  LAUNCH_CMD="$(ps -p "${pids%% *}" -o command= 2>/dev/null | sed 's/^[[:space:]]*//' || true)"
fi

# ---------- 复制文件（记录 sha256） ----------
FILES_TMP="$(mktemp)"
add_file() { # add_file <source> <snapshot-relative-name>
  local src="$1" name="$2"
  if [ ! -e "$src" ]; then log_warn "跳过缺失文件: $src"; return 0; fi
  mkdir -p "$(dirname "$DIR/$name")"
  cp -p "$src" "$DIR/$name" || { log_fail "复制失败: $src"; return 1; }
  local sha; sha="$($(sha_tool) "$DIR/$name" | awk '{print $1}')"
  printf '%s\t%s\t%s\n' "$name" "$src" "$sha" >> "$FILES_TMP"
}

FAILED=0
add_file "$HOME_DIR/settings.yaml" "settings.yaml" || FAILED=1
add_file "$HOME_DIR/cordis.patch.yml" "cordis.patch.yml" || FAILED=1
add_file "$PROFILE_DIR/cordis.patch.yml" "profile-cordis.patch.yml" || FAILED=1
add_file "$PROFILE_DIR/cordis.yml" "profile-cordis.yml" || FAILED=1
add_file "$PROFILE_DIR/package.json" "package.json" || FAILED=1
add_file "$PROFILE_DIR/pnpm-lock.yaml" "pnpm-lock.yaml" || FAILED=1
add_file "$PROFILE_DIR/pnpm-workspace.yaml" "pnpm-workspace.yaml" || FAILED=1
printf '%s\n' "$REPO_COMMIT" > "$DIR/repo.sha" 2>/dev/null
[ $FAILED -ne 0 ] && die "快照文件复制失败"

# config-dump（尽力而为，失败不阻断）
if [ -n "$DSH_BIN" ]; then
  (cd "$REPO" && "$DSH_BIN" --profile "$PROFILE" --dump-config > "$DIR/config-dump.yaml" 2>/dev/null) \
    || log_warn "dsh --dump-config 失败（config-dump.yaml 缺失，不影响回滚）"
fi

# ---------- 组装 manifest（node 生成，避免路径空格/引号问题） ----------
export SNAP_DIR="$DIR"
export SNAP_MANIFEST="$DIR/manifest.json"
export SNAP_CREATED_AT="$CREATED_AT"
export SNAP_REPO="$REPO"
export SNAP_COMMIT="$REPO_COMMIT"
export SNAP_BRANCH="$REPO_BRANCH"
export SNAP_DIRTY="$REPO_DIRTY"
export SNAP_DSH_BIN="$DSH_BIN"
export SNAP_DSH_VER="$DSH_VER"
export SNAP_DSH_ROOT="$DSH_ROOT"
export SNAP_PROFILE="$PROFILE"
export SNAP_HOME="$HOME_DIR"
export SNAP_PROFILE_DIR="$PROFILE_DIR"
export SNAP_LAUNCH="$LAUNCH_CMD"
export SNAP_FILES_TMP="$FILES_TMP"

node <<'NODE'
const fs = require('fs');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };

// files 列表：name	source	sha
const files = (fs.readFileSync(process.env.SNAP_FILES_TMP, 'utf8').trim().split('\n'))
  .filter(Boolean)
  .map(line => { const parts = line.split('	'); return { name: parts[0], source: parts[1], sha256: parts[2] }; });

// ownPlugins：仓库插件版本
const repo = process.env.SNAP_REPO;
const ownPluginPaths = {
  'dsh-computer-use': 'plugins/dsh-computer-use/package.json',
  'dsh-vision-bridge': 'plugins/dsh-vision-bridge/package.json',
  'dsh-web-pets': 'plugins/dsh-web-pets/package.json',
  'dsh-desktop-pets': 'projects/desktop-pets/integration/dsh-plugin/package.json',
};
const ownPlugins = {};
for (const name of Object.keys(ownPluginPaths)) {
  const pkg = readJson(repo + '/' + ownPluginPaths[name]);
  if (pkg && pkg.version) ownPlugins[name] = pkg.version;
}

// thirdParty + installShapes：profile package.json dependencies
const profilePkg = readJson(process.env.SNAP_PROFILE_DIR + '/package.json') || {};
const deps = profilePkg.dependencies || {};
const thirdParty = {};
const installShapes = {};
for (const name of Object.keys(deps)) {
  const spec = String(deps[name]);
  let shape = 'npm';
  if (spec.startsWith('file:')) shape = 'file';
  else if (spec.startsWith('link:')) shape = 'link';
  else if (spec.endsWith('.tgz')) shape = 'tarball';
  installShapes[name] = shape;
  const installed = readJson(process.env.SNAP_PROFILE_DIR + '/node_modules/' + name + '/package.json');
  thirdParty[name] = installed && installed.version ? installed.version : spec;
}

const manifest = {
  schemaVersion: 1,
  createdAt: process.env.SNAP_CREATED_AT,
  label: process.env.SNAP_DIR.split('/').pop(),
  home: process.env.SNAP_HOME,
  profile: process.env.SNAP_PROFILE,
  profileDir: process.env.SNAP_PROFILE_DIR,
  repoPath: process.env.SNAP_REPO,
  repoCommit: process.env.SNAP_COMMIT,
  repoBranch: process.env.SNAP_BRANCH,
  repoDirty: process.env.SNAP_DIRTY === 'true',
  dshBin: process.env.SNAP_DSH_BIN || null,
  dshVersion: process.env.SNAP_DSH_VER || null,
  dshInstallRoot: process.env.SNAP_DSH_ROOT || null,
  launchCommand: process.env.SNAP_LAUNCH || null,
  ownPlugins,
  thirdParty,
  installShapes,
  files,
};
fs.writeFileSync(process.env.SNAP_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
NODE

rm -f "$FILES_TMP"

# ---------- latest symlink + 清理 ----------
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] 未写盘；以上为将创建的快照内容。"
  rm -rf "$DIR"
  exit 0
fi

ln -sfn "$DIR" "$ROLLBACK_DIR/latest"
log_ok "latest -> $(basename "$DIR")"

# 清理旧快照（保留最近 KEEP 份，忽略 _broken-*）
count=0
for d in "$ROLLBACK_DIR"/[0-9]*-*; do
  [ -d "$d" ] || continue
  count=$((count+1))
done
if [ "$count" -gt "$KEEP" ]; then
  to_delete=$((count - KEEP))
  i=0
  for d in "$ROLLBACK_DIR"/[0-9]*-*; do
    [ -d "$d" ] || continue
    i=$((i+1))
    if [ "$i" -le "$to_delete" ]; then
      echo "  清理旧快照: $(basename "$d")"
      rm -rf "$d"
    fi
  done
fi

echo ""
echo "== 快照完成: $DIR =="
echo "  依赖图: pnpm-lock.yaml + package.json"
echo "  repo:   $REPO_COMMIT"
echo "  dsh:    ${DSH_VER:-?} (${DSH_BIN:-?})"
echo "  回滚:   bash $SCRIPT_DIR/dsh-rollback.sh latest"