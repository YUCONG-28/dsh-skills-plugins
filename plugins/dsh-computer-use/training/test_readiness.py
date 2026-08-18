#!/usr/bin/env python3
"""training/readiness 单测。"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.readiness import evaluate, collect_stats  # noqa: E402


def stats(trajs=50, ok=40, verified=3, pos=500, neg=10, pref=50):
    return {"trajectories": trajs, "successes": ok, "failures": trajs - ok,
            "verified_skills": verified, "positive_samples": pos,
            "negative_samples": neg, "preference_pairs": pref}


class TestEvaluate(unittest.TestCase):
    def test_early_stage_not_ready(self):
        r = evaluate(stats())
        stages = {s["stage"]: s for s in r["stages"]}
        self.assertFalse(stages["A"]["ready"])
        self.assertFalse(stages["C"]["ready"])
        self.assertEqual(r["overall"]["ready_stages"], 0)
        self.assertIn("早期", r["overall"]["recommendation"])

    def test_full_ready(self):
        r = evaluate(stats(trajs=200, ok=190, verified=15, pos=2000, pref=500))
        stages = {s["stage"]: s for s in r["stages"]}
        self.assertTrue(stages["A"]["ready"])
        self.assertTrue(stages["B"]["ready"])
        self.assertTrue(stages["C"]["ready"])
        self.assertTrue(stages["D"]["ready"])
        # E 需要成功率 >= 0.9：190/200 = 0.95 ✓
        self.assertTrue(stages["E"]["ready"])
        self.assertEqual(r["overall"]["ready_stages"], 5)

    def test_e_not_ready_without_prereq(self):
        r = evaluate(stats(trajs=200, ok=190, verified=15, pos=2000, pref=5))
        stages = {s["stage"]: s for s in r["stages"]}
        self.assertFalse(stages["D"]["ready"])
        self.assertFalse(stages["E"]["ready"])  # 前置 D 未就绪

    def test_e_requires_stable_success_rate(self):
        # 成功率 0.85：A 就绪（≥0.8），但 E 需要 ≥0.9
        r = evaluate(stats(trajs=200, ok=170, verified=15, pos=2000, pref=500))
        stages = {s["stage"]: s for s in r["stages"]}
        self.assertTrue(stages["A"]["ready"])
        self.assertFalse(stages["E"]["ready"])  # 成功率 0.85 < 0.9

    def test_score_partial(self):
        r = evaluate(stats(trajs=50, ok=40))
        stage_a = next(s for s in r["stages"] if s["stage"] == "A")
        self.assertEqual(stage_a["score"], 0.5)  # 50/100

    def test_note_no_training(self):
        r = evaluate(stats())
        self.assertIn("不训练", r["overall"]["note"])


class TestCollectStats(unittest.TestCase):
    def test_collect_without_store(self):
        # 无 memory/训练产物时返回 0
        st = collect_stats(memory_store=None)
        self.assertEqual(st["trajectories"], 0)


if __name__ == "__main__":
    unittest.main()
