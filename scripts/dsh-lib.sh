#!/usr/bin/env bash
# dsh-lib.sh —— 事务式升级/回滚脚本共享库（被 dsh-snapshot / dsh-rollback /
# dsh-healthcheck / dsh-safe-upgrade 引用）。只定义函数与变量，不执行动作。
#
# 约定：
#   DSH_HOME 环境变量优先；否则 $HOME/.dsh
#   PROFILE  默认 web
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------- 基础输出 ----------
log_info()  { echo "  INFO  $*"; }
log_ok()    { echo "  OK    $*"; }
log_warn()  { echo "  WARN  $*"; }
log_fail()  { echo "  FAIL  $*"; }
die()       { echo "错误: $*" >&2; exit 1; }

now_ts()    { date +%Y%m%d-%H%M%S; }

resolve_home() {
  echo "${DSH_HOME:-$HOME/.dsh}"
}

resolve_profile_dir() {
  local home="$(resolve_home)"
  local profile="${PROFILE:-web}"
  echo "$home/profiles/$profile"
}

# ---------- dsh 环境 ----------
dsh_bin() {
  command -v dsh 2>/dev/null || echo ""
}

dsh_version() {
  local bin; bin="$(dsh_bin)"
  [ -n "$bin" ] && "$bin" --version 2>/dev/null | head -1 || echo ""
}

dsh_install_root() {
  local bin; bin="$(dsh_bin)"
  [ -z "$bin" ] && return 0
  local real; real="$(readlink -f "$bin" 2>/dev/null || echo "$bin")"
  local pkg; pkg="$(dirname "$(dirname "$real")")"
  if [ -f "$pkg/package.json" ]; then
    echo "$pkg"
  fi
}

# 查找运行中的 dsh web 进程（返回 pid 列表，一行一个）
# 说明：优先 ps + grep（macOS 沙箱下 pgrep -f 可能不可见），并排除脚本自身。
find_dsh_web_pids() {
  ps ax -o pid=,command= 2>/dev/null | grep -E '[d]sh web|[d]sh --profile' | while read -r pid rest; do
    case "$rest" in
      *"dsh-healthcheck"*|*"dsh-safe-upgrade"*|*"dsh-rollback"*|*"dsh-snapshot"*) continue ;;
    esac
    echo "$pid"
  done | sort -u
}

# 根据监听端口找 pid
pid_of_port() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1
}

# 根据 pid 找监听端口
port_of_pid() {
  local pid="$1"
  lsof -nP -iTCP -sTCP:LISTEN -a -p "$pid" 2>/dev/null | awk 'NR>1{print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | head -1
}

# 等待 dsh web 日志出现启动行
wait_for_boot() {
  local log="$1" timeout="${2:-60}"
  local i=0
  while [ "$i" -lt "$timeout" ]; do
    if grep -qE 'dsh web: http' "$log" 2>/dev/null; then return 0; fi
    i=$((i+1)); sleep 1
  done
  return 1
}

# 等待 HTTP 200
wait_for_http() {
  local url="$1" timeout="${2:-30}"
  local i=0
  while [ "$i" -lt "$timeout" ]; do
    if curl -fsS -m 3 -o /dev/null "$url" 2>/dev/null; then return 0; fi
    i=$((i+1)); sleep 1
  done
  return 1
}

# 判定是否致命错误行（支持 --allow-pattern 正则排除）
is_fatal_line() {
  local line="$1"; shift
  local re
  for re in "$@"; do
    if printf '%s' "$line" | grep -qE "$re"; then return 1; fi
  done
  printf '%s' "$line" | grep -qE 'unhandledRejection|FATAL|fatal error|TypeError:|ReferenceError:|ERR_UNCAUGHT_EXCEPTION' || true
}