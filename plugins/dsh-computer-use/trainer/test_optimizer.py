#!/usr/bin/env python3
"""trainer/optimizer 单测。"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from trainer.optimizer import (  # noqa: E402
    analyze, promote_candidate, report,
)


def traj(task, duration=1000, actions=None, vision=0, llm=1, pro=0, success=True, tid="x"):
    return {"id": tid, "task": task, "success": success, "duration_ms": duration,
            "actions": actions or [], "vision_calls": vision, "llm_calls": llm,
            "pro_calls": pro}


class TestOptimizer(unittest.TestCase):
    def test_repeat_pattern_detected(self):
        cands = analyze([traj("t1", tid="a"), traj("t1", tid="b")])
        kinds = [c["kind"] for c in cands]
        self.assertIn("repeat_pattern", kinds)

    def test_high_latency_detected(self):
        cands = analyze([traj("t1", duration=20000)])
        kinds = [c["kind"] for c in cands]
        self.assertIn("high_latency", kinds)
        # 低延迟不触发
        cands2 = analyze([traj("t1", duration=1000)])
        self.assertNotIn("high_latency", [c["kind"] for c in cands2])

    def test_frequent_vision_detected(self):
        cands = analyze([traj("t1", vision=5)])
        kinds = [c["kind"] for c in cands]
        self.assertIn("frequent_vision", kinds)

    def test_failure_hotspot(self):
        fails = [{"task": "open_x"}, {"task": "open_x"}]
        cands = analyze([traj("t1")], fails)
        hotspots = [c for c in cands if c["kind"] == "failure_hotspot"]
        self.assertEqual(len(hotspots), 1)
        self.assertEqual(hotspots[0]["source"], "open_x")
        self.assertEqual(hotspots[0]["severity"], "error")

    def test_batch_candidate(self):
        actions = [{"type": "click"}, {"type": "type"}, {"type": "press"}, {"type": "wait"}]
        cands = analyze([traj("t1", actions=actions)])
        batch = [c for c in cands if c["kind"] == "batch_candidate"]
        self.assertEqual(len(batch), 1)
        self.assertIn("4", batch[0]["detail"])  # 4 动作 → 减少 3 次

    def test_short_sequence_no_batch(self):
        actions = [{"type": "click"}, {"type": "wait"}]
        cands = analyze([traj("t1", actions=actions)])
        self.assertNotIn("batch_candidate", [c["kind"] for c in cands])

    def test_pro_heavy(self):
        cands = analyze([traj("t1", llm=10, pro=9)])
        kinds = [c["kind"] for c in cands]
        self.assertIn("pro_heavy", kinds)
        # 正常占比不触发
        cands2 = analyze([traj("t1", llm=10, pro=1)])
        self.assertNotIn("pro_heavy", [c["kind"] for c in cands2])

    def test_promote(self):
        cand = {"kind": "repeat_pattern", "title": "x", "status": "candidate"}
        promoted = promote_candidate(cand)
        self.assertEqual(promoted["status"], "promoted")
        self.assertIn("promoted_at", promoted)

    def test_report(self):
        cands = analyze([traj("t1", duration=20000), traj("t1", tid="a"), traj("t1", tid="b")])
        r = report(cands)
        self.assertEqual(r["total"], len(cands))
        self.assertIn("repeat_pattern", r["by_kind"])


if __name__ == "__main__":
    unittest.main()
