#!/usr/bin/env python3
"""
memory/retrieve.py — Phase 5：相似轨迹检索

任务开始前检索相似成功轨迹：先按 task 精确匹配，再按 environment 特征
（os/app/window）相似度打分，返回排序后的候选。检索只给候选——真正
replay 前必须通过 verify_environment（禁止盲目 replay）。
"""
import json
import sys
from pathlib import Path

from memory.store import MemoryStore

# 环境特征权重（用于相似度打分）
ENV_WEIGHTS = {
    "os": 3.0,
    "os_version": 1.0,
    "app": 3.0,
    "app_version": 1.0,
    "window_title": 1.5,
}


def env_score(candidate: dict, current: dict) -> float:
    """环境相似度 0~1（1=完全一致）。缺失字段不计分。"""
    total = 0.0
    matched = 0.0
    for key, weight in ENV_WEIGHTS.items():
        c = candidate.get(key)
        n = current.get(key)
        if c is None or n is None:
            continue
        total += weight
        if str(c).lower() == str(n).lower():
            matched += weight
        elif key == "window_title" and (str(n).lower() in str(c).lower()
                                        or str(c).lower() in str(n).lower()):
            matched += weight * 0.8  # 部分匹配
    return matched / total if total > 0 else 0.0


def find_similar(store: MemoryStore, task: str, environment: dict = None,
                 min_score: float = 0.6, only_success: bool = True) -> list:
    """检索相似轨迹。

    @param task: 任务 id（精确匹配）
    @param environment: 当前环境特征 {os, os_version, app, app_version, window_title}
    @param min_score: 环境相似度下限（低于不返回）
    @param only_success: 只检索成功轨迹
    @returns: [{entry, score}] 按 score 降序
    """
    environment = environment or {}
    candidates = store.list_by_task(task)
    results = []
    for entry in candidates:
        if only_success and not entry.get("success"):
            continue
        score = env_score(entry.get("environment", {}), environment)
        results.append({"entry": entry, "score": round(score, 2)})
    results.sort(key=lambda r: r["score"], reverse=True)
    return [r for r in results if r["score"] >= min_score]


def summarize(candidates: list) -> str:
    """候选的模型可读摘要（供 planner 决定是否复用）。"""
    if not candidates:
        return "(无相似轨迹)"
    lines = []
    for i, r in enumerate(candidates[:3], 1):
        e = r["entry"]
        lines.append(
            f"{i}. {e['id']} 环境相似 {r['score']:.0%} "
            f"({e['duration_ms']}ms, {e.get('environment', {}).get('app', '?')})")
    return "\n".join(lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--search":
        store = MemoryStore()
        task = args[1]
        env = {}
        if len(args) > 2:
            env = json.loads(args[2])
        cands = find_similar(store, task, env)
        print(summarize(cands))
    else:
        print(__doc__)
