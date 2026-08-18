#!/usr/bin/env bash
# =============================================================================
# install.sh — dsh-computer-use 安装脚本（编译 helper + 自检 + TCC 指引）
#
# 前置：插件已通过 `dsh plugin --profile web add file:<path>` 安装。
# 用法：bash scripts/install.sh [--web | --headless]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> 1/3 编译原生 helper"
bash "$SCRIPT_DIR/build-helper.sh"

echo
echo "==> 2/3 helper 自检"
HELPER="$PLUGIN_ROOT/bin/cu-helper"
echo '{}' | "$HELPER" tcc-status

echo
echo "==> 3/3 TCC 权限指引"
echo "dsh-computer-use 需要两项 macOS 隐私权限（授权给【运行 dsh 的宿主进程】，子进程继承 responsible process）："
echo "  1. 辅助功能（Accessibility）—— 观察与操作界面（必需）"
echo "     系统设置 → 隐私与安全性 → 辅助功能 → 勾选你的终端/宿主应用"
echo "  2. 屏幕录制（Screen Recording）—— 截图 artifact（可选，仅在 computer_observe 请求截图时使用）"
echo "     系统设置 → 隐私与安全性 → 屏幕录制 → 勾选你的终端/宿主应用"
echo
echo "授权后重启 dsh web，在新会话中加载 Skill：/computer-use"
echo "然后让模型执行：computer_list_apps → computer_observe → 动作 → 验证。"
