#!/usr/bin/env bash
# ============================================================
# Claude Code + 雷米埃尔桌宠 一键安装脚本
# 用法:
#   bash install.sh                        # 交互式(提示输入 API 密钥)
#   bash install.sh --api-key sk-xxxx      # 直接传密钥,无人值守
#   bash install.sh --skip-apt             # 跳过依赖安装
#   bash install.sh --dir ~/pet            # 指定桌宠安装目录(默认 ~/remiel-pet)
#   bash install.sh --with-project-perms   # 同时安装项目级权限模板
#   bash install.sh --yes                  # 跳过确认,自动安装依赖
# 特性:幂等(重复执行不重复配置)、覆盖前自动备份、中文进度输出
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PET_DIR="${HOME}/remiel-pet"
API_KEY=""
SKIP_APT=0
WITH_PROJECT_PERMS=0
ASSUME_YES=0
MARKER_START="### >>> claude-deepseek-env >>>"
MARKER_END="### <<< claude-deepseek-env <<<"
BASH_RC="${HOME}/.bashrc"

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) PET_DIR="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --skip-apt) SKIP_APT=1; shift ;;
    --with-project-perms) WITH_PROJECT_PERMS=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done
PET_DIR="$(realpath -m "$PET_DIR")"

# ---------- 安全护栏 ----------
if [ "$(id -u)" -eq 0 ]; then
  echo "错误:请勿以 root 运行,请用普通用户执行(需要 sudo 时会提示)。"
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "错误:未找到 apt-get,本脚本仅支持 Debian/Ubuntu 系系统。"
  exit 1
fi

echo "======================================================"
echo " Claude Code + 雷米埃尔桌宠 一键安装"
echo "======================================================"

# ---------- [1/5] 依赖安装(幂等) ----------
echo "==> [1/5] 检查桌宠运行依赖"
if [ "$SKIP_APT" -eq 1 ]; then
  echo "    已跳过依赖安装(--skip-apt)"
else
  MISSING=()
  for pkg in python3-gi gir1.2-gtk-3.0 python3-pil jq; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      MISSING+=("$pkg")
    fi
  done
  if [ ${#MISSING[@]} -eq 0 ]; then
    echo "    依赖已齐全,无需安装"
  else
    echo "    缺失依赖: ${MISSING[*]}"
    if [ "$ASSUME_YES" -eq 0 ]; then
      read -rp "    执行 sudo apt install -y ${MISSING[*]}? [Y/n] " ans
      if [ "$ans" = "n" ] || [ "$ans" = "N" ]; then
        echo "    已跳过依赖安装,若后续启动失败请手动执行 apt 安装。"
      else
        sudo apt install -y "${MISSING[@]}"
      fi
    else
      sudo apt install -y "${MISSING[@]}"
    fi
  fi
fi

# ---------- [2/5] 复制桌宠文件夹 ----------
echo "==> [2/5] 复制桌宠文件夹 -> $PET_DIR"
if [ -d "$PET_DIR" ]; then
  BAK="${PET_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  echo "    检测到已有目录,先备份为: $BAK"
  mv "$PET_DIR" "$BAK"
fi
mkdir -p "$PET_DIR"
cp -r "$SCRIPT_DIR/remiel-pet/." "$PET_DIR/"    # 末尾 /. 确保隐藏文件(.claude/ 等)一并复制
if [ "$WITH_PROJECT_PERMS" -eq 1 ]; then
  sed -i "s|__PET_DIR__|$PET_DIR|g; s|__USER__|$USER|g" "$PET_DIR/.claude/settings.local.json"
  echo "    已安装项目级权限模板(--with-project-perms)"
else
  rm -rf "$PET_DIR/.claude"
  echo "    (未加 --with-project-perms,已跳过项目级权限)"
fi
echo "    完成。主程序通过自身路径定位资源,目录位置/名称随意。"

# ---------- [3/5] 应用 Claude Code 配置 ----------
echo "==> [3/5] 应用 Claude Code 配置 (~/.claude/settings.json)"
TMP_SETTINGS="$(mktemp)"
sed "s|__PET_DIR__|$PET_DIR|g" "$SCRIPT_DIR/claude-config/settings.json" > "$TMP_SETTINGS"
if command -v jq >/dev/null 2>&1; then
  jq empty "$TMP_SETTINGS"
else
  python3 -m json.tool "$TMP_SETTINGS" >/dev/null
fi
mkdir -p "${HOME}/.claude"
if [ -f "${HOME}/.claude/settings.json" ]; then
  cp "${HOME}/.claude/settings.json" "${HOME}/.claude/settings.json.bak.$(date +%Y%m%d%H%M%S)"
  echo "    原配置已备份 (settings.json.bak.*)"
fi
cp "$TMP_SETTINGS" "${HOME}/.claude/settings.json"
rm -f "$TMP_SETTINGS"
echo "    已写入 ~/.claude/settings.json(含桌宠启动钩子)"

# ---------- [4/5] 配置 DeepSeek 环境变量 ----------
echo "==> [4/5] 配置 DeepSeek 环境变量 (~/.bashrc)"
if [ -z "$API_KEY" ]; then
  echo -n "    请输入 DeepSeek API 密钥(输入不显示,回车跳过): "
  read -rs API_KEY
  echo
fi
if [ -n "$API_KEY" ]; then
  case "$API_KEY" in
    sk-*) ;;
    *) echo "    警告:密钥通常以 sk- 开头,请确认输入是否正确。" ;;
  esac
  BLOCK="$(sed "s|__DEEPSEEK_API_KEY__|$API_KEY|g" "$SCRIPT_DIR/claude-config/env-claude.sh")"
  touch "$BASH_RC"
  if grep -qF "$MARKER_START" "$BASH_RC"; then
    sed -i "/${MARKER_START}/,/${MARKER_END}/d" "$BASH_RC"
    echo "    已替换旧的配置块(幂等)"
  fi
  {
    echo ""
    echo "$MARKER_START"
    echo "$BLOCK"
    echo "$MARKER_END"
  } >> "$BASH_RC"
  echo "    已写入 ~/.bashrc(标记块内)。"
  echo "    请执行 source ~/.bashrc 或重新打开终端使其生效。"
else
  echo "    未输入密钥,跳过环境变量配置。"
  echo "    稍后可手动把 claude-config/env-claude.sh 的占位符替换后追加到 ~/.bashrc。"
fi

# ---------- [5/5] 收尾 ----------
echo "======================================================"
echo " 安装完成!请按以下清单验证(详见《说明书.md》第八节):"
echo "  1. source ~/.bashrc && claude --version"
echo "  2. env | grep ANTHROPIC_BASE_URL   # 确认端点生效"
echo "  3. claude 开始会话后: cat /tmp/remiel-pet.state   # 应为 idle"
echo "  4. pgrep -af remiel-pet-desktop.py  # 确认桌宠进程存活"
echo "======================================================"
