#!/usr/bin/env python3
"""computer/router 单测。"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from computer.router import ActionState, plan, candidates_for, CHANNELS  # noqa: E402


class TestCandidates(unittest.TestCase):
    def test_click_prefers_structured(self):
        cands = candidates_for("click")
        # dom/ax 优先于 shortcut/vision
        self.assertEqual(cands[0], "dom_cdp")
        self.assertLess(cands.index("ax"), cands.index("vision"))

    def test_observe_prefers_ax_over_vision(self):
        cands = candidates_for("observe")
        self.assertEqual(cands[0], "ax")
        self.assertLess(cands.index("ocr"), cands.index("vision"))


class TestPlan(unittest.TestCase):
    def test_open_app_via_shell(self):
        p = plan("open_app", "TextEdit", ActionState(shell_capable=True))
        self.assertEqual(p.selected, "shell")

    def test_click_uses_ax_when_no_dom(self):
        p = plan("click", "Save", ActionState(ax_available=True))
        self.assertEqual(p.selected, "ax")

    def test_click_uses_shortcut_when_no_ax(self):
        p = plan("click", "Save", ActionState(shortcut_known=True))
        self.assertEqual(p.selected, "shortcut")

    def test_click_falls_to_vision_when_nothing_structured(self):
        # 结构化通道全不可用 + 预算允许 vision（>=2）→ 最后手段 vision
        p = plan("click", "Save", ActionState(screen_recording=True, cost_budget=5.0))
        self.assertEqual(p.selected, "vision")
        self.assertIn("vision", p.reason)

    def test_click_none_when_vision_budget_locked(self):
        # 默认预算（1.0 < 2.0）下 vision 不可用，且无其他通道 → none（诚实失败）
        p = plan("click", "Save", ActionState(screen_recording=True))
        self.assertEqual(p.selected, "none")

    def test_vision_blocked_by_budget(self):
        p = plan("click", "Save", ActionState(screen_recording=True, cost_budget=1.0))
        # 预算 < 2 时 vision 不可用 → 只能选降级链最后手段
        self.assertNotEqual(p.selected, "vision")

    def test_alternatives_ordered(self):
        p = plan("click", "Save", ActionState(ax_available=True, shortcut_known=True, screen_recording=True))
        self.assertEqual(p.selected, "ax")
        self.assertEqual(p.alternatives[0], "shortcut")

    def test_priority_order_in_channels(self):
        prios = [c.priority for c in CHANNELS]
        self.assertEqual(prios, sorted(prios))


class TestCli(unittest.TestCase):
    def test_cli_plan(self):
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent.parent / "computer" / "router.py"),
             "--plan", '{"action":"click","target":"Save","state":{"ax_available":true}}'],
            capture_output=True, text=True, timeout=15)
        self.assertEqual(proc.returncode, 0)
        d = json.loads(proc.stdout)
        self.assertEqual(d["selected"], "ax")


if __name__ == "__main__":
    unittest.main()
