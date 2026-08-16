#!/usr/bin/env bash
# 桌宠管理脚本 petctl · 多桌宠库通用外壳
# 用法: petctl [pet] {start|stop|status|enable|disable}
#   pet 缺省 = 活动桌宠（~/.config/opencode/desktop-pets.json 的 active）
set -u

# BASH_SOURCE[0] 在 PATH 调用下指向脚本完整路径；符号链接再用 readlink 解出真实位置
SELF="${BASH_SOURCE[0]}"
if [ -L "$SELF" ]; then
    SELF=$(readlink "$SELF")
fi
ROOT=$(cd "$(dirname "$SELF")/.." && pwd)
CONFIG="$HOME/.config/opencode/desktop-pets.json"
PLIST="$HOME/Library/LaunchAgents/com.desktop-pets.plist"
ACTIVE="remiel"

if [ -r "$CONFIG" ]; then
    ACTIVE=$(/usr/bin/python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get("active") or "remiel")
except Exception:
    print("remiel")' "$CONFIG" 2>/dev/null || echo "remiel")
fi

usage() {
    echo "用法: petctl [pet] {start|stop|status|enable|disable|run}"
    echo "  pet       桌宠名（缺省 = 活动桌宠 ${ACTIVE}）"
    echo "  start     启动桌宠（后台运行，日志 pets/<pet>/pet.log）"
    echo "  stop      停止桌宠"
    echo "  status    查看运行状态"
    echo "  run       前台运行桌宠（供 LaunchAgent 使用，不后台）"
    echo "  enable    注册开机自启（LaunchAgent com.desktop-pets）"
    echo "  disable   取消开机自启"
}

validate_pet() {
    if [ -f "$ROOT/pets/${pet}/pet.py" ]; then
        return 0
    fi
    echo "[pet] 错误: 未找到桌宠 '${pet}'（缺 $ROOT/pets/${pet}/pet.py）"
    return 1
}

start() {
    if pgrep -f "$PET_PATTERN" >/dev/null 2>&1; then
        echo "[pet] ${pet} 已在运行（PID $(pgrep -f "$PET_PATTERN" | tr '\n' ' ')），无需重复启动"
        return 0
    fi
    nohup "$ROOT/.venv/bin/python3" "$ROOT/pets/${pet}/pet.py" >> "$ROOT/pets/${pet}/pet.log" 2>&1 &
    echo "[pet] ${pet} 启动中（后台运行，日志: $ROOT/pets/${pet}/pet.log）"
    sleep 2
    if pgrep -f "$PET_PATTERN" >/dev/null 2>&1; then
        echo "[pet] ${pet} 启动成功（PID $(pgrep -f "$PET_PATTERN" | tr '\n' ' ')）"
    else
        echo "[pet] ${pet} 未检测到进程（可能被单实例锁拦截或启动失败，见 $ROOT/pets/${pet}/pet.log）"
        return 1
    fi
}

stop() {
    if pgrep -f "$PET_PATTERN" >/dev/null 2>&1; then
        pkill -f "$PET_PATTERN"
        echo "[pet] ${pet} 已发送停止信号"
    else
        echo "[pet] ${pet} 未运行，无需停止"
    fi
    return 0
}

status() {
    local pids
    pids=$(pgrep -fl "$PET_PATTERN" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "[pet] ${pet} 运行中:"
        echo "$pids" | sed 's/^/  /'
        return 0
    else
        echo "[pet] ${pet} 未运行"
        return 1
    fi
}

enable() {
    if [ ! -f "$PLIST" ]; then
        echo "[pet] 错误: 找不到 $PLIST"
        return 1
    fi
    launchctl load -w "$PLIST"
    echo "[pet] 已启用开机自启（LaunchAgent: $PLIST）"
}

disable() {
    launchctl unload -w "$PLIST" 2>/dev/null || true
    echo "[pet] 已取消开机自启"
}

# ROOT 作为正则字面量嵌入 PET_PATTERN 前必须转义正则特殊字符。
# 用纯 bash 实现（macOS BSD sed 不支持 GNU 的 '[]' 首字符类写法）。
esc_regex() {
    local s="$1" out="" c i
    for ((i = 0; i < ${#s}; i++)); do
        c="${s:i:1}"
        case "$c" in
            '[' | ']' | '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '\')
                out="${out}\\${c}" ;;
            *)
                out="${out}${c}" ;;
        esac
    done
    printf '%s' "$out"
}

main() {
    local pet cmd
    case "${1:-}" in
        start|stop|status|enable|disable|run)
            cmd="$1"
            pet="$ACTIVE"
            ;;
        "")
            usage
            return 1
            ;;
        *)
            pet="$1"
            cmd="${2:-}"
            ;;
    esac

    case "$cmd" in
        start|stop|status|enable|disable|run) ;;
        *)
            usage
            return 1
            ;;
    esac

    # 精确匹配真实桌宠进程: python 解释器 + 桌宠脚本完整路径（结尾锚定）
    # 避免 pgrep -f 误匹配命令行仅含路径字面量的无关进程。
    # 注: macOS 下 .venv/bin/python3 是符号链接，真实 argv 会解析为框架 Python（/.*/Python）。
    PET_PATTERN="^($(esc_regex "${ROOT}")/\.venv/bin/python3|/.*/Python) .*pets/${pet}/pet\.py$"

    # enable/disable 作用于 LaunchAgent，不依赖具体桌宠名
    if [ "$cmd" = "enable" ] || [ "$cmd" = "disable" ]; then
        "$cmd"
        return $?
    fi

    if ! validate_pet; then
        return 1
    fi
    if [ "$cmd" = "run" ]; then
        # 前台运行: exec 使桌宠成为本进程（launchd 作业主进程），
        # 作业存活即桌宠存活，避免 launchd 终止后台残留子进程。
        exec "$ROOT/.venv/bin/python3" "$ROOT/pets/${pet}/pet.py"
    fi
    "$cmd"
}

main "$@"
