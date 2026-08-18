#!/usr/bin/env python3
"""
memory/strategies.py — Phase 6：失败 → 策略切换

连续失败时禁止无限重复相同操作。每个失败类别映射到「下一步尝试策略链」：
  Failure → Classify → Change strategy → Retry

策略链示例：
  coordinate click failed → 切换 AX → AX 失败 → 切换 Vision
  每类失败最多尝试策略链中的方案；全部失败后停止（交给用户/模型决策）。
"""
import json
import sys

# 类别 → 有序策略链（每个策略 = {strategy, description}）
STRATEGIES = {
    "wrong_element": [
        {"strategy": "rebind_semantic", "description": "allowRebind=true 按 role+title 语义重绑定"},
        {"strategy": "reobserve", "description": "重新 computer_observe 获取新鲜树"},
        {"strategy": "vision_grounding", "description": "截图 + 视觉定位（最后手段）"},
    ],
    "coordinate_changed": [
        {"strategy": "reobserve", "description": "重新观察（坐标/树已变）"},
        {"strategy": "ax_semantic", "description": "改用 AX 语义动作（不依赖坐标）"},
        {"strategy": "shortcut", "description": "改用键盘快捷键"},
    ],
    "timeout": [
        {"strategy": "longer_wait", "description": "延长等待并重新观察"},
        {"strategy": "reobserve", "description": "重新观察应用状态"},
        {"strategy": "vision_grounding", "description": "截图确认界面状态"},
    ],
    "page_not_loaded": [
        {"strategy": "wait_retry", "description": "等待加载完成再操作"},
        {"strategy": "reopen", "description": "重新打开应用/页面"},
        {"strategy": "vision_grounding", "description": "截图确认页面状态"},
    ],
    "unexpected_dialog": [
        {"strategy": "dismiss_dialog", "description": "关闭意外对话框（Cancel/Don't Save）"},
        {"strategy": "reobserve", "description": "重新观察窗口状态"},
    ],
    "permission_denied": [
        {"strategy": "user_action_required", "description": "需用户授权（TCC/应用批准），停止自动重试"},
    ],
    "tool_failure": [
        {"strategy": "switch_channel", "description": "切换工具通道（AX→shortcut→vision，见 computer/router）"},
        {"strategy": "reobserve", "description": "重新观察后重试"},
    ],
    "model_reasoning_failure": [
        {"strategy": "replan", "description": "重新规划（可能是模型误判参数）"},
        {"strategy": "observe_first", "description": "先观察再规划（避免猜测）"},
    ],
    "environment_changed": [
        {"strategy": "verify_env", "description": "检查应用/窗口/输入法环境"},
        {"strategy": "reopen", "description": "重新打开目标应用"},
    ],
}

# 每类失败最多切换次数（防止无限重试）
MAX_STRATEGY_ATTEMPTS = {
    "permission_denied": 0,      # 用户动作，不自动重试
    "environment_changed": 2,
    "wrong_element": 3,
    "coordinate_changed": 3,
    "timeout": 3,
    "page_not_loaded": 3,
    "unexpected_dialog": 3,
    "tool_failure": 2,
    "model_reasoning_failure": 3,
}
DEFAULT_MAX = 3


def next_strategy(category: str, attempts: int) -> dict:
    """返回第 attempts 次重试应采用的策略（0-based）。

    @param category: 失败类别（classifier 输出）
    @param attempts: 已失败次数
    @returns: {should_retry, strategy?, index, max_attempts, reason}
    """
    chain = STRATEGIES.get(category, STRATEGIES["model_reasoning_failure"])
    max_attempts = MAX_STRATEGY_ATTEMPTS.get(category, DEFAULT_MAX)
    if attempts >= max_attempts:
        return {"should_retry": False, "index": None, "max_attempts": max_attempts,
                "reason": f"{category} 已重试 {attempts} 次（上限 {max_attempts}），停止自动重试"}
    if category == "permission_denied":
        return {"should_retry": False, "index": None, "max_attempts": 0,
                "reason": "权限类失败需用户操作，不自动重试"}
    strategy = chain[attempts % len(chain)]
    return {"should_retry": True, "strategy": strategy, "index": attempts,
            "max_attempts": max_attempts, "reason": f"{category} 第 {attempts + 1} 次重试"}


def strategy_plan(failure_history: list) -> list:
    """根据连续失败历史生成重试计划（每次失败推进一个策略）。"""
    plan = []
    for i, failure in enumerate(failure_history):
        cat = failure.get("category", "model_reasoning_failure")
        step = next_strategy(cat, i)
        plan.append({
            "attempt": i + 1,
            "category": cat,
            "error": failure.get("error", "")[:120],
            **step,
        })
    return plan


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--next":
        data = json.loads(args[1])
        print(json.dumps(next_strategy(data.get("category", ""),
                                       data.get("attempts", 0)),
                         ensure_ascii=False, indent=2))
    else:
        print(__doc__)
