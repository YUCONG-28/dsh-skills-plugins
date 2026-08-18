#!/usr/bin/env python3
"""
memory/store.py — Phase 5：轨迹记忆存储

每次任务保存轨迹 JSON 到 memory/trajectories/；
成功/失败分别归档到 successes/ 与 failures/；
memory/index/trajectories.json 维护可检索索引。

数据模型（用户定义 + 扩展）：
  {
    "id": "...", "task": "...", "environment": {...}, "initial_state": {...},
    "actions": [...], "result": "...", "success": true,
    "duration_ms": 0, "llm_calls": 0, "vision_calls": 0, "screenshots": 0,
    "created_at": "..."
  }

replay 安全：检索只给候选，真正执行前必须 verify（memory/verify.py）——
禁止盲目 replay。
"""
import json
import os
import time
import uuid
from pathlib import Path

MEMORY_ROOT = Path(__file__).resolve().parent


class MemoryStore:
    def __init__(self, root: Path = None):
        self.root = Path(root) if root else MEMORY_ROOT
        for sub in ("trajectories", "successes", "failures", "index"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # 写入
    # ------------------------------------------------------------------

    def save_trajectory(self, trajectory: dict) -> str:
        """保存一条轨迹到 trajectories/（原子写），返回 id。"""
        traj = dict(trajectory)
        if "id" not in traj or not traj["id"]:
            traj["id"] = f"{traj.get('task', 'task')}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
        if "created_at" not in traj:
            traj["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        path = self.root / "trajectories" / f"{traj['id']}.json"
        self._atomic_write(path, traj)
        # 归档到 successes/failures（按 success 复制引用）
        target = self.root / ("successes" if traj.get("success") else "failures")
        self._atomic_write(target / f"{traj['id']}.json", traj)
        self._update_index(traj)
        return traj["id"]

    def _update_index(self, traj: dict):
        idx_path = self.root / "index" / "trajectories.json"
        index = self._read_json(idx_path, default={"trajectories": []})
        entry = {
            "id": traj["id"], "task": traj.get("task", ""),
            "environment": traj.get("environment", {}),
            "success": bool(traj.get("success")),
            "duration_ms": traj.get("duration_ms", 0),
            "created_at": traj.get("created_at", ""),
        }
        # 去重（同 id 覆盖）
        index["trajectories"] = [e for e in index["trajectories"] if e["id"] != entry["id"]]
        index["trajectories"].append(entry)
        self._atomic_write(idx_path, index)

    # ------------------------------------------------------------------
    # 读取
    # ------------------------------------------------------------------

    def load_trajectory(self, traj_id: str) -> dict:
        return self._read_json(self.root / "trajectories" / f"{traj_id}.json")

    def list_index(self) -> list:
        """索引条目列表（按创建时间倒序）。"""
        idx = self._read_json(self.root / "index" / "trajectories.json",
                              default={"trajectories": []})
        return sorted(idx.get("trajectories", []),
                      key=lambda e: e.get("created_at", ""), reverse=True)

    def list_by_task(self, task: str) -> list:
        return [e for e in self.list_index() if e.get("task") == task]

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------

    @staticmethod
    def _atomic_write(path: Path, data: dict):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    @staticmethod
    def _read_json(path: Path, default=None):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return default


def make_trajectory(task, environment, actions, result, success,
                    duration_ms=0, llm_calls=0, vision_calls=0, screenshots=0,
                    initial_state=None) -> dict:
    """构造轨迹对象。"""
    return {
        "task": task,
        "environment": environment,
        "initial_state": initial_state or {},
        "actions": actions,
        "result": result,
        "success": success,
        "duration_ms": duration_ms,
        "llm_calls": llm_calls,
        "vision_calls": vision_calls,
        "screenshots": screenshots,
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        store = MemoryStore()
        for entry in store.list_index():
            mark = "✓" if entry["success"] else "✗"
            print(f"{mark} {entry['id']:40s} {entry['task']:24s} {entry['duration_ms']}ms")
    else:
        print(__doc__)
