#!/usr/bin/env python3
"""
skills/skill_learning.py — Phase 7：Skill 学习

当相似任务成功多次后，自动从成功轨迹生成候选 Skill（参数化动作模板）。

生命周期：
  Trajectory(s) → Candidate Skill(generated/) → Test → Benchmark → Verified(verified/)
  退化（benchmark 失败/环境变化）→ deprecated/

生成规则：
  1. 按 task 聚合成功轨迹（>= MIN_TRAJECTORIES 条）
  2. 提取动作序列；具体参数（文本/坐标/句柄）→ 参数占位符 {param:N}
  3. 合并相同模板；score = 轨迹数 * 稳定性（时长方差）+ 平均时长奖励
  4. 输出候选 Skill JSON 到 generated/

只有通过 Benchmark 的 Skill 才允许进入 verified/（自动生成 ≠ 自动进生产）。
"""
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent
GENERATED_DIR = SKILLS_ROOT / "generated"
VERIFIED_DIR = SKILLS_ROOT / "verified"
DEPRECATED_DIR = SKILLS_ROOT / "deprecated"

MIN_TRAJECTORIES = 2          # 至少 N 条成功轨迹才生成候选
MIN_TRAJECTORY_LENGTH = 2     # 至少 N 个动作才有抽象价值
PARAM_PATTERN = re.compile(r"(?<![A-Za-z0-9])([a-zA-Z0-9_\-]{4,})(?![A-Za-z0-9])")


def _parametrize(value):
    """具体值 → 参数占位符（识别路径/文本/标识符）。"""
    if not isinstance(value, str) or value == "":
        return value
    # 路径、长文本、标识符参数化
    if "/" in value or len(value) > 8 or re.fullmatch(r"[a-zA-Z0-9_.-]+", value):
        return "{param}"
    return value


def parametrize_action(action: dict) -> dict:
    """参数化单个动作（把具体文本/句柄/目标等转为占位符）。
    key（有限词表按键）与修饰键不参数化。"""
    PARAM_KEYS = ("handle", "text", "value", "target", "path")
    out = {}
    for key, value in action.items():
        if key in PARAM_KEYS:
            out[key] = _parametrize(value)
        elif key == "actions":  # 嵌套（batch）
            out[key] = [parametrize_action(a) for a in value]
        else:
            out[key] = value
    return out


def action_template_signature(actions: list) -> str:
    """动作序列模板的稳定签名（类型序列 + 参数化）。"""
    return json.dumps([parametrize_action(a) for a in actions], sort_keys=True)


def extract_actions(trajectory: dict) -> list:
    """从轨迹提取动作序列（normalize 为 [{type, ...}]）。"""
    actions = trajectory.get("actions", [])
    if not actions or not isinstance(actions[0], dict):
        return []
    return [a for a in actions if isinstance(a, dict)]


def generate_candidates(trajectories: list) -> list:
    """从成功轨迹生成候选 Skill。

    @param trajectories: 成功轨迹列表（含 task/actions/duration_ms/environment）
    @returns: [{name, description, task, actions(模板), source_trajectories,
                trajectory_count, avg_duration_ms, stability, score}]
    """
    # 按 task 聚合
    by_task = {}
    for traj in trajectories:
        if not traj.get("success"):
            continue
        task = traj.get("task", "unknown")
        actions = extract_actions(traj)
        if len(actions) < MIN_TRAJECTORY_LENGTH:
            continue
        by_task.setdefault(task, []).append(traj)

    candidates = []
    for task, trajs in by_task.items():
        if len(trajs) < MIN_TRAJECTORIES:
            continue
        # 按动作模板签名聚合
        templates = {}
        for traj in trajs:
            sig = action_template_signature(extract_actions(traj))
            templates.setdefault(sig, {"actions": None, "trajs": []})
            templates[sig]["trajs"].append(traj)
        for sig, group in templates.items():
            if len(group["trajs"]) < MIN_TRAJECTORIES:
                continue
            sample = group["trajs"][0]
            actions = [parametrize_action(a) for a in extract_actions(sample)]
            durations = [t.get("duration_ms", 0) for t in group["trajs"]]
            avg = sum(durations) / len(durations) if durations else 0
            # 稳定性：时长变异系数（越小越稳定）
            import statistics
            stdev = statistics.pstdev(durations) if len(durations) > 1 else 0
            stability = 1.0 / (1.0 + (stdev / max(avg, 1)))
            count = len(group["trajs"])
            score = round(count * stability * (1.0 / (1.0 + avg / 5000.0)), 3)
            name = f"skill_{task}"
            candidates.append({
                "name": name,
                "description": f"自动化执行「{task}」（由 {count} 条成功轨迹学习）",
                "task": task,
                "actions": actions,
                "source_trajectories": [t.get("id", "") for t in group["trajs"]],
                "trajectory_count": count,
                "avg_duration_ms": round(avg, 0),
                "stability": round(stability, 3),
                "score": score,
                "status": "generated",
            })
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


def save_candidate(candidate: dict, directory: Path = None) -> str:
    """写入候选 Skill 文件（generated/），返回路径。"""
    directory = directory or GENERATED_DIR
    directory.mkdir(parents=True, exist_ok=True)
    name = candidate.get("name", "skill")
    path = directory / f"{name}-{uuid.uuid4().hex[:6]}.json"
    path.write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def promote_to_verified(candidate: dict, directory: Path = None) -> str:
    """Benchmark 通过后晋升 verified/（status → verified）。"""
    directory = directory or VERIFIED_DIR
    directory.mkdir(parents=True, exist_ok=True)
    verified = {**candidate, "status": "verified", "verified_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    path = directory / f"{candidate.get('name', 'skill')}.json"
    path.write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def deprecate(candidate: dict, reason: str, directory: Path = None) -> str:
    """Benchmark 失败/环境变化 → deprecated/。"""
    directory = directory or DEPRECATED_DIR
    directory.mkdir(parents=True, exist_ok=True)
    dep = {**candidate, "status": "deprecated", "deprecated_reason": reason,
           "deprecated_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    path = directory / f"{candidate.get('name', 'skill')}.json"
    path.write_text(json.dumps(dep, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def list_skills(directory: Path = None) -> list:
    """列出某目录下的 Skill 文件内容。"""
    directory = directory or GENERATED_DIR
    if not directory.exists():
        return []
    skills = []
    for f in sorted(directory.glob("*.json")):
        try:
            skills.append(json.loads(f.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return skills


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--generate" and len(args) > 1:
        trajs = json.loads(args[1])
        cands = generate_candidates(trajs)
        for c in cands:
            path = save_candidate(c)
            print(f"generated: {c['name']} (score={c['score']}, {c['trajectory_count']} 轨迹) → {path}")
    elif args and args[0] == "--list":
        for c in list_skills():
            print(f"[{c.get('status')}] {c['name']} score={c.get('score')}")
    else:
        print(__doc__)
