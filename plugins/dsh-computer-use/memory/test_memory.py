#!/usr/bin/env python3
"""memory 单测：store / retrieve / verify。"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from memory.store import MemoryStore, make_trajectory  # noqa: E402
from memory.retrieve import find_similar, env_score  # noqa: E402
from memory.verify import verify_environment  # noqa: E402

ENV = {"os": "macOS", "os_version": "26.5", "app": "TextEdit",
       "app_version": "1.0", "window_title": "Untitled"}


class MemoryTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dsh-cu-mem-test-"))
        self.store = MemoryStore(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestStore(MemoryTestCase):
    def test_save_and_load(self):
        traj = make_trajectory("open_textedit", ENV, [{"type": "open_app"}],
                               "ok", True, duration_ms=2000)
        traj_id = self.store.save_trajectory(traj)
        loaded = self.store.load_trajectory(traj_id)
        self.assertEqual(loaded["task"], "open_textedit")
        self.assertTrue(loaded["success"])
        # 索引存在
        self.assertEqual(len(self.store.list_index()), 1)
        # 成功归档
        self.assertTrue((self.tmp / "successes" / f"{traj_id}.json").exists())

    def test_failure_archived_separately(self):
        traj = make_trajectory("click_x", ENV, [], "fail", False)
        traj_id = self.store.save_trajectory(traj)
        self.assertTrue((self.tmp / "failures" / f"{traj_id}.json").exists())
        self.assertFalse((self.tmp / "successes" / f"{traj_id}.json").exists())

    def test_index_dedup(self):
        traj = make_trajectory("t1", ENV, [], "ok", True)
        traj_id = self.store.save_trajectory(traj)
        traj["id"] = traj_id
        self.store.save_trajectory(traj)
        self.assertEqual(len(self.store.list_index()), 1)


class TestRetrieve(MemoryTestCase):
    def test_exact_env_match_high_score(self):
        self.store.save_trajectory(make_trajectory("open_textedit", ENV, [], "ok", True))
        cands = find_similar(self.store, "open_textedit", ENV)
        self.assertEqual(len(cands), 1)
        self.assertGreaterEqual(cands[0]["score"], 0.9)

    def test_task_mismatch_returns_nothing(self):
        self.store.save_trajectory(make_trajectory("open_textedit", ENV, [], "ok", True))
        cands = find_similar(self.store, "open_terminal", ENV)
        self.assertEqual(cands, [])

    def test_env_mismatch_below_threshold(self):
        self.store.save_trajectory(make_trajectory("open_textedit", ENV, [], "ok", True))
        cands = find_similar(self.store, "open_textedit", {"os": "Windows", "app": "Notepad"})
        self.assertEqual(cands, [])

    def test_failures_excluded_by_default(self):
        self.store.save_trajectory(make_trajectory("t1", ENV, [], "ok", False))
        cands = find_similar(self.store, "t1", ENV)
        self.assertEqual(cands, [])

    def test_env_score_partial_window(self):
        s1 = env_score({"window_title": "Untitled"}, {"window_title": "Untitled 2"})
        s2 = env_score({"window_title": "Untitled"}, {"window_title": "Completely Different"})
        self.assertGreater(s1, s2)


class TestVerify(MemoryTestCase):
    def test_matching_env_replayable(self):
        traj = make_trajectory("t1", ENV, [{"type": "open_app"}], "ok", True)
        v = verify_environment(traj, {"os": "macOS", "app": "TextEdit", "window_title": "Untitled 2"})
        self.assertTrue(v["replayable"])
        self.assertLess(len(v["reasons"]), 2)  # window 不一致是可覆盖 warning

    def test_app_mismatch_not_replayable(self):
        traj = make_trajectory("t1", ENV, [], "ok", True)
        v = verify_environment(traj, {"os": "macOS", "app": "Safari"})
        self.assertFalse(v["replayable"])
        self.assertTrue(any("app" in r for r in v["reasons"]))

    def test_os_mismatch_not_replayable(self):
        traj = make_trajectory("t1", ENV, [], "ok", True)
        v = verify_environment(traj, {"os": "Windows", "app": "TextEdit"})
        self.assertFalse(v["replayable"])

    def test_ui_fingerprint_mismatch_warns(self):
        traj = make_trajectory("t1", ENV, [], "ok", True,
                               initial_state={"ax_tree_hash": "abc"})
        v = verify_environment(traj, {"os": "macOS", "app": "TextEdit"},
                               ui_fingerprint={"ax_tree_hash": "def"})
        # ui_state 非关键维度 → 仍可 replay（warning）
        self.assertTrue(v["replayable"])
        self.assertTrue(any("ui_state" in r for r in v["reasons"]))


if __name__ == "__main__":
    unittest.main()
