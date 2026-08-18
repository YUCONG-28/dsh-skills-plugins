#!/usr/bin/env python3
"""memory/classifier + strategies 单测。"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from memory.classifier import classify, categorize_history, CATEGORIES  # noqa: E402
from memory.strategies import next_strategy, strategy_plan, STRATEGIES  # noqa: E402


class TestClassifier(unittest.TestCase):
    def test_code_precise(self):
        c = classify(error_code="COMPUTER_PERMISSION_REQUIRED")
        self.assertEqual(c["category"], "permission_denied")
        self.assertEqual(c["confidence"], 1.0)

    def test_text_fallback(self):
        c = classify(error_code="", error_text="未找到按钮 Save")
        self.assertEqual(c["category"], "wrong_element")

    def test_action_fallback(self):
        c = classify(error_code="", error_text="something odd", action_type="click")
        self.assertEqual(c["category"], "wrong_element")

    def test_unknown_goes_model_reasoning(self):
        c = classify(error_code="", error_text="mysterious")
        self.assertEqual(c["category"], "model_reasoning_failure")

    def test_repeated_attempts_env(self):
        c = classify(error_code="", error_text="mysterious", attempts=5)
        self.assertEqual(c["category"], "environment_changed")

    def test_all_categories_covered(self):
        """每个类别至少有一个 code 或 text 规则可命中。"""
        sample_codes = [
            "COMPUTER_TARGET_STALE", "COMPUTER_TARGET_AMBIGUOUS", "COMPUTER_TIMEOUT",
            "COMPUTER_ACTION_FAILED", "COMPUTER_APP_NOT_FOUND", "COMPUTER_NO_WINDOW",
            "COMPUTER_INPUT_METHOD_CONFLICT", "COMPUTER_KEY_NOT_ALLOWED",
            "COMPUTER_PROTOCOL", "COMPUTER_PERMISSION_REQUIRED",
        ]
        hit = set()
        for code in sample_codes:
            hit.add(classify(error_code=code)["category"])
        self.assertEqual(hit, set(CATEGORIES) - {"unexpected_dialog", "page_not_loaded"})

    def test_categorize_history(self):
        counts = categorize_history([
            {"error_code": "COMPUTER_TIMEOUT"},
            {"error_code": "COMPUTER_PERMISSION_REQUIRED"},
            {"error_code": "COMPUTER_TIMEOUT"},
        ])
        self.assertEqual(counts["timeout"], 2)
        self.assertEqual(counts["permission_denied"], 1)


class TestStrategies(unittest.TestCase):
    def test_permission_denied_no_retry(self):
        s = next_strategy("permission_denied", 0)
        self.assertFalse(s["should_retry"])

    def test_wrong_element_strategy_chain(self):
        s0 = next_strategy("wrong_element", 0)
        self.assertTrue(s0["should_retry"])
        self.assertEqual(s0["strategy"]["strategy"], "rebind_semantic")
        s1 = next_strategy("wrong_element", 1)
        self.assertEqual(s1["strategy"]["strategy"], "reobserve")
        s2 = next_strategy("wrong_element", 2)
        self.assertEqual(s2["strategy"]["strategy"], "vision_grounding")

    def test_retry_cap_stops(self):
        s = next_strategy("wrong_element", 3)
        self.assertFalse(s["should_retry"])
        self.assertIn("上限", s["reason"])

    def test_strategy_plan_progression(self):
        history = [
            {"category": "coordinate_changed", "error": "e1"},
            {"category": "coordinate_changed", "error": "e2"},
            {"category": "coordinate_changed", "error": "e3"},
        ]
        plan = strategy_plan(history)
        self.assertEqual(plan[0]["strategy"]["strategy"], "reobserve")
        self.assertEqual(plan[1]["strategy"]["strategy"], "ax_semantic")
        self.assertEqual(plan[2]["strategy"]["strategy"], "shortcut")
        # 第 4 次停止
        plan4 = strategy_plan(history + [{"category": "coordinate_changed", "error": "e4"}])
        self.assertFalse(plan4[3]["should_retry"])

    def test_unknown_category_defaults(self):
        s = next_strategy("nonsense", 0)
        self.assertTrue(s["should_retry"])  # 走默认模型推理链


if __name__ == "__main__":
    unittest.main()
