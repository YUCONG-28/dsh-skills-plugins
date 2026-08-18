#!/usr/bin/env python3
"""
trainer/optimizer.py — Phase 8：自优化分析

定期分析轨迹与失败，寻找优化候选：
  1. repeat_pattern   — 重复轨迹（可抽象为 Skill / 复用记忆）
  2. high_latency     — 高延迟任务（可优化步骤）
  3. frequent_vision  — 频繁截图/Vision（应启用状态检测跳过）
  4. failure_hotspot  — 失败热点（分类后改善策略）
  5. batch_candidate  — 连续动作可合并为 computer_batch（减少 LLM 往返）
  6. pro_heavy        — Pro 调用密集（应路由到 Fast）

产出优化候选列表（status=candidate）。自动生成 ≠ 自动进生产：
必须 Benchmark → Regression Test → Promote（promote_candidate）。
"""
import json
import sys
import time
import uuid
from pathlib import Path

TRAINER_ROOT = Path(__file__).resolve().parent

# 阈值
HIGH_LATENCY_MS = 8000          # 超过视为高延迟
VISION_THRESHOLD = 3            # vision_calls 超过视为频繁视觉
BATCH_MIN_SEQUENCE = 3          # 连续动作 ≥3 个可 batch
BATCH_SAVINGS_MIN = 2           # 可减少的 LLM 往返 ≥2 才建议 batch
FAILURE_HOTSPOT_MIN = 2         # 同任务失败 ≥2 次为热点
PRO_HEAVY_THRESHOLD = 0.6       # pro 调用占比


def analyze(trajectories: list, failures: list = None) -> list:
    """分析轨迹 → 优化候选列表。纯函数。

    @param trajectories: 轨迹列表（含 task/duration_ms/vision_calls/llm_calls/actions）
    @param failures: 失败轨迹列表（分类后）
    @returns: [{kind, title, detail, severity, source, status:'candidate'}]
    """
    failures = failures or []
    candidates = []

    # 1. 重复轨迹（同任务多次成功 → Skill 候选）
    by_task = {}
    for t in trajectories:
        if t.get("success"):
            by_task.setdefault(t.get("task", ""), []).append(t)
    for task, trajs in by_task.items():
        if len(trajs) >= 2:
            candidates.append({
                "kind": "repeat_pattern",
                "title": f"任务「{task}」重复成功 {len(trajs)} 次",
                "detail": "可抽象为 Skill 或从记忆直接复用（见 Phase 5/7）",
                "severity": "info", "source": task,
                "status": "candidate",
            })

    # 2. 高延迟任务
    for t in trajectories:
        if t.get("duration_ms", 0) >= HIGH_LATENCY_MS:
            candidates.append({
                "kind": "high_latency",
                "title": f"任务「{t.get('task')}」耗时 {t.get('duration_ms')}ms",
                "detail": "超过高延迟阈值，检查等待/重试/截图开销",
                "severity": "warn", "source": t.get("task", ""),
                "status": "candidate",
            })

    # 3. 频繁 Vision / 截图
    for t in trajectories:
        if t.get("vision_calls", 0) >= VISION_THRESHOLD:
            candidates.append({
                "kind": "frequent_vision",
                "title": f"任务「{t.get('task')}」vision_calls={t.get('vision_calls')}",
                "detail": "应启用 state/detector 状态检测，稳定状态跳过截图",
                "severity": "warn", "source": t.get("task", ""),
                "status": "candidate",
            })

    # 4. 失败热点
    hotspot = {}
    for f in failures:
        hotspot[f.get("task", "")] = hotspot.get(f.get("task", ""), 0) + 1
    for task, count in hotspot.items():
        if count >= FAILURE_HOTSPOT_MIN:
            candidates.append({
                "kind": "failure_hotspot",
                "title": f"任务「{task}」失败 {count} 次",
                "detail": "查看 memory/failures 分类与重试策略（Phase 6）",
                "severity": "error", "source": task,
                "status": "candidate",
            })

    # 5. batch 候选：动作序列 ≥3 且可减少 ≥2 次 LLM 往返
    for t in trajectories:
        actions = t.get("actions", [])
        if len(actions) >= BATCH_MIN_SEQUENCE:
            llm_rounds = len(actions)  # 逐动作执行 = 每动作一次 LLM
            batch_rounds = 1           # batch = 一次
            savings = llm_rounds - batch_rounds
            if savings >= BATCH_SAVINGS_MIN:
                candidates.append({
                    "kind": "batch_candidate",
                    "title": f"任务「{t.get('task')}」{len(actions)} 个动作可批量",
                    "detail": f"{len(actions)} 个动作可合并：computer_batch 可减少约 {savings} 次 LLM 往返",
                    "severity": "info", "source": t.get("task", ""),
                    "status": "candidate",
                })

    # 6. Pro 调用密集
    for t in trajectories:
        total = t.get("llm_calls", 0)
        pro = t.get("pro_calls", 0)
        if total > 0 and pro / total >= PRO_HEAVY_THRESHOLD:
            candidates.append({
                "kind": "pro_heavy",
                "title": f"任务「{t.get('task')}」Pro 调用占比 {pro / total:.0%}",
                "detail": "应检查 router/model_router 路由规则（routine 动作走 Fast）",
                "severity": "warn", "source": t.get("task", ""),
                "status": "candidate",
            })

    candidates.sort(key=lambda c: {"error": 0, "warn": 1, "info": 2}[c["severity"]])
    return candidates


def promote_candidate(candidate: dict) -> dict:
    """Benchmark + 回归通过后 promote（status → promoted）。"""
    return {**candidate, "status": "promoted",
            "promoted_at": time.strftime("%Y-%m-%dT%H:%M:%S")}


def report(candidates: list) -> dict:
    """生成优化报告摘要。"""
    by_kind = {}
    for c in candidates:
        by_kind.setdefault(c["kind"], 0)
        by_kind[c["kind"]] += 1
    return {
        "total": len(candidates),
        "by_kind": by_kind,
        "by_severity": {
            "error": sum(1 for c in candidates if c["severity"] == "error"),
            "warn": sum(1 for c in candidates if c["severity"] == "warn"),
            "info": sum(1 for c in candidates if c["severity"] == "info"),
        },
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--analyze":
        data = json.loads(args[1])
        cands = analyze(data.get("trajectories", []), data.get("failures", []))
        print(json.dumps({"report": report(cands), "candidates": cands},
                         ensure_ascii=False, indent=2))
    else:
        print(__doc__)
