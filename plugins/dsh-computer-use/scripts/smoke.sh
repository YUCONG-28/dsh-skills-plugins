#!/usr/bin/env bash
# =============================================================================
# smoke.sh — dsh-computer-use 冒烟测试
#
# 分两级：
#   1. helper 层（无需 TCC 权限）：ping / tcc-status / apps / 错误路径
#   2. 端到端层（需要辅助功能授权）：open TextEdit → observe → click → type
#
# 用法：bash scripts/smoke.sh [--e2e]
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
HELPER="$PLUGIN_ROOT/bin/cu-helper"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

check() { # check <描述> <实际输出> <期望子串>
  if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1（期望含 \"$3\"，实际: ${2:0:120}）"; fi
}

echo "== helper 层（基础命令 + 按 TCC 状态断言错误路径）=="

# 读取辅助功能授权状态（决定错误路径断言：未授权 → 权限错误；已授权 → 目标解析错误）
AX=$(echo '{}' | "$HELPER" tcc-status | python3 -c "import sys,json; print(str(json.load(sys.stdin)['permissions']['accessibility']).lower())" 2>/dev/null)
[[ "$AX" == "true" ]] && AUTH=1 || AUTH=0

R=$(echo '{}' | "$HELPER" ping 2>&1)
check "ping 返回 ok" "$R" '"ok":true'

R=$(echo '{}' | "$HELPER" tcc-status 2>&1)
check "tcc-status 返回权限字段" "$R" 'accessibility'

R=$(echo '{}' | "$HELPER" apps 2>&1)
check "apps 列出应用" "$R" '"apps":['
check "apps 包含 pid 字段" "$R" '"pid"'

# observe 无参数：未授权 → COMPUTER_PERMISSION_REQUIRED；已授权 → COMPUTER_APP_NOT_FOUND（都是 fail-closed，不猜测）
R=$(echo '{}' | "$HELPER" observe 2>&1)
if [[ "$AUTH" -eq 1 ]]; then
  check "observe 无目标时 fail-closed (COMPUTER_APP_NOT_FOUND)" "$R" 'COMPUTER_APP_NOT_FOUND'
else
  check "observe 无权限时 fail-closed (COMPUTER_PERMISSION_REQUIRED)" "$R" 'COMPUTER_PERMISSION_REQUIRED'
fi

R=$(echo '{}' | "$HELPER" click 2>&1)
if [[ "$AUTH" -eq 1 ]]; then
  check "click 无目标时 fail-closed (COMPUTER_APP_NOT_FOUND)" "$R" 'COMPUTER_APP_NOT_FOUND'
else
  check "click 无权限时 fail-closed" "$R" 'COMPUTER_PERMISSION_REQUIRED'
fi

# press-key：无权限 → 权限错误；有权限但 key 不在词表 → 词表错误（注意目标解析在权限检查之后）
R=$(echo '{"key":"not-a-real-key"}' | "$HELPER" press-key 2>&1)
if [[ "$R" == *'COMPUTER_PERMISSION_REQUIRED'* ]]; then
  ok "press-key 无权限时 fail-closed"
elif [[ "$R" == *'COMPUTER_APP_NOT_FOUND'* ]]; then
  ok "press-key 无目标时 fail-closed (COMPUTER_APP_NOT_FOUND)"
else
  check "press-key 有限词表校验" "$R" 'COMPUTER_KEY_NOT_ALLOWED'
fi

R=$(echo '{}' | "$HELPER" unknown-command 2>&1)
check "未知命令返回错误" "$R" 'COMPUTER_UNKNOWN_COMMAND'

echo
echo "== helper 层结果: $PASS 通过, $FAIL 失败 =="

if [[ "$FAIL" -gt 0 ]]; then
  echo "提示：helper 层错误路径断言依赖 TCC 状态（已授权=目标解析错误，未授权=权限错误）。"
  exit 1
fi

if [[ "${1:-}" == "--e2e" ]]; then
  echo
  echo "== 端到端层（需要辅助功能授权）=="

  if [[ "$AUTH" -ne 1 ]]; then
    echo "  ✗ 辅助功能未授权，跳过端到端。请先运行 scripts/install.sh 并完成授权。"
    exit 1
  fi

  echo "  打开 TextEdit（后台，不抢焦点）…"
  open -g -a TextEdit
  sleep 2

  PID=$(pgrep -x TextEdit | head -1)
  if [[ -z "$PID" ]]; then echo "  ✗ TextEdit 未运行"; exit 1; fi
  echo "  TextEdit pid=$PID"

  # observe 基础
  R=$(echo "{\"pid\":$PID}" | "$HELPER" observe 2>&1)
  check "observe TextEdit 返回元素" "$R" '"elements":['

  # 处理可能出现的 Open 对话框：找 New Document 按钮并 AXPress 点击（真实语义动作）
  NEWDOC=$(echo "{\"pid\":$PID}" | "$HELPER" observe | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print(''); sys.exit()
for el in d['elements']:
    if el.get('role') == 'AXButton' and el.get('title') == 'New Document':
        print(el.get('path')); sys.exit()
print('')
" 2>/dev/null)
  if [[ -n "$NEWDOC" ]]; then
    R=$(echo "{\"pid\":$PID,\"path\":\"$NEWDOC\"}" | "$HELPER" click 2>&1)
    check "AXPress 点击 New Document" "$R" '"mode":"axpress"'
    sleep 1.5
  fi

  # 找文本区域 AXTextArea
  AREA=$(echo "{\"pid\":$PID}" | "$HELPER" observe | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print(''); sys.exit()
for el in d['elements']:
    if el.get('role') == 'AXTextArea':
        print(el.get('path')); sys.exit()
print('')
" 2>/dev/null)
  if [[ -z "$AREA" ]]; then
    echo "  ✗ 未找到 AXTextArea"; FAIL=$((FAIL+1))
  else
    echo "  文本区域 path=$AREA"
    # 语义写入（set-value，可靠）
    TEST_TEXT="dsh-computer-use smoke test"
    R=$(echo "{\"pid\":$PID,\"path\":\"$AREA\",\"value\":\"$TEST_TEXT\"}" | "$HELPER" set-value 2>&1)
    check "set-value 语义写入" "$R" '"ok":true'
    sleep 0.5
    R=$(echo "{\"pid\":$PID}" | "$HELPER" observe 2>&1)
    check "重观察包含输入文本" "$R" 'dsh-computer-use smoke test'

    # 键盘输入：先点击聚焦（activate 全局点击），再 type-text（activate + path）
    # 输入法检测：非 ASCII 输入法（拼音等）会拦截合成键盘 → 预期 COMPUTER_INPUT_METHOD_CONFLICT
    IM=$(defaults read com.apple.HIToolbox AppleCurrentKeyboardLayoutInputSourceID 2>/dev/null || echo "")
    ASCII_IM=$(echo "$IM" | grep -qiE "abc|us-|ansi|qwerty" && echo 1 || echo 0)
    if [[ "$ASCII_IM" -eq 1 ]]; then
      R=$(echo "{\"pid\":$PID,\"path\":\"$AREA\",\"prefer\":\"coordinate\",\"activate\":true}" | "$HELPER" click 2>&1)
      check "全局点击聚焦文本区域" "$R" '"ok":true'
      sleep 0.5
      R=$(echo "{\"pid\":$PID,\"text\":\" + typed\",\"path\":\"$AREA\",\"activate\":true}" | "$HELPER" type-text 2>&1)
      check "type-text activate 模式成功" "$R" '"ok":true'
      sleep 0.8
      R=$(echo "{\"pid\":$PID}" | "$HELPER" observe 2>&1)
      check "键盘输入已进入文档" "$R" 'typed'
    else
      R=$(echo "{\"pid\":$PID,\"text\":\"x\",\"activate\":true}" | "$HELPER" type-text 2>&1)
      check "非 ASCII 输入法下 fail-closed (COMPUTER_INPUT_METHOD_CONFLICT)" "$R" 'COMPUTER_INPUT_METHOD_CONFLICT'
    fi
  fi

  # 截图：检测屏幕录制权限（未授权 → 预期错误路径，不算失败）
  SR=$(echo '{}' | "$HELPER" tcc-status | python3 -c "import sys,json; print(str(json.load(sys.stdin)['permissions']['screenRecording']).lower())" 2>/dev/null)
  if [[ "$SR" == "true" ]]; then
    R=$(echo "{\"pid\":$PID,\"screenshot\":true,\"screenshotPath\":\"$PLUGIN_ROOT/bin/smoke-shot.png\"}" | "$HELPER" observe 2>&1)
    check "observe 带截图" "$R" '"screenshot"'
    [[ -f "$PLUGIN_ROOT/bin/smoke-shot.png" ]] && ok "截图文件已生成" || bad "截图文件缺失"
  else
    R=$(echo "{\"pid\":$PID,\"screenshot\":true,\"screenshotPath\":\"$PLUGIN_ROOT/bin/smoke-shot.png\"}" | "$HELPER" observe 2>&1)
    check "无屏幕录制权限时 fail-closed (COMPUTER_SCREEN_RECORDING_REQUIRED)" "$R" 'COMPUTER_SCREEN_RECORDING_REQUIRED'
  fi

  kill "$PID" 2>/dev/null || true
  echo
  echo "== 端到端结果: $PASS 通过, $FAIL 失败 =="
fi

exit "$FAIL" >/dev/null 2>&1 || exit 0
