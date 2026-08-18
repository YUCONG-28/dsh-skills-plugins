#!/usr/bin/env python3
"""
memory/classifier.py — Phase 6：失败自动分类

把失败（error_code + 错误文本 + 上下文）分类到 9 类：
  wrong_element / coordinate_changed / timeout / page_not_loaded /
  unexpected_dialog / permission_denied / tool_failure /
  model_reasoning_failure / environment_changed

分类驱动策略切换（memory/strategies.py）：连续失败禁止无限重复相同操作。
"""
import json
import sys

CATEGORIES = [
    "wrong_element", "coordinate_changed", "timeout", "page_not_loaded",
    "unexpected_dialog", "permission_denied", "tool_failure",
    "model_reasoning_failure", "environment_changed",
]

# error_code → 类别（精确匹配优先）
CODE_MAP = {
    "COMPUTER_TARGET_STALE": "coordinate_changed",
    "COMPUTER_OBSERVATION_STALE": "coordinate_changed",
    "COMPUTER_TARGET_AMBIGUOUS": "wrong_element",
    "COMPUTER_TARGET_NO_FRAME": "wrong_element",
    "COMPUTER_TIMEOUT": "timeout",
    "COMPUTER_HELPER_EXIT": "tool_failure",
    "COMPUTER_HELPER_SPAWN_FAILED": "tool_failure",
    "COMPUTER_HELPER_MISSING": "tool_failure",
    "COMPUTER_ACTION_FAILED": "tool_failure",
    "COMPUTER_PERMISSION_REQUIRED": "permission_denied",
    "COMPUTER_SCREEN_RECORDING_REQUIRED": "permission_denied",
    "COMPUTER_APP_NOT_FOUND": "environment_changed",
    "COMPUTER_NO_WINDOW": "environment_changed",
    "COMPUTER_INPUT_METHOD_CONFLICT": "environment_changed",
    "COMPUTER_POINT_OUTSIDE_WINDOW": "coordinate_changed",
    "COMPUTER_WORKSPACE_MISSING": "environment_changed",
    "COMPUTER_BATCH_BAD_ACTION": "model_reasoning_failure",
    "COMPUTER_BATCH_SIZE": "model_reasoning_failure",
    "COMPUTER_KEY_NOT_ALLOWED": "model_reasoning_failure",
    "COMPUTER_PROTOCOL": "model_reasoning_failure",
}

# 文本关键词 → 类别（code 未命中时兜底）
TEXT_RULES = [
    (["窗口标题不含", "window title"], "page_not_loaded"),
    (["窗口数未", "窗口数不符"], "unexpected_dialog"),
    (["未找到按钮", "未找到元素", "button_not_found", "element_not_found"], "wrong_element"),
    (["超时", "timeout"], "timeout"),
    (["权限", "授权", "permission"], "permission_denied"),
    (["输入法", "input method"], "environment_changed"),
    (["未启动", "app_not_started", "找不到目标应用"], "environment_changed"),
    (["对话框", "dialog", "Review"], "unexpected_dialog"),
]


def classify(error_code: str = "", error_text: str = "",
             attempts: int = 1, action_type: str = "") -> dict:
    """分类失败。返回 {category, confidence, matched_by}。"""
    code = error_code or ""
    text = (error_text or "").lower()

    # 1. 精确 code 匹配
    if code in CODE_MAP:
        return {"category": CODE_MAP[code], "confidence": 1.0,
                "matched_by": f"code:{code}"}

    # 2. 文本关键词
    for keywords, cat in TEXT_RULES:
        if any(k.lower() in text for k in keywords):
            return {"category": cat, "confidence": 0.8,
                    "matched_by": f"text:{keywords[0]}"}

    # 3. 动作类型兜底
    if action_type in ("click", "type", "press", "scroll", "drag"):
        return {"category": "wrong_element", "confidence": 0.4,
                "matched_by": "action_type_fallback"}
    if attempts >= 3:
        return {"category": "environment_changed", "confidence": 0.3,
                "matched_by": "repeated_attempts"}

    return {"category": "model_reasoning_failure", "confidence": 0.3,
            "matched_by": "unknown"}


def categorize_history(failures: list) -> dict:
    """批量分类一组失败（用于失败热点分析）。"""
    counts = {c: 0 for c in CATEGORIES}
    for f in failures:
        c = classify(f.get("error_code", ""), f.get("error", ""),
                     f.get("attempts", 1), f.get("action_type", ""))
        counts[c["category"]] += 1
    return counts


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 1:
        data = json.loads(args[0]) if args[0].startswith("{") else {"error_code": args[0]}
        print(json.dumps(classify(data.get("error_code", ""),
                                  data.get("error", ""),
                                  data.get("attempts", 1),
                                  data.get("action_type", "")),
                         ensure_ascii=False, indent=2))
    else:
        print(__doc__)
