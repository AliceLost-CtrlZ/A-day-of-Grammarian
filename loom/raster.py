#!/usr/bin/env python3
"""
A small anti-aliased rasterizer and PNG encoder, standard library only.

Loom's native output is SVG, which is the right format for something built
out of lines. But a picture you cannot open is only a rumour, so this turns
the same geometry into pixels using nothing but `zlib` and arithmetic.

Coverage is computed the honest way: for every pixel in a primitive's
bounding box, measure the distance from the pixel centre to the shape and
use it as an alpha value. Round caps and joins fall out of that for free.
"""

from __future__ import annotations

import struct
import zlib
from math import ceil, floor, sqrt


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


class Raster:
    def __init__(self, width: int, height: int, background: str = "#000000"):
        self.w = int(width)
        self.h = int(height)
        r, g, b = hex_to_rgb(background)
        self.buf = bytearray(bytes((r, g, b)) * (self.w * self.h))

    # -- blending ----------------------------------------------------------

    def _blend(self, x: int, y: int, rgb, a: float) -> None:
        if a <= 0.0 or x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        if a > 1.0:
            a = 1.0
        i = (y * self.w + x) * 3
        buf = self.buf
        inv = 1.0 - a
        buf[i] = int(buf[i] * inv + rgb[0] * a + 0.5)
        buf[i + 1] = int(buf[i + 1] * inv + rgb[1] * a + 0.5)
        buf[i + 2] = int(buf[i + 2] * inv + rgb[2] * a + 0.5)

    # -- primitives --------------------------------------------------------

    def stroke(self, x0, y0, x1, y1, rgb, width, alpha=1.0) -> None:
        """A capsule: the set of points within `width/2` of the segment."""
        hw = max(width, 0.35) / 2.0
        pad = hw + 1.0
        lo_x = max(0, int(floor(min(x0, x1) - pad)))
        hi_x = min(self.w - 1, int(ceil(max(x0, x1) + pad)))
        lo_y = max(0, int(floor(min(y0, y1) - pad)))
        hi_y = min(self.h - 1, int(ceil(max(y0, y1) + pad)))
        if lo_x > hi_x or lo_y > hi_y:
            return
        dx, dy = x1 - x0, y1 - y0
        len2 = dx * dx + dy * dy
        edge = hw + 0.5
        for py in range(lo_y, hi_y + 1):
            fy = py + 0.5
            for px in range(lo_x, hi_x + 1):
                fx = px + 0.5
                if len2 > 0.0:
                    t = ((fx - x0) * dx + (fy - y0) * dy) / len2
                    if t < 0.0:
                        t = 0.0
                    elif t > 1.0:
                        t = 1.0
                else:
                    t = 0.0
                ex = fx - (x0 + t * dx)
                ey = fy - (y0 + t * dy)
                cov = edge - sqrt(ex * ex + ey * ey)
                if cov > 0.0:
                    self._blend(px, py, rgb, (cov if cov < 1.0 else 1.0) * alpha)

    def disc(self, cx, cy, r, rgb, alpha=1.0) -> None:
        pad = r + 1.0
        lo_x = max(0, int(floor(cx - pad)))
        hi_x = min(self.w - 1, int(ceil(cx + pad)))
        lo_y = max(0, int(floor(cy - pad)))
        hi_y = min(self.h - 1, int(ceil(cy + pad)))
        edge = r + 0.5
        for py in range(lo_y, hi_y + 1):
            dy = py + 0.5 - cy
            for px in range(lo_x, hi_x + 1):
                dx = px + 0.5 - cx
                cov = edge - sqrt(dx * dx + dy * dy)
                if cov > 0.0:
                    self._blend(px, py, rgb, (cov if cov < 1.0 else 1.0) * alpha)

    def polygon(self, pts, rgb, alpha=1.0) -> None:
        """Even-odd fill, anti-aliased with a 3x3 sample grid per pixel."""
        if len(pts) < 3:
            return
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        lo_x = max(0, int(floor(min(xs))))
        hi_x = min(self.w - 1, int(ceil(max(xs))))
        lo_y = max(0, int(floor(min(ys))))
        hi_y = min(self.h - 1, int(ceil(max(ys))))
        if lo_x > hi_x or lo_y > hi_y:
            return
        edges = []
        n = len(pts)
        for k in range(n):
            ax, ay = pts[k]
            bx, by = pts[(k + 1) % n]
            if ay != by:
                edges.append((ax, ay, bx, by))
        if not edges:
            return
        offs = (1 / 6, 3 / 6, 5 / 6)
        for py in range(lo_y, hi_y + 1):
            for px in range(lo_x, hi_x + 1):
                hits = 0
                for oy in offs:
                    sy = py + oy
                    row = [
                        ax + (sy - ay) * (bx - ax) / (by - ay)
                        for ax, ay, bx, by in edges
                        if (ay <= sy < by) or (by <= sy < ay)
                    ]
                    if not row:
                        continue
                    for ox in offs:
                        sx = px + ox
                        if sum(1 for cx in row if cx > sx) & 1:
                            hits += 1
                if hits:
                    self._blend(px, py, rgb, (hits / 9.0) * alpha)

    # -- output ------------------------------------------------------------

    def to_png(self, path: str) -> None:
        w, h, buf = self.w, self.h, self.buf
        stride = w * 3
        raw = bytearray()
        for y in range(h):
            raw.append(0)  # filter type 0 (None)
            raw += buf[y * stride : (y + 1) * stride]

        def chunk(tag: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b"")
        )
        with open(path, "wb") as f:
            f.write(png)
