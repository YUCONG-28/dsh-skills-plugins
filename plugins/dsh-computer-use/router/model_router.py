#!/usr/bin/env python3
"""
model_router.py — Phase 1：Fast / Pro 模型路由器

目标：不让 Pro 模型参与每一个简单鼠标操作。默认走 FAST 模型且
reasoning_effort=off；只有以下情况才升级到 PRO（+ 高级推理）：

  - 复杂规划（planning / 任务开始）
  - 连续失败（failure_count >= threshold）
  - 未知 UI（元素不在已知模式内）
  - 需要视觉理解（vision_required）
  - 高风险操作（high_risk：删除/覆盖/系统配置/安装/发送/支付/权限修改等）

职责划分：
  PRO  : Planning / Complex reasoning / Vision / Error recovery / Unknown UI
  FAST : Click / Type / Scroll / Keyboard / Known UI / Routine execution

本模块是纯决策层（无副作用，便于单测）；输出 RoutingDecision 供：
  1) DSH 插件侧按轮次应用（agent/request 覆盖 provider/model/reasoningEffort，
     类似 dsh-vision-bridge 的路由模式）；
  2) 离线分析（analyze_trajectory）为训练/规则优化提供依据。

用法：
  python3 model_router.py --decide '{"action_type":"click","turn":3}'
  python3 model_router.py --config            # 打印默认路由配置
"""
import json
import sys
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------------------
# 路由配置
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "fast": {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "reasoning_effort": "off",
    },
    "pro": {
        "provider": "deepseek",
        "model": "deepseek-reasoner",
        "reasoning_effort": "high",
    },
    "vision": {
        "provider": "qwen",
        "model": "qwen-vl-max",
        "reasoning_effort": "off",
    },
    "rules": {
        # 触发 PRO 的条件（任一命中即升级）
        "pro_on": [
            "planning",        # 复杂规划/任务开始
            "failure_threshold",  # 连续失败达到阈值
            "unknown_ui",      # 未知界面
            "vision_required", # 需要视觉理解
            "high_risk",       # 高风险操作
        ],
        # 连续失败升级阈值
        "failure_threshold": 2,
        # 默认关闭思考
        "thinking_off_default": True,
        # 高风险动作关键词（命中即 PRO + 需要确认）
        "high_risk_keywords": [
            "delete", "remove", "overwrite", "git push --force",
            "system config", "install", "uninstall", "send message",
            "send email", "submit form", "payment", "purchase",
            "permission", "password", "api key",
        ],
        # 已知 UI 的 routine 动作（FAST 直接执行，不升级）
        "routine_actions": [
            "click", "type", "scroll", "keyboard", "set_value",
            "press_key", "wait", "focus", "open", "switch_window",
        ],
    },
    "cost": {
        # 单位成本（相对）：用于离线分析/优化报告
        "pro_per_call": 10.0,
        "fast_per_call": 1.0,
        "vision_per_call": 8.0,
        "screenshot_per_call": 2.0,
    },
}


# ---------------------------------------------------------------------------
# 决策模型
# ---------------------------------------------------------------------------

@dataclass
class RoutingContext:
    """路由决策输入（来自 agent 会话状态）。"""
    action_type: str = "routine"       # click/type/scroll/.../planning/observe
    turn: int = 0                      # 当前轮次
    failures: int = 0                  # 连续失败次数
    ui_known: bool = True              # 元素是否在已知模式内
    needs_vision: bool = False         # 是否需要截图/视觉理解
    high_risk: bool = False            # 是否高风险操作
    task_stage: str = "execute"        # planning | execute | recovery | verify
    action_text: str = ""              # 动作描述（用于高风险关键词匹配）


@dataclass
class RoutingDecision:
    tier: str                          # pro | fast | vision
    provider: str
    model: str
    reasoning_effort: str              # off | low | medium | high
    reason: list = field(default_factory=list)
    thinking_on: bool = False

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# 决策函数
# ---------------------------------------------------------------------------

def high_risk_detected(text: str, config: dict) -> bool:
    """按关键词判断动作是否高风险（保守：命中任一即 True）。"""
    if not text:
        return False
    low = text.lower()
    for kw in config["rules"].get("high_risk_keywords", []):
        if kw.lower() in low:
            return True
    return False


def decide(ctx: RoutingContext, config: dict = None) -> RoutingDecision:
    """核心路由决策（纯函数）。

    顺序：
      1. 高风险 → PRO（+ thinking）
      2. 需要视觉 → vision（PRO 视觉模型）
      3. planning / 未知 UI / 连续失败达阈值 → PRO
      4. 其余 routine 动作 → FAST + thinking off
    """
    config = config or DEFAULT_CONFIG
    rules = config["rules"]
    reasons = []

    # 1. 高风险：审慎优先
    if ctx.high_risk or high_risk_detected(ctx.action_text, config):
        p = config["pro"]
        return RoutingDecision("pro", p["provider"], p["model"], p["reasoning_effort"],
                               ["high_risk"], thinking_on=True)

    # 2. 视觉理解
    if ctx.needs_vision:
        v = config["vision"]
        return RoutingDecision("vision", v["provider"], v["model"], v["reasoning_effort"],
                               ["vision_required"], thinking_on=False)

    # 3. 规划 / 错误恢复 / 未知 UI
    if ctx.task_stage in ("planning", "recovery"):
        reasons.append(f"task_stage={ctx.task_stage}")
    if ctx.action_type == "planning":
        reasons.append("planning")
    if not ctx.ui_known:
        reasons.append("unknown_ui")
    if ctx.failures >= rules.get("failure_threshold", 2):
        reasons.append(f"failures={ctx.failures}>={rules['failure_threshold']}")
    if reasons:
        p = config["pro"]
        return RoutingDecision("pro", p["provider"], p["model"], p["reasoning_effort"],
                               reasons, thinking_on=True)

    # 4. 默认：FAST + thinking off
    f = config["fast"]
    return RoutingDecision("fast", f["provider"], f["model"], f["reasoning_effort"],
                           ["routine"], thinking_on=False)


def analyze_trajectory(trajectory: dict, config: dict = None) -> dict:
    """离线分析一条轨迹的路由成本与 FAST 化空间。

    trajectory: {actions: [{type, tier?, cost?}], ...}
    返回：成本统计 + 可 FAST 化的动作列表。
    """
    config = config or DEFAULT_CONFIG
    actions = trajectory.get("actions", [])
    stats = {"total": len(actions), "pro": 0, "fast": 0, "vision": 0,
             "cost": 0.0, "fastable": []}
    for act in actions:
        tier = act.get("tier", "fast")
        stats[tier] = stats.get(tier, 0) + 1
        key = f"{tier}_per_call"
        stats["cost"] += config["cost"].get(key, 1.0)
        # 若动作类型是 routine 但用了 pro/vision，标记可 FAST 化
        if act.get("type") in config["rules"]["routine_actions"] and tier in ("pro", "vision"):
            stats["fastable"].append(act.get("type"))
    stats["fastable"] = sorted(set(stats["fastable"]))
    stats["potential_saving"] = round(
        stats["cost"] - (len(actions) * config["cost"]["fast_per_call"]), 2)
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    if args[0] == "--config":
        print(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--decide" and len(args) > 1:
        ctx = RoutingContext(**json.loads(args[1]))
        d = decide(ctx)
        print(json.dumps(d.to_dict(), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--analyze" and len(args) > 1:
        traj = json.loads(args[1])
        print(json.dumps(analyze_trajectory(traj), ensure_ascii=False, indent=2))
        return 0
    print(f"未知参数: {args}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
