#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sol Watch 图标生成器（无第三方依赖：zlib + struct 手写 PNG）。
生成方形深色底 + 紫色表盘 + 深蓝指针的时钟图标（16/32/48/128）。"""
import struct
import zlib


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def make_icon(size):
    bg = (24, 24, 36)          # 深色底
    dial = (196, 168, 255)     # 淡紫表盘
    hand = (24, 30, 84)        # 深蓝指针
    corner = (245, 245, 250)   # 四角小三角
    px = [[0] * (size * 3) for _ in range(size)]
    cx = cy = size / 2.0
    r = size * 0.42
    cr = size * 0.06
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= r:
                c = dial
            else:
                c = bg
            # 四角小三角装饰
            if x < size * 0.16 and y < size * 0.16 and x + y < size * 0.20:
                c = corner
            if x > size * 0.84 and y < size * 0.16 and (size - x) + y < size * 0.20:
                c = corner
            if x < size * 0.16 and y > size * 0.84 and x + (size - y) < size * 0.20:
                c = corner
            if x > size * 0.84 and y > size * 0.84 and (size - x) + (size - y) < size * 0.20:
                c = corner
            # 指针：分针（指向 12 点方向附近）与时针（3 点样式）
            if dist <= r:
                if abs(x - cx) < cr and y < cy + cr and y > cy - r * 0.7:
                    c = hand  # 分针（竖直）
                if abs(y - cy) < cr and x > cx - cr and x < cx + r * 0.62:
                    c = hand  # 时针（水平偏右）
                # 中心点
                if dist < cr:
                    c = hand
            px[y][x * 3:x * 3 + 3] = c
    return px


def main():
    out_dir = "icons"
    import os
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(out_dir, f"icon{size}.png"), size, make_icon(size))
        print(f"icon{size}.png written")


if __name__ == "__main__":
    main()
