#!/usr/bin/env python3
"""model_router 单测（python3 -m unittest 或直接运行）。"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from router.model_router import RoutingContext, decide, analyze_trajectory  # noqa: E402


class TestDecide(unittest.TestCase):
    def test_routine_click_goes_fast(self):
        d = decide(RoutingContext(action_type="click", turn=3, action_text="点击保存按钮"))
        self.assertEqual(d.tier, "fast")
        self.assertFalse(d.thinking_on)
        self.assertEqual(d.reasoning_effort, "off")

    def test_planning_goes_pro(self):
        d = decide(RoutingContext(action_type="planning", task_stage="planning"))
        self.assertEqual(d.tier, "pro")
        self.assertTrue(d.thinking_on)

    def test_unknown_ui_goes_pro(self):
        d = decide(RoutingContext(action_type="click", ui_known=False))
        self.assertEqual(d.tier, "pro")

    def test_failures_threshold_goes_pro(self):
        d = decide(RoutingContext(action_type="click", failures=2))
        self.assertEqual(d.tier, "pro")
        self.assertIn("failures=2>=2", d.reason)
        # 1 次失败不升级
        d1 = decide(RoutingContext(action_type="click", failures=1))
        self.assertEqual(d1.tier, "fast")

    def test_vision_required_goes_vision(self):
        d = decide(RoutingContext(action_type="observe", needs_vision=True))
        self.assertEqual(d.tier, "vision")
        self.assertIn("deepseek-v4-flash-vision-exp", d.model)

    def test_high_risk_text_detected(self):
        d = decide(RoutingContext(action_type="click", action_text="git push --force 到远程"))
        self.assertEqual(d.tier, "pro")
        self.assertTrue(d.thinking_on)

    def test_recovery_stage_goes_pro(self):
        d = decide(RoutingContext(action_type="click", task_stage="recovery"))
        self.assertEqual(d.tier, "pro")


class TestAnalyze(unittest.TestCase):
    def test_fastable_detection(self):
        traj = {
            "actions": [
                {"type": "click", "tier": "fast"},
                {"type": "click", "tier": "pro"},   # 可 FAST 化
                {"type": "type", "tier": "vision"},  # 可 FAST 化
                {"type": "planning", "tier": "pro"},  # 合理用 pro
            ]
        }
        stats = analyze_trajectory(traj)
        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["pro"], 2)
        self.assertEqual(stats["fastable"], ["click", "type"])
        self.assertGreater(stats["potential_saving"], 0)


class TestCli(unittest.TestCase):
    def test_cli_decide(self):
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent.parent / "router" / "model_router.py"),
             "--decide", '{"action_type":"click","turn":3}'],
            capture_output=True, text=True, timeout=15)
        self.assertEqual(proc.returncode, 0)
        d = json.loads(proc.stdout)
        self.assertEqual(d["tier"], "fast")


if __name__ == "__main__":
    unittest.main()
