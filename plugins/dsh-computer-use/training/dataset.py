#!/usr/bin/env python3
"""
training/dataset.py — Phase 9：训练数据集积累（严格脱敏）

从轨迹记忆生成训练样本，保留：
  state / task / available_tools / chosen_tool / action / result / success / latency

输出目录：
  raw/        原始样本（先脱敏再落盘）
  cleaned/    清洗后（去重、字段规范）
  positive/   成功样本（SFT / Policy Model）
  negative/   失败样本（对比学习）
  preference/ 偏好对（同任务成功 vs 失败，DPO / Preference Learning）

安全（脱敏规则，任何样本不得包含）：
  - API Key（sk-… / 32+ 位 base64）
  - Bearer / access_token / refresh_token
  - password / passwd / pwd 值
  - cookie / session
  - 邮箱 / 手机号 / 身份证 / 银行卡
  - 私钥路径（~/.ssh、credentials、.pem）
  - 敏感输入框内容（secure 字段——helper 层已保证不输出）
"""
import json
import re
import sys
import time
import uuid
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# 脱敏规则
# ---------------------------------------------------------------------------

SECRET_PATTERNS = [
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"), "sk-<REDACTED>"),
    (re.compile(r"\b(Bearer\s+[A-Za-z0-9._-]{16,})", re.I), "Bearer <REDACTED>"),
    (re.compile(r"\b(access_token|refresh_token|api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*[^\s,;\"']+", re.I),
     r"\1=<REDACTED>"),
    (re.compile(r"\b(cookie|session[_-]?id)\s*[=:]\s*[^\s,;\"']+", re.I), r"\1=<REDACTED>"),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "<EMAIL_REDACTED>"),
    (re.compile(r"\b1[3-9]\d{9}\b"), "<PHONE_REDACTED>"),
    (re.compile(r"\b\d{17}[\dXx]\b"), "<ID_REDACTED>"),
    (re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b"), "<CARD_REDACTED>"),
    (re.compile(r"(~|/Users/[^/\s]+)/(\.ssh|\.aws|\.kube|\.pem|\.key|credentials)[^\s\"']*", re.UNICODE),
     r"<PATH_REDACTED>"),
]

SENSITIVE_KEYS = {"password", "passwd", "pwd", "token", "api_key", "apikey",
                  "secret", "cookie", "session", "credentials", "authorization"}


def sanitize_text(text: str) -> str:
    """脱敏任意文本（正则规则）。"""
    if not text:
        return text
    out = text
    for pattern, repl in SECRET_PATTERNS:
        out = pattern.sub(repl, out)
    return out


def sanitize_value(key: str, value):
    """按 key 脱敏单值；敏感 key 直接标记。"""
    if key.lower() in SENSITIVE_KEYS:
        return "<REDACTED>"
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [sanitize_value(key, v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize_value(k, v) for k, v in value.items()}
    return value


def sanitize_sample(sample: dict) -> dict:
    """脱敏一条样本（递归）。"""
    out = {}
    for key, value in sample.items():
        out[key] = sanitize_value(key, value)
    return out


# ---------------------------------------------------------------------------
# 样本构造
# ---------------------------------------------------------------------------

def trajectory_to_samples(trajectory: dict) -> list:
    """轨迹 → 动作级样本列表（state/task/chosen_tool/action/result/success/latency）。"""
    samples = []
    actions = trajectory.get("actions", [])
    for i, action in enumerate(actions):
        if not isinstance(action, dict):
            continue
        samples.append({
            "state": f"trajectory:{trajectory.get('task')}:step:{i}",
            "task": trajectory.get("task", ""),
            "available_tools": ["computer_observe", "computer_click", "computer_type_text",
                                "computer_press_key", "computer_scroll", "computer_batch"],
            "chosen_tool": f"computer_{action.get('type', 'unknown')}"
                           if action.get("type") not in ("open_app", "wait", "assert_app_window")
                           else ("shell_open" if action.get("type") == "open_app" else "wait"),
            "action": action,
            "result": trajectory.get("result", ""),
            "success": bool(trajectory.get("success")),
            "latency_ms": trajectory.get("duration_ms", 0),
            "environment": trajectory.get("environment", {}),
        })
    return samples


# ---------------------------------------------------------------------------
# 流水线
# ---------------------------------------------------------------------------

def build_dataset(memory_store, root: Path = None, flush: bool = True) -> dict:
    """从记忆构建完整数据集（raw→cleaned→positive/negative→preference）。"""
    root = root or TRAINING_ROOT
    for sub in ("raw", "cleaned", "positive", "negative", "preference"):
        (root / sub).mkdir(parents=True, exist_ok=True)

    # 1. 从记忆取轨迹
    entries = memory_store.list_index()
    trajectories = []
    for e in entries:
        traj = memory_store.load_trajectory(e["id"])
        if traj:
            trajectories.append(traj)

    # 2. raw：动作级样本 + 脱敏
    raw_samples = []
    for traj in trajectories:
        for s in trajectory_to_samples(traj):
            raw_samples.append(sanitize_sample(s))
    if flush:
        _write_samples(root / "raw", raw_samples, "raw")

    # 3. cleaned：去重（按 state+chosen_tool+action 签名）
    cleaned = []
    seen = set()
    for s in raw_samples:
        sig = json.dumps([s.get("state"), s.get("chosen_tool"), s.get("action")], sort_keys=True)
        if sig in seen:
            continue
        seen.add(sig)
        cleaned.append(s)
    if flush:
        _write_samples(root / "cleaned", cleaned, "cleaned")

    # 4. positive / negative
    positive = [s for s in cleaned if s["success"]]
    negative = [s for s in cleaned if not s["success"]]
    if flush:
        _write_samples(root / "positive", positive, "positive")
        _write_samples(root / "negative", negative, "negative")

    # 5. preference：同 task 的成功 vs 失败（成功在前）
    preference = []
    by_task = {}
    for s in cleaned:
        by_task.setdefault(s["task"], {"ok": [], "bad": []})
        (by_task[s["task"]]["ok"] if s["success"] else by_task[s["task"]]["bad"]).append(s)
    for task, groups in by_task.items():
        for ok in groups["ok"][:5]:
            for bad in groups["bad"][:2]:
                preference.append({
                    "task": task,
                    "chosen": ok,
                    "rejected": bad,
                    "preference": "chosen>rejected",
                })
    if flush:
        _write_samples(root / "preference", preference, "preference")

    return {
        "trajectories": len(trajectories),
        "raw": len(raw_samples),
        "cleaned": len(cleaned),
        "positive": len(positive),
        "negative": len(negative),
        "preference": len(preference),
    }


def _write_samples(directory: Path, samples: list, tag: str):
    if not samples:
        return
    path = directory / f"{tag}-{int(time.time() * 1000)}.json"
    path.write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from memory.store import MemoryStore
    stats = build_dataset(MemoryStore(Path(__file__).resolve().parent.parent / "memory"))
    print(json.dumps(stats, ensure_ascii=False, indent=2))
