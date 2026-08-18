#!/usr/bin/env python3
"""state/detector 单测。"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from state.detector import (  # noqa: E402
    compute_fingerprint, fingerprint_equal, state_changed, needs_vision,
)

BASE_OBS = {
    "windows": [{"axIndex": 0, "title": "Untitled"}],
    "elements": [
        {"path": "0", "role": "AXTextArea", "title": "", "value": "hello"},
        {"path": "1", "role": "AXButton", "title": "Save", "value": ""},
        {"path": "2", "role": "AXButton", "title": "Cancel", "value": ""},
    ],
}


class TestFingerprint(unittest.TestCase):
    def test_same_observation_same_fingerprint(self):
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(json.loads(json.dumps(BASE_OBS)))
        self.assertTrue(fingerprint_equal(a, b))

    def test_value_change_changes_hash(self):
        changed = json.loads(json.dumps(BASE_OBS))
        changed["elements"][0]["value"] = "world"
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(changed)
        self.assertNotEqual(a["ax_tree_hash"], b["ax_tree_hash"])

    def test_coordinate_change_ignored(self):
        """坐标变化不改变指纹（坐标不该触发截图）。"""
        moved = json.loads(json.dumps(BASE_OBS))
        moved["elements"][0]["frame"] = {"x": 999, "y": 999}
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(moved)
        self.assertTrue(fingerprint_equal(a, b))

    def test_window_change(self):
        changed = json.loads(json.dumps(BASE_OBS))
        changed["windows"] = [{"axIndex": 0, "title": "Untitled 2"}]
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(changed)
        self.assertTrue(state_changed(a, b)["changed"])


class TestNeedsVision(unittest.TestCase):
    def test_stable_state_no_vision(self):
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(json.loads(json.dumps(BASE_OBS)))
        d = needs_vision(a, b)
        self.assertFalse(d["needs_vision"])
        self.assertEqual(d["reason"], "state_stable")

    def test_text_change_triggers_vision(self):
        changed = json.loads(json.dumps(BASE_OBS))
        changed["elements"][0]["value"] = "completely different content"
        a = compute_fingerprint(BASE_OBS)
        b = compute_fingerprint(changed)
        d = needs_vision(a, b)
        self.assertTrue(d["needs_vision"])
        self.assertIn("ax_tree_hash", d["changes"])

    def test_small_element_delta_does_not_trigger(self):
        """元素数小幅比例变化（< element_ratio）且无文本变化 → 不触发。"""
        big = {
            "windows": [{"axIndex": 0, "title": "Doc"}],
            "elements": [
                {"path": f"{i}", "role": "AXStaticText", "title": "", "value": f"line {i}"}
                for i in range(20)
            ],
        }
        small = json.loads(json.dumps(big))
        # 追加一个无内容元素：元素数 20→21（5% < 10%），无文本变化
        small["elements"].append({"path": "99", "role": "AXSeparator", "title": "", "value": ""})
        a = compute_fingerprint(big)
        b = compute_fingerprint(small)
        d = needs_vision(a, b)
        self.assertFalse(d["needs_vision"])


class TestCli(unittest.TestCase):
    def test_cli_decide_screenshot(self):
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent.parent / "state" / "detector.py"),
             "--decide-screenshot",
             json.dumps({"prev": BASE_OBS, "new": BASE_OBS})],
            capture_output=True, text=True, timeout=15)
        self.assertEqual(proc.returncode, 0)
        d = json.loads(proc.stdout)
        self.assertFalse(d["needs_vision"])


if __name__ == "__main__":
    unittest.main()
