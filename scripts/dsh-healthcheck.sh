#!/usr/bin/env bash
# =============================================================================
# dsh-healthcheck.sh —— dsh web 实例健康检查（“崩溃保险丝”）
#
# 检查项：
#   1. 进程存活（--pid 指定，否则自动探测；多个实例报歧义）
#   2. HTTP 服务：GET <url>/ 200 且含 window.__DSH_BOOT__
#   3. Web UI client 加载：__DSH_BOOT__ entries 非空
#   4. 插件加载完成：默认用 dsh --dump-config 组合校验（--dump-config）；
#      --check-log-plugins 时才改为日志 grep 各插件名
#   5. 无 fatal：日志不含 unhandledRejection / FATAL / TypeError 等（可用
#      --allow-pattern 排除白名单行）
#   6. 会话/工作区初始化（日志级，尽力而为）：日志含 session/workspace 标记
#      且无对应错误
#
# 用法：
#   dsh-healthcheck.sh [--url http://127.0.0.1:PORT] [--pid <pid>] [--log <path>]
#                      [--plugins a,b,c] [--timeout 30] [--allow-pattern <re>]...
#                      [--skip process|http|log|session] [--json]
#
# 退出码：0=全部 PASS；1=存在 FAIL；2=用法/探测歧义错误
# =============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsh-lib.sh"

URL=""
PID=""
LOG=""
PLUGINS="computer-use,web-pets,dsh-web-ui-all"
TIMEOUT=30
JSON=0
ALLOW=()
SKIP_PROCESS=0 SKIP_HTTP=0 SKIP_LOG=0 SKIP_SESSION=1
REQUIRE_LOG=0
CHECK_LOG_PLUGINS=0
DUMP_CONFIG=0
DUMP_HOME=""
DUMP_PROFILE="web"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --pid) PID="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --plugins) PLUGINS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --allow-pattern) ALLOW+=("$2"); shift 2 ;;
    --skip) case "$2" in process) SKIP_PROCESS=1;; http) SKIP_HTTP=1;; log) SKIP_LOG=1;; session) SKIP_SESSION=1;; *) die "未知 --skip 目标: $2";; esac; shift 2 ;;
    --require-log) REQUIRE_LOG=1; shift ;;
    --check-log-plugins) CHECK_LOG_PLUGINS=1; shift ;;
    --check-session) SKIP_SESSION=0; shift ;;
    --dump-config) DUMP_CONFIG=1; shift ;;
    --dump-home) DUMP_HOME="$2"; shift 2 ;;
    --dump-profile) DUMP_PROFILE="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

PASS=0; FAIL=0
declare -a RESULTS=()

mark() { # mark <status> <name> <detail>
  local st="$1" name="$2" detail="${3:-}"
  RESULTS+=("$st|$name|$detail")
  if [ "$st" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# ---------- 1. 进程存活 ----------
if [ "$SKIP_PROCESS" -eq 0 ]; then
  if [ -n "$PID" ]; then
    if kill -0 "$PID" 2>/dev/null; then
      mark PASS "进程存活" "pid $PID"
    else
      mark FAIL "进程存活" "pid $PID 不存在"
    fi
  else
    pids="${pids:-}"
    count="${count:-0}"
    pids="$(find_dsh_web_pids | tr '\n' ' ')"
    count=$(find_dsh_web_pids | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ] && [ -n "$URL" ]; then
      # 兜底：按 URL 端口反查监听进程
      port="$(printf '%s' "$URL" | sed -E 's#.*:([0-9]+).*#\1#')"
      [ -n "$port" ] && PID="$(pid_of_port "$port")"
      count=0; [ -n "$PID" ] && count=1
    fi
    if [ "$count" -eq 0 ]; then
      mark FAIL "进程存活" "未发现运行中的 dsh web（可 --pid 指定）"
    elif [ "$count" -gt 1 ]; then
      mark FAIL "进程存活" "发现多个 dsh web 实例: ${pids:-}（请用 --pid 指定）"
    else
      [ -z "$PID" ] && PID=$(find_dsh_web_pids | head -1)
      mark PASS "进程存活" "pid $PID"
    fi
  fi
fi

# ---------- 2. HTTP 服务 ----------
if [ "$SKIP_HTTP" -eq 0 ]; then
  if [ -z "$URL" ]; then
    if [ -n "$PID" ]; then
      port="$(port_of_pid "$PID")"
      [ -n "$port" ] && URL="http://127.0.0.1:$port"
    fi
  fi
  if [ -z "$URL" ]; then
    mark FAIL "HTTP 服务" "无法确定 URL（--url 或运行中的进程）"
  elif wait_for_http "$URL" "$TIMEOUT"; then
    html="$(curl -fsS -m 5 "$URL/" 2>/dev/null || true)"
    if printf '%s' "$html" | grep -q 'window.__DSH_BOOT__'; then
      mark PASS "HTTP 服务" "$URL/ 200 + __DSH_BOOT__"
    else
      mark FAIL "HTTP 服务" "$URL/ 200 但缺少 __DSH_BOOT__ 标记"
    fi
  else
    mark FAIL "HTTP 服务" "$URL/ 在 ${TIMEOUT}s 内未返回 200"
  fi
fi

# ---------- 3. Web UI client 加载（boot HTML entries 非空） ----------
if [ "$SKIP_HTTP" -eq 0 ] && [ -n "$URL" ]; then
  html="$(curl -fsS -m 5 "$URL/" 2>/dev/null || true)"
  entries=$(printf '%s' "$html" | grep -oE '"id":"[^"]+"' | wc -l | tr -d ' ')
  if [ "${entries:-0}" -gt 0 ]; then
    mark PASS "Web UI client" "${entries} 个 client 插件 entry"
  else
    mark FAIL "Web UI client" "boot HTML 无 client entries"
  fi
fi

# ---------- 4/5/6. 日志检查 ----------
if [ "$SKIP_LOG" -eq 0 ]; then
  if [ -z "$LOG" ]; then
    LOG="$HOME/.dsh/logs/web.log"
    [ -f "$LOG" ] || LOG=""
  fi
  if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
    if [ "$REQUIRE_LOG" -eq 1 ]; then
      mark FAIL "日志检查" "找不到日志（--log <path> 或 ~/.dsh/logs/web.log）"
    else
      log_warn "无日志文件（--log 或 ~/.dsh/logs/web.log），跳过插件加载/无 fatal/session 检查（--require-log 强制）"
    fi
  else
    # 4. 插件加载（--check-log-plugins 才做日志 grep；默认用 dump-config 校验插件组合）
    if [ "$CHECK_LOG_PLUGINS" -eq 1 ]; then
      IFS=',' read -r -a plugin_list <<< "$PLUGINS"
      for p in "${plugin_list[@]:-}"; do
        p="$(echo "$p" | xargs)"
        [ -z "$p" ] && continue
        if grep -qi "$p" "$LOG"; then
          mark PASS "插件加载" "$p"
        else
          mark FAIL "插件加载" "日志中未出现 $p"
        fi
      done
    fi
    # 5. fatal
    fatal=0
    while IFS= read -r line; do
      if is_fatal_line "$line" "${ALLOW[@]:-}"; then
        fatal=1
        mark FAIL "无 fatal" "日志含致命错误: $(printf '%s' "$line" | cut -c1-160)"
        break
      fi
    done < <(tail -n 500 "$LOG")
    [ "$fatal" -eq 0 ] && mark PASS "无 fatal" "最近 500 行无致命错误"
    # 6. session/workspace（尽力而为）
    if [ "$SKIP_SESSION" -eq 0 ]; then
      if grep -qiE 'session|workspace' "$LOG" && ! grep -qiE 'session.*(fail|error)|workspace.*(fail|error)' "$LOG"; then
        mark PASS "会话服务" "日志含 session/workspace 初始化标记"
      else
        mark FAIL "会话服务" "日志缺少 session/workspace 标记或含对应错误"
      fi
    fi
  fi
fi

# ---------- 6b. dump-config 组合校验（--dump-config） ----------
if [ "$DUMP_CONFIG" -eq 1 ]; then
  DUMP_TMP="$(mktemp /tmp/dsh-dump.XXXXXX)"
  if [ -n "$DUMP_HOME" ]; then
    DSH_HOME="$DUMP_HOME" "$(dsh_bin)" --profile "$DUMP_PROFILE" --dump-config > "$DUMP_TMP" 2>&1
  else
    "$(dsh_bin)" --profile "$DUMP_PROFILE" --dump-config > "$DUMP_TMP" 2>&1
  fi
  if [ $? -ne 0 ]; then
    mark FAIL "dump-config" "dsh --dump-config 失败（tail: $(tail -1 "$DUMP_TMP" | cut -c1-120)）"
  else
    mark PASS "dump-config" "$DUMP_PROFILE profile 组合成功"
    IFS=',' read -r -a dump_plugins <<< "$PLUGINS"
    for p in "${dump_plugins[@]:-}"; do
      p="$(echo "$p" | xargs)"
      [ -z "$p" ] && continue
      if grep -q "$p" "$DUMP_TMP"; then
        mark PASS "插件组合" "${p}（dump-config）"
      else
        mark FAIL "插件组合" "dump-config 中未出现 $p"
      fi
    done
  fi
  rm -f "$DUMP_TMP"
fi

# ---------- 汇总 ----------
if [ "$JSON" -eq 1 ]; then
  printf '{\n  "pass": %d,\n  "fail": %d,\n  "results": [\n' "$PASS" "$FAIL"
  first=1
  for r in "${RESULTS[@]}"; do
    [ "$first" -eq 0 ] && printf ',\n'
    first=0
    IFS='|' read -r st name detail <<< "$r"
    printf '    {"status":"%s","name":"%s","detail":"%s"}' "$st" "$name" "$detail"
  done
  printf '\n  ]\n}\n'
else
  echo ""
  echo "== dsh-healthcheck 结果 =="
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r st name detail <<< "$r"
    printf '  %-5s %-16s %s\n' "$st" "$name" "$detail"
  done
  echo "== PASS: $PASS  FAIL: $FAIL =="
fi

if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0