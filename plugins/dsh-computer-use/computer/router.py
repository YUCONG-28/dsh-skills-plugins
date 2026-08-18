#!/usr/bin/env python3
"""
computer/router.py — Phase 2：Computer Tool Router（统一工具选择层）

原则：能结构化操作，就不要截图。

工具通道优先级（从最结构化到最像素化）：
  1. shell      — 直接 API/Shell（open -a、open URL、文件操作等）
  2. dom_cdp    — 浏览器 DOM/CDP（页面内元素选择/点击/填表）
  3. ax         — Accessibility Tree（AXPress / set-value / 元素定位）
  4. shortcut   — 键盘快捷键（Cmd+N / Cmd+W 等确定性快捷）
  5. ocr        — 本地 OCR（读屏幕文字，不调用视觉模型）
  6. vision     — Screenshot + Vision（视觉理解，最后手段）

每个动作选择「第一个可用且足够」的通道；只有更结构化的通道不可用时
才降级到更像素化的通道。

用法：
  python3 router.py --plan '{"action":"click","target":"Save button","state":{...}}'
"""
import json
import sys
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------------------
# 通道注册
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Channel:
    name: str
    priority: int          # 1=最高优先（最结构化）
    description: str
    requires: tuple = ()   # state 需要的键（缺失则不可用）


CHANNELS = [
    Channel("shell", 1, "直接 API/Shell（open/文件/URL/命令）",
            requires=("shell_capable",)),
    Channel("dom_cdp", 2, "浏览器 DOM/CDP（元素选择/点击/填表）",
            requires=("browser_connected",)),
    Channel("ax", 3, "Accessibility Tree（AXPress/set-value/定位）",
            requires=("ax_available",)),
    Channel("shortcut", 4, "键盘快捷键（确定性快捷）",
            requires=("shortcut_known",)),
    Channel("ocr", 5, "本地 OCR（读屏幕文字，零 API 成本）",
            requires=("ocr_available",)),
    Channel("vision", 6, "Screenshot + Vision（视觉理解，最后手段）",
            requires=("screen_recording",)),
]
CHANNEL_BY_NAME = {c.name: c for c in CHANNELS}


# ---------------------------------------------------------------------------
# 动作 → 候选通道的映射规则
# ---------------------------------------------------------------------------

# 动作类型 → 结构化程度递减的候选通道（无显式映射的走通用降级链）
ACTION_CHANNEL_CANDIDATES = {
    # 打开类：shell 最直接
    "open_app": ["shell", "ax", "shortcut", "vision"],
    "open_url": ["shell", "dom_cdp", "ax", "vision"],
    "open_file": ["shell", "ax", "shortcut", "vision"],
    # 文本类：shell(重定向) > ax(set-value) > shortcut(粘贴) > vision
    "type_text": ["shell", "ax", "shortcut", "vision"],
    "set_value": ["ax", "dom_cdp", "shell", "vision"],
    # 点击类：dom > ax > shortcut > vision
    "click": ["dom_cdp", "ax", "shortcut", "vision"],
    "click_button": ["dom_cdp", "ax", "shortcut", "vision"],
    # 按键类：shortcut 最直接；无法映射到快捷键时 ax/vision
    "press_key": ["shortcut", "ax", "vision"],
    # 滚动类：ax(滚动 action) > shortcut(PageDown) > vision
    "scroll": ["ax", "dom_cdp", "shortcut", "vision"],
    # 观察类：ax 树 > ocr > vision
    "observe": ["ax", "ocr", "vision"],
    "read_text": ["ax", "ocr", "vision"],
    # 查找/复制粘贴
    "copy_paste": ["shortcut", "ax", "vision"],
    # 通用降级链（未知动作）
    "generic": ["shell", "dom_cdp", "ax", "shortcut", "ocr", "vision"],
}


@dataclass
class ActionState:
    """动作执行时的可用通道状态（由上层探测填充）。"""
    shell_capable: bool = False        # 是否可用 shell（无沙箱限制）
    browser_connected: bool = False    # 是否已连接浏览器 DOM/CDP
    ax_available: bool = False         # Accessibility 是否可用
    shortcut_known: bool = False       # 是否有已知快捷键可映射
    ocr_available: bool = False        # 本地 OCR 是否可用
    screen_recording: bool = False     # 屏幕录制（vision 前提）
    target_known: bool = False         # 目标元素是否已定位（AX/DOM）
    cost_budget: float = 1.0           # 本次动作允许的成本预算（相对）


@dataclass
class ToolPlan:
    action: str
    target: str
    selected: str                      # 选中的通道名
    alternatives: list = field(default_factory=list)  # 降级备选（有序）
    reason: str = ""

    def to_dict(self):
        return asdict(self)


def candidates_for(action: str) -> list:
    """动作类型 → 候选通道（按优先级）。"""
    return ACTION_CHANNEL_CANDIDATES.get(action, ACTION_CHANNEL_CANDIDATES["generic"])


def plan(action: str, target: str = "", state: ActionState = None,
         verbose: bool = False) -> ToolPlan:
    """选择动作的最优工具通道（纯函数）。

    流程：候选通道按优先级依次检查「可用性 + 成本」；
    第一个可用的即为选中；其余作为降级备选。
    """
    state = state or ActionState()
    candidates = candidates_for(action)
    selected = None
    alternatives = []
    reasons = []

    for name in candidates:
        ch = CHANNEL_BY_NAME.get(name)
        if ch is None:
            continue
        # 可用性检查
        missing = [r for r in ch.requires if not getattr(state, r, False)]
        if missing:
            reasons.append(f"{name}:缺{','.join(missing)}")
            continue
        # 成本检查（结构化通道成本低，天然优先）
        if ch.priority == 6 and state.cost_budget < 2.0:
            reasons.append("vision:超出成本预算")
            continue
        if selected is None:
            selected = name
        else:
            alternatives.append(name)
        if verbose:
            reasons.append(f"{name}:可用(priority={ch.priority})")

    if selected is None:
        # 全部不可用（含预算拒绝）：诚实返回 none，调用方应报错/请求更高预算
        selected = "none"
        alternatives = []
        reasons.append("无可用通道（可能受预算或权限限制）")

    reason = "；".join(reasons)
    if selected != "none":
        reason = f"选中 {selected}" + (f"；{reason}" if reason else "")
    return ToolPlan(action, target, selected, alternatives, reason)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    if args[0] == "--plan" and len(args) > 1:
        data = json.loads(args[1])
        action = data.get("action", "generic")
        target = data.get("target", "")
        state = ActionState(**data.get("state", {}))
        p = plan(action, target, state, verbose=True)
        print(json.dumps(p.to_dict(), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--channels":
        print(json.dumps([asdict(c) for c in CHANNELS], ensure_ascii=False, indent=2))
        return 0
    print(f"未知参数: {args}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
