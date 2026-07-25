#!/usr/bin/env python3
"""
Loom - a tiny concatenative language for drawing.

A Loom program is a sequence of whitespace-separated words that push values
onto a stack and steer a turtle across a plane. The turtle leaves ink; the ink
becomes an SVG.

    python loom.py run examples/tree.loom -o out/tree.svg
    python loom.py gallery
    python loom.py repl

See README.md for the language reference.
"""

from __future__ import annotations

import argparse
import colorsys
import math
import os
import random
import sys
from dataclasses import dataclass, replace
from typing import Any, Callable

sys.setrecursionlimit(20000)

MAX_CALL_DEPTH = 1200
MAX_STEPS = 40_000_000
MAX_PRIMITIVES = 600_000


# --------------------------------------------------------------------------
# errors
# --------------------------------------------------------------------------


class LoomError(Exception):
    def __init__(self, message: str, token: "Token | None" = None):
        self.message = message
        self.token = token
        super().__init__(message)

    def __str__(self) -> str:
        if self.token is None:
            return self.message
        t = self.token
        return f"{t.file}:{t.line}:{t.col}: {self.message}  (at `{t.text}`)"


# --------------------------------------------------------------------------
# lexer
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Token:
    text: str
    line: int
    col: int
    file: str


def tokenize(src: str, filename: str = "<input>") -> list[Token]:
    toks: list[Token] = []
    i, line, col, n = 0, 1, 1, len(src)
    while i < n:
        c = src[i]
        if c == "\n":
            i, line, col = i + 1, line + 1, 1
            continue
        if c.isspace() or c == "﻿":  # editors on Windows love a BOM
            i, col = i + 1, col + 1
            continue
        if c == "#":  # line comment
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "(":  # nestable block comment
            open_tok = Token("(", line, col, filename)
            depth = 1
            i, col = i + 1, col + 1
            while i < n and depth:
                ch = src[i]
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                elif ch == "\n":
                    line, col = line + 1, 0
                i, col = i + 1, col + 1
            if depth:
                raise LoomError("unterminated `(` comment", open_tok)
            continue
        start, sline, scol = i, line, col
        while i < n and not src[i].isspace():
            i, col = i + 1, col + 1
        toks.append(Token(src[start:i], sline, scol, filename))
    return toks


# --------------------------------------------------------------------------
# terms
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Num:
    value: float


@dataclass(frozen=True)
class Block:
    """A quotation: an unevaluated list of terms, first-class on the stack."""

    terms: tuple

    def __repr__(self) -> str:
        return f"[block:{len(self.terms)}]"


@dataclass(frozen=True)
class PushBlock:
    block: Block


@dataclass(frozen=True)
class Ref:
    name: str
    token: Token


@dataclass(frozen=True)
class Store:
    """`-> name` stores into the current frame; `=> name` into the global one."""

    name: str
    token: Token
    glob: bool = False


def parse_number(text: str) -> float | None:
    try:
        return float(text)
    except ValueError:
        return None


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------


class Parser:
    def __init__(self, tokens: list[Token], builtins: set[str]):
        self.toks = tokens
        self.pos = 0
        self.builtins = builtins
        self.defs: dict[str, Block] = {}

    def peek(self) -> Token | None:
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def next(self) -> Token | None:
        t = self.peek()
        if t is not None:
            self.pos += 1
        return t

    def parse_program(self) -> tuple[list, dict[str, Block]]:
        terms: list = []
        while (t := self.peek()) is not None:
            if t.text == ":":
                self.parse_definition()
            elif t.text == ";":
                raise LoomError("`;` without a matching `:`", self.next())
            elif t.text == "]":
                raise LoomError("`]` without a matching `[`", self.next())
            else:
                terms.append(self.parse_term())
        return terms, self.defs

    def parse_definition(self) -> None:
        colon = self.next()
        name_tok = self.next()
        if name_tok is None:
            raise LoomError("`:` at end of file, expected a word name", colon)
        name = name_tok.text
        if name in (":", ";", "[", "]", "->", "=>"):
            raise LoomError(f"`{name}` is not a usable word name", name_tok)
        if parse_number(name) is not None:
            raise LoomError(f"`{name}` is a number, not a word name", name_tok)
        if name in self.builtins:
            raise LoomError(f"`{name}` is a builtin and cannot be redefined", name_tok)
        body: list = []
        while True:
            t = self.peek()
            if t is None:
                raise LoomError(f"definition of `{name}` is missing its `;`", colon)
            if t.text == ";":
                self.next()
                break
            if t.text == ":":
                raise LoomError("definitions cannot be nested", t)
            body.append(self.parse_term())
        self.defs[name] = Block(tuple(body))

    def parse_term(self):
        t = self.next()
        assert t is not None
        if t.text == "[":
            return PushBlock(self.parse_block(t))
        if t.text == "]":
            raise LoomError("`]` without a matching `[`", t)
        if t.text == ";":
            raise LoomError("`;` without a matching `:`", t)
        if t.text in ("->", "=>"):
            name_tok = self.next()
            if name_tok is None:
                raise LoomError(
                    f"`{t.text}` at end of file, expected a variable name", t
                )
            if parse_number(name_tok.text) is not None:
                raise LoomError("cannot store into a number", name_tok)
            if name_tok.text in self.builtins:
                raise LoomError(
                    f"`{name_tok.text}` is a builtin and cannot be used as a variable",
                    name_tok,
                )
            return Store(name_tok.text, name_tok, glob=(t.text == "=>"))
        v = parse_number(t.text)
        if v is not None:
            return Num(v)
        return Ref(t.text, t)

    def parse_block(self, opener: Token) -> Block:
        body: list = []
        while True:
            t = self.peek()
            if t is None:
                raise LoomError("unterminated `[` block", opener)
            if t.text == "]":
                self.next()
                return Block(tuple(body))
            if t.text == ":":
                raise LoomError("definitions cannot appear inside a block", t)
            body.append(self.parse_term())


# --------------------------------------------------------------------------
# canvas
# --------------------------------------------------------------------------


def hsl_to_hex(h: float, s: float, ll: float) -> str:
    h = (h % 360.0) / 360.0
    s = min(max(s, 0.0), 100.0) / 100.0
    ll = min(max(ll, 0.0), 100.0) / 100.0
    r, g, b = colorsys.hls_to_rgb(h, ll, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def fmt(x: float) -> str:
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


class Canvas:
    """Accumulates drawing primitives in z-order, then emits SVG.

    Consecutive segments that share a style and meet end-to-start are merged
    into a single polyline, which keeps the output small and readable.
    """

    def __init__(self) -> None:
        self.ops: list = []
        self.background = "#101014"
        self.count = 0

    def _bump(self, token: Token | None) -> None:
        self.count += 1
        if self.count > MAX_PRIMITIVES:
            raise LoomError(
                f"drawing exceeded {MAX_PRIMITIVES} primitives - runaway recursion?",
                token,
            )

    def segment(self, p0, p1, style, token=None) -> None:
        if p0 == p1:
            return
        self._bump(token)
        if self.ops:
            kind, data = self.ops[-1]
            if kind == "poly" and data["style"] == style:
                pts = data["pts"]
                if abs(pts[-1][0] - p0[0]) < 1e-9 and abs(pts[-1][1] - p0[1]) < 1e-9:
                    pts.append(p1)
                    return
        self.ops.append(("poly", {"pts": [p0, p1], "style": style}))

    def dot(self, x, y, r, style, token=None) -> None:
        if r <= 0:
            return
        self._bump(token)
        self.ops.append(("dot", {"x": x, "y": y, "r": r, "style": style}))

    def fill(self, pts, style, token=None) -> None:
        if len(pts) < 3:
            return
        self._bump(token)
        self.ops.append(("fill", {"pts": list(pts), "style": style}))

    def bounds(self):
        xs_lo = ys_lo = math.inf
        xs_hi = ys_hi = -math.inf
        for kind, d in self.ops:
            if kind == "poly":
                pad = d["style"][1] / 2
                for x, y in d["pts"]:
                    xs_lo, xs_hi = min(xs_lo, x - pad), max(xs_hi, x + pad)
                    ys_lo, ys_hi = min(ys_lo, y - pad), max(ys_hi, y + pad)
            elif kind == "dot":
                r = d["r"]
                xs_lo, xs_hi = min(xs_lo, d["x"] - r), max(xs_hi, d["x"] + r)
                ys_lo, ys_hi = min(ys_lo, d["y"] - r), max(ys_hi, d["y"] + r)
            else:
                for x, y in d["pts"]:
                    xs_lo, xs_hi = min(xs_lo, x), max(xs_hi, x)
                    ys_lo, ys_hi = min(ys_lo, y), max(ys_hi, y)
        if xs_lo is math.inf:
            return (-1.0, -1.0, 1.0, 1.0)
        return (xs_lo, ys_lo, xs_hi, ys_hi)

    def layout(self, size: int, margin: float = 0.03):
        """Fit the drawing to a `size`-px square, with a little air around it.

        World y grows upward, raster y grows downward, so the mapping flips
        once here and nowhere else:  dev = ((x - left) * s, (top - y) * s).
        """
        x0, y0, x1, y1 = self.bounds()
        w, h = max(x1 - x0, 1e-6), max(y1 - y0, 1e-6)
        pad = max(w, h) * margin
        left, top = x0 - pad, y1 + pad
        w, h = w + 2 * pad, h + 2 * pad
        scale = size / max(w, h)
        return left, top, w, h, scale, max(1, round(w * scale)), max(1, round(h * scale))

    def to_svg(self, size: int = 1000, margin: float = 0.03) -> str:
        left, top, w, h, _scale, px_w, px_h = self.layout(size, margin)

        def P(p):
            return f"{fmt(p[0] - left)},{fmt(top - p[1])}"

        out = [
            '<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{px_w}" height="{px_h}" viewBox="0 0 {fmt(w)} {fmt(h)}">',
            f'<rect width="100%" height="100%" fill="{self.background}"/>',
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
        ]
        for kind, d in self.ops:
            if kind == "poly":
                color, width, alpha = d["style"]
                pts = " ".join(P(p) for p in d["pts"])
                a = "" if alpha >= 1 else f' stroke-opacity="{fmt(alpha)}"'
                out.append(
                    f'<polyline points="{pts}" stroke="{color}" '
                    f'stroke-width="{fmt(width)}"{a}/>'
                )
            elif kind == "dot":
                color, alpha = d["style"]
                a = "" if alpha >= 1 else f' fill-opacity="{fmt(alpha)}"'
                cx, cy = P((d["x"], d["y"])).split(",")
                out.append(
                    f'<circle cx="{cx}" cy="{cy}" r="{fmt(d["r"])}" '
                    f'fill="{color}"{a}/>'
                )
            else:
                color, alpha = d["style"]
                a = "" if alpha >= 1 else f' fill-opacity="{fmt(alpha)}"'
                pts = " ".join(P(p) for p in d["pts"])
                out.append(f'<polygon points="{pts}" fill="{color}"{a}/>')
        out.append("</g>")
        out.append("</svg>")
        return "\n".join(out)

    def to_png(self, path: str, size: int = 1000, margin: float = 0.03) -> None:
        from raster import Raster, hex_to_rgb

        left, top, _w, _h, scale, px_w, px_h = self.layout(size, margin)
        img = Raster(px_w, px_h, self.background)

        def P(p):
            return ((p[0] - left) * scale, (top - p[1]) * scale)

        for kind, d in self.ops:
            if kind == "poly":
                color, width, alpha = d["style"]
                rgb = hex_to_rgb(color)
                pts = [P(p) for p in d["pts"]]
                wpx = width * scale
                for a, b in zip(pts, pts[1:]):
                    img.stroke(a[0], a[1], b[0], b[1], rgb, wpx, alpha)
            elif kind == "dot":
                color, alpha = d["style"]
                x, y = P((d["x"], d["y"]))
                img.disc(x, y, d["r"] * scale, hex_to_rgb(color), alpha)
            else:
                color, alpha = d["style"]
                img.polygon([P(p) for p in d["pts"]], hex_to_rgb(color), alpha)
        img.to_png(path)


# --------------------------------------------------------------------------
# turtle
# --------------------------------------------------------------------------


@dataclass
class Turtle:
    x: float = 0.0
    y: float = 0.0
    heading: float = 0.0  # degrees, 0 = north, clockwise positive
    pen: bool = True
    hue: float = 200.0
    sat: float = 20.0
    light: float = 92.0
    width: float = 1.0
    alpha: float = 1.0

    @property
    def stroke(self):
        return (hsl_to_hex(self.hue, self.sat, self.light), self.width, self.alpha)

    @property
    def paint(self):
        return (hsl_to_hex(self.hue, self.sat, self.light), self.alpha)


# --------------------------------------------------------------------------
# interpreter
# --------------------------------------------------------------------------


class Interp:
    def __init__(self, seed: int = 0):
        self.stack: list[Any] = []
        self.canvas = Canvas()
        self.turtle = Turtle()
        self.turtle_stack: list[Turtle] = []
        self.loops: list[int] = []
        self.frames: list[dict[str, Any]] = [{}]  # frames[0] is global
        self.defs: dict[str, Block] = {}
        self.rng = random.Random(seed)
        self.fill_pts: list | None = None
        self.depth = 0
        self.steps = 0
        self.out = sys.stderr
        self.builtins: dict[str, Callable] = {}
        self._install_builtins()

    # ---- stack helpers ---------------------------------------------------

    def push(self, v) -> None:
        self.stack.append(v)

    def pop(self, tok=None):
        if not self.stack:
            raise LoomError("stack underflow", tok)
        return self.stack.pop()

    def popn(self, tok=None) -> float:
        v = self.pop(tok)
        if isinstance(v, Block):
            raise LoomError("expected a number, found a block", tok)
        return v

    def popb(self, tok=None) -> Block:
        v = self.pop(tok)
        if not isinstance(v, Block):
            raise LoomError(f"expected a block, found the number {fmt(v)}", tok)
        return v

    # ---- evaluation ------------------------------------------------------

    def run_source(self, src: str, filename: str = "<input>") -> None:
        toks = tokenize(src, filename)
        parser = Parser(toks, set(self.builtins))
        terms, defs = parser.parse_program()
        self.defs.update(defs)
        self.exec_terms(terms)

    def exec_terms(self, terms) -> None:
        for term in terms:
            self.steps += 1
            if self.steps > MAX_STEPS:
                raise LoomError("program exceeded the step limit (infinite loop?)")
            k = term.__class__
            if k is Num:
                self.stack.append(term.value)
            elif k is PushBlock:
                self.stack.append(term.block)
            elif k is Store:
                target = self.frames[0] if term.glob else self.frames[-1]
                target[term.name] = self.pop(term.token)
            else:  # Ref
                self.resolve(term)

    def resolve(self, ref: Ref) -> None:
        name = ref.name
        frame = self.frames[-1]
        if name in frame:
            self.stack.append(frame[name])
            return
        if len(self.frames) > 1 and name in self.frames[0]:
            self.stack.append(self.frames[0][name])
            return
        body = self.defs.get(name)
        if body is not None:
            self.invoke(body, ref.token)
            return
        fn = self.builtins.get(name)
        if fn is not None:
            fn(ref.token)
            return
        raise LoomError(f"unknown word `{name}`", ref.token)

    def invoke(self, body: Block, token: Token | None) -> None:
        if self.depth >= MAX_CALL_DEPTH:
            raise LoomError(
                f"call depth exceeded {MAX_CALL_DEPTH} - runaway recursion?", token
            )
        self.depth += 1
        self.frames.append({})
        try:
            self.exec_terms(body.terms)
        finally:
            self.frames.pop()
            self.depth -= 1

    def call_block(self, block: Block, token: Token | None) -> None:
        """Blocks run in the caller's frame - so `[ ... ]` sees local names."""
        if self.depth >= MAX_CALL_DEPTH:
            raise LoomError(
                f"call depth exceeded {MAX_CALL_DEPTH} - runaway recursion?", token
            )
        self.depth += 1
        try:
            self.exec_terms(block.terms)
        finally:
            self.depth -= 1

    # ---- turtle motion ---------------------------------------------------

    def move(self, dist: float, draw: bool, tok) -> None:
        t = self.turtle
        rad = math.radians(t.heading)
        nx = t.x + math.sin(rad) * dist
        ny = t.y + math.cos(rad) * dist
        if draw and t.pen:
            self.canvas.segment((t.x, t.y), (nx, ny), t.stroke, tok)
        if self.fill_pts is not None:
            self.fill_pts.append((nx, ny))
        t.x, t.y = nx, ny

    def teleport(self, nx: float, ny: float, draw: bool, tok) -> None:
        t = self.turtle
        if draw and t.pen:
            self.canvas.segment((t.x, t.y), (nx, ny), t.stroke, tok)
        if self.fill_pts is not None:
            self.fill_pts.append((nx, ny))
        t.x, t.y = nx, ny

    # ---- builtins --------------------------------------------------------

    def _install_builtins(self) -> None:
        B = self.builtins

        def w(name):
            def deco(fn):
                B[name] = fn
                return fn

            return deco

        # -- stack ---------------------------------------------------------
        @w("dup")
        def _(t):
            v = self.pop(t)
            self.push(v)
            self.push(v)

        @w("drop")
        def _(t):
            self.pop(t)

        @w("swap")
        def _(t):
            b, a = self.pop(t), self.pop(t)
            self.push(b)
            self.push(a)

        @w("over")
        def _(t):
            b, a = self.pop(t), self.pop(t)
            self.push(a)
            self.push(b)
            self.push(a)

        @w("nip")
        def _(t):
            b, _a = self.pop(t), self.pop(t)
            self.push(b)

        @w("rot")
        def _(t):
            c, b, a = self.pop(t), self.pop(t), self.pop(t)
            self.push(b)
            self.push(c)
            self.push(a)

        @w("2dup")
        def _(t):
            b, a = self.pop(t), self.pop(t)
            self.push(a)
            self.push(b)
            self.push(a)
            self.push(b)

        @w("depth")
        def _(t):
            self.push(float(len(self.stack)))

        @w("clear")
        def _(t):
            self.stack.clear()

        # -- arithmetic ----------------------------------------------------
        def binop(name, fn):
            def op(t):
                b, a = self.popn(t), self.popn(t)
                try:
                    self.push(float(fn(a, b)))
                except ZeroDivisionError:
                    raise LoomError(f"division by zero in `{name}`", t) from None
                except (ValueError, OverflowError) as e:
                    raise LoomError(f"`{name}`: {e}", t) from None

            B[name] = op

        binop("+", lambda a, b: a + b)
        binop("-", lambda a, b: a - b)
        binop("*", lambda a, b: a * b)
        binop("/", lambda a, b: a / b)
        binop("mod", lambda a, b: math.fmod(a, b))
        binop("pow", lambda a, b: a**b)
        binop("min", min)
        binop("max", max)
        binop("atan2", lambda a, b: math.degrees(math.atan2(a, b)))
        binop("hypot", math.hypot)

        def unop(name, fn):
            def op(t):
                a = self.popn(t)
                try:
                    self.push(float(fn(a)))
                except (ValueError, OverflowError) as e:
                    raise LoomError(f"`{name}`: {e}", t) from None

            B[name] = op

        unop("neg", lambda a: -a)
        unop("abs", abs)
        unop("sqrt", math.sqrt)
        unop("floor", math.floor)
        unop("ceil", math.ceil)
        unop("round", lambda a: round(a))
        unop("sin", lambda a: math.sin(math.radians(a)))
        unop("cos", lambda a: math.cos(math.radians(a)))
        unop("tan", lambda a: math.tan(math.radians(a)))
        unop("ln", math.log)
        unop("exp", math.exp)

        def const(name, value):
            B[name] = lambda t, v=value: self.push(v)

        const("pi", math.pi)
        const("tau", math.tau)
        const("phi", (1 + math.sqrt(5)) / 2)
        const("true", 1.0)
        const("false", 0.0)

        # -- comparison / logic --------------------------------------------
        def cmp(name, fn):
            def op(t):
                b, a = self.popn(t), self.popn(t)
                self.push(1.0 if fn(a, b) else 0.0)

            B[name] = op

        cmp("<", lambda a, b: a < b)
        cmp(">", lambda a, b: a > b)
        cmp("<=", lambda a, b: a <= b)
        cmp(">=", lambda a, b: a >= b)
        cmp("=", lambda a, b: a == b)
        cmp("<>", lambda a, b: a != b)
        cmp("and", lambda a, b: a != 0 and b != 0)
        cmp("or", lambda a, b: a != 0 or b != 0)

        @w("not")
        def _(t):
            self.push(1.0 if self.popn(t) == 0 else 0.0)

        # -- control -------------------------------------------------------
        @w("call")
        def _(t):
            self.call_block(self.popb(t), t)

        @w("if")
        def _(t):
            body = self.popb(t)
            if self.popn(t) != 0:
                self.call_block(body, t)

        @w("ifelse")
        def _(t):
            other, body = self.popb(t), self.popb(t)
            cond = self.popn(t)
            self.call_block(body if cond != 0 else other, t)

        @w("times")
        def _(t):
            body = self.popb(t)
            n = int(self.popn(t))
            self.loops.append(0)
            try:
                for k in range(max(0, n)):
                    self.loops[-1] = k
                    self.call_block(body, t)
            finally:
                self.loops.pop()

        @w("while")
        def _(t):
            body, cond = self.popb(t), self.popb(t)
            guard = 0
            while True:
                self.call_block(cond, t)
                if self.popn(t) == 0:
                    break
                self.call_block(body, t)
                guard += 1
                if guard > 5_000_000:
                    raise LoomError("`while` ran away", t)

        @w("i")
        def _(t):
            if not self.loops:
                raise LoomError("`i` used outside of a loop", t)
            self.push(float(self.loops[-1]))

        @w("j")
        def _(t):
            if len(self.loops) < 2:
                raise LoomError("`j` needs two enclosing loops", t)
            self.push(float(self.loops[-2]))

        # -- turtle --------------------------------------------------------
        @w("fd")
        def _(t):
            self.move(self.popn(t), True, t)

        @w("bk")
        def _(t):
            self.move(-self.popn(t), True, t)

        @w("hop")
        def _(t):
            self.move(self.popn(t), False, t)

        @w("rt")
        def _(t):
            self.turtle.heading += self.popn(t)

        @w("lt")
        def _(t):
            self.turtle.heading -= self.popn(t)

        @w("face")
        def _(t):
            self.turtle.heading = self.popn(t)

        @w("heading")
        def _(t):
            self.push(self.turtle.heading)

        @w("goto")
        def _(t):
            y, x = self.popn(t), self.popn(t)
            self.teleport(x, y, True, t)

        @w("jump")
        def _(t):
            y, x = self.popn(t), self.popn(t)
            self.teleport(x, y, False, t)

        @w("home")
        def _(t):
            self.teleport(0.0, 0.0, False, t)
            self.turtle.heading = 0.0

        @w("xy")
        def _(t):
            self.push(self.turtle.x)
            self.push(self.turtle.y)

        @w("pu")
        def _(t):
            self.turtle.pen = False

        @w("pd")
        def _(t):
            self.turtle.pen = True

        @w("{")
        def _(t):
            self.turtle_stack.append(replace(self.turtle))

        @w("}")
        def _(t):
            if not self.turtle_stack:
                raise LoomError("`}` without a matching `{`", t)
            self.turtle = self.turtle_stack.pop()

        # -- style ---------------------------------------------------------
        @w("hsl")
        def _(t):
            ll, s, h = self.popn(t), self.popn(t), self.popn(t)
            self.turtle.hue, self.turtle.sat, self.turtle.light = h, s, ll

        @w("hue")
        def _(t):
            self.turtle.hue = self.popn(t)

        @w("sat")
        def _(t):
            self.turtle.sat = self.popn(t)

        @w("light")
        def _(t):
            self.turtle.light = self.popn(t)

        @w("alpha")
        def _(t):
            self.turtle.alpha = min(max(self.popn(t), 0.0), 1.0)

        @w("width")
        def _(t):
            self.turtle.width = max(self.popn(t), 0.0)

        @w("bg")
        def _(t):
            ll, s, h = self.popn(t), self.popn(t), self.popn(t)
            self.canvas.background = hsl_to_hex(h, s, ll)

        # -- marks ---------------------------------------------------------
        @w("dot")
        def _(t):
            r = self.popn(t)
            self.canvas.dot(self.turtle.x, self.turtle.y, r, self.turtle.paint, t)

        @w("begin-fill")
        def _(t):
            self.fill_pts = [(self.turtle.x, self.turtle.y)]

        @w("end-fill")
        def _(t):
            if self.fill_pts is None:
                raise LoomError("`end-fill` without `begin-fill`", t)
            pts, self.fill_pts = self.fill_pts, None
            self.canvas.fill(pts, self.turtle.paint, t)

        # -- randomness ----------------------------------------------------
        @w("seed")
        def _(t):
            self.rng.seed(int(self.popn(t)))

        @w("rand")
        def _(t):
            self.push(self.rng.random())

        @w("randr")
        def _(t):
            hi, lo = self.popn(t), self.popn(t)
            self.push(self.rng.uniform(lo, hi))

        @w("chance")
        def _(t):
            self.push(1.0 if self.rng.random() < self.popn(t) else 0.0)

        # -- debugging -----------------------------------------------------
        @w(".")
        def _(t):
            print(fmt(self.popn(t)), file=self.out)

        @w(".s")
        def _(t):
            items = " ".join(
                repr(v) if isinstance(v, Block) else fmt(v) for v in self.stack
            )
            print(f"<{len(self.stack)}> {items}", file=self.out)


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------


def render(src: str, filename: str, size: int, seed: int) -> tuple[str, Interp]:
    interp = Interp(seed=seed)
    interp.run_source(src, filename)
    return interp.canvas.to_svg(size=size), interp


def cmd_run(args) -> int:
    path = args.file
    try:
        src = open(path, encoding="utf-8-sig").read()
    except OSError as e:
        print(f"loom: {e}", file=sys.stderr)
        return 1
    try:
        interp = Interp(seed=args.seed)
        interp.run_source(src, path)
    except LoomError as e:
        print(f"loom: {e}", file=sys.stderr)
        return 1
    out = args.output or os.path.splitext(os.path.basename(path))[0] + ".svg"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    if out.lower().endswith(".png"):
        interp.canvas.to_png(out, size=args.size)
    else:
        with open(out, "w", encoding="utf-8") as f:
            f.write(interp.canvas.to_svg(size=args.size))
    print(
        f"{out}  ({interp.canvas.count} primitives, {interp.steps} steps)",
        file=sys.stderr,
    )
    return 0


INDEX_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0c0c10; color: #d7d7e0;
  font: 15px/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
header { padding: 4rem 2rem 1rem; max-width: 62rem; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .4rem; letter-spacing: .18em;
  text-transform: uppercase; color: #f2f2f7; font-weight: 500; }
header p { margin: 0; color: #7d7d92; max-width: 40rem; }
main { display: grid; gap: 2rem; padding: 2rem; max-width: 62rem; margin: 0 auto;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); }
figure { margin: 0; border: 1px solid #22222c; border-radius: 6px;
  overflow: hidden; background: #0f0f14; }
figure img { display: block; width: 100%; height: auto; }
figcaption { padding: .9rem 1.1rem 1.1rem; border-top: 1px solid #22222c; }
.name { color: #f2f2f7; letter-spacing: .06em; }
.note { color: #7d7d92; font-size: .82rem; margin-top: .35rem;
  white-space: pre-wrap; }
.stat { color: #4d4d5e; font-size: .75rem; margin-top: .6rem; }
footer { color: #4d4d5e; text-align: center; padding: 2rem 2rem 4rem;
  font-size: .8rem; }
"""


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def leading_comment(src: str) -> str:
    """The `#` header at the top of a program, minus its filename line."""
    lines = []
    for raw in src.splitlines():
        line = raw.strip()
        if not line.startswith("#"):
            break
        lines.append(line.lstrip("#").strip())
    while lines and (not lines[0] or lines[0].endswith(".loom")):
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def write_index(out_dir: str, entries: list[dict]) -> str:
    cards = []
    for e in entries:
        cards.append(
            "<figure>"
            f'<img src="{esc(e["svg"])}" alt="{esc(e["name"])}" loading="lazy">'
            "<figcaption>"
            f'<div class="name">{esc(e["name"])}</div>'
            f'<div class="note">{esc(e["note"])}</div>'
            f'<div class="stat">{e["count"]:,} primitives</div>'
            "</figcaption></figure>"
        )
    html = (
        "<!doctype html>\n<html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Loom</title><style>" + INDEX_CSS + "</style></head><body>"
        "<header><h1>Loom</h1><p>A tiny concatenative language for drawing. "
        "Every picture below is a text file of stack words steering a turtle. "
        "Sources live in <code>examples/</code>.</p></header>"
        "<main>" + "".join(cards) + "</main>"
        "<footer>rendered by loom.py</footer></body></html>"
    )
    path = os.path.join(out_dir, "index.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


def cmd_gallery(args) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    src_dir = args.dir or os.path.join(here, "examples")
    out_dir = args.output or os.path.join(here, "out")
    os.makedirs(out_dir, exist_ok=True)
    names = sorted(n for n in os.listdir(src_dir) if n.endswith(".loom"))
    if not names:
        print(f"loom: no .loom files in {src_dir}", file=sys.stderr)
        return 1
    failures = 0
    entries: list[dict] = []
    for name in names:
        path = os.path.join(src_dir, name)
        src = open(path, encoding="utf-8-sig").read()
        try:
            svg, interp = render(src, path, args.size, args.seed)
        except LoomError as e:
            print(f"  {name:<18} FAILED  {e}", file=sys.stderr)
            failures += 1
            continue
        stem = os.path.splitext(name)[0]
        with open(os.path.join(out_dir, stem + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        if args.png:
            interp.canvas.to_png(os.path.join(out_dir, stem + ".png"), size=args.size)
        entries.append(
            {
                "name": name,
                "svg": stem + ".svg",
                "note": leading_comment(src),
                "count": interp.canvas.count,
            }
        )
        kb = len(svg) / 1024
        print(
            f"  {name:<18} {interp.canvas.count:>7} primitives  {kb:>7.1f} KB",
            file=sys.stderr,
        )
    if entries:
        print(f"\n  {write_index(out_dir, entries)}", file=sys.stderr)
    return 1 if failures else 0


def cmd_repl(args) -> int:
    interp = Interp(seed=args.seed)
    interp.out = sys.stdout
    print("loom repl - `.s` shows the stack, `save FILE` writes the drawing, ^D quits")
    buf = ""
    while True:
        try:
            line = input("... " if buf else "loom> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        stripped = line.strip()
        if stripped.startswith("save "):
            out = stripped[5:].strip()
            with open(out, "w", encoding="utf-8") as f:
                f.write(interp.canvas.to_svg(size=args.size))
            print(f"wrote {out}")
            continue
        buf += line + "\n"
        # keep reading while a definition or block is still open
        if buf.count("[") > buf.count("]") or (
            buf.rstrip().split() and _unclosed_def(buf)
        ):
            continue
        try:
            interp.run_source(buf, "<repl>")
        except LoomError as e:
            print(f"error: {e}", file=sys.stderr)
        buf = ""
    return 0


def _unclosed_def(src: str) -> bool:
    toks = [t.text for t in tokenize(src, "<repl>")]
    return toks.count(":") > toks.count(";")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="loom", description=__doc__.strip().splitlines()[1])
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="render one .loom file to SVG")
    r.add_argument("file")
    r.add_argument("-o", "--output")
    r.add_argument("--size", type=int, default=1000)
    r.add_argument("--seed", type=int, default=0)
    r.set_defaults(func=cmd_run)

    g = sub.add_parser("gallery", help="render every example")
    g.add_argument("-d", "--dir")
    g.add_argument("-o", "--output")
    g.add_argument("--size", type=int, default=1000)
    g.add_argument("--seed", type=int, default=0)
    g.add_argument("--png", action="store_true", help="also rasterise to PNG")
    g.set_defaults(func=cmd_gallery)

    q = sub.add_parser("repl", help="interactive session")
    q.add_argument("--size", type=int, default=1000)
    q.add_argument("--seed", type=int, default=0)
    q.set_defaults(func=cmd_repl)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
