#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""demo 桌宠表情生成器（P3 演示，可重复运行）

生成 pets/demo/emotes/demo_1..demo_5.gif：
- 画布 128x128 RGBA 透明底，每 GIF 8 帧、帧时长 120ms、循环播放
- 每帧为单一状态色的弹跳圆点（ImageDraw.ellipse）或星形（ImageDraw.polygon）
  （奇数号=圆点，偶数号=星形，让 5 张表情有差异）
- 上下弹跳动画：y 位移按正弦曲线在触地基线之上做往返运动
- 状态色：1=蓝 #5b8def  2=黄 #ffd34d  3=橙 #ff8c42  4=绿 #4ecb71  5=紫 #b07ce8
- 与 remiel 一致的前缀约定：status_icon = "emotes/demo_1.gif" →
  引擎正则 ^(.*?)(\d+)\.(\w+)$ 推导出 demo_{n}.gif（n=1..5）

仅依赖 PIL 的 Image / ImageDraw。覆盖式写入，已存在则直接覆盖。
"""
import math
import os

from PIL import Image, ImageDraw

SIZE = 128          # 画布边长（px）
FRAMES = 8          # 每 GIF 帧数（8-10 范围内）
DURATION = 120      # 帧时长（ms）
AMPLITUDE = 18      # 弹跳 y 位移振幅（px）
RADIUS = 26         # 圆点半径 / 星形外接圆半径
GROUND = SIZE - 18  # 触地基线（圆点底边的 y）

COLORS = {  # 状态号 → 状态色（与 pet_spec.json 的 emote_map 1..5 对应）
    1: "#5b8def",
    2: "#ffd34d",
    3: "#ff8c42",
    4: "#4ecb71",
    5: "#b07ce8",
}
SHAPES = {1: "circle", 2: "star", 3: "circle", 4: "star", 5: "circle"}


def _hex_rgb(hexv):
    return (int(hexv[1:3], 16), int(hexv[3:5], 16), int(hexv[5:7], 16))


def _draw_star(draw, cx, cy, R, color):
    """五角星（ImageDraw.polygon），外接圆半径 R"""
    n = 5
    pts = []
    for i in range(n * 2):
        r = R if i % 2 == 0 else R * 0.45
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    draw.polygon(pts, fill=color)


def make_frame(state, fi):
    """第 state 张 GIF 的第 fi 帧（0..FRAMES-1）：正弦上下弹跳"""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = _hex_rgb(COLORS[state]) + (255,)

    t = fi / FRAMES
    bounce = abs(math.sin(math.pi * t))     # 0 → 1 → 0，触地为 0
    cy = GROUND - RADIUS - int(bounce * AMPLITUDE)

    # 地面阴影：弹得越高影子越小越淡
    sh_r = int(RADIUS * (0.5 + 0.4 * bounce))
    d.ellipse([SIZE // 2 - sh_r, GROUND + 8 - sh_r // 2,
               SIZE // 2 + sh_r, GROUND + 8 + sh_r // 2],
              fill=(20, 24, 40, int(64 + 66 * bounce)))

    cx = SIZE // 2
    if SHAPES[state] == "circle":
        d.ellipse([cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS],
                  fill=color)
        # 左上高光小圆
        hi = max(2, RADIUS // 4)
        d.ellipse([cx - RADIUS // 2, cy - RADIUS // 2,
                   cx - RADIUS // 2 + hi, cy - RADIUS // 2 + hi],
                  fill=(255, 255, 255, 160))
    else:
        _draw_star(d, cx, cy, RADIUS, color)
    return img


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "pets", "demo", "emotes")
    os.makedirs(out_dir, exist_ok=True)
    for state in range(1, 6):
        frames = [make_frame(state, fi) for fi in range(FRAMES)]
        path = os.path.join(out_dir, "demo_%d.gif" % state)
        frames[0].save(path, save_all=True, append_images=frames[1:],
                       duration=DURATION, loop=0, disposal=2)
        print("generated %s (%d 帧, %dms/帧)" % (path, FRAMES, DURATION))
    print("OK: 5 张 demo GIF 已生成")


if __name__ == "__main__":
    main()
