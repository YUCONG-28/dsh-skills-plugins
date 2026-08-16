#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core/pet_profile.py 单元测试（unittest，无第三方依赖）

覆盖：亲密度冷却/封顶/等级边界、小鱼干惰性结算（锚点首写与死锁回归）、
消耗、持久化往返与坏文件容错。
运行：.venv/bin/python3 -m unittest discover tests
"""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import pet_profile  # noqa: E402


class TestAffinity(unittest.TestCase):
    def test_empty(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        self.assertEqual(a["points"], 0)
        self.assertEqual(pet_profile.rank_of(0)["name"], "初识")

    def test_rank_boundaries(self):
        # 0/25/50/80 → 初识/伙伴/挚友/羁绊；100 封顶仍为羁绊
        self.assertEqual(pet_profile.rank_of(0)["name"], "初识")
        self.assertEqual(pet_profile.rank_of(24)["name"], "初识")
        self.assertEqual(pet_profile.rank_of(25)["name"], "伙伴")
        self.assertEqual(pet_profile.rank_of(49)["name"], "伙伴")
        self.assertEqual(pet_profile.rank_of(50)["name"], "挚友")
        self.assertEqual(pet_profile.rank_of(79)["name"], "挚友")
        self.assertEqual(pet_profile.rank_of(80)["name"], "羁绊")
        self.assertEqual(pet_profile.rank_of(100)["name"], "羁绊")

    def test_pet_first_always_lands(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        nxt, delta, _, accepted = pet_profile.apply_pet(a, 1000)
        self.assertTrue(accepted)
        self.assertEqual(delta, pet_profile.PET_REWARD)
        self.assertEqual(nxt["points"], 1)
        self.assertEqual(nxt["pets"], 1)
        self.assertEqual(nxt["last_pet_at"], 1000)

    def test_pet_cooldown(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        nxt, _, _, _ = pet_profile.apply_pet(a, 1000)
        # 冷却内：原样返回
        again, delta, reaction, accepted = pet_profile.apply_pet(nxt, 1000 + 5000)
        self.assertFalse(accepted)
        self.assertEqual(delta, 0)
        self.assertIn("歇口气", reaction)
        self.assertIs(again, nxt)  # 未变更 → 同一对象（调用方跳过持久化）
        # 冷却后：生效
        later, delta, _, accepted = pet_profile.apply_pet(nxt, 1000 + pet_profile.PET_COOLDOWN_MS + 1)
        self.assertTrue(accepted)
        self.assertEqual(later["points"], 2)

    def test_feed_reward_and_cooldown(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        nxt, delta, _, accepted = pet_profile.apply_feed(a, 1000)
        self.assertTrue(accepted)
        self.assertEqual(delta, pet_profile.FEED_REWARD)
        self.assertEqual(nxt["points"], 5)
        # 冷却内拒绝
        _, delta, _, accepted = pet_profile.apply_feed(nxt, 1000 + 1000)
        self.assertFalse(accepted)
        self.assertEqual(delta, 0)

    def test_points_capped_at_max(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        a["points"] = pet_profile.AFFINITY_MAX - 2
        nxt, _, _, _ = pet_profile.apply_feed(a, 1)
        self.assertEqual(nxt["points"], pet_profile.AFFINITY_MAX)
        rewarded = pet_profile.apply_turn_reward(nxt)
        self.assertEqual(rewarded["points"], pet_profile.AFFINITY_MAX)

    def test_turn_reward_counts_turns(self):
        a = dict(pet_profile.EMPTY_AFFINITY)
        a["points"] = 90
        nxt = pet_profile.apply_turn_reward(a)
        self.assertEqual(nxt["turns"], 1)
        self.assertEqual(nxt["points"], 91)


class TestTreats(unittest.TestCase):
    def test_work_output_whole_periods(self):
        # 3 回合 +1；turns 从 0 起算，锚点在 0 时 turns=3 → 1 条
        t = dict(pet_profile.EMPTY_TREATS)
        nxt, gained = pet_profile.settle_treat_grants(t, turns=3, now_ms=0)
        self.assertEqual(gained, 1)
        self.assertEqual(nxt["treats"], 1)
        # 工作锚点推进：剩余回合归零（turns - (3 % 3) = 3）
        self.assertEqual(nxt["turns_at_last_treat_grant"], 3)

    def test_work_anchor_advances_only_on_grant(self):
        # 时间时钟已启动（锚点非 0），专注验证工作锚点推进与余数累积
        t = dict(pet_profile.EMPTY_TREATS)
        t["last_treat_grant_at"] = 1000
        nxt, gained = pet_profile.settle_treat_grants(t, turns=4, now_ms=1000)
        self.assertEqual(gained, 1)
        # 4 - (4 % 3) = 3：余 1 回合累积到下一周期
        self.assertEqual(nxt["turns_at_last_treat_grant"], 3)
        again, gained2 = pet_profile.settle_treat_grants(nxt, turns=5, now_ms=1000)
        self.assertEqual(gained2, 0)  # 只新增 2 回合，不够 3
        self.assertIs(again, nxt)     # 无产出且锚点已设 → 原对象（跳过持久化）

    def test_time_anchor_starts_on_first_settlement(self):
        # 死锁回归：首次零收益也写时间锚点，之后 30 分钟可产出
        t = dict(pet_profile.EMPTY_TREATS)
        nxt, gained = pet_profile.settle_treat_grants(t, turns=0, now_ms=5000)
        self.assertEqual(gained, 0)
        self.assertEqual(nxt["last_treat_grant_at"], 5000)  # 锚点已写
        later, gained2 = pet_profile.settle_treat_grants(
            nxt, turns=0, now_ms=5000 + pet_profile.TIME_TREAT_MS + 1)
        self.assertEqual(gained2, 1)
        self.assertEqual(later["treats"], 1)

    def test_time_and_work_independent(self):
        # 一直工作也能拿时间产出：两路独立（时间时钟已启动，锚点在过去）
        t = dict(pet_profile.EMPTY_TREATS)
        now_ms = pet_profile.TIME_TREAT_MS * 2 + 1000
        t["last_treat_grant_at"] = 1000  # 已走满 2 个时间周期
        nxt, gained = pet_profile.settle_treat_grants(t, turns=6, now_ms=now_ms)
        self.assertEqual(gained, 4)  # 工作 2 条 + 时间 2 条
        self.assertEqual(nxt["treats"], 4)

    def test_stock_capped(self):
        t = dict(pet_profile.EMPTY_TREATS)
        t["treats"] = pet_profile.MAX_TREATS - 1
        nxt, gained = pet_profile.settle_treat_grants(t, turns=30, now_ms=0)
        self.assertEqual(gained, 10)
        self.assertEqual(nxt["treats"], pet_profile.MAX_TREATS)

    def test_consume_treat(self):
        t = dict(pet_profile.EMPTY_TREATS)
        self.assertIsNone(pet_profile.consume_treat(t))  # 空库存拒绝
        t["treats"] = 2
        nxt = pet_profile.consume_treat(t)
        self.assertIsNotNone(nxt)
        self.assertEqual(nxt["treats"], 1)


class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, ".pet-profile.json")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_roundtrip(self):
        profile = {
            "name": "小雷",
            "affinity": {
                "points": 33, "last_pet_at": 1000, "last_feed_at": 2000,
                "pets": 3, "feeds": 2, "turns": 7,
            },
            "treats": {
                "treats": 4, "last_treat_grant_at": 3000,
                "turns_at_last_treat_grant": 6,
            },
        }
        pet_profile.save_profile(self.path, profile)
        loaded = pet_profile.load_profile(self.path)
        self.assertEqual(loaded["name"], "小雷")
        self.assertEqual(loaded["affinity"], profile["affinity"])
        self.assertEqual(loaded["treats"], profile["treats"])

    def test_missing_file_defaults(self):
        loaded = pet_profile.load_profile(self.path)
        self.assertEqual(loaded["name"], "")
        self.assertEqual(loaded["affinity"]["points"], 0)
        self.assertEqual(loaded["treats"]["treats"], 0)

    def test_corrupt_file_falls_back(self):
        with open(self.path, "w") as f:
            f.write("{ not json !!")
        loaded = pet_profile.load_profile(self.path)
        self.assertEqual(loaded["affinity"]["points"], 0)
        self.assertEqual(loaded["name"], "")

    def test_bad_fields_fall_back_per_field(self):
        with open(self.path, "w") as f:
            json.dump({
                "name": "   ",
                "affinity": {"points": "oops", "pets": 5},
                "treats": {"treats": 999},
            }, f)
        loaded = pet_profile.load_profile(self.path)
        self.assertEqual(loaded["affinity"]["points"], 0)      # 坏字段回退
        self.assertEqual(loaded["affinity"]["pets"], 5)        # 好字段保留
        self.assertEqual(loaded["treats"]["treats"], pet_profile.MAX_TREATS)  # 封顶
        self.assertEqual(loaded["name"], "")                   # 空白名回退

    def test_points_clamped_on_load(self):
        with open(self.path, "w") as f:
            json.dump({"affinity": {"points": 500}}, f)
        loaded = pet_profile.load_profile(self.path)
        self.assertEqual(loaded["affinity"]["points"], pet_profile.AFFINITY_MAX)

    def test_atomic_write_leaves_no_tmp(self):
        pet_profile.save_profile(self.path, {
            "name": "x", "affinity": dict(pet_profile.EMPTY_AFFINITY),
            "treats": dict(pet_profile.EMPTY_TREATS),
        })
        self.assertFalse(os.path.exists(self.path + ".tmp"))
        self.assertTrue(os.path.exists(self.path))


if __name__ == "__main__":
    unittest.main()
