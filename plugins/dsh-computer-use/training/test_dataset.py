#!/usr/bin/env python3
"""training/dataset 单测。"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.dataset import (  # noqa: E402
    sanitize_text, sanitize_sample, trajectory_to_samples, build_dataset,
)


class TestSanitize(unittest.TestCase):
    def test_api_key_redacted(self):
        self.assertEqual(sanitize_text("key=sk-abcdefghijklmnopqrstuvwxyz123456"),
                         "key=sk-<REDACTED>")

    def test_bearer_redacted(self):
        out = sanitize_text("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", out)

    def test_password_value_redacted(self):
        out = sanitize_text("password=superSecret123")
        self.assertIn("REDACTED", out)
        self.assertNotIn("superSecret123", out)

    def test_email_redacted(self):
        self.assertIn("EMAIL_REDACTED", sanitize_text("contact me at user@example.com"))

    def test_phone_redacted(self):
        self.assertIn("PHONE_REDACTED", sanitize_text("call 13800138000 now"))

    def test_ssh_path_redacted(self):
        out = sanitize_text("use ~/.ssh/id_rsa")
        self.assertNotIn(".ssh/id_rsa", out)
        self.assertIn("REDACTED", out)

    def test_sensitive_key_value(self):
        out = sanitize_sample({"task": "t", "token": "abc123", "ok": "fine"})
        self.assertEqual(out["token"], "<REDACTED>")
        self.assertEqual(out["ok"], "fine")

    def test_clean_text_passes(self):
        self.assertEqual(sanitize_text("click Save button"), "click Save button")


class TestSamples(unittest.TestCase):
    def test_trajectory_to_samples(self):
        traj = {
            "task": "open_textedit", "success": True, "result": "ok",
            "duration_ms": 2000,
            "environment": {"os": "macOS"},
            "actions": [
                {"type": "open_app", "target": "TextEdit"},
                {"type": "wait", "ms": 1500},
                {"type": "assert_app_window"},
            ],
        }
        samples = trajectory_to_samples(traj)
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[0]["chosen_tool"], "shell_open")
        self.assertEqual(samples[1]["chosen_tool"], "wait")
        self.assertTrue(samples[2]["success"])


class TestBuildDataset(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dsh-cu-train-test-"))
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from memory.store import MemoryStore, make_trajectory
        self.store = MemoryStore(self.tmp / "memory")
        env = {"os": "macOS", "app": "TextEdit"}
        for i in range(2):
            self.store.save_trajectory(make_trajectory(
                "open_textedit", env,
                [{"type": "open_app", "target": "TextEdit"},
                 {"type": "wait", "ms": 1500},
                 {"type": "assert_app_window"}],
                "ok", True, duration_ms=2000))
        self.store.save_trajectory(make_trajectory(
            "fail_task", env, [{"type": "click", "handle": "0"}], "fail", False,
            duration_ms=500))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_build_full_pipeline(self):
        stats = build_dataset(self.store, root=self.tmp / "training")
        self.assertEqual(stats["trajectories"], 3)
        self.assertGreater(stats["raw"], 0)
        self.assertGreater(stats["positive"], 0)
        self.assertGreater(stats["negative"], 0)
        # 文件已落盘
        raw_files = list((self.tmp / "training" / "raw").glob("*.json"))
        self.assertGreater(len(raw_files), 0)

    def test_cleaned_dedup(self):
        stats = build_dataset(self.store, root=self.tmp / "training")
        # 2 条相同轨迹 → raw 6 样本 → cleaned 去重后 < 6（wait 等重复动作合并）
        self.assertLess(stats["cleaned"], stats["raw"])

    def test_no_secrets_in_output(self):
        # 轨迹里塞敏感信息 → 输出必须脱敏
        from memory.store import make_trajectory
        self.store.save_trajectory(make_trajectory(
            "secret_task", {"os": "macOS"},
            [{"type": "type", "text": "password=hunter2"},
             {"type": "click", "handle": "0"}],
            "ok", True))
        stats = build_dataset(self.store, root=self.tmp / "training2")
        for f in (self.tmp / "training2" / "raw").glob("*.json"):
            content = f.read_text()
            self.assertNotIn("hunter2", content)


if __name__ == "__main__":
    unittest.main()
