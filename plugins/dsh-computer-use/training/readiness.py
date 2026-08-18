#!/usr/bin/env python3
"""
training/readiness.py — Phase 10：训练就绪度评估（仅评估，不训练）

当积累足够高质量轨迹后，按 5 个 Stage 评估是否可进入训练：

  Stage A  Trajectory Retrieval      — 轨迹量
  Stage B  Skill Learning            — verified Skill 量
  Stage C  SFT（Supervised FT）      — positive 样本量
  Stage D  Preference Optimization   — preference 对量
  Stage E  Small Computer Policy Model — 前置全部就绪 + 成功率稳定

原则：
  - 第一阶段不进行任何模型 Fine-tuning（本模块只评估，不训练）；
  - 优先训练 Computer Policy / Executor，而非重新训练整个 DeepSeek。
"""
import json
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent

# 各 Stage 就绪阈值（保守，可配置）
THRESHOLDS = {
    "A_trajectory_retrieval": {"trajectories": 100, "success_rate": 0.8},
    "B_skill_learning": {"verified_skills": 10},
    "C_sft": {"positive_samples": 1000},
    "D_preference": {"preference_pairs": 200},
    "E_policy_model": {"stages": ["A", "B", "C", "D"], "success_rate": 0.9},
}


def collect_stats(memory_store=None, training_root: Path = None) -> dict:
    """收集数据统计。"""
    stats = {"trajectories": 0, "successes": 0, "failures": 0,
             "verified_skills": 0, "positive_samples": 0,
             "negative_samples": 0, "preference_pairs": 0}
    # 轨迹
    if memory_store is not None:
        entries = memory_store.list_index()
        stats["trajectories"] = len(entries)
        stats["successes"] = sum(1 for e in entries if e.get("success"))
        stats["failures"] = sum(1 for e in entries if not e.get("success"))
    # verified skills
    verified_dir = (training_root or PLUGIN_ROOT / "skills" / "verified")
    if verified_dir.exists():
        stats["verified_skills"] = len(list(verified_dir.glob("*.json")))
    # 训练样本（读训练产物目录；每个文件内含样本数组，统计样本总数）
    root = training_root or PLUGIN_ROOT / "training"
    for sub, key in (("positive", "positive_samples"), ("negative", "negative_samples"),
                     ("preference", "preference_pairs")):
        d = root / sub
        if d.exists():
            total = 0
            for f in d.glob("*.json"):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    total += len(data) if isinstance(data, list) else (1 if data else 0)
                except (json.JSONDecodeError, OSError):
                    continue
            stats[key] = total
    return stats


def evaluate(stats: dict, thresholds: dict = None) -> dict:
    """按 5 Stage 评估就绪度。纯函数。

    @returns: {stages: [{stage, title, ready, score, detail, required}],
               overall: {...}}
    """
    thresholds = thresholds or THRESHOLDS
    total = stats.get("trajectories", 0)
    ok = stats.get("successes", 0)
    success_rate = ok / total if total > 0 else 0.0

    stages = []
    # A: 轨迹检索
    tA = thresholds["A_trajectory_retrieval"]
    stages.append(_stage("A", "Trajectory Retrieval", "记忆检索/复用（Phase 5）",
                         total >= tA["trajectories"] and success_rate >= tA["success_rate"],
                         total, tA["trajectories"],
                         f"{total} 轨迹 / 成功率 {success_rate:.0%}（需 ≥{tA['trajectories']} / ≥{tA['success_rate']:.0%}）"))
    # B: Skill 学习
    tB = thresholds["B_skill_learning"]
    vs = stats.get("verified_skills", 0)
    stages.append(_stage("B", "Skill Learning", "候选→测试→Benchmark→verified（Phase 7）",
                         vs >= tB["verified_skills"], vs, tB["verified_skills"],
                         f"{vs} verified Skills（需 ≥{tB['verified_skills']}）"))
    # C: SFT
    tC = thresholds["C_sft"]
    pos = stats.get("positive_samples", 0)
    stages.append(_stage("C", "SFT", "Supervised Fine-tuning（Positive 样本）",
                         pos >= tC["positive_samples"], pos, tC["positive_samples"],
                         f"{pos} positive 样本（需 ≥{tC['positive_samples']}）"))
    # D: Preference
    tD = thresholds["D_preference"]
    pref = stats.get("preference_pairs", 0)
    stages.append(_stage("D", "Preference Optimization", "DPO / Preference Learning",
                         pref >= tD["preference_pairs"], pref, tD["preference_pairs"],
                         f"{pref} preference 对（需 ≥{tD['preference_pairs']}）"))
    # E: Policy Model（前置 A-D 全就绪 + 成功率稳定）
    tE = thresholds["E_policy_model"]
    prereq_ready = all(s["ready"] for s in stages[:4])
    stages.append(_stage("E", "Small Computer Policy Model",
                         "训练 Computer Policy / Executor（非整个 DeepSeek）",
                         prereq_ready and success_rate >= tE["success_rate"],
                         sum(1 for s in stages[:4] if s["ready"]), 4,
                         f"前置 {sum(1 for s in stages[:4] if s['ready'])}/4 就绪 / 成功率 {success_rate:.0%}（需 ≥{tE['success_rate']:.0%}）"))

    ready_count = sum(1 for s in stages if s["ready"])
    return {
        "stages": stages,
        "overall": {
            "ready_stages": ready_count,
            "total_stages": len(stages),
            "recommendation": _recommendation(ready_count),
            "evaluated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
            "note": "仅评估不训练：本模块不进行任何模型 Fine-tuning",
        },
    }


def _stage(code, title, detail, ready, current, required, desc):
    return {
        "stage": code, "title": title, "detail": detail, "ready": ready,
        "score": round(min(current / required, 1.0) if required else 0, 3) if not ready else 1.0,
        "current": current, "required": required, "description": desc,
    }


def _recommendation(ready_count):
    if ready_count >= 5:
        return "全部 Stage 就绪：可评估训练 Computer Policy / Executor（仍需人工评审）"
    if ready_count >= 4:
        return "接近就绪：建议先积累 D（Preference）数据与稳定性验证"
    if ready_count >= 2:
        return "持续积累数据：重点补充 positive 样本与 verified Skills"
    return "早期阶段：优先积累高质量轨迹与 benchmark 覆盖"


if __name__ == "__main__":
    sys.path.insert(0, str(PLUGIN_ROOT))
    from memory.store import MemoryStore
    stats = collect_stats(MemoryStore(PLUGIN_ROOT / "memory"))
    report = evaluate(stats)
    print(json.dumps(report, ensure_ascii=False, indent=2))
