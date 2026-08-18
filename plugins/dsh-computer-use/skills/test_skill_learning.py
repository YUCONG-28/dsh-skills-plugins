#!/usr/bin/env python3
"""skills/skill_learning 单测。"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from skills.skill_learning import (  # noqa: E402
    generate_candidates, parametrize_action, save_candidate, promote_to_verified,
    deprecate, list_skills, MIN_TRAJECTORIES,
)

ENV = {"os": "macOS", "app": "TextEdit"}


def traj(task, actions, duration=2000, success=True, tid="x"):
    return {"id": tid, "task": task, "success": success, "duration_ms": duration,
            "environment": ENV, "actions": actions}


class TestParametrize(unittest.TestCase):
    def test_handle_parametrized(self):
        out = parametrize_action({"type": "click", "handle": "0.3.7"})
        self.assertEqual(out["handle"], "{param}")

    def test_type_text_parametrized(self):
        out = parametrize_action({"type": "type", "text": "hello world"})
        self.assertEqual(out["text"], "{param}")

    def test_short_value_kept(self):
        out = parametrize_action({"type": "press", "key": "return"})
        self.assertEqual(out["key"], "return")


class TestGenerate(unittest.TestCase):
    def test_insufficient_trajectories(self):
        cands = generate_candidates([traj("t1", [{"type": "open_app", "target": "X"}], tid="a")])
        self.assertEqual(cands, [])

    def test_generate_from_repeated_success(self):
        trajs = [
            traj("open_textedit", [{"type": "open_app", "target": "TextEdit"},
                                   {"type": "wait", "ms": 1500}], tid="a"),
            traj("open_textedit", [{"type": "open_app", "target": "TextEdit"},
                                   {"type": "wait", "ms": 1500}], tid="b"),
            traj("open_textedit", [{"type": "open_app", "target": "TextEdit"},
                                   {"type": "wait", "ms": 1500}], tid="c"),
        ]
        cands = generate_candidates(trajs)
        self.assertEqual(len(cands), 1)
        c = cands[0]
        self.assertEqual(c["task"], "open_textedit")
        self.assertEqual(c["trajectory_count"], 3)
        self.assertEqual(c["status"], "generated")
        self.assertGreater(c["score"], 0)
        # 动作模板参数化
        self.assertEqual(c["actions"][0]["target"], "{param}")

    def test_failed_trajectories_excluded(self):
        trajs = [
            traj("t1", [{"type": "click", "handle": "0"}], success=False, tid="a"),
            traj("t1", [{"type": "click", "handle": "0"}], success=False, tid="b"),
        ]
        self.assertEqual(generate_candidates(trajs), [])

    def test_different_templates_not_merged(self):
        trajs = [
            traj("t1", [{"type": "click", "handle": "0"}, {"type": "wait", "ms": 100}], tid="a"),
            traj("t1", [{"type": "press", "key": "return"}, {"type": "wait", "ms": 100}], tid="b"),
        ]
        cands = generate_candidates(trajs)
        self.assertEqual(cands, [])  # 各自只有 1 条，达不到 MIN_TRAJECTORIES


class TestLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dsh-cu-skill-test-"))
        self.gen = self.tmp / "generated"
        self.ver = self.tmp / "verified"
        self.dep = self.tmp / "deprecated"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_generated_to_verified(self):
        cand = {"name": "skill_t1", "task": "t1", "actions": [], "score": 1.0}
        p1 = save_candidate(cand, self.gen)
        self.assertTrue(Path(p1).exists())
        p2 = promote_to_verified(cand, self.ver)
        self.assertTrue(Path(p2).exists())
        loaded = json.loads(Path(p2).read_text())
        self.assertEqual(loaded["status"], "verified")

    def test_deprecate(self):
        cand = {"name": "skill_t1", "task": "t1"}
        p = deprecate(cand, "benchmark 失败", self.dep)
        loaded = json.loads(Path(p).read_text())
        self.assertEqual(loaded["status"], "deprecated")
        self.assertIn("benchmark", loaded["deprecated_reason"])

    def test_list_skills(self):
        save_candidate({"name": "a", "task": "t"}, self.gen)
        save_candidate({"name": "b", "task": "t"}, self.gen)
        self.assertEqual(len(list_skills(self.gen)), 2)


if __name__ == "__main__":
    unittest.main()
