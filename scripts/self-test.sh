#!/usr/bin/env bash
# =============================================================================
# self-test.sh —— 事务式升级/回滚脚本自检（CI repository job 调用）
#
# 覆盖：
#   1. bash -n 全部 shell 脚本
#   2. check-versions.mjs 能检测 versions.lock 漂移（fixture 断言）
#   3. dsh-snapshot.sh 在临时 DSH_HOME 上生成 manifest + latest symlink
#   4. dsh-rollback.sh --dry-run 对同一快照输出 restore 计划且哈希校验通过
#   5. check-repo.mjs 在仓库上通过
#
# 用法：bash scripts/self-test.sh [--repo <path>]
# 退出码：0=全部 PASS；1=存在失败
# =============================================================================
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:-}"
[ -z "$REPO" ] && REPO="$SCRIPT_DIR/.."
REPO="$(cd "$REPO" && pwd)"

FAIL=0
step() { echo ""; echo "===== $1 ====="; }
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; FAIL=1; }

# ---------- 1. bash -n ----------
step "1. bash -n 全部 shell 脚本"
for f in "$REPO"/scripts/*.sh "$REPO"/fix-web-profile.sh "$REPO"/sync-skills.sh; do
  if bash -n "$f" 2>/dev/null; then ok "bash -n $f"; else bad "bash -n $f"; fi
done

# ---------- 2. check-versions 漂移检测 ----------
step "2. check-versions.mjs 漂移检测（fixture）"
TMP="$(mktemp -d /tmp/dsh-selftest.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
FIX="$TMP/fixture"
mkdir -p "$FIX/plugins/dsh-computer-use" "$FIX/plugins/dsh-web-pets" "$FIX/projects/desktop-pets/integration/dsh-plugin"
cat > "$FIX/versions.lock.json" <<'EOF'
{
  "updatedAt": "2026-08-19",
  "profile": "web",
  "verified": {},
  "ownPlugins": {
    "dsh-computer-use": "0.1.0",
    "dsh-web-pets": "0.2.3",
    "dsh-desktop-pets": "0.1.0"
  }
}
EOF
echo '{"version":"0.1.0"}' > "$FIX/plugins/dsh-computer-use/package.json"
echo '{"version":"0.2.4"}' > "$FIX/plugins/dsh-web-pets/package.json"
echo '{"version":"0.1.0"}' > "$FIX/projects/desktop-pets/integration/dsh-plugin/package.json"
if node "$SCRIPT_DIR/check-versions.mjs" --repo "$FIX" >/dev/null 2>&1; then
  bad "check-versions 未检测到 dsh-web-pets 0.2.3 vs 0.2.4 漂移"
else
  out="$(node "$SCRIPT_DIR/check-versions.mjs" --repo "$FIX" 2>&1)"
  if printf '%s' "$out" | grep -q 'dsh-web-pets'; then
    ok "check-versions 检测到 dsh-web-pets 漂移"
  else
    bad "check-versions 退出非 0 但输出不含漂移明细: $(printf '%s' "$out" | head -3)"
  fi
fi

# ---------- 3. snapshot（临时 DSH_HOME） ----------
step "3. dsh-snapshot.sh（临时 home）"
SHOME="$TMP/home"
mkdir -p "$SHOME/profiles/web"
cat > "$SHOME/settings.yaml" <<'EOF'
# selftest settings
EOF
echo "# user patch" > "$SHOME/cordis.patch.yml"
echo "# profile patch" > "$SHOME/profiles/web/cordis.patch.yml"
echo "[]" > "$SHOME/profiles/web/cordis.yml"
cat > "$SHOME/profiles/web/package.json" <<'EOF'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-web-pets": "file:/tmp/dsh-web-pets"
  }
}
EOF
echo "lockfileVersion: '9.0'" > "$SHOME/profiles/web/pnpm-lock.yaml"
if bash "$SCRIPT_DIR/dsh-snapshot.sh" --home "$SHOME" --repo "$REPO" --label selftest --allow-unhealthy >/dev/null 2>&1; then
  ok "snapshot 执行成功"
else
  bad "snapshot 执行失败"; FAIL=1
fi
MANIFEST="$SHOME/rollback/latest/manifest.json"
if [ -f "$MANIFEST" ] && node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const need = ["createdAt","repoCommit","dshVersion","profileDir","ownPlugins","files","installShapes","launchCommand"];
for (const k of need) { if (!(k in m)) { console.error("缺少字段: " + k); process.exit(1); } }
if (!Array.isArray(m.files) || m.files.length === 0) { console.error("files 为空"); process.exit(1); }
if (!m.ownPlugins["dsh-web-pets"]) { console.error("ownPlugins 缺 dsh-web-pets"); process.exit(1); }
' "$MANIFEST"; then
  ok "manifest.json 字段齐全（repoCommit/dshVersion/ownPlugins/files/installShapes）"
else
  bad "manifest.json 缺失或字段不完整"; FAIL=1
fi
[ -L "$SHOME/rollback/latest" ] && ok "latest symlink 存在" || { bad "latest symlink 缺失"; FAIL=1; }
[ -f "$SHOME/rollback/latest/pnpm-lock.yaml" ] && ok "pnpm-lock.yaml 已入快照" || { bad "pnpm-lock.yaml 未入快照"; FAIL=1; }

# ---------- 4. rollback dry-run ----------
step "4. dsh-rollback.sh --dry-run（临时 home）"
bash "$SCRIPT_DIR/dsh-rollback.sh" latest --dry-run --home "$SHOME" --repo "$REPO" > "$TMP/rollback.out" 2>&1
RB_RC=$?
if [ "${RB_RC:-1}" -eq 0 ] && grep -q '回滚计划' "$TMP/rollback.out"; then
  ok "rollback dry-run 输出了回滚计划"
else
  bad "rollback dry-run 失败（rc=${RB_RC:-?}）"; FAIL=1
fi
if grep -q '快照文件哈希校验通过' "$TMP/rollback.out"; then
  ok "rollback 哈希校验通过"
else
  bad "rollback 哈希校验未通过/未执行"; FAIL=1
fi

# ---------- 5. check-repo ----------
step "5. check-repo.mjs（真实仓库）"
if node "$SCRIPT_DIR/check-repo.mjs" --repo "$REPO"; then
  ok "check-repo PASS"
else
  bad "check-repo FAIL"; FAIL=1
fi

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "== self-test: FAIL =="
  exit 1
fi
echo "== self-test: 全部 PASS =="