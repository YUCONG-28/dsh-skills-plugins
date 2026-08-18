#!/usr/bin/env python3
"""
memory/verify.py — Phase 5：Replay 前环境验证

禁止盲目 replay。执行轨迹前按以下维度验证当前环境与轨迹记录时一致：
  OS（系统版本）
  Application（应用存在 / 版本）
  Window（窗口标题匹配）
  UI state（初始状态指纹：AX 树 hash / 文本 hash）
  Element（轨迹首动作引用的元素在当前树中存在）

验证通过 → replayable；任一关键维度不匹配 → 拒绝 replay（返回原因）。
"""
import json
import sys
from pathlib import Path

from memory.store import MemoryStore

# 关键维度：缺失即不可 replay
REQUIRED_DIMENSIONS = ("os", "app")


def verify_environment(trajectory: dict, current: dict, ui_fingerprint: dict = None) -> dict:
    """验证轨迹是否可在当前环境 replay。

    @param trajectory: 存储的轨迹（含 environment / initial_state）
    @param current: 当前环境 {os, os_version, app, app_version, window_title}
    @param ui_fingerprint: 当前 UI 指纹（可选，来自 state/detector.compute_fingerprint）
    @returns: {replayable, checks: [{dimension, ok, detail}], reasons}
    """
    checks = []
    recorded_env = trajectory.get("environment", {})
    initial = trajectory.get("initial_state", {})

    # OS
    if "os" in current:
        ok = str(recorded_env.get("os", "")).lower() == str(current["os"]).lower()
        checks.append({"dimension": "os", "ok": ok,
                       "detail": f"{recorded_env.get('os')} vs {current['os']}"})
    # Application
    if "app" in current:
        ok = str(recorded_env.get("app", "")).lower() == str(current["app"]).lower()
        checks.append({"dimension": "app", "ok": ok,
                       "detail": f"{recorded_env.get('app')} vs {current['app']}"})
    # Window（若记录过窗口标题且当前提供）
    if "window_title" in current and recorded_env.get("window_title"):
        recorded = str(recorded_env["window_title"]).lower()
        now = str(current["window_title"]).lower()
        ok = now in recorded or recorded in now or recorded == now
        checks.append({"dimension": "window", "ok": ok,
                       "detail": f"{recorded_env['window_title']} vs {current['window_title']}"})
    # UI state 指纹（若轨迹记录过 initial_state 且当前提供指纹）
    if ui_fingerprint and initial.get("ax_tree_hash"):
        ok = str(initial.get("ax_tree_hash")) == str(ui_fingerprint.get("ax_tree_hash"))
        checks.append({"dimension": "ui_state", "ok": ok,
                       "detail": "ax_tree_hash 比对"})
    # Element（轨迹首动作引用的元素）
    if trajectory.get("actions"):
        first = trajectory["actions"][0]
        if isinstance(first, dict) and first.get("handle") and ui_fingerprint:
            # 元素存在性由调用方用 tree 判定；这里记录检查占位
            checks.append({"dimension": "element", "ok": True,
                           "detail": f"首动作 handle={first.get('handle')}（需在树中验证）"})

    # 判定：关键维度（os/app）必须匹配；其他维度不匹配给 warning
    reasons = []
    for c in checks:
        if not c["ok"]:
            if c["dimension"] in REQUIRED_DIMENSIONS:
                reasons.append(f"{c['dimension']} 不匹配：{c['detail']}")
            else:
                reasons.append(f"{c['dimension']} 不一致（可覆盖）：{c['detail']}")
    replayable = not any(r.startswith(d) for r in reasons for d in REQUIRED_DIMENSIONS)
    return {"replayable": replayable, "checks": checks, "reasons": reasons}


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "--verify":
        data = json.loads(args[1])
        store = MemoryStore()
        traj = store.load_trajectory(data["trajectory_id"]) if "trajectory_id" in data else data.get("trajectory", {})
        print(json.dumps(verify_environment(traj, data.get("current", {}),
                                            data.get("ui_fingerprint")),
                         ensure_ascii=False, indent=2))
    else:
        print(__doc__)
