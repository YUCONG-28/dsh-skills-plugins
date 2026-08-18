#!/usr/bin/env python3
"""
state/detector.py — Phase 4：State Change Detection（状态变化检测）

目标：禁止每个动作后无条件重新截图/调用 Vision。只有 UI 明显变化时才
需要重新截图（screenshot + vision）；AX 树/窗口元数据足够时用结构化信号。

检测维度（按成本从低到高）：
  1. window_title / window_count      — 窗口级变化
  2. ax_tree_hash                     — AX 树指纹（role+title+value 序列 hash）
  3. element_count / element_types    — 树结构变化
  4. process_state                    — 进程/前台状态
  5. screenshot_hash / ROI diff       — 像素级（最后手段）

needs_vision 决策：只有窗口/AX 指纹变化超过阈值时才需要截图+视觉；
否则复用现有状态（AX 树足够）。

用法：
  python3 detector.py --fingerprint '{"windows":[...],"elements":[...]}'
  python3 detector.py --changed '{"prev":{...},"new":{...}}'
  python3 detector.py --decide-screenshot '{"prev":{...},"new":{...}}'
"""
import hashlib
import json
import sys

# ---------------------------------------------------------------------------
# 指纹计算
# ---------------------------------------------------------------------------

DEFAULT_THRESHOLDS = {
    "element_ratio": 0.1,        # 元素数相对变化超过 10% 视为变化
    "min_elements": 3,           # 至少 3 个元素变化才触发
    "window_change": True,       # 窗口标题/数量变化即触发
    "text_change": True,         # 文本值变化即触发
    "screenshot_psnr": 20.0,     # 截图变化阈值（预留，PSNR 风格）
}


def _norm(v):
    if v is None:
        return ""
    return str(v).strip()


def _element_token(el):
    """元素的稳定 token：role + title + value（不含坐标，坐标变化不触发）。"""
    return "|".join([
        _norm(el.get("role")),
        _norm(el.get("title")),
        _norm(el.get("value")),
    ])


def compute_fingerprint(observation: dict) -> dict:
    """从 observation（AX 树 + 窗口）计算状态指纹。纯函数。"""
    elements = observation.get("elements", []) or []
    windows = observation.get("windows", []) or []
    tokens = [_element_token(el) for el in elements]
    joined = "\n".join(tokens)
    tree_hash = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    # 仅非空文本（value）的 hash：用于区分「文本变化」与「纯结构变化」
    # （追加无内容元素、坐标变化等不改变 text_hash）
    text_tokens = [_norm(el.get("value")) for el in elements if _norm(el.get("value"))]
    text_hash = hashlib.sha256("\n".join(text_tokens).encode("utf-8")).hexdigest()
    return {
        "window_titles": [_norm(w.get("title")) for w in windows],
        "window_count": len(windows),
        "element_count": len(elements),
        "element_types": sorted({_norm(el.get("role")) for el in elements}),
        "ax_tree_hash": tree_hash,
        "text_hash": text_hash,
    }


def fingerprint_equal(a: dict, b: dict) -> bool:
    """指纹是否完全一致（忽略 text_snapshot 的截断差异）。"""
    for key in ("window_titles", "window_count", "element_count",
                "element_types", "ax_tree_hash", "text_hash"):
        if a.get(key) != b.get(key):
            return False
    return True


# ---------------------------------------------------------------------------
# 变化判定
# ---------------------------------------------------------------------------

def state_changed(prev: dict, new: dict, thresholds: dict = None) -> dict:
    """比较两份指纹，返回是否变化 + 变化明细。纯函数。"""
    thresholds = thresholds or DEFAULT_THRESHOLDS
    changes = []
    delta = 0

    if thresholds.get("window_change"):
        if prev.get("window_count") != new.get("window_count"):
            changes.append(f"window_count:{prev.get('window_count')}→{new.get('window_count')}")
        if prev.get("window_titles") != new.get("window_titles"):
            changes.append("window_titles")
    if prev.get("ax_tree_hash") != new.get("ax_tree_hash"):
        # 区分文本变化（value 变 → 明显变化，触发）与纯结构变化（按数量/比例判定）
        text_changed = prev.get("text_hash") != new.get("text_hash")
        delta = abs((new.get("element_count") or 0) - (prev.get("element_count") or 0))
        min_el = thresholds.get("min_elements", 3)
        ratio = thresholds.get("element_ratio", 0.1)
        base = max(prev.get("element_count") or 1, 1)
        if text_changed and thresholds.get("text_change"):
            changes.append("ax_tree_hash")
        elif delta >= min_el or delta / base >= ratio:
            changes.append(f"element_count_delta:{delta}")

    changed = len(changes) > 0
    return {"changed": changed, "changes": changes, "delta_elements": delta if changes else 0}


def needs_vision(prev: dict, new: dict, thresholds: dict = None) -> dict:
    """是否必须重新截图 + Vision。

    规则：指纹明显变化 → True（需要重新视觉确认）；
    指纹一致或仅轻微变化 → False（AX 树足够，跳过截图）。
    """
    result = state_changed(prev, new, thresholds)
    return {
        "needs_vision": result["changed"],
        "reason": "state_changed" if result["changed"] else "state_stable",
        "changes": result["changes"],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    if args[0] == "--fingerprint" and len(args) > 1:
        obs = json.loads(args[1])
        print(json.dumps(compute_fingerprint(obs), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--changed" and len(args) > 1:
        data = json.loads(args[1])
        prev = compute_fingerprint(data.get("prev", {}))
        new = compute_fingerprint(data.get("new", {}))
        print(json.dumps(state_changed(prev, new), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--decide-screenshot" and len(args) > 1:
        data = json.loads(args[1])
        prev = compute_fingerprint(data.get("prev", {}))
        new = compute_fingerprint(data.get("new", {}))
        print(json.dumps(needs_vision(prev, new), ensure_ascii=False, indent=2))
        return 0
    print(f"未知参数: {args}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
