#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""桌面宠物通用引擎（macOS 原生 AppKit 版，PyObjC）

由 remiel 桌宠（remiel-pet-desktop.py）全量提取而来：纯逻辑层算法与字段保持一致，
窗口/交互层为 macOS 原生 AppKit。功能全量对照原版：
- 透明无边框置顶窗口，右下角停靠
- 多帧 GIF 表情动画（idle/thinking/waiting/running/success 由 <state_file> 驱动）
- 头顶气泡堆栈（<bubble_file> 驱动，矩形/云朵两种形状，槽位动画）
- 拖动 / 滚轮缩放 / 旋转 / 镜像 / 右键菜单 / 菜单栏图标
- 互动系统：点击摸头 / 喂食小鱼干 / 亲密度 4 级成长 /
  自定义命名 / 隐藏召唤，账本持久化于 pets/<name>/.pet-profile.json
- flock 单实例锁；Q / Esc / 右键退出

通用引擎由 pet_spec.json 驱动，缺省回退内置 DEFAULT_SPEC。入口 main(pet_dir)：
加载 spec → 构建 PetController → 运行 NSApplication 主循环。运行时一律由
pets/<name>/pet.py 调用。

运行环境：.venv/bin/python3（Python 3.9.6 + pyobjc-framework-Cocoa 11.0 + Pillow 11.3.0）
"""
import copy
import os
import sys
import json
import re
import fcntl
import signal
import subprocess
import time
from math import ceil

import warnings
warnings.filterwarnings("ignore")  # 屏蔽 PyObjC 指针所有权告警，保持日志干净

import objc
from PIL import Image, ImageSequence, ImageOps, ImageDraw

from Foundation import NSObject, NSMakeRect, NSString, NSTimer
from AppKit import (NSApplication, NSWindow, NSView, NSImageView, NSTextField,
                    NSMenu, NSMenuItem, NSStatusBar, NSColorPanel, NSColor,
                    NSColorSpace, NSScreen, NSApp, NSEvent, NSFont,
                    NSFontAttributeName, NSBitmapImageRep, NSImage,
                    NSWindowStyleMaskBorderless, NSBackingStoreBuffered,
                    NSFloatingWindowLevel, NSApplicationActivationPolicyAccessory,
                    NSVariableStatusItemLength, NSCalibratedRGBColorSpace,
                    NSImageScaleNone, NSImageAlignCenter,
                    NSRightTextAlignment, NSLeftTextAlignment,
                    NSAlert, NSAlertFirstButtonReturn)

from core import pet_profile

# ---------- 内置默认 spec（缺省回退 / P3 演示桌宠 / 测试使用） ----------
DEFAULT_SPEC = {
    "name": "pet",
    "display_name": "桌宠",
    "emotes_dir": "emotes",
    "html": None,                 # None 时状态栏不显示「打开网页版」项
    "state_file": "/tmp/pet.state",
    "bubble_file": "/tmp/pet.bubble",
    "config_file": ".pet-config.json",
    "lock_file": ".pet.lock",
    "status_icon": None,          # 相对 pet_dir；None 时跳过菜单栏图标
    "emote_map": {"idle": 1, "thinking": 2, "waiting": 3, "running": 4, "success": 5},
    "defaults": {
        "width": 190.0,           # 默认显示宽度（px）
        "min_width": 95.0,        # 0.5x
        "max_width": 305.0,       # ~1.6x
        "step_ratio": 1.15,       # 每次滚轮缩放比例
        "bubbles": 5,             # 默认同时显示的气泡数
        "lifetime": 6.0,          # 默认气泡停留秒数（到期自动淡出）
        "side": "right",          # 气泡默认右上
        "bubble_border_w": 0,     # 气泡边框宽度默认（px，0 表示无边框）
        "bubble_border_color": "#c9b8d0",  # 边框颜色默认（宽度 0 时不显示）
        "bubble_font_size": 12,   # 气泡文字字号默认（px）
        "bubble_text_color": "#3a2b3f",    # 气泡文字颜色默认
        "bubble_bg_color": "#ffffff",      # 气泡背景色默认
        "bubble_bg_alpha": 92,    # 气泡背景不透明度默认（%）
        "bubble_gap": 2,          # 气泡垂直间距默认（px）
        "bubble_shape": "rect",   # 气泡形状默认（rect 圆角矩形 / cloud 云朵）
    },
}

# ---------- 动画/行为常量（非参数化，保持与原版一致） ----------
BUBBLE_ROW_H = 24       # 单条气泡高度下限（px，实际行高随字号/边框动态计算）
BUBBLE_FADE_MS = 500    # 淡出动画时长
RISE_SPEED = 200.0      # 气泡垂直移动速度（px/s，固定速度模式：出生升起/移除填位）
BIRTH_FADE_MS = 300     # 出生淡入时长（ms，0 → 1）
BUBBLE_FADE_START = 0.2  # 气泡生命周期的前 20% 保持完全透明，之后开始渐变
FLOAT_TICK_MS = 50       # 浮动动画帧间隔（约 20fps）
STATE_IDLE_TIMEOUT = 30  # thinking/running 状态无活动多少秒后自动回退 idle
# 样式变化会改变窗口几何的键（触发 apply_size 重算 + 右下角锚定）
GEOMETRIC_KEYS = {"bubble_font_size", "bubble_border_w", "bubble_gap", "bubble_shape"}

# ---------- 运行时全局（main() 设置） ----------
_PET_DIR = None
_SPEC = None
_APP_PET = None
_LOCK_FD = None


def load_spec(pet_dir):
    """加载 pet_dir/pet_spec.json 并与 DEFAULT_SPEC 深合并（缺省回退内置默认）"""
    merged = copy.deepcopy(DEFAULT_SPEC)
    spec_path = os.path.join(pet_dir, "pet_spec.json")
    if os.path.exists(spec_path):
        with open(spec_path, "r") as f:
            spec = json.load(f)
        if isinstance(spec, dict):
            # 嵌套 dict（defaults/emote_map）先在 deepcopy 的 merged 上做真合并，
            # 再从顶层 update 中剔除，避免 merged.update(spec) 的引用替换导致
            # 后续 update 变成对自身 update 的 no-op、缺省键回退失效。
            for key in ("defaults", "emote_map"):
                if isinstance(spec.get(key), dict) and isinstance(merged.get(key), dict):
                    merged[key].update(spec[key])
            merged.update({k: v for k, v in spec.items()
                           if k not in ("defaults", "emote_map")})
    return merged


def _now_us():
    """单调时钟微秒时间戳（等价原版 GLib.get_monotonic_time）"""
    return int(time.monotonic() * 1e6)


def pil_to_nsimage(img):
    """PIL RGBA Image → NSImage（内存拷贝进 NSBitmapImageRep，与原版 new_from_data 同语义）"""
    w, h = img.size
    raw = img.tobytes()
    rep = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, w, h, 8, 4, True, False, NSCalibratedRGBColorSpace, w * 4, 32)
    rep.bitmapData()[:] = raw  # 拷贝字节进 rep 自有缓冲区
    nsimg = NSImage.alloc().init()
    nsimg.addRepresentation_(rep)
    nsimg.setSize_((w, h))
    return nsimg


class BubbleItem:
    """单条浮动气泡的数据"""
    __slots__ = ("widget", "label", "cloud_img", "w",
                 "born", "x", "y", "dying", "fade_start", "fade_from")

    def __init__(self, widget, born_us):
        self.widget = widget          # NSView 气泡容器（矩形/云朵统一）
        self.label = None             # 文字 NSTextField（云朵模式居中叠加）
        self.cloud_img = None         # 云朵 NSImageView 子控件（云朵模式才有，None 表示矩形）
        self.w = 0                    # 容器宽度（矩形=文本实测宽度，云朵=PNG 宽）
        self.born = born_us           # 出生微秒时间戳
        self.x = 0
        self.y = 0
        self.dying = False            # 已标记淡出（溢出/到期，淡出完移除）
        self.fade_start = 0           # 淡出起始微秒时间戳
        self.fade_from = 1.0          # 淡出起始透明度（取自 widget.alphaValue()）


# ---------- 配置存取（17 字段 schema 不变） ----------
def load_config(config_path, defaults):
    """读取配置：逐字段安全解析，单个坏字段只回退该字段（文件级错误才整表默认）"""
    try:
        with open(config_path, "r") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raw = {}
    except (OSError, ValueError, TypeError):
        raw = {}

    def field(key, conv, default):
        try:
            return conv(raw.get(key, default))  # 缺键→默认；坏值→conv 抛异常→回退
        except (TypeError, ValueError):
            return default

    return {
        "width": field("width", float, defaults["width"]),
        "x": field("x", int, -1),
        "y": field("y", int, -1),
        "bubbles": field("bubbles", int, defaults["bubbles"]),
        "lifetime": field("lifetime", float, defaults["lifetime"]),
        "angle": field("angle", lambda v: int(v) % 360, 0),
        "mirror_x": field("mirror_x", bool, False),
        "mirror_y": field("mirror_y", bool, False),
        "side": field("side", str, defaults["side"]),
        "bubble_border_w": field("bubble_border_w", int, defaults["bubble_border_w"]),
        "bubble_border_color": field("bubble_border_color", str, defaults["bubble_border_color"]),
        "bubble_font_size": field("bubble_font_size", int, defaults["bubble_font_size"]),
        "bubble_text_color": field("bubble_text_color", str, defaults["bubble_text_color"]),
        "bubble_bg_color": field("bubble_bg_color", str, defaults["bubble_bg_color"]),
        "bubble_bg_alpha": field("bubble_bg_alpha", int, defaults["bubble_bg_alpha"]),
        "bubble_gap": field("bubble_gap", int, defaults["bubble_gap"]),
        "bubble_shape": field("bubble_shape", str, defaults["bubble_shape"]),
    }


def save_config(config_path, values):
    """原子写配置（17 字段）：先写 .tmp 再 os.replace，崩溃不产生半截 JSON"""
    tmp = config_path + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump({"width": round(values["width"], 1), "x": int(values["x"]), "y": int(values["y"]),
                       "bubbles": int(values["bubbles"]), "lifetime": float(values["lifetime"]),
                       "angle": int(values["angle"]) % 360, "mirror_x": bool(values["mirror_x"]),
                       "mirror_y": bool(values["mirror_y"]), "side": str(values["side"]),
                       "bubble_border_w": int(values["bubble_border_w"]),
                       "bubble_border_color": str(values["bubble_border_color"]),
                       "bubble_font_size": int(values["bubble_font_size"]),
                       "bubble_text_color": str(values["bubble_text_color"]),
                       "bubble_bg_color": str(values["bubble_bg_color"]),
                       "bubble_bg_alpha": int(values["bubble_bg_alpha"]),
                       "bubble_gap": int(values["bubble_gap"]),
                       "bubble_shape": str(values["bubble_shape"])}, f)
        os.replace(tmp, config_path)
    except OSError:
        pass


def _text_w_px(text, font_size):
    """估算单行文本像素宽：全角/emoji 计 1.0 倍字号，半角计 0.55 倍"""
    w = 0.0
    for ch in text:
        w += font_size if ord(ch) > 0x2E80 else font_size * 0.55
    return max(8, int(w))


def make_cloud_pixbuf(text, font_size, bg_hex, bg_alpha, border_hex, border_w):
    """PIL 画云朵形状 RGBA 图（2x 超采样抗锯齿），返回 (宽, 高, NSImage)

    4 圆并集：底部大圆 + 顶部中圆 + 左右小圆；border_w>0 时先画外扩边框圆
    再画填充圆（整体外描边、内部无交线；圆接缝处有轻微 V 形凸出，bw=0 无影响）。
    背景透明度直接写入像素 alpha，与矩形模式 CSS rgba 语义一致。
    """
    tw = _text_w_px(text, font_size)
    H = int(font_size * 1.7) + 20
    W = max(tw + 44, int(H * 1.35))
    p = border_w                              # 画布内边距：外描边圆会超出填充圆，必须预留
    W2, H2 = W + 2 * p, H + 2 * p

    circles = [                               # (半径, 中心x, 中心y)，相对 W/H 比例
        (0.55 * H, 0.46 * W, H - 0.55 * H),   # 底部大圆，底边与画布底相切
        (0.36 * H, 0.58 * W, 0.38 * H),       # 顶部中圆
        (0.28 * H, 0.27 * W, 0.60 * H),       # 左侧小圆
        (0.26 * H, 0.74 * W, 0.56 * H),       # 右侧小圆
    ]
    bg_rgb = (int(bg_hex[1:3], 16), int(bg_hex[3:5], 16), int(bg_hex[5:7], 16))
    bd_rgb = (int(border_hex[1:3], 16), int(border_hex[3:5], 16),
              int(border_hex[5:7], 16))
    bg_a = int(bg_alpha * 255 / 100)

    img = Image.new("RGBA", (W2 * 2, H2 * 2), (0, 0, 0, 0))  # 2x 超采样
    d = ImageDraw.Draw(img)

    def disc(cx, cy, r, color):
        box = ((cx + p - r) * 2, (cy + p - r) * 2,
               (cx + p + r) * 2, (cy + p + r) * 2)
        d.ellipse(box, fill=color)

    if border_w > 0:                          # 第一遍：边框色外扩圆（全不透明）
        for r, cx, cy in circles:
            disc(cx, cy, r + border_w, bd_rgb + (255,))
    for r, cx, cy in circles:                 # 第二遍：背景色填充圆（带透明度）
        disc(cx, cy, r, bg_rgb + (bg_a,))

    img = img.resize((W2, H2), Image.LANCZOS)
    return W2, H2, pil_to_nsimage(img)


def make_rect_image(w, h, bg_hex, bg_alpha, border_hex, border_w):
    """PIL 画圆角矩形气泡背景 RGBA 图（2x 超采样，与云朵语义一致），返回 NSImage"""
    bg_rgb = (int(bg_hex[1:3], 16), int(bg_hex[3:5], 16), int(bg_hex[5:7], 16))
    bd_rgb = (int(border_hex[1:3], 16), int(border_hex[3:5], 16),
              int(border_hex[5:7], 16))
    bg_a = int(bg_alpha * 255 / 100)
    radius = 22                                # CSS border-radius 11px × 2x 超采样
    img = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if border_w > 0:
        d.rounded_rectangle([0, 0, w * 2 - 1, h * 2 - 1], radius, fill=bd_rgb + (255,))
        inset = border_w * 2
        d.rounded_rectangle([inset, inset, w * 2 - 1 - inset, h * 2 - 1 - inset],
                            radius, fill=bg_rgb + (bg_a,))
    else:
        d.rounded_rectangle([0, 0, w * 2 - 1, h * 2 - 1], radius, fill=bg_rgb + (bg_a,))
    img = img.resize((w, h), Image.LANCZOS)
    return pil_to_nsimage(img)


def _valid_color(value, fallback):
    """校验 #RRGGBB 格式，非法回退默认色"""
    if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value
    return fallback


def _hex_to_ns_color(hexv):
    return NSColor.colorWithSRGBRed_green_blue_alpha_(
        int(hexv[1:3], 16) / 255.0, int(hexv[3:5], 16) / 255.0,
        int(hexv[5:7], 16) / 255.0, 1.0)


def _ns_color_to_hex(color):
    try:
        c = color.colorUsingColorSpace_(NSColorSpace.sRGBColorSpace())
    except Exception:
        c = color
    return "#%02x%02x%02x" % (int(round(c.redComponent() * 255)),
                              int(round(c.greenComponent() * 255)),
                              int(round(c.blueComponent() * 255)))


def load_frames(frame_path, width, angle=0, mirror_x=False, mirror_y=False):
    """加载表情的全部动画帧（缩放+姿态变换），返回 (NSImage列表, 每帧毫秒)"""
    im = Image.open(frame_path)
    h = max(1, int(im.size[1] * width / im.size[0]))
    frames, durations = [], []
    for frame in ImageSequence.Iterator(im):
        rgba = frame.convert("RGBA").resize((int(width), h), Image.LANCZOS)
        if mirror_x:
            rgba = ImageOps.mirror(rgba)
        if mirror_y:
            rgba = ImageOps.flip(rgba)
        if angle:
            rgba = rgba.rotate(angle, expand=True, resample=Image.BICUBIC)
        frames.append(pil_to_nsimage(rgba))
        durations.append(frame.info.get("duration", 100))
    return frames, durations


# ---------- AppKit 窗口/视图子类 ----------
class PetWindow(NSWindow):
    """无边框窗口可成为 key window（接收键盘 Q/Esc）"""
    def canBecomeKeyWindow(self):
        return True

    def canBecomeMainWindow(self):
        return True


class PetView(NSView):
    """翻转坐标系（原点左上）的内容视图：接收鼠标/滚轮/键盘事件，转发给控制器"""
    def init(self):
        self = objc.super(PetView, self).init()
        return self

    def setPet_(self, pet):
        self._pet = pet

    def isFlipped(self):
        return True

    def acceptsFirstResponder(self):
        return True

    def mouseDown_(self, event):
        self._pet.on_mouse_down(event)

    def mouseDragged_(self, event):
        self._pet.on_mouse_dragged(event)

    def mouseUp_(self, event):
        self._pet.on_mouse_up(event)

    def rightMouseDown_(self, event):
        self._pet.on_right_click(event)

    def scrollWheel_(self, event):
        self._pet.on_scroll(event)

    def keyDown_(self, event):
        self._pet.on_key(event)


class PetController(NSObject):
    def init(self):
        self = objc.super(PetController, self).init()
        if self is None:
            return None

        spec = _SPEC
        pet_dir = _PET_DIR
        d = spec["defaults"]

        # ---- 路径/元数据参数化 ----
        self.pet_dir = pet_dir
        self.display_name = spec["display_name"]
        self.emotes_dir = os.path.join(pet_dir, spec["emotes_dir"])
        self.config_path = os.path.join(pet_dir, spec["config_file"])
        self.state_file = spec["state_file"]
        self.bubble_file = spec["bubble_file"]
        self.emote_map = spec["emote_map"]
        self.html_path = os.path.join(pet_dir, spec["html"]) if spec["html"] else None
        self.status_icon = spec["status_icon"]
        self.status_icon_path = (os.path.join(pet_dir, self.status_icon)
                                 if self.status_icon else None)

        # 表情帧文件命名：从 status_icon 推导（如 "emotes/remiel_1.gif" → "remiel_{n}.gif"）
        self.emote_prefix = ""
        self.emote_ext = ".gif"
        if self.status_icon:
            m = re.match(r"^(.*?)(\d+)\.(\w+)$", os.path.basename(self.status_icon))
            if m:
                self.emote_prefix = m.group(1)
                self.emote_ext = "." + m.group(3)

        # 参数化常量（原版模块级 DEFAULT_*/MIN_*/MAX_*/STEP_RATIO）
        self.MIN_WIDTH = d["min_width"]
        self.MAX_WIDTH = d["max_width"]
        self.STEP_RATIO = d["step_ratio"]
        self.DEFAULT_BORDER_COLOR = d["bubble_border_color"]
        self.DEFAULT_TEXT_COLOR = d["bubble_text_color"]
        self.DEFAULT_BG_COLOR = d["bubble_bg_color"]

        self.width = d["width"]
        self.state = None          # 当前 Claude 状态（idle/thinking/running/success）
        self.state_emote = 1
        self.state_since = 0.0   # 状态切换时间戳（秒）
        self.success_since = None  # 成功状态展示起始时间
        self.bubble_mtime = 0.0    # 上次处理的气泡文件修改时间
        self.bubble_items = []     # DEPRECATED: 旧 Revealer 列表，保留兼容
        self.bubble_data = []      # [(BubbleItem, ...)] 浮动气泡数据
        self.frames = {}
        self.durations = {}
        self.frame_idx = 0
        self.timer = None
        self.drag_off = None
        self.resize_pending = None
        self.cfg = load_config(self.config_path, d)
        self.max_bubbles = max(1, min(10, self.cfg["bubbles"]))
        self.bubble_lifetime = max(2.0, min(120.0, self.cfg["lifetime"]))
        self.angle = self.cfg["angle"]
        self.mirror_x = self.cfg["mirror_x"]
        self.mirror_y = self.cfg["mirror_y"]
        self.bubble_side = self.cfg["side"] if self.cfg["side"] in ("left", "right") else "right"
        # 气泡样式（必须在 apply_size 之前赋值——行高计算会读取）
        self.bubble_border_w = max(0, min(5, self.cfg["bubble_border_w"]))
        self.bubble_font_size = max(10, min(18, self.cfg["bubble_font_size"]))
        self.bubble_bg_alpha = max(60, min(100, self.cfg["bubble_bg_alpha"]))
        self.bubble_border_color = _valid_color(self.cfg["bubble_border_color"],
                                                self.DEFAULT_BORDER_COLOR)
        self.bubble_text_color = _valid_color(self.cfg["bubble_text_color"],
                                              self.DEFAULT_TEXT_COLOR)
        self.bubble_bg_color = _valid_color(self.cfg["bubble_bg_color"],
                                            self.DEFAULT_BG_COLOR)
        self.bubble_gap = max(0, min(12, self.cfg["bubble_gap"]))
        self.bubble_shape = (self.cfg["bubble_shape"]
                             if self.cfg["bubble_shape"] in ("rect", "cloud") else "rect")
        self._float_last_us = None   # float_tick 上一帧时间戳（计算真实 dt）
        self._color_key = None       # 当前颜色面板正在调节的键
        self._color_pending = None   # 取色防抖一次性定时器
        self._color_pending_hex = None
        self.status_state_item = None
        self.status_affinity_item = None

        # ---- 互动账本（亲密度/小鱼干） ----
        self.profile_path = os.path.join(pet_dir, ".pet-profile.json")
        self.profile = pet_profile.load_profile(self.profile_path)
        self.profile_name = self.profile["name"] or self.display_name
        # 首次启动惰性结算：时间产出锚点首写（启动时间时钟），零收益也落盘
        ledger, _ = pet_profile.settle_treat_grants(
            self.profile["treats"], self.profile["affinity"]["turns"], pet_profile.now_ms())
        if ledger is not self.profile["treats"]:
            self.profile["treats"] = ledger
            pet_profile.save_profile(self.profile_path, self.profile)
        self._down_pos = None        # 点击判定：按下位置（屏幕坐标）
        self._down_time = None       # 点击判定：按下时间（单调时钟）

        # ---- 窗口 ----
        self.win = PetWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(0, 0, 200, 200), NSWindowStyleMaskBorderless,
            NSBackingStoreBuffered, False)
        self.win.setBackgroundColor_(NSColor.clearColor())
        self.win.setOpaque_(False)
        self.win.setHasShadow_(False)
        self.win.setLevel_(NSFloatingWindowLevel)
        self.win.setReleasedWhenClosed_(False)

        self.view = PetView.alloc().init()
        self.view.setFrame_(NSMakeRect(0, 0, 200, 200))
        self.view.setPet_(self)
        self.win.setContentView_(self.view)

        self.img = NSImageView.alloc().initWithFrame_(NSMakeRect(0, 0, 200, 200))
        self.img.setImageScaling_(NSImageScaleNone)
        self.img.setImageAlignment_(NSImageAlignCenter)
        self.img.setEditable_(False)
        self.view.addSubview_(self.img)

        # 应用保存过的尺寸与姿态
        self.apply_size(self.cfg["width"])

        # 位置：记住的（屏幕内校验，越界回退）> 默认右下角
        saved = self._saved_position()
        if saved is not None:
            self.win.setFrameOrigin_(saved)
        else:
            screen = NSScreen.mainScreen().frame()
            self.win.setFrameOrigin_(
                (screen.origin.x + screen.size.width - self.pet_w - 28,
                 screen.origin.y + 30))

        self.win.makeKeyAndOrderFront_(None)
        self.save_cfg()
        self.show_emote(1)

        print(f"[pet] 启动 尺寸={self.pet_w}x{self.win_h} 姿态=旋转{self.angle}°"
              f" 镜像x={self.mirror_x} 镜像y={self.mirror_y}"
              f" 气泡上限={self.max_bubbles} 停留={self.bubble_lifetime:.0f}s"
              f" 位置={self.bubble_side} pos=({int(self.win.frame().origin.x)},{int(self.win.frame().origin.y)})",
              flush=True)

        # 启动轮询与浮动动画（每 300ms / 50ms）
        self.poll_(None)
        self.poll_timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.3, self, "poll:", None, True)
        self.float_timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            FLOAT_TICK_MS / 1000.0, self, "floatTick:", None, True)

        # 菜单栏图标
        try:
            self._setup_status_item()
        except Exception:
            pass
        return self

    # ---------- 尺寸与姿态 ----------
    def _saved_position(self):
        x, y = self.cfg["x"], self.cfg["y"]
        if x < 0 or y < 0:
            return None
        screen = NSScreen.mainScreen().frame()
        sx0, sy0 = screen.origin.x, screen.origin.y
        sx1, sy1 = sx0 + screen.size.width, sy0 + screen.size.height
        # 窗口尺寸大于屏幕时回退默认右下角
        if self.pet_w > screen.size.width or self.win_h > screen.size.height:
            return None
        # 位置钳制：略微越界拉回屏幕内，而非整点丢弃
        x = max(sx0, min(sx1 - self.pet_w, x))
        y = max(sy0, min(sy1 - self.win_h, y))
        return (int(x), int(y))

    def bubble_area_h(self):
        return self.max_bubbles * (self._bubble_row_h() + self.bubble_gap) \
            - self.bubble_gap + 4

    def _bubble_row_h(self):
        """单条气泡行高（px）：随字号/边框/形状动态计算，下限 BUBBLE_ROW_H"""
        base = max(BUBBLE_ROW_H,
                   int(self.bubble_font_size * 1.5)
                   + 6                       # CSS 上下 padding 3+3
                   + 2 * self.bubble_border_w  # 边框上下
                   + 1)                      # margin-top 1 + 安全余量
        if self.bubble_shape == "cloud":
            base = max(base, int(self.bubble_font_size * 1.7) + 20
                       + 2 * self.bubble_border_w)  # 云朵画布高（含边框内边距）
        return base

    def _layout(self):
        """按当前几何重排窗口内容：宠物图在下方，气泡区在上方"""
        ba = self.bubble_area_h()
        self.img.setFrame_(NSMakeRect(0, ba + 24, self.pet_w, self.pet_h))
        self.win.setContentSize_((self.pet_w, self.win_h))
        for item in self.bubble_data:
            item.x = self._bubble_x(item)
            self._place_bubble(item)

    def apply_size(self, width):
        self.width = max(self.MIN_WIDTH, min(self.MAX_WIDTH, width))
        widths, heights = [], []
        self.frames, self.durations = {}, {}
        for n in range(1, max(self.emote_map.values()) + 1):
            frame_path = os.path.join(self.emotes_dir, f"{self.emote_prefix}{n}{self.emote_ext}")
            self.frames[n], self.durations[n] = load_frames(
                frame_path, self.width, self.angle, self.mirror_x, self.mirror_y)
            widths.append(int(self.frames[n][0].size().width))
            heights.append(int(self.frames[n][0].size().height))
        self.pet_w = max(widths)
        self.pet_h = max(heights)
        self.win_h = self.pet_h + 24 + self.bubble_area_h()
        self._layout()
        self.show_emote(self.current if hasattr(self, "current") else 1)

    def do_resize(self, step):
        old_w, old_h = self.pet_w, self.win_h
        new_w = int(self.width * step)
        new_w = max(int(self.MIN_WIDTH), min(int(self.MAX_WIDTH), new_w))
        if new_w == int(self.width):
            return
        x, y = self.win.frame().origin.x, self.win.frame().origin.y
        self.apply_size(new_w)
        self.win.setFrameOrigin_((x + old_w - self.pet_w, y))  # 底边锚定（保持 y，右边 x 对齐）
        self.save_cfg()
        print(f"[pet] 大小调整 -> {self.pet_w}x{self.win_h}", flush=True)

    def set_pose(self, angle=None, mirror_x=None, mirror_y=None):
        if angle is not None:
            self.angle = int(angle) % 360
        if mirror_x is not None:
            self.mirror_x = bool(mirror_x)
        if mirror_y is not None:
            self.mirror_y = bool(mirror_y)
        old_w, old_h = self.pet_w, self.win_h
        x, y = self.win.frame().origin.x, self.win.frame().origin.y
        self.apply_size(self.width)
        self.win.setFrameOrigin_((x + old_w - self.pet_w, y))  # 底边锚定（保持 y，右边 x 对齐）
        self.save_cfg()
        print(f"[pet] 姿态 -> 旋转{self.angle}° 镜像x={self.mirror_x} 镜像y={self.mirror_y}",
              flush=True)

    def save_cfg(self):
        save_config(self.config_path, {
            "width": self.width,
            "x": self.win.frame().origin.x,
            "y": self.win.frame().origin.y,
            "bubbles": self.max_bubbles,
            "lifetime": self.bubble_lifetime,
            "angle": self.angle,
            "mirror_x": self.mirror_x,
            "mirror_y": self.mirror_y,
            "side": self.bubble_side,
            "bubble_border_w": self.bubble_border_w,
            "bubble_border_color": self.bubble_border_color,
            "bubble_font_size": self.bubble_font_size,
            "bubble_text_color": self.bubble_text_color,
            "bubble_bg_color": self.bubble_bg_color,
            "bubble_bg_alpha": self.bubble_bg_alpha,
            "bubble_gap": self.bubble_gap,
            "bubble_shape": self.bubble_shape,
        })

    def _build_cloud(self, text):
        """按当前样式生成云朵气泡图，返回 (宽, 高, NSImage)"""
        return make_cloud_pixbuf(text, self.bubble_font_size, self.bubble_bg_color,
                                 self.bubble_bg_alpha, self.bubble_border_color,
                                 self.bubble_border_w)

    # ---------- Claude 联动 ----------
    def poll_(self, timer):
        now_sec = time.monotonic()

        # 表情状态（errors=replace：写入可能被截断产生非法 UTF-8，不能崩溃）
        try:
            with open(self.state_file, "r", errors="replace") as f:
                s = f.read().strip()
        except (OSError, IOError):
            s = None

        if s != self.state:
            self.state = s
            self.state_since = now_sec        # 记录状态切换时间
            self.success_since = None
            if s in self.emote_map:
                self.state_emote = self.emote_map[s]
                self.show_emote(self.state_emote)
                print(f"[pet] 状态 -> {s} 表情{self.state_emote}", flush=True)
                self._update_status_item()
            if s == "success":
                # 回合完成奖励：亲密度 +1 + 惰性结算小鱼干（dsh-pet 同语义）
                self.reward_turn()
        elif s == "success":
            # success 状态 4 秒后自动回退到 idle
            if self.success_since is None:
                self.success_since = now_sec
            elif now_sec - self.success_since > 4:
                self.show_emote(1)
                self.success_since = None
        elif s in ("thinking", "running", "waiting"):
            # thinking / running / waiting 状态超时自动回退：
            # 超过 STATE_IDLE_TIMEOUT 秒无新气泡则回退 idle
            if self.bubble_data:
                latest_bubble_age = now_sec - (self.bubble_data[-1].born / 1e6)
            else:
                latest_bubble_age = now_sec - self.state_since
            if latest_bubble_age > STATE_IDLE_TIMEOUT:
                if self.state_emote != 1:
                    self.state_emote = 1
                    self.show_emote(1)
                    print(f"[pet] 状态 {s} 超时 -> 回退 idle", flush=True)

        # 小鱼干时间产出惰性结算（每轮 poll 结算一次，无产出且锚点已设时零开销）
        self.settle_treats()

        # 气泡（按文件 mtime 检测，每次写入追加一条新气泡）
        try:
            mtime = os.stat(self.bubble_file).st_mtime
        except OSError:
            mtime = 0.0
        if mtime != self.bubble_mtime:
            self.bubble_mtime = mtime
            try:
                with open(self.bubble_file, "r", errors="replace") as f:
                    b = f.read().strip()
            except (OSError, IOError):
                b = ""
            if b:
                self.add_bubble(b)

    # ---------- 气泡堆栈（浮动动画版） ----------
    def fit_text(self, text):
        max_chars = max(10, self.pet_w // max(9, self.bubble_font_size))
        if len(text) > max_chars:
            return text[:max_chars - 1] + "…"
        return text

    def _bubble_x(self, item):
        """根据气泡位置（右上/左上）计算气泡容器 x 坐标"""
        if self.bubble_side == "left":
            return 2
        w = item.w if item.w else 200
        return max(2, self.pet_w - w - 8)

    def _measure_text(self, text):
        attrs = {NSFontAttributeName: NSFont.systemFontOfSize_(self.bubble_font_size)}
        s = NSString.stringWithString_(text).sizeWithAttributes_(attrs)
        return s.width, s.height

    def _make_label(self, text):
        label = NSTextField.labelWithString_(text)
        label.setFont_(NSFont.systemFontOfSize_(self.bubble_font_size))
        label.setTextColor_(_hex_to_ns_color(self.bubble_text_color))
        label.setEditable_(False)
        label.setSelectable_(False)
        label.setBordered_(False)
        label.setDrawsBackground_(False)
        label.setAlignment_(
            NSRightTextAlignment if self.bubble_side == "right" else NSLeftTextAlignment)
        return label

    def _build_bubble_view(self, text):
        """按当前样式构建气泡容器，返回 (container, label, cloud_img, w, h)"""
        if self.bubble_shape == "cloud":
            W, H, nsimg = self._build_cloud(text)
            container = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, W, H))
            imgv = NSImageView.alloc().initWithFrame_(NSMakeRect(0, 0, W, H))
            imgv.setImage_(nsimg)
            imgv.setImageScaling_(NSImageScaleNone)
            container.addSubview_(imgv)
            tw = _text_w_px(text, self.bubble_font_size)
            th = int(self.bubble_font_size * 1.4)
            label = self._make_label(text)
            label.setFrame_(NSMakeRect(max(2, (W - tw) // 2), max(2, (H - th) // 2), tw, th))
            container.addSubview_(label)
            return container, label, imgv, W, H
        else:
            text_w, text_h = self._measure_text(text)
            bw = self.bubble_border_w
            pad_x, pad_y = 9, 3
            cw = int(ceil(text_w)) + 2 * pad_x + 2 * bw + 1
            ch = int(ceil(text_h)) + 2 * pad_y + 2 * bw + 1
            bgimg = make_rect_image(cw, ch, self.bubble_bg_color, self.bubble_bg_alpha,
                                    self.bubble_border_color, bw)
            container = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, cw, ch))
            bgv = NSImageView.alloc().initWithFrame_(NSMakeRect(0, 0, cw, ch))
            bgv.setImage_(bgimg)
            bgv.setImageScaling_(NSImageScaleNone)
            container.addSubview_(bgv)
            label = self._make_label(text)
            label.setFrame_(NSMakeRect(pad_x + bw, pad_y + bw,
                                       int(ceil(text_w)), int(ceil(text_h))))
            container.addSubview_(label)
            return container, label, None, cw, ch

    def _place_bubble(self, item):
        item.widget.setFrameOrigin_((int(item.x), int(item.y)))

    def add_bubble(self, raw):
        parts = raw.split("|", 2)
        kind = parts[0] if parts else ""
        tool = parts[1] if len(parts) > 1 else ""
        detail = parts[2] if len(parts) > 2 else ""
        if not raw:
            return
        if kind == "run":
            detail = detail.replace("\n", " ").strip()
            text = f"🛠 {tool}" + (f" · {detail}" if detail else "")
        elif kind == "done":
            ok = detail in ("0", "ok", "")
            mark = "✅" if ok else "❌"
            text = f"{mark} {tool} 完成" + ("" if ok else f" · exit {detail}")
        elif kind == "think":
            text = "💭 思考中…"
        elif kind == "finish":
            text = "🎉 完成！"
        else:
            text = raw[:40]
        text = self.fit_text(text)

        container, label, cloud_img, w, h = self._build_bubble_view(text)
        item = BubbleItem(container, _now_us())
        item.label = label
        item.cloud_img = cloud_img
        item.w = w

        # 出生在容器底部视口外（下方 4px 被宠物图盖住，视觉上从头顶边缘冒出）
        item.x = self._bubble_x(item)
        item.y = self.bubble_area_h() + 4
        self.view.addSubview_(container)
        self._place_bubble(item)
        self.bubble_data.append(item)

        print(f"[pet] 气泡+1 ({len(self.bubble_data)}/{self.max_bubbles}): {text}"
              f"（{self.bubble_lifetime:.0f}s 浮动淡出）", flush=True)

    def floatTick_(self, timer):
        """每 50ms：纯槽位布局（旧上新下，严格不重叠）+ 固定速度升起/回排 + 淡入淡出"""
        now_us = _now_us()
        if self._float_last_us is None:
            dt = FLOAT_TICK_MS / 1000.0
        else:
            dt = min(0.25, (now_us - self._float_last_us) / 1e6)  # 钳制防卡顿跳变
        self._float_last_us = now_us
        lifetime_us = self.bubble_lifetime * 1e6
        fade_us = BUBBLE_FADE_MS * 1000
        row_h = self._bubble_row_h()
        pitch = row_h + self.bubble_gap
        step = RISE_SPEED * dt                 # 每帧移动距离（px）
        to_remove = []

        # 1) 容量维护：超限的最旧未 dying 项整批标记淡出
        excess = sum(1 for it in self.bubble_data if not it.dying) - self.max_bubbles
        for item in self.bubble_data:            # 头部即最旧
            if excess <= 0:
                break
            if not item.dying:
                item.dying = True
                item.fade_start = now_us
                item.fade_from = item.widget.alphaValue()
                excess -= 1

        # 2) 按年龄排序 → 槽位（0 最旧最上，n-1 最新最下）→ 固定速度移动 + 透明度
        order = sorted(range(len(self.bubble_data)),
                       key=lambda j: self.bubble_data[j].born)
        for slot, j in enumerate(order):
            item = self.bubble_data[j]
            target_y = 2 + slot * pitch         # 槽位唯一 → 数学上不可能重叠
            if item.y > target_y + 0.5:
                item.y = max(target_y, item.y - step)
            elif item.y < target_y - 0.5:
                item.y = min(target_y, item.y + step)
            else:
                item.y = target_y
            # 矩形模式容器宽度在构建时已按文本实测宽度固定，无需每帧重算
            item.x = self._bubble_x(item)

            if item.dying:
                # 淡出中：500ms 内从 fade_from 线性降到 0，结束后移除
                fp = (now_us - item.fade_start) / fade_us
                if fp >= 1.0:
                    to_remove.append(j)
                    continue
                item.widget.setAlphaValue_(max(0.0, item.fade_from * (1.0 - fp)))
            else:
                progress = (now_us - item.born) / lifetime_us  # 0.0 → 1.0+
                if progress >= 1.0:
                    # 到期 → 进入淡出（dying 项仍占槽位，堆栈不跳动）
                    item.dying = True
                    item.fade_start = now_us
                    item.fade_from = item.widget.alphaValue()
                else:
                    if progress < BUBBLE_FADE_START:
                        life_op = 1.0
                    else:
                        fp = (progress - BUBBLE_FADE_START) / (1.0 - BUBBLE_FADE_START)
                        life_op = max(0.0, 1.0 - fp)
                    fade_in = min(1.0, (now_us - item.born) / (BIRTH_FADE_MS * 1000.0))
                    item.widget.setAlphaValue_(life_op * fade_in)

            self._place_bubble(item)

        # 3) 移除淡出完成的（索引从大到小，避免错位）
        for j in sorted(to_remove, reverse=True):
            item = self.bubble_data.pop(j)
            item.widget.removeFromSuperview()
            print("[pet] 气泡-1 淡出移除", flush=True)

    def set_bubble_side(self, side):
        self.bubble_side = side
        for item in self.bubble_data:
            item.x = self._bubble_x(item)
            item.label.setAlignment_(
                NSRightTextAlignment if side == "right" else NSLeftTextAlignment)
            self._place_bubble(item)
        self.save_cfg()
        print(f"[pet] 气泡位置 -> {side}", flush=True)

    def set_max_bubbles(self, n):
        self.max_bubbles = max(1, min(10, n))
        old_w, old_h = self.pet_w, self.win_h
        x, y = self.win.frame().origin.x, self.win.frame().origin.y
        self.apply_size(self.width)
        self.win.setFrameOrigin_((x + old_w - self.pet_w, y))  # 底边锚定（保持 y，右边 x 对齐）
        self.save_cfg()
        print(f"[pet] 气泡上限 -> {self.max_bubbles}", flush=True)

    def set_lifetime(self, sec):
        self.bubble_lifetime = max(2.0, min(120.0, float(sec)))
        self.save_cfg()
        print(f"[pet] 气泡停留 -> {self.bubble_lifetime:.0f} 秒", flush=True)

    def set_bubble_style(self, key, value):
        """气泡样式统一入口：几何变化重算窗口 → 云朵/矩形重建 → 存配置"""
        old_shape = self.bubble_shape
        setattr(self, key, value)
        if key in GEOMETRIC_KEYS:            # 字号/边框/间距/形状 → 行高窗口变化
            old_w, old_h = self.pet_w, self.win_h
            x, y = self.win.frame().origin.x, self.win.frame().origin.y
            self.apply_size(self.width)
            self.win.setFrameOrigin_((x + old_w - self.pet_w, y))  # 底边锚定（保持 y，右边 x 对齐）
        if key == "bubble_shape" and value != old_shape:
            # 形状切换：现有气泡整批快速淡出，新气泡用新形状
            now_us = _now_us()
            for item in self.bubble_data:
                if not item.dying:
                    item.dying = True
                    item.fade_start = now_us
                    item.fade_from = item.widget.alphaValue()
        elif key != "bubble_shape":
            self._refresh_bubbles()          # 样式变更 → 重建既有气泡视觉（矩形+云朵）
        self.save_cfg()
        print(f"[pet] 气泡样式 {key} -> {value}", flush=True)

    def _refresh_bubbles(self):
        """样式变更后重建既有气泡视觉（dying 项跳过），保留位置与当前透明度"""
        for item in self.bubble_data:
            if item.dying:
                continue
            alpha = item.widget.alphaValue()
            text = item.label.stringValue()
            container, label, cloud_img, w, h = self._build_bubble_view(text)
            item.widget.removeFromSuperview()
            item.widget = container
            item.label = label
            item.cloud_img = cloud_img
            item.w = w
            self.view.addSubview_(container)
            self._place_bubble(item)
            container.setAlphaValue_(alpha)

    def choose_bubble_color(self, key):
        """弹出系统取色面板（响应式回调里应用 + 存配置）"""
        self._color_key = key
        self._color_pending = None
        self._color_pending_hex = None
        panel = NSColorPanel.sharedColorPanel()
        panel.setColor_(_hex_to_ns_color(getattr(self, key)))
        panel.setTarget_(self)
        panel.setAction_("colorPanelAction:")
        panel.setShowsAlpha_(False)  # 不透明度由菜单项单独调节，不进面板
        panel.makeKeyAndOrderFront_(None)
        self._color_panel = panel  # 防 GC 提前回收

    def colorPanelAction_(self, sender):
        if not self._color_key:
            return
        # 防抖避免每 tick 连续 save_cfg + 全量重建
        self._color_pending_hex = _ns_color_to_hex(sender.color())
        if self._color_pending is not None:
            self._color_pending.invalidate()
        self._color_pending = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.15, self, "applyColor:", None, False)

    def applyColor_(self, timer):
        self._color_pending = None
        if self._color_key and self._color_pending_hex:
            self.set_bubble_style(self._color_key, self._color_pending_hex)

    # ---------- 动画 ----------
    def show_emote(self, n):
        self.current = n
        self.frame_idx = 0
        if self.timer:
            self.timer.invalidate()
        self.img.setImage_(self.frames[n][0])
        self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.1, self, "tick:", None, False)

    def tick_(self, timer):
        n = self.current
        self.frame_idx = (self.frame_idx + 1) % len(self.frames[n])
        self.img.setImage_(self.frames[n][self.frame_idx])
        self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            max(0.03, self.durations[n][self.frame_idx] / 1000.0), self, "tick:", None, False)

    # ---------- 交互 ----------
    def on_mouse_down(self, event):
        loc = NSEvent.mouseLocation()
        origin = self.win.frame().origin
        self.drag_off = (loc.x - origin.x, loc.y - origin.y)
        # 点击判定锚点：按下位置与时间（位移 < 4px 且时长 < 0.4s 视为摸头）
        self._down_pos = (loc.x, loc.y)
        self._down_time = time.monotonic()

    def on_mouse_dragged(self, event):
        if self.drag_off is None:
            return
        loc = NSEvent.mouseLocation()
        self.win.setFrameOrigin_((loc.x - self.drag_off[0], loc.y - self.drag_off[1]))
        self.save_cfg()

    def on_mouse_up(self, event):
        if self._down_pos is not None and self._down_time is not None:
            loc = NSEvent.mouseLocation()
            dx = loc.x - self._down_pos[0]
            dy = loc.y - self._down_pos[1]
            dt = time.monotonic() - self._down_time
            if dx * dx + dy * dy < 16 and dt < 0.4:
                self.pet_pet()  # 原地快速点击 = 摸头
        self.drag_off = None
        self._down_pos = None
        self._down_time = None

    def on_right_click(self, event):
        self.popup_menu(event)

    def on_scroll(self, event):
        dy = event.scrollingDeltaY()
        if dy == 0:
            dy = event.deltaY()
        step = self.STEP_RATIO if dy > 0 else (1.0 / self.STEP_RATIO if dy < 0 else 0.0)
        if not step:
            return
        if self.resize_pending is not None:
            self.resize_pending.invalidate()
        self.resize_pending = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.18, self, "doResizeTimer:", float(step), False)

    def doResizeTimer_(self, timer):
        self.resize_pending = None
        self.do_resize(float(timer.userInfo()))

    def on_key(self, event):
        chars = event.charactersIgnoringModifiers() or ""
        key_code = event.keyCode()
        if key_code == 53 or chars in ("q", "Q"):
            self.quit()
        elif key_code in (24, 69) or chars in ("+", "="):
            self.do_resize(self.STEP_RATIO)
        elif key_code in (27, 78) or chars in ("-", "_"):
            self.do_resize(1.0 / self.STEP_RATIO)

    # ---------- 互动（亲密度/小鱼干） ----------
    def affinity_rank_name(self):
        return pet_profile.rank_of(self.profile["affinity"]["points"])["name"]

    def settle_treats(self):
        """小鱼干惰性结算（工作+时间产出）。账本对象变化才落盘，零收益零开销"""
        ledger, _ = pet_profile.settle_treat_grants(
            self.profile["treats"], self.profile["affinity"]["turns"], pet_profile.now_ms())
        if ledger is not self.profile["treats"]:
            self.profile["treats"] = ledger
            pet_profile.save_profile(self.profile_path, self.profile)
            self._update_status_item()

    def reward_turn(self):
        """回合完成奖励：亲密度 +1 + 小鱼干结算（由 poll_ 在状态进入 success 时调用）"""
        before = self.affinity_rank_name()
        self.profile["affinity"] = pet_profile.apply_turn_reward(self.profile["affinity"])
        self.settle_treats()
        pet_profile.save_profile(self.profile_path, self.profile)
        after = self.affinity_rank_name()
        if after != before:
            self.add_bubble(f"🎉 亲密度升级：{before} → {after}")
            print(f"[pet] 亲密度升级 -> {after}（{self.profile['affinity']['points']}/100）", flush=True)
        else:
            print(f"[pet] 回合完成 +{pet_profile.TURN_REWARD} 亲密度="
                  f"{self.profile['affinity']['points']}", flush=True)
        self._update_status_item()

    def pet_pet(self):
        """点击宠物 = 摸头：亲密度 +1（10s 冷却），气泡反馈"""
        now_ms = pet_profile.now_ms()
        affinity, delta, reaction, accepted = pet_profile.apply_pet(
            self.profile["affinity"], now_ms)
        if accepted:
            before = self.affinity_rank_name()
            self.profile["affinity"] = affinity
            pet_profile.save_profile(self.profile_path, self.profile)
            after = self.affinity_rank_name()
            if after != before:
                self.add_bubble(f"🎉 亲密度升级：{before} → {after}")
            else:
                self.add_bubble(reaction)
            print(f"[pet] 摸头 +{delta} 亲密度={affinity['points']} 等级={after}", flush=True)
        else:
            self.add_bubble(reaction)
            print(f"[pet] 摸头冷却中（{delta}）", flush=True)
        self._update_status_item()

    def feed(self):
        """喂食：先结算小鱼干，再按 30s 冷却门槛判定，冷却内不消耗库存"""
        now_ms = pet_profile.now_ms()
        self.settle_treats()
        affinity, delta, reaction, accepted = pet_profile.apply_feed(
            self.profile["affinity"], now_ms)
        if not accepted:
            self.add_bubble(reaction)
            print(f"[pet] 喂食冷却中（{delta}）", flush=True)
            return
        ledger = pet_profile.consume_treat(self.profile["treats"])
        if ledger is None:
            self.add_bubble("没有小鱼干了，多陪小家伙工作一会儿吧～")
            print("[pet] 喂食失败：小鱼干库存不足", flush=True)
            return
        before = self.affinity_rank_name()
        self.profile["treats"] = ledger
        self.profile["affinity"] = affinity
        pet_profile.save_profile(self.profile_path, self.profile)
        after = self.affinity_rank_name()
        if after != before:
            self.add_bubble(f"🎉 亲密度升级：{before} → {after}")
        else:
            self.add_bubble(reaction)
        print(f"[pet] 喂食 +{delta} 亲密度={affinity['points']} 库存={ledger['treats']}", flush=True)
        self._update_status_item()

    def rename(self):
        """改名：NSAlert + NSTextField 输入，1–20 字符，trim 校验，持久化"""
        alert = NSAlert.alloc().init()
        alert.setMessageText_(f"给「{self.profile_name}」起个新名字")
        alert.setInformativeText_("1–20 个字符")
        alert.addButtonWithTitle_("确定")
        alert.addButtonWithTitle_("取消")
        field = NSTextField.alloc().initWithFrame_(NSMakeRect(0, 0, 220, 24))
        field.setStringValue_(self.profile_name)
        alert.setAccessoryView_(field)
        alert.window().setInitialFirstResponder_(field)
        if alert.runModal() == NSAlertFirstButtonReturn:
            name = field.stringValue().strip()
            if 1 <= len(name) <= 20:
                self.profile_name = name
                self.profile["name"] = name
                pet_profile.save_profile(self.profile_path, self.profile)
                self.add_bubble(f"以后就叫「{name}」啦")
                print(f"[pet] 改名 -> {name}", flush=True)
            else:
                self.add_bubble("名字需要 1–20 个字符哦")
            self._update_status_item()

    def hide(self):
        """隐藏：窗口消失，菜单栏图标保留（可召唤）"""
        self.win.orderOut_(None)
        print("[pet] 已隐藏（菜单栏图标可召唤）", flush=True)

    def show(self):
        """召唤：恢复显示（不抢焦点）"""
        self.win.orderFrontRegardless()
        print("[pet] 已召唤", flush=True)

    def quit(self):
        self.save_cfg()
        NSApp.terminate_(None)

    def popup_menu(self, event):
        menu = NSMenu.alloc().init()

        def item(menu_obj, title, op):
            it = menu_obj.addItemWithTitle_action_keyEquivalent_(title, "doMenuAction:", "")
            it.setTarget_(self)
            it.setRepresentedObject_(op)
            return it

        # 气泡数量
        bubble_menu = NSMenu.alloc().initWithTitle_("")
        for n in (1, 2, 3, 4, 5, 6, 8, 10):
            item(bubble_menu, f"{n} 条" + (" ✓" if n == self.max_bubbles else ""), ("bubbles", n))
        bubble_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"气泡数量（当前 {self.max_bubbles}）", "", "")
        bubble_item.setSubmenu_(bubble_menu)

        # 大小（预设档位 + 放大/缩小）
        size_menu = NSMenu.alloc().initWithTitle_("")
        for n in (95, 120, 150, 190, 240, 305):
            item(size_menu, f"{n} px" + (" ✓" if abs(self.width - n) < 1 else ""),
                 ("size_preset", n))
        size_menu.addItem_(NSMenuItem.separatorItem())
        item(size_menu, "放大", ("size_up",))
        item(size_menu, "缩小", ("size_down",))
        size_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"大小（当前 {int(self.width)} px）", "", "")
        size_item.setSubmenu_(size_menu)

        # 气泡停留时间
        life_menu = NSMenu.alloc().initWithTitle_("")
        for sec in (3, 5, 8, 12, 20):
            item(life_menu, f"{sec} 秒" + (" ✓" if sec == self.bubble_lifetime else ""),
                 ("lifetime", sec))
        life_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"气泡停留（当前 {self.bubble_lifetime:.0f} 秒）", "", "")
        life_item.setSubmenu_(life_menu)

        # 气泡位置（右上/左上）
        side_menu = NSMenu.alloc().initWithTitle_("")
        for side, label in (("right", "右上"), ("left", "左上")):
            item(side_menu, label + (" ✓" if side == self.bubble_side else ""), ("side", side))
        side_item = menu.addItemWithTitle_action_keyEquivalent_(
            "气泡位置（当前 " + ("右上" if self.bubble_side == "right" else "左上") + "）",
            "", "")
        side_item.setSubmenu_(side_menu)

        # 气泡间距（垂直方向）
        gap_menu = NSMenu.alloc().initWithTitle_("")
        for g in (0, 2, 4, 6, 8, 12):
            item(gap_menu, f"{g} px" + (" ✓" if g == self.bubble_gap else ""), ("gap", g))
        gap_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"气泡间距（当前 {self.bubble_gap} px）", "", "")
        gap_item.setSubmenu_(gap_menu)

        # 气泡样式：形状 / 边框 / 文字 / 背景
        style_menu = NSMenu.alloc().initWithTitle_("")
        shape_menu = NSMenu.alloc().initWithTitle_("")
        for val, lbl in (("rect", "圆角矩形"), ("cloud", "云朵")):
            item(shape_menu, lbl + (" ✓" if val == self.bubble_shape else ""), ("shape", val))
        shape_item = style_menu.addItemWithTitle_action_keyEquivalent_(
            "气泡形状（当前 " + ("云朵" if self.bubble_shape == "cloud" else "圆角矩形") + "）",
            "", "")
        shape_item.setSubmenu_(shape_menu)

        bw_menu = NSMenu.alloc().initWithTitle_("")
        for w in (0, 1, 2, 3, 4, 5):
            item(bw_menu, f"{w} px" + (" ✓" if w == self.bubble_border_w else ""), ("border_w", w))
        bw_item = style_menu.addItemWithTitle_action_keyEquivalent_(
            f"边框宽度（当前 {self.bubble_border_w} px）", "", "")
        bw_item.setSubmenu_(bw_menu)

        item(style_menu, f"边框颜色（当前 {self.bubble_border_color}）",
             ("color", "bubble_border_color"))

        fs_menu = NSMenu.alloc().initWithTitle_("")
        for sz in (10, 12, 14, 16, 18):
            item(fs_menu, f"{sz} px" + (" ✓" if sz == self.bubble_font_size else ""),
                 ("font_size", sz))
        fs_item = style_menu.addItemWithTitle_action_keyEquivalent_(
            f"文字字号（当前 {self.bubble_font_size} px）", "", "")
        fs_item.setSubmenu_(fs_menu)

        item(style_menu, f"文字颜色（当前 {self.bubble_text_color}）",
             ("color", "bubble_text_color"))
        item(style_menu, f"背景颜色（当前 {self.bubble_bg_color}）",
             ("color", "bubble_bg_color"))

        alpha_menu = NSMenu.alloc().initWithTitle_("")
        for a in (60, 70, 80, 90, 100):
            item(alpha_menu, f"{a}%" + (" ✓" if a == self.bubble_bg_alpha else ""), ("bg_alpha", a))
        alpha_item = style_menu.addItemWithTitle_action_keyEquivalent_(
            f"背景不透明度（当前 {self.bubble_bg_alpha}%）", "", "")
        alpha_item.setSubmenu_(alpha_menu)

        style_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"气泡样式（当前 字号 {self.bubble_font_size} · 边框 {self.bubble_border_w}）",
            "", "")
        style_item.setSubmenu_(style_menu)

        # 姿态：旋转 / 镜像
        pose_menu = NSMenu.alloc().initWithTitle_("")
        for ang in (0, 90, 180, 270):
            item(pose_menu, f"旋转 {ang}°" + (" ✓" if ang == self.angle else ""), ("angle", ang))
        pose_menu.addItem_(NSMenuItem.separatorItem())
        for label, key in (("水平镜像", "mirror_x"), ("垂直镜像", "mirror_y")):
            item(pose_menu, f"{label} {'开 ✓' if getattr(self, key) else '关'}", (key,))
        pose_item = menu.addItemWithTitle_action_keyEquivalent_(
            f"姿态（旋转{self.angle}° · "
            f"{'水平镜像' if self.mirror_x else '水平正常'} · "
            f"{'垂直镜像' if self.mirror_y else '垂直正常'}）", "", "")
        pose_item.setSubmenu_(pose_menu)

        # 互动：亲密度状态 + 喂食 / 改名 / 隐藏
        affinity = self.profile["affinity"]
        rank = self.affinity_rank_name()
        interact_menu = NSMenu.alloc().initWithTitle_("")
        info_item = interact_menu.addItemWithTitle_action_keyEquivalent_(
            f"亲密度 {affinity['points']}/100 · {rank}"
            f"（摸头 {affinity['pets']} 次 · 喂食 {affinity['feeds']} 次 · "
            f"回合 {affinity['turns']} 次）", "", "")
        info_item.setEnabled_(False)
        interact_menu.addItem_(NSMenuItem.separatorItem())
        item(interact_menu, f"喂食（库存 {self.profile['treats']['treats']}"
             f"/{pet_profile.MAX_TREATS} 条小鱼干）", ("feed",))
        item(interact_menu, "改名…", ("rename",))
        item(interact_menu, "隐藏宠物", ("hide",))
        interact_item = menu.addItemWithTitle_action_keyEquivalent_(
            "互动（摸头 = 点击宠物）", "", "")
        interact_item.setSubmenu_(interact_menu)

        menu.addItem_(NSMenuItem.separatorItem())
        item(menu, "退出宠物", ("quit",))

        NSMenu.popUpContextMenu_withEvent_forView_(menu, event, self.view)

    def doMenuAction_(self, sender):
        op = sender.representedObject()
        if not op:
            return
        kind = op[0]
        if kind == "bubbles":
            self.set_max_bubbles(op[1])
        elif kind == "lifetime":
            self.set_lifetime(op[1])
        elif kind == "side":
            self.set_bubble_side(op[1])
        elif kind == "gap":
            self.set_bubble_style("bubble_gap", op[1])
        elif kind == "shape":
            self.set_bubble_style("bubble_shape", op[1])
        elif kind == "border_w":
            self.set_bubble_style("bubble_border_w", op[1])
        elif kind == "font_size":
            self.set_bubble_style("bubble_font_size", op[1])
        elif kind == "bg_alpha":
            self.set_bubble_style("bubble_bg_alpha", op[1])
        elif kind == "color":
            self.choose_bubble_color(op[1])
        elif kind == "angle":
            self.set_pose(angle=op[1])
        elif kind == "mirror_x":
            self.set_pose(mirror_x=not self.mirror_x)
        elif kind == "mirror_y":
            self.set_pose(mirror_y=not self.mirror_y)
        elif kind == "size_preset":
            self.do_resize(op[1] / self.width)
        elif kind == "size_up":
            self.do_resize(self.STEP_RATIO)
        elif kind == "size_down":
            self.do_resize(1.0 / self.STEP_RATIO)
        elif kind == "open_web":
            subprocess.Popen(["/usr/bin/open", self.html_path])
        elif kind == "feed":
            self.feed()
        elif kind == "rename":
            self.rename()
        elif kind == "hide":
            self.hide()
        elif kind == "show":
            self.show()
        elif kind == "quit":
            self.quit()

    # ---------- 菜单栏图标 ----------
    def _setup_status_item(self):
        if not self.status_icon_path:
            return
        im = Image.open(self.status_icon_path)
        frame = im.convert("RGBA")
        h = 18
        w = max(1, int(frame.size[0] * h / frame.size[1]))
        icon = pil_to_nsimage(frame.resize((w, h), Image.LANCZOS))

        self.status_item = NSStatusBar.systemStatusBar().statusItemWithLength_(
            NSVariableStatusItemLength)
        self.status_item.button().setImage_(icon)

        menu = NSMenu.alloc().initWithTitle_(self.display_name)
        title_item = menu.addItemWithTitle_action_keyEquivalent_(self.display_name, "", "")
        title_item.setEnabled_(False)
        self.status_state_item = menu.addItemWithTitle_action_keyEquivalent_(
            "状态: idle", "", "")
        self.status_state_item.setEnabled_(False)
        self.status_affinity_item = menu.addItemWithTitle_action_keyEquivalent_(
            "亲密度: 0/100", "", "")
        self.status_affinity_item.setEnabled_(False)
        if self.html_path:
            open_item = menu.addItemWithTitle_action_keyEquivalent_(
                "打开网页版桌宠", "doMenuAction:", "")
            open_item.setTarget_(self)
            open_item.setRepresentedObject_(("open_web",))
        menu.addItem_(NSMenuItem.separatorItem())
        show_item = menu.addItemWithTitle_action_keyEquivalent_(
            "显示宠物", "doMenuAction:", "")
        show_item.setTarget_(self)
        show_item.setRepresentedObject_(("show",))
        menu.addItem_(NSMenuItem.separatorItem())
        quit_item = menu.addItemWithTitle_action_keyEquivalent_(
            "退出宠物", "doMenuAction:", "")
        quit_item.setTarget_(self)
        quit_item.setRepresentedObject_(("quit",))
        self.status_item.setMenu_(menu)
        self._update_status_item()

    def _update_status_item(self):
        if self.status_state_item is not None:
            self.status_state_item.setTitle_(f"状态: {self.state}")
        if self.status_affinity_item is not None:
            a = self.profile["affinity"]
            self.status_affinity_item.setTitle_(
                f"亲密度: {a['points']}/100 · {self.affinity_rank_name()} · "
                f"小鱼干 {self.profile['treats']['treats']}")


def _save_on_signal(signum, frame):
    try:
        if _APP_PET is not None:
            _APP_PET.save_cfg()
            pet_profile.save_profile(_APP_PET.profile_path, _APP_PET.profile)
    except Exception:
        pass
    os._exit(0)  # 立即终止：sys.exit 抛 SystemExit 会被 NSRunLoop 吞掉导致进程残留


def main(pet_dir):
    """加载 spec → 构建并运行桌面宠物。运行时由 pets/<name>/pet.py 调用。"""
    global _APP_PET, _PET_DIR, _SPEC, _LOCK_FD
    _PET_DIR = pet_dir
    _SPEC = load_spec(pet_dir)

    # flock 单实例锁（pet_dir 参数化后从模块顶层移到这里；持锁 fd 存全局防 GC）
    _LOCK_FD = open(os.path.join(pet_dir, _SPEC["lock_file"]), "w")
    try:
        fcntl.flock(_LOCK_FD, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit(0)  # 已有实例在跑，直接退出

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    signal.signal(signal.SIGTERM, _save_on_signal)
    signal.signal(signal.SIGHUP, _save_on_signal)
    _APP_PET = PetController.alloc().init()
    app.run()
