#!/usr/bin/env python3
"""雷米埃尔 · 桌面宠物（与 Claude 联动版，历史 GTK 蓝本）
使用 remiel_1..5.gif 表情动图，无边框透明置顶悬浮在桌面右下角。

与 Claude Code 联动：
- 表情由状态驱动：待机 idle→1  思考 thinking→2  运行 running→4  成功 success→5（不显示文字状态）
- 头顶气泡堆栈显示运行步骤 / 进程 / 结果（数据来自 /tmp/remiel-pet.bubble）：
    run|工具|命令          → 🛠 运行中
    done|工具|退出码        → ✅/❌ 结果
    think|                → 💭 思考中
    finish|               → 🎉 完成
  新气泡从底部出生，旧气泡向上排开（严格不重叠）；每条停留 N 秒（默认 6，可调），
  到期或满堆时最旧气泡淡出（500ms）后移除。气泡以对话框形式显示在宠物窗口右上或左上（可切换）。

操作（右键菜单）：
- 气泡数量（1~10 条）、气泡停留（3~20 秒）、气泡位置（右上/左上）
- 气泡样式：边框宽度/颜色、文字字号/颜色、背景颜色/不透明度（可细调）
- 姿态：旋转 0/90/180/270°、水平/垂直镜像
- 滚轮 / 键盘 +/-：调整大小（0.5x ~ 1.6x）；左键拖动移动；键盘 Q / 右键退出
  所有设置自动记忆。
"""
import os
import sys
import json
import re
import fcntl
import signal

# 强制走 XWayland，保证置顶（keep_above）在 Wayland 会话下也生效
os.environ.setdefault("GDK_BACKEND", "x11")

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib, GdkPixbuf
from PIL import Image, ImageSequence, ImageOps, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
EMOTE_DIR = os.path.join(BASE, "remiel-emotes")
CONFIG_PATH = os.path.join(BASE, ".remiel-pet-config.json")

DEFAULT_WIDTH = 190.0   # 默认显示宽度（px）
MIN_WIDTH = 95.0        # 0.5x
MAX_WIDTH = 305.0       # ~1.6x
STEP_RATIO = 1.15       # 每次滚轮缩放比例
DEFAULT_BUBBLES = 5     # 默认同时显示的气泡数
DEFAULT_LIFETIME = 6.0  # 默认气泡停留秒数（到期自动淡出）
DEFAULT_SIDE = "right"  # 气泡默认右上
DEFAULT_BORDER_W = 0    # 气泡边框宽度默认（px，0 表示无边框）
DEFAULT_BORDER_COLOR = "#c9b8d0"  # 边框颜色默认（宽度 0 时不显示）
DEFAULT_FONT_SIZE = 12  # 气泡文字字号默认（px）
DEFAULT_TEXT_COLOR = "#3a2b3f"     # 气泡文字颜色默认
DEFAULT_BG_COLOR = "#ffffff"      # 气泡背景色默认
DEFAULT_BG_ALPHA = 92   # 气泡背景不透明度默认（%）
DEFAULT_GAP = 2         # 气泡垂直间距默认（px）
DEFAULT_SHAPE = "rect"  # 气泡形状默认（rect 圆角矩形 / cloud 云朵）
BUBBLE_ROW_H = 24       # 单条气泡高度下限（px，实际行高随字号/边框动态计算）
BUBBLE_FADE_MS = 500    # 淡出动画时长（保留用于其他过渡）
RISE_SPEED = 200.0      # 气泡垂直移动速度（px/s，固定速度模式：出生升起/移除填位）
BIRTH_FADE_MS = 300     # 出生淡入时长（ms，0 → 1）
BUBBLE_FADE_START = 0.2  # 气泡生命周期的前 20% 保持完全透明，之后开始渐变
FLOAT_TICK_MS = 50       # 浮动动画帧间隔（约 20fps）
STATE_IDLE_TIMEOUT = 30  # thinking/running 状态无活动多少秒后自动回退 idle
# 样式变化会改变窗口几何的键（触发 apply_size 重算 + 右下角锚定）
GEOMETRIC_KEYS = {"bubble_font_size", "bubble_border_w", "bubble_gap", "bubble_shape"}

# ---------- Claude 联动 ----------
STATE_FILE = "/tmp/remiel-pet.state"
BUBBLE_FILE = "/tmp/remiel-pet.bubble"
STATE_EMOTE = {"idle": 1, "thinking": 2, "running": 4, "success": 5}

# ---------- 单实例锁 ----------
lock_fd = open(os.path.join(BASE, ".remiel-pet.lock"), "w")
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(0)  # 已有实例在跑，直接退出

_KEEP = []  # 防止 pixbuf 底层字节被 GC 回收


class BubbleItem:
    """单条浮动气泡的数据"""
    __slots__ = ("widget", "label", "cloud_img", "w",
                 "born", "x", "y", "dying", "fade_start", "fade_from")

    def __init__(self, widget, born_us):
        self.widget = widget          # Gtk.Fixed 气泡容器（矩形/云朵统一）
        self.label = None             # 文字 Gtk.Label（云朵模式居中叠加）
        self.cloud_img = None         # 云朵 Gtk.Image 子控件（云朵模式才有，None 表示矩形）
        self.w = 0                    # 容器宽度（矩形=label 分配宽度，云朵=PNG 宽）
        self.born = born_us           # GLib.get_monotonic_time() 出生微秒时间戳
        self.x = 0
        self.y = 0
        self.dying = False            # 已标记淡出（溢出/到期，淡出完移除）
        self.fade_start = 0           # 淡出起始微秒时间戳
        self.fade_from = 1.0          # 淡出起始透明度（取自 widget.get_opacity()）


# ---------- 配置存取 ----------
def load_config():
    """读取配置：逐字段安全解析，单个坏字段只回退该字段（文件级错误才整表默认）"""
    try:
        with open(CONFIG_PATH, "r") as f:
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
        "width": field("width", float, DEFAULT_WIDTH),
        "x": field("x", int, -1),
        "y": field("y", int, -1),
        "bubbles": field("bubbles", int, DEFAULT_BUBBLES),
        "lifetime": field("lifetime", float, DEFAULT_LIFETIME),
        "angle": field("angle", lambda v: int(v) % 360, 0),
        "mirror_x": field("mirror_x", bool, False),
        "mirror_y": field("mirror_y", bool, False),
        "side": field("side", str, DEFAULT_SIDE),
        "bubble_border_w": field("bubble_border_w", int, DEFAULT_BORDER_W),
        "bubble_border_color": field("bubble_border_color", str, DEFAULT_BORDER_COLOR),
        "bubble_font_size": field("bubble_font_size", int, DEFAULT_FONT_SIZE),
        "bubble_text_color": field("bubble_text_color", str, DEFAULT_TEXT_COLOR),
        "bubble_bg_color": field("bubble_bg_color", str, DEFAULT_BG_COLOR),
        "bubble_bg_alpha": field("bubble_bg_alpha", int, DEFAULT_BG_ALPHA),
        "bubble_gap": field("bubble_gap", int, DEFAULT_GAP),
        "bubble_shape": field("bubble_shape", str, DEFAULT_SHAPE),
    }


def save_config(width, x, y, bubbles, lifetime, angle, mirror_x, mirror_y, side,
                bubble_border_w, bubble_border_color, bubble_font_size,
                bubble_text_color, bubble_bg_color, bubble_bg_alpha,
                bubble_gap=DEFAULT_GAP, bubble_shape=DEFAULT_SHAPE):
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({"width": round(width, 1), "x": int(x), "y": int(y),
                       "bubbles": int(bubbles), "lifetime": float(lifetime),
                       "angle": int(angle) % 360, "mirror_x": bool(mirror_x),
                       "mirror_y": bool(mirror_y), "side": str(side),
                       "bubble_border_w": int(bubble_border_w),
                       "bubble_border_color": str(bubble_border_color),
                       "bubble_font_size": int(bubble_font_size),
                       "bubble_text_color": str(bubble_text_color),
                       "bubble_bg_color": str(bubble_bg_color),
                       "bubble_bg_alpha": int(bubble_bg_alpha),
                       "bubble_gap": int(bubble_gap),
                       "bubble_shape": str(bubble_shape)}, f)
    except OSError:
        pass


def _text_w_px(text, font_size):
    """估算单行文本像素宽：全角/emoji 计 1.0 倍字号，半角计 0.55 倍"""
    w = 0.0
    for ch in text:
        w += font_size if ord(ch) > 0x2E80 else font_size * 0.55
    return max(8, int(w))


def make_cloud_pixbuf(text, font_size, bg_hex, bg_alpha, border_hex, border_w):
    """PIL 画云朵形状 RGBA 图（2x 超采样抗锯齿），返回 (宽, 高, GdkPixbuf)

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
    raw = img.tobytes()
    _KEEP.append(raw)                         # 防 GC，与 load_frames 一致
    pb = GdkPixbuf.Pixbuf.new_from_data(
        raw, GdkPixbuf.Colorspace.RGB, True, 8, W2, H2, W2 * 4)
    return W2, H2, pb


def _rgba(hex_color, alpha_pct):
    """#RRGGBB + 不透明度百分比 → CSS rgba() 字符串"""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return "rgba(%d, %d, %d, %.2f)" % (r, g, b, alpha_pct / 100.0)


def _valid_color(value, fallback):
    """校验 #RRGGBB 格式，非法回退默认色"""
    if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value
    return fallback


def load_frames(n, width, angle=0, mirror_x=False, mirror_y=False):
    """加载第 n 个表情的全部动画帧（缩放+姿态变换），返回 (pixbuf列表, 每帧毫秒)"""
    path = os.path.join(EMOTE_DIR, f"remiel_{n}.gif")
    im = Image.open(path)
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
        w2, h2 = rgba.size
        raw = rgba.tobytes()
        _KEEP.append(raw)  # 保持引用，pixbuf 才能一直读到有效数据
        pb = GdkPixbuf.Pixbuf.new_from_data(
            raw, GdkPixbuf.Colorspace.RGB, True, 8, w2, h2, w2 * 4
        )
        frames.append(pb)
        durations.append(frame.info.get("duration", 100))
    return frames, durations


class RemielPet:
    def __init__(self):
        self.width = DEFAULT_WIDTH
        self.state = None          # 当前 Claude 状态（idle/thinking/running/success）
        self.state_emote = 1
        self.state_since = 0.0   # 状态切换时间戳（秒）
        self.success_since = None  # 成功状态展示起始时间
        self.bubble_mtime = 0.0    # 上次处理的气泡文件修改时间
        self.bubble_items = []     # DEPRECATED: 旧 Revealer 列表，保留兼容
        self.bubble_data = []      # [(BubbleItem, ...)] 新的浮动气泡数据
        self.frames = {}
        self.durations = {}
        self.frame_idx = 0
        self.timer = None
        self.drag_off = None
        self.resize_pending = None
        self.cfg = load_config()
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
                                                DEFAULT_BORDER_COLOR)
        self.bubble_text_color = _valid_color(self.cfg["bubble_text_color"],
                                              DEFAULT_TEXT_COLOR)
        self.bubble_bg_color = _valid_color(self.cfg["bubble_bg_color"],
                                            DEFAULT_BG_COLOR)
        self.bubble_gap = max(0, min(12, self.cfg["bubble_gap"]))
        self.bubble_shape = (self.cfg["bubble_shape"]
                             if self.cfg["bubble_shape"] in ("rect", "cloud") else "rect")
        self._float_last_us = None   # float_tick 上一帧时间戳（计算真实 dt）

        self.win = Gtk.Window(type=Gtk.WindowType.POPUP)
        self.win.set_decorated(False)
        self.win.set_app_paintable(True)
        self.win.set_keep_above(True)
        self.win.set_accept_focus(True)
        self.win.set_position(Gtk.WindowPosition.NONE)

        screen = self.win.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.win.set_visual(visual)

        # CSS：气泡样式（对话框形式，随配置动态重建）
        self.css_provider = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_screen(
            screen, self.css_provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.apply_bubble_css()

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.bubble_area = Gtk.Fixed()
        self.img = Gtk.Image()
        box.pack_start(self.bubble_area, False, False, 0)
        box.pack_start(self.img, True, True, 0)
        self.win.add(box)

        # 事件
        self.win.connect("button-press-event", self.on_press)
        self.win.connect("button-release-event", self.on_release)
        self.win.connect("motion-notify-event", self.on_motion)
        self.win.connect("key-press-event", self.on_key)
        self.win.connect("scroll-event", self.on_scroll)
        self.win.connect("destroy", self.on_quit)

        # 应用保存过的尺寸与姿态
        self.apply_size(self.cfg["width"])

        # 位置：记住的 > 默认右下角
        mon = screen.get_monitor_geometry(screen.get_primary_monitor())
        if self.cfg["x"] >= 0 and self.cfg["y"] >= 0:
            self.win.move(self.cfg["x"], self.cfg["y"])
        else:
            self.win.move(mon.x + mon.width - self.pet_w - 28,
                          mon.y + mon.height - self.win_h - 30)
        self.win.show_all()
        self.win.set_can_focus(True)
        self.win.grab_focus()

        self.show_emote(1)
        self.win.connect("realize", lambda w: w.get_window().set_events(
            w.get_window().get_events() |
            Gdk.EventMask.POINTER_MOTION_MASK |
            Gdk.EventMask.BUTTON_PRESS_MASK |
            Gdk.EventMask.BUTTON_RELEASE_MASK |
            Gdk.EventMask.KEY_PRESS_MASK |
            Gdk.EventMask.SCROLL_MASK))

        print(f"[pet] 启动 尺寸={self.pet_w}x{self.win_h} 姿态=旋转{self.angle}°"
              f" 镜像x={self.mirror_x} 镜像y={self.mirror_y}"
              f" 气泡上限={self.max_bubbles} 停留={self.bubble_lifetime:.0f}s"
              f" 位置={self.bubble_side} pos={self.win.get_position()}", flush=True)
        self.poll()
        # 启动气泡浮动动画（每 50ms 更新位置和透明度）
        GLib.timeout_add(FLOAT_TICK_MS, self.float_tick)

    # ---------- 尺寸与姿态 ----------
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

    def apply_size(self, width):
        self.width = max(MIN_WIDTH, min(MAX_WIDTH, width))
        widths, heights = [], []
        self.frames, self.durations = {}, {}
        for n in range(1, 6):
            self.frames[n], self.durations[n] = load_frames(
                n, self.width, self.angle, self.mirror_x, self.mirror_y)
            widths.append(int(self.frames[n][0].get_width()))
            heights.append(int(self.frames[n][0].get_height()))
        self.pet_w = max(widths)
        self.pet_h = max(heights)
        self.win_h = self.pet_h + 24 + self.bubble_area_h()
        self.bubble_area.set_size_request(self.pet_w, self.bubble_area_h())
        self.win.set_default_size(self.pet_w, self.win_h)
        self.win.resize(self.pet_w, self.win_h)
        self.show_emote(self.current if hasattr(self, "current") else 1)

    def on_scroll(self, _w, ev):
        step = 0.0
        if ev.direction == Gdk.ScrollDirection.UP:
            step = STEP_RATIO
        elif ev.direction == Gdk.ScrollDirection.DOWN:
            step = 1.0 / STEP_RATIO
        else:
            dy = ev.get_deltas()[1]
            step = STEP_RATIO if dy < 0 else 1.0 / STEP_RATIO
        if not step:
            return True
        if self.resize_pending:
            GLib.source_remove(self.resize_pending)
        self.resize_pending = GLib.timeout_add(180, lambda: self.do_resize(step))
        return True

    def do_resize(self, step):
        self.resize_pending = None
        old_w, old_h = self.win.get_size()
        new_w = int(self.width * step)
        new_w = max(int(MIN_WIDTH), min(int(MAX_WIDTH), new_w))
        if new_w == int(self.width):
            return False
        x, y = self.win.get_position()
        self.apply_size(new_w)
        self.win.move(x + old_w - self.pet_w, y + old_h - self.win_h)  # 右下角锚定
        self.save_cfg()
        print(f"[pet] 大小调整 -> {self.pet_w}x{self.win_h}", flush=True)
        return False

    def set_pose(self, angle=None, mirror_x=None, mirror_y=None):
        if angle is not None:
            self.angle = int(angle) % 360
        if mirror_x is not None:
            self.mirror_x = bool(mirror_x)
        if mirror_y is not None:
            self.mirror_y = bool(mirror_y)
        old_w, old_h = self.win.get_size()
        x, y = self.win.get_position()
        self.apply_size(self.width)
        self.win.move(x + old_w - self.pet_w, y + old_h - self.win_h)  # 右下角锚定
        self.save_cfg()
        print(f"[pet] 姿态 -> 旋转{self.angle}° 镜像x={self.mirror_x} 镜像y={self.mirror_y}",
              flush=True)

    def save_cfg(self):
        save_config(self.width, self.win.get_position()[0],
                    self.win.get_position()[1], self.max_bubbles,
                    self.bubble_lifetime, self.angle, self.mirror_x,
                    self.mirror_y, self.bubble_side,
                    self.bubble_border_w, self.bubble_border_color,
                    self.bubble_font_size, self.bubble_text_color,
                    self.bubble_bg_color, self.bubble_bg_alpha,
                    self.bubble_gap, self.bubble_shape)

    def apply_bubble_css(self):
        """按当前样式配置重建气泡 CSS（provider 重载后已有气泡自动重绘）"""
        bg = _rgba(self.bubble_bg_color, self.bubble_bg_alpha)
        fg = _rgba(self.bubble_text_color, 100)
        bd = _rgba(self.bubble_border_color, 100)
        css = (f"#bubble {{ background: {bg}; color: {fg};"
               f" border: {self.bubble_border_w}px solid {bd};"
               f" border-radius: 11px; padding: 3px 9px;"
               f" font-size: {self.bubble_font_size}px;"
               f" margin: 1px 8px 0 8px; }}"
               f" #bubble-text {{ color: {fg}; font-size: {self.bubble_font_size}px;"
               f" background: transparent; }}").encode()
        self.css_provider.load_from_data(css)

    def _build_cloud(self, text):
        """按当前样式生成云朵气泡图，返回 (宽, 高, pixbuf)"""
        return make_cloud_pixbuf(text, self.bubble_font_size, self.bubble_bg_color,
                                 self.bubble_bg_alpha, self.bubble_border_color,
                                 self.bubble_border_w)

    # ---------- Claude 联动 ----------
    def poll(self):
        now_sec = GLib.get_monotonic_time() / 1e6

        # 表情状态（errors=replace：写入可能被截断产生非法 UTF-8，不能崩溃）
        try:
            with open(STATE_FILE, "r", errors="replace") as f:
                s = f.read().strip()
        except (OSError, IOError):
            s = None

        if s != self.state:
            self.state = s
            self.state_since = now_sec        # 记录状态切换时间
            self.success_since = None
            if s in STATE_EMOTE:
                self.state_emote = STATE_EMOTE[s]
                self.show_emote(self.state_emote)
                print(f"[pet] 状态 -> {s} 表情{self.state_emote}", flush=True)
        elif s == "success":
            # success 状态 4 秒后自动回退到 idle
            if self.success_since is None:
                self.success_since = now_sec
            elif now_sec - self.success_since > 4:
                self.show_emote(1)
                self.success_since = None
        elif s in ("thinking", "running"):
            # thinking / running 状态超时自动回退：超过 STATE_IDLE_TIMEOUT 秒无新气泡则回退 idle
            if self.bubble_data:
                latest_bubble_age = now_sec - (self.bubble_data[-1].born / 1e6)
            else:
                latest_bubble_age = now_sec - self.state_since
            if latest_bubble_age > STATE_IDLE_TIMEOUT:
                # 超时无活动，回退到 idle
                if self.state_emote != 1:
                    self.state_emote = 1
                    self.show_emote(1)
                    print(f"[pet] 状态 {s} 超时 -> 回退 idle", flush=True)

        # 气泡（按文件 mtime 检测，每次写入追加一条新气泡）
        try:
            mtime = os.stat(BUBBLE_FILE).st_mtime
        except OSError:
            mtime = 0.0
        if mtime != self.bubble_mtime:
            self.bubble_mtime = mtime
            try:
                with open(BUBBLE_FILE, "r", errors="replace") as f:
                    b = f.read().strip()
            except (OSError, IOError):
                b = ""
            if b:
                self.add_bubble(b)

        GLib.timeout_add(300, self.poll)
        return False

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
        # 右对齐：x = 容器宽度 - 气泡实际宽度 - 右边距
        # （矩形模式未分配宽度时按估算值，下一帧自动修正）
        w = item.w if item.w else 200
        return max(2, self.pet_w - w - 8)

    def align_bubble(self, label):
        """设置 label 文本对齐（CSS 内部对齐）"""
        label.set_halign(Gtk.Align.END if self.bubble_side == "right" else Gtk.Align.START)

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

        # 容量管理交给 float_tick：超限时最旧气泡标记 dying 淡出（500ms）后移除

        # 创建气泡容器（矩形：label 直接放容器；云朵：云朵图 + 文字叠加）
        label = Gtk.Label(label=text)
        self.align_bubble(label)
        container = Gtk.Fixed()
        item = BubbleItem(container, GLib.get_monotonic_time())
        item.label = label
        if self.bubble_shape == "cloud":
            label.set_name("bubble-text")
            W, H, pb = self._build_cloud(text)
            img = Gtk.Image.new_from_pixbuf(pb)
            container.put(img, 0, 0)
            img.show()
            tw = _text_w_px(text, self.bubble_font_size)
            th = int(self.bubble_font_size * 1.4)
            container.put(label, max(2, (W - tw) // 2), max(2, (H - th) // 2))
            container.set_size_request(W, H)
            item.cloud_img = img
            item.w = W
        else:
            label.set_name("bubble")
            container.put(label, 0, 0)
        container.show()

        # 出生在容器底部视口外（下方 4px 被宠物图盖住，视觉上从头顶边缘冒出）
        item.x = self._bubble_x(item)
        item.y = self.bubble_area_h() + 4
        self.bubble_area.put(container, int(item.x), int(item.y))
        self.bubble_data.append(item)

        print(f"[pet] 气泡+1 ({len(self.bubble_data)}/{self.max_bubbles}): {text}"
              f"（{self.bubble_lifetime:.0f}s 浮动淡出）", flush=True)

    def float_tick(self):
        """每 50ms：纯槽位布局（旧上新下，严格不重叠）+ 固定速度升起/回排 + 淡入淡出"""
        now_us = GLib.get_monotonic_time()
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
        #    （只统计存活项，形状切换过渡期旧气泡全 dying 时新气泡不受影响）
        excess = sum(1 for it in self.bubble_data if not it.dying) - self.max_bubbles
        for item in self.bubble_data:            # 头部即最旧
            if excess <= 0:
                break
            if not item.dying:
                item.dying = True
                item.fade_start = now_us
                item.fade_from = item.widget.get_opacity()
                excess -= 1

        # 2) 按年龄排序 → 槽位（0 最旧最上，n-1 最新最下）→ 固定速度移动 + 透明度
        order = sorted(range(len(self.bubble_data)),
                       key=lambda j: self.bubble_data[j].born)
        for slot, j in enumerate(order):
            item = self.bubble_data[j]
            target_y = 2 + slot * pitch         # 槽位唯一 → 数学上不可能重叠
            # 速度模式（统一：出生升起 / 移除填位 / 行高变化回排，双向）
            if item.y > target_y + 0.5:
                item.y = max(target_y, item.y - step)
            elif item.y < target_y - 0.5:
                item.y = min(target_y, item.y + step)
            else:
                item.y = target_y
            if item.cloud_img is None:           # 矩形模式：容器宽度跟随 label 实际分配
                item.w = item.widget.get_allocated_width()
            item.x = self._bubble_x(item)

            if item.dying:
                # 淡出中：500ms 内从 fade_from 线性降到 0，结束后移除
                fp = (now_us - item.fade_start) / fade_us
                if fp >= 1.0:
                    to_remove.append(j)
                    continue
                item.widget.set_opacity(max(0.0, item.fade_from * (1.0 - fp)))
            else:
                progress = (now_us - item.born) / lifetime_us  # 0.0 → 1.0+
                if progress >= 1.0:
                    # 到期 → 进入淡出（dying 项仍占槽位，堆栈不跳动）
                    item.dying = True
                    item.fade_start = now_us
                    item.fade_from = item.widget.get_opacity()
                else:
                    # 生命周期透明度：前 BUBBLE_FADE_START 比例全显，之后线性渐变到 0
                    if progress < BUBBLE_FADE_START:
                        life_op = 1.0
                    else:
                        fp = (progress - BUBBLE_FADE_START) / (1.0 - BUBBLE_FADE_START)
                        life_op = max(0.0, 1.0 - fp)
                    # 出生淡入：前 BIRTH_FADE_MS 内 0 → 1，与生命周期曲线相乘
                    fade_in = min(1.0, (now_us - item.born) / (BIRTH_FADE_MS * 1000.0))
                    item.widget.set_opacity(life_op * fade_in)

            self.bubble_area.move(item.widget, int(item.x), int(item.y))

        # 3) 移除淡出完成的（索引从大到小，避免错位）
        for j in sorted(to_remove, reverse=True):
            item = self.bubble_data.pop(j)
            self.bubble_area.remove(item.widget)
            item.widget.destroy()
            print("[pet] 气泡-1 淡出移除", flush=True)

        return True  # 继续定时器

    def set_bubble_side(self, side):
        self.bubble_side = side
        for item in self.bubble_data:
            item.x = self._bubble_x(item)
            self.align_bubble(item.label)
            self.bubble_area.move(item.widget, int(item.x), int(item.y))
        self.save_cfg()
        print(f"[pet] 气泡位置 -> {side}", flush=True)

    # ---------- 动画 ----------
    def show_emote(self, n):
        self.current = n
        self.frame_idx = 0
        if self.timer:
            GLib.source_remove(self.timer)
        self.img.set_from_pixbuf(self.frames[n][0])
        self.timer = GLib.timeout_add(100, self.tick)

    def tick(self):
        n = self.current
        self.frame_idx = (self.frame_idx + 1) % len(self.frames[n])
        self.img.set_from_pixbuf(self.frames[n][self.frame_idx])
        self.timer = GLib.timeout_add(max(30, self.durations[n][self.frame_idx]), self.tick)
        return False

    # ---------- 交互 ----------
    def on_press(self, _w, ev):
        if ev.button == 1:
            self.drag_off = (ev.x_root - self.win.get_position()[0],
                             ev.y_root - self.win.get_position()[1])
            return False
        if ev.button == 3:
            self.popup_menu(ev)
            return True
        return False

    def on_release(self, _w, ev):
        if ev.button == 1:
            self.drag_off = None
        return False

    def on_motion(self, _w, ev):
        if self.drag_off is not None and ev.state & Gdk.ModifierType.BUTTON1_MASK:
            self.win.move(ev.x_root - self.drag_off[0], ev.y_root - self.drag_off[1])
            self.save_cfg()
        return False

    def on_key(self, _w, ev):
        name = Gdk.keyval_name(ev.keyval)
        if name in ("plus", "equal", "KP_Add", "KP_Equal"):
            self.do_resize(STEP_RATIO)
        elif name in ("minus", "KP_Subtract"):
            self.do_resize(1.0 / STEP_RATIO)
        elif name in ("q", "Q", "Escape"):
            Gtk.main_quit()
        return True

    def on_quit(self, *_a):
        self.save_cfg()

    def popup_menu(self, ev):
        menu = Gtk.Menu()

        # 气泡数量
        bubble_menu = Gtk.Menu()
        for n in (1, 2, 3, 4, 5, 6, 8, 10):
            item = Gtk.MenuItem(label=f"{n} 条" + (" ✓" if n == self.max_bubbles else ""))
            item.connect("activate", lambda _i, n=n: self.set_max_bubbles(n))
            bubble_menu.append(item)
        bubble_item = Gtk.MenuItem(label=f"气泡数量（当前 {self.max_bubbles}）")
        bubble_item.set_submenu(bubble_menu)
        menu.append(bubble_item)

        # 气泡停留时间
        life_menu = Gtk.Menu()
        for sec in (3, 5, 8, 12, 20):
            item = Gtk.MenuItem(label=f"{sec} 秒" + (" ✓" if sec == self.bubble_lifetime else ""))
            item.connect("activate", lambda _i, sec=sec: self.set_lifetime(sec))
            life_menu.append(item)
        life_item = Gtk.MenuItem(label=f"气泡停留（当前 {self.bubble_lifetime:.0f} 秒）")
        life_item.set_submenu(life_menu)
        menu.append(life_item)

        # 气泡位置（右上/左上）
        side_menu = Gtk.Menu()
        for side, label in (("right", "右上"), ("left", "左上")):
            item = Gtk.MenuItem(label=label + (" ✓" if side == self.bubble_side else ""))
            item.connect("activate", lambda _i, side=side: self.set_bubble_side(side))
            side_menu.append(item)
        side_item = Gtk.MenuItem(label="气泡位置（当前 "
                                 f"{'右上' if self.bubble_side == 'right' else '左上'}）")
        side_item.set_submenu(side_menu)
        menu.append(side_item)

        # 气泡间距（垂直方向）
        gap_menu = Gtk.Menu()
        for g in (0, 2, 4, 6, 8, 12):
            item = Gtk.MenuItem(label=f"{g} px" + (" ✓" if g == self.bubble_gap else ""))
            item.connect("activate", lambda _i, g=g: self.set_bubble_style("bubble_gap", g))
            gap_menu.append(item)
        gap_item = Gtk.MenuItem(label=f"气泡间距（当前 {self.bubble_gap} px）")
        gap_item.set_submenu(gap_menu)
        menu.append(gap_item)

        # 气泡样式：形状 / 边框 / 文字 / 背景（可细调，持久化到配置）
        style_menu = Gtk.Menu()
        shape_menu = Gtk.Menu()
        for val, lbl in (("rect", "圆角矩形"), ("cloud", "云朵")):
            item = Gtk.MenuItem(label=lbl + (" ✓" if val == self.bubble_shape else ""))
            item.connect("activate", lambda _i, v=val: self.set_bubble_style("bubble_shape", v))
            shape_menu.append(item)
        shape_item = Gtk.MenuItem(label="气泡形状（当前 "
                                  f"{'云朵' if self.bubble_shape == 'cloud' else '圆角矩形'}）")
        shape_item.set_submenu(shape_menu)
        style_menu.append(shape_item)

        bw_menu = Gtk.Menu()
        for w in (0, 1, 2, 3, 4, 5):
            item = Gtk.MenuItem(label=f"{w} px" + (" ✓" if w == self.bubble_border_w else ""))
            item.connect("activate", lambda _i, w=w: self.set_bubble_style("bubble_border_w", w))
            bw_menu.append(item)
        bw_item = Gtk.MenuItem(label=f"边框宽度（当前 {self.bubble_border_w} px）")
        bw_item.set_submenu(bw_menu)
        style_menu.append(bw_item)

        bc_item = Gtk.MenuItem(label=f"边框颜色（当前 {self.bubble_border_color}）")
        bc_item.connect("activate", lambda _i: self.choose_bubble_color("bubble_border_color"))
        style_menu.append(bc_item)

        fs_menu = Gtk.Menu()
        for sz in (10, 12, 14, 16, 18):
            item = Gtk.MenuItem(label=f"{sz} px" + (" ✓" if sz == self.bubble_font_size else ""))
            item.connect("activate", lambda _i, sz=sz: self.set_bubble_style("bubble_font_size", sz))
            fs_menu.append(item)
        fs_item = Gtk.MenuItem(label=f"文字字号（当前 {self.bubble_font_size} px）")
        fs_item.set_submenu(fs_menu)
        style_menu.append(fs_item)

        tc_item = Gtk.MenuItem(label=f"文字颜色（当前 {self.bubble_text_color}）")
        tc_item.connect("activate", lambda _i: self.choose_bubble_color("bubble_text_color"))
        style_menu.append(tc_item)

        bg_item = Gtk.MenuItem(label=f"背景颜色（当前 {self.bubble_bg_color}）")
        bg_item.connect("activate", lambda _i: self.choose_bubble_color("bubble_bg_color"))
        style_menu.append(bg_item)

        alpha_menu = Gtk.Menu()
        for a in (60, 70, 80, 90, 100):
            item = Gtk.MenuItem(label=f"{a}%" + (" ✓" if a == self.bubble_bg_alpha else ""))
            item.connect("activate", lambda _i, a=a: self.set_bubble_style("bubble_bg_alpha", a))
            alpha_menu.append(item)
        alpha_item = Gtk.MenuItem(label=f"背景不透明度（当前 {self.bubble_bg_alpha}%）")
        alpha_item.set_submenu(alpha_menu)
        style_menu.append(alpha_item)

        style_item = Gtk.MenuItem(label=f"气泡样式（当前 字号 {self.bubble_font_size} · "
                                        f"边框 {self.bubble_border_w}）")
        style_item.set_submenu(style_menu)
        menu.append(style_item)

        # 姿态：旋转 / 镜像
        pose_menu = Gtk.Menu()
        for ang in (0, 90, 180, 270):
            item = Gtk.MenuItem(label=f"旋转 {ang}°" + (" ✓" if ang == self.angle else ""))
            item.connect("activate", lambda _i, ang=ang: self.set_pose(angle=ang))
            pose_menu.append(item)
        pose_menu.append(Gtk.SeparatorMenuItem())
        for label, key in (("水平镜像", "mirror_x"), ("垂直镜像", "mirror_y")):
            item = Gtk.MenuItem(label=f"{label} {'开 ✓' if getattr(self, key) else '关'}")
            item.connect("activate", lambda _i, key=key: self.set_pose(
                **{key: not getattr(self, key)}))
            pose_menu.append(item)
        pose_item = Gtk.MenuItem(label=f"姿态（旋转{self.angle}° · "
                                 f"{'水平镜像' if self.mirror_x else '水平正常'} · "
                                 f"{'垂直镜像' if self.mirror_y else '垂直正常'}）")
        pose_item.set_submenu(pose_menu)
        menu.append(pose_item)

        menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem(label="退出宠物")
        quit_item.connect("activate", lambda _i: Gtk.main_quit())
        menu.append(quit_item)
        menu.show_all()
        menu.popup_at_pointer(ev)

    def set_max_bubbles(self, n):
        self.max_bubbles = max(1, min(10, n))
        old_w, old_h = self.win.get_size()
        x, y = self.win.get_position()
        self.apply_size(self.width)
        self.win.move(x + old_w - self.pet_w, y + old_h - self.win_h)
        self.save_cfg()
        print(f"[pet] 气泡上限 -> {self.max_bubbles}", flush=True)

    def set_lifetime(self, sec):
        self.bubble_lifetime = max(2.0, min(120.0, float(sec)))
        self.save_cfg()
        print(f"[pet] 气泡停留 -> {self.bubble_lifetime:.0f} 秒", flush=True)

    def set_bubble_style(self, key, value):
        """气泡样式统一入口：应用 CSS → 几何变化重算窗口 → 云朵重建/形状切换 → 存配置"""
        old_shape = self.bubble_shape
        setattr(self, key, value)
        self.apply_bubble_css()
        if key in GEOMETRIC_KEYS:            # 字号/边框/间距/形状 → 行高窗口变化
            old_w, old_h = self.win.get_size()
            x, y = self.win.get_position()
            self.apply_size(self.width)
            self.win.move(x + old_w - self.pet_w, y + old_h - self.win_h)
        if key == "bubble_shape" and value != old_shape:
            # 形状切换：现有气泡整批快速淡出，新气泡用新形状
            now_us = GLib.get_monotonic_time()
            for item in self.bubble_data:
                if not item.dying:
                    item.dying = True
                    item.fade_start = now_us
                    item.fade_from = item.widget.get_opacity()
        elif key != "bubble_shape":
            self._refresh_cloud_images()     # 云朵模式样式变更 → 重建既有云朵 PNG
        self.save_cfg()
        print(f"[pet] 气泡样式 {key} -> {value}", flush=True)

    def _refresh_cloud_images(self):
        """云朵模式下样式变更后重建既有气泡的 PNG（dying 项跳过，矩形项跳过）"""
        if self.bubble_shape != "cloud":
            return
        for item in self.bubble_data:
            if item.dying or item.cloud_img is None:
                continue
            text = item.label.get_text()
            W, H, pb = self._build_cloud(text)
            item.widget.remove(item.cloud_img)
            img = Gtk.Image.new_from_pixbuf(pb)
            item.widget.put(img, 0, 0)
            img.show()
            item.cloud_img = img
            item.w = W
            item.widget.set_size_request(W, H)
            # 文字位置随 W/字号变化重摆
            tw = _text_w_px(text, self.bubble_font_size)
            th = int(self.bubble_font_size * 1.4)
            item.widget.move(item.label, max(2, (W - tw) // 2), max(2, (H - th) // 2))

    def choose_bubble_color(self, key):
        """弹出颜色选择对话框（响应式回调里应用 + 存配置）"""
        dlg = Gtk.ColorChooserDialog(title="选择气泡颜色", transient_for=self.win)
        dlg.set_use_alpha(False)  # 不透明度由菜单项单独调节，不进对话框
        rgba = Gdk.RGBA()
        rgba.parse(getattr(self, key))
        dlg.set_rgba(rgba)
        dlg.connect("response", self._on_color_choose, key)
        dlg.show_all()
        dlg.present()
        self._color_dlg = dlg  # 防 GC 提前回收

    def _on_color_choose(self, dlg, resp, key):
        dlg.destroy()
        self._color_dlg = None
        if resp != Gtk.ResponseType.OK:
            return
        c = dlg.get_rgba()
        hexv = "#%02x%02x%02x" % (int(c.red * 255), int(c.green * 255),
                                  int(c.blue * 255))
        self.set_bubble_style(key, hexv)


def main():
    signal.signal(signal.SIGINT, lambda *a: Gtk.main_quit())
    RemielPet()
    Gtk.main()


if __name__ == "__main__":
    main()
