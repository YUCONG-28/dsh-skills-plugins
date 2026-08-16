#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""桌宠互动账本（亲密度 + 小鱼干经济 + 持久化）——纯逻辑模块，无 AppKit 依赖

互动数值：摸头 +1（10s 冷却）、喂食 +5（30s 冷却，消耗 1 条小鱼干）、
回合完成 +1；4 级成长（初识 → 伙伴 → 挚友 → 羁绊，100 分封顶）。

小鱼干经济两路产出（均与陪伴挂钩）：
- 工作产出：每完成 3 个回合 +1 条
- 时间产出：每 30 分钟 +1 条
结算为惰性：每次读账本或互动时按持久化的上次结算锚点推算整周期，无定时器、
无漂移；首次零收益结算也会写入时间锚点（锚点死锁修复）。

持久化：pets/<名称>/.pet-profile.json，原子写（.tmp + os.replace），
坏文件/缺失回退默认。与 .pet-config.json（窗口/气泡显示配置）职责分离。
"""
import json
import os
import time

# ---------- 亲密度 ----------
AFFINITY_MAX = 100

# 等级阈值与名称（0/25/50/80，100 封顶）
AFFINITY_RANKS = (
    {"min": 0, "name": "初识"},
    {"min": 25, "name": "伙伴"},
    {"min": 50, "name": "挚友"},
    {"min": 80, "name": "羁绊"},
)

# 互动数值（与 dsh-pet 默认一致）
PET_REWARD = 1          # 每次摸头亲密度
PET_COOLDOWN_MS = 10000  # 摸头冷却（10s）
FEED_REWARD = 5         # 每次喂食亲密度
FEED_COOLDOWN_MS = 30000  # 喂食冷却（30s）
TURN_REWARD = 1         # 每完成一个回合的亲密度

# ---------- 小鱼干经济 ----------
TURNS_PER_TREAT = 3        # 工作每 3 回合 +1 条
TIME_TREAT_MS = 30 * 60000  # 时间每 30 分钟 +1 条
MAX_TREATS = 20            # 库存上限

DEFAULT_PET_NAME = ""      # 空 = 用 spec 的 display_name

# ---------- 账本结构 ----------
EMPTY_AFFINITY = {
    "points": 0,
    "last_pet_at": 0,     # epoch 毫秒；0 = 从未互动（首次必中）
    "last_feed_at": 0,
    "pets": 0,            # 摸头总次数（终身）
    "feeds": 0,           # 喂食总次数（终身）
    "turns": 0,           # 见证的已完成回合数（终身）
}

EMPTY_TREATS = {
    "treats": 0,
    "last_treat_grant_at": 0,   # 时间产出锚点（epoch 毫秒，0 = 从未开始）
    "turns_at_last_treat_grant": 0,  # 工作产出锚点（上次结算时的回合数）
}

EMPTY_PROFILE = {
    "name": DEFAULT_PET_NAME,
    "affinity": dict(EMPTY_AFFINITY),
    "treats": dict(EMPTY_TREATS),
}


# ---------- 纯函数（时钟注入，便于测试） ----------
def rank_of(points):
    """按分数返回等级 dict（{"min","name"}）"""
    rank = AFFINITY_RANKS[0]
    for candidate in AFFINITY_RANKS:
        if points >= candidate["min"]:
            rank = candidate
    return rank


def _clamp(points):
    return max(0, min(AFFINITY_MAX, points))


def apply_pet(affinity, now_ms):
    """摸头：+1 亲密度，10s 冷却。返回 (新账本, 增量, 文案, 是否生效)"""
    if affinity["last_pet_at"] != 0 and now_ms - affinity["last_pet_at"] < PET_COOLDOWN_MS:
        return affinity, 0, "摸过头啦，让小家伙歇口气～", False
    nxt = dict(affinity)
    nxt["last_pet_at"] = now_ms
    nxt["pets"] += 1
    nxt["points"] = _clamp(nxt["points"] + PET_REWARD)
    return nxt, PET_REWARD, "咕噜咕噜～被摸摸好舒服！", True


def apply_feed(affinity, now_ms):
    """喂食：+5 亲密度，30s 冷却（库存是否足够由调用方先查 consume_treat）。
    返回 (新账本, 增量, 文案, 是否生效)"""
    if affinity["last_feed_at"] != 0 and now_ms - affinity["last_feed_at"] < FEED_COOLDOWN_MS:
        return affinity, 0, "吃饱啦，晚点再喂～", False
    nxt = dict(affinity)
    nxt["last_feed_at"] = now_ms
    nxt["feeds"] += 1
    nxt["points"] = _clamp(nxt["points"] + FEED_REWARD)
    return nxt, FEED_REWARD, "呜哇！小鱼干好好吃！", True


def apply_turn_reward(affinity):
    """回合完成奖励：+1 亲密度（幂等性由调用方按回合号去重）"""
    nxt = dict(affinity)
    nxt["turns"] += 1
    nxt["points"] = _clamp(nxt["points"] + TURN_REWARD)
    return nxt


def settle_treat_grants(treats, turns, now_ms):
    """惰性结算小鱼干：工作 + 时间两路产出，返回 (新账本, 本次获得条数)。

    工作产出：整周期 = (turns - 上次工作锚点) // TURNS_PER_TREAT，只推进工作锚点；
    时间产出：整周期 = (now - 时间锚点) // TIME_TREAT_MS，只推进时间锚点。
    两路独立（一直工作也能拿时间产出）。0 时间历史不回溯——时钟从首次结算起算，
    且首次零收益也写时间锚点（死锁修复：锚点不写 → 永远无产出）。库存封顶 MAX_TREATS。
    无产出且锚点已设时原样返回（调用方可跳过持久化）。
    """
    turn_delta = max(0, turns - treats["turns_at_last_treat_grant"])
    work_grants = turn_delta // TURNS_PER_TREAT
    time_anchor = treats["last_treat_grant_at"] if treats["last_treat_grant_at"] != 0 else now_ms
    time_grants = max(0, now_ms - time_anchor) // TIME_TREAT_MS
    gained = work_grants + time_grants
    if gained <= 0:
        if treats["last_treat_grant_at"] == 0:
            return dict(treats, last_treat_grant_at=now_ms), 0  # 启动时间时钟
        return treats, 0
    nxt = dict(treats)
    nxt["treats"] = min(MAX_TREATS, max(0, treats["treats"] + gained))
    nxt["last_treat_grant_at"] = (
        time_anchor + time_grants * TIME_TREAT_MS if time_grants > 0 else time_anchor)
    nxt["turns_at_last_treat_grant"] = (
        turns - (turn_delta % TURNS_PER_TREAT) if work_grants > 0
        else treats["turns_at_last_treat_grant"])
    return nxt, gained


def consume_treat(treats):
    """喂食消耗 1 条小鱼干；库存不足返回 None"""
    if treats["treats"] <= 0:
        return None
    nxt = dict(treats)
    nxt["treats"] -= 1
    return nxt


# ---------- 持久化 ----------
def profile_path(pet_dir, config_file):
    """桌宠目录下的互动账本路径（.pet-profile.json）"""
    return os.path.join(pet_dir, config_file)


def load_profile(profile_path_):
    """读取账本：逐字段安全解析，单个坏字段只回退该字段；文件级错误整表默认"""
    raw = {}
    try:
        with open(profile_path_, "r") as f:
            parsed = json.load(f)
        if isinstance(parsed, dict):
            raw = parsed
    except (OSError, ValueError, TypeError):
        raw = {}

    def field(section, key, conv, default):
        try:
            return conv(raw.get(section, {}).get(key, default))
        except (TypeError, ValueError, AttributeError):
            return default

    affinity = {
        "points": field("affinity", "points", int, 0),
        "last_pet_at": field("affinity", "last_pet_at", int, 0),
        "last_feed_at": field("affinity", "last_feed_at", int, 0),
        "pets": field("affinity", "pets", int, 0),
        "feeds": field("affinity", "feeds", int, 0),
        "turns": field("affinity", "turns", int, 0),
    }
    affinity["points"] = max(0, min(AFFINITY_MAX, affinity["points"]))
    treats = {
        "treats": field("treats", "treats", int, 0),
        "last_treat_grant_at": field("treats", "last_treat_grant_at", int, 0),
        "turns_at_last_treat_grant": field("treats", "turns_at_last_treat_grant", int, 0),
    }
    treats["treats"] = max(0, min(MAX_TREATS, treats["treats"]))
    name = raw.get("name", "")
    return {
        "name": name if isinstance(name, str) and name.strip() else DEFAULT_PET_NAME,
        "affinity": affinity,
        "treats": treats,
    }


def save_profile(profile_path_, profile):
    """原子写账本：先写 .tmp 再 os.replace，崩溃不产生半截 JSON"""
    tmp = profile_path_ + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump({
                "name": str(profile["name"]),
                "affinity": {
                    "points": int(profile["affinity"]["points"]),
                    "last_pet_at": int(profile["affinity"]["last_pet_at"]),
                    "last_feed_at": int(profile["affinity"]["last_feed_at"]),
                    "pets": int(profile["affinity"]["pets"]),
                    "feeds": int(profile["affinity"]["feeds"]),
                    "turns": int(profile["affinity"]["turns"]),
                },
                "treats": {
                    "treats": int(profile["treats"]["treats"]),
                    "last_treat_grant_at": int(profile["treats"]["last_treat_grant_at"]),
                    "turns_at_last_treat_grant": int(profile["treats"]["turns_at_last_treat_grant"]),
                },
            }, f, ensure_ascii=False, indent=2)
        os.replace(tmp, profile_path_)
    except OSError:
        pass


def now_ms():
    """当前 epoch 毫秒（wall clock，与冷却/时间产出语义一致）"""
    return int(time.time() * 1000)
