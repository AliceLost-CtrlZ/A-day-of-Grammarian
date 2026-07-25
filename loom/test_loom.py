#!/usr/bin/env python3
"""Tests for Loom. Run: python test_loom.py"""

import math
import sys

from loom import Interp, LoomError, Block, tokenize

FAILURES = []


def check(name, fn):
    try:
        fn()
    except AssertionError as e:
        FAILURES.append((name, f"assertion: {e}"))
        print(f"  FAIL  {name}: {e}")
    except Exception as e:  # noqa: BLE001
        FAILURES.append((name, f"{type(e).__name__}: {e}"))
        print(f"  FAIL  {name}: {type(e).__name__}: {e}")
    else:
        print(f"  ok    {name}")


def run(src, seed=0):
    it = Interp(seed=seed)
    it.run_source(src, "<test>")
    return it


def stack(src):
    return run(src).stack


def near(a, b, eps=1e-9):
    assert abs(a - b) < eps, f"{a} != {b}"


def raises(src, fragment):
    try:
        run(src)
    except LoomError as e:
        assert fragment in str(e), f"expected {fragment!r} in {e!r}"
    else:
        raise AssertionError(f"expected an error containing {fragment!r}")


# -- lexer -----------------------------------------------------------------


def t_comments():
    assert [t.text for t in tokenize("1 # hi\n2", "x")] == ["1", "2"]
    assert [t.text for t in tokenize("1 ( a ( b ) c ) 2", "x")] == ["1", "2"]
    assert stack("1 ( nested ( comment ) here ) 2 +") == [3.0]


def t_positions():
    toks = tokenize("fd\n  rt", "f.loom")
    assert (toks[1].line, toks[1].col) == (2, 3), toks[1]


def t_unterminated_comment():
    raises("1 ( oops", "unterminated")


def t_byte_order_mark_is_ignored():
    assert stack("﻿2 3 +") == [5.0]


# -- stack & arithmetic ----------------------------------------------------


def t_arithmetic():
    assert stack("2 3 +") == [5.0]
    assert stack("2 3 -") == [-1.0]
    assert stack("10 4 /") == [2.5]
    near(stack("2 10 pow")[0], 1024.0)
    near(stack("90 sin")[0], 1.0)
    near(stack("180 cos")[0], -1.0)
    near(stack("1 1 atan2")[0], 45.0)


def t_stack_words():
    assert stack("1 2 dup") == [1.0, 2.0, 2.0]
    assert stack("1 2 swap") == [2.0, 1.0]
    assert stack("1 2 over") == [1.0, 2.0, 1.0]
    assert stack("1 2 3 rot") == [2.0, 3.0, 1.0]
    assert stack("1 2 nip") == [2.0]
    assert stack("1 2 2dup") == [1.0, 2.0, 1.0, 2.0]
    assert stack("7 8 depth") == [7.0, 8.0, 2.0]


def t_underflow():
    raises("+", "stack underflow")


def t_division_by_zero():
    raises("1 0 /", "division by zero")


def t_comparison():
    assert stack("1 2 <") == [1.0]
    assert stack("2 2 =") == [1.0]
    assert stack("1 0 and") == [0.0]
    assert stack("1 0 or") == [1.0]
    assert stack("0 not") == [1.0]


# -- control ---------------------------------------------------------------


def t_times_and_i():
    assert stack("0 4 [ i + ] times") == [6.0]
    assert stack("3 [ ] times 9") == [9.0]
    assert stack("-5 [ 1 ] times 9") == [9.0]  # negative count is a no-op


def t_nested_loop_index():
    assert stack("0 3 [ 2 [ j + ] times ] times") == [6.0]


def t_if_ifelse():
    assert stack("1 [ 42 ] if") == [42.0]
    assert stack("0 [ 42 ] if 7") == [7.0]
    assert stack("0 [ 1 ] [ 2 ] ifelse") == [2.0]


def t_while():
    assert stack("0 [ dup 5 < ] [ 1 + ] while") == [5.0]


def t_blocks_are_values():
    it = run("[ 1 2 + ]")
    assert isinstance(it.stack[0], Block)
    assert stack("[ 1 2 + ] call") == [3.0]


def t_i_outside_loop():
    raises("i", "outside of a loop")


# -- words & variables -----------------------------------------------------


def t_definition():
    assert stack(": double 2 * ; 21 double") == [42.0]


def t_recursion_with_locals():
    src = """
    : fact ( n -- n! )
      -> n
      n 1 <= [ 1 ] [ n 1 - fact n * ] ifelse ;
    6 fact
    """
    assert stack(src) == [720.0]


def t_locals_are_per_frame():
    # the inner call must not clobber the outer call's `n`
    src = """
    : f -> n  n 0 > [ n 1 - f drop ] if  n ;
    3 f
    """
    assert stack(src) == [3.0]


def t_blocks_see_enclosing_locals():
    assert stack(": g -> a [ a a + ] call ; 5 g") == [10.0]


def t_globals_visible_in_words():
    assert stack("7 -> k  : usek k 1 + ; usek") == [8.0]


def t_locals_shadow_globals():
    assert stack("7 -> k  : sh -> k k ; 100 sh k") == [100.0, 7.0]


def t_unknown_word():
    raises("wibble", "unknown word `wibble`")


def t_cannot_redefine_builtin():
    raises(": fd 1 ; ", "builtin")
    raises("1 -> dup", "builtin")


def t_unbalanced_syntax():
    raises(": f 1 ", "missing its `;`")
    raises("[ 1 2", "unterminated `[`")
    raises("1 ]", "without a matching `[`")
    raises(": a : b ; ;", "cannot be nested")


def t_recursion_guard():
    raises(": boom boom ; boom", "call depth")


# -- turtle ----------------------------------------------------------------


def t_turtle_moves_north_first():
    it = run("10 fd")
    near(it.turtle.x, 0.0, 1e-9)
    near(it.turtle.y, 10.0, 1e-9)


def t_right_turn_is_clockwise():
    it = run("90 rt 10 fd")
    near(it.turtle.x, 10.0, 1e-9)
    near(it.turtle.y, 0.0, 1e-9)


def t_square_closes():
    it = run("4 [ 10 fd 90 rt ] times")
    near(it.turtle.x, 0.0, 1e-9)
    near(it.turtle.y, 0.0, 1e-9)
    near(it.turtle.heading, 360.0)


def t_pen_up_leaves_no_ink():
    assert run("pu 10 fd").canvas.count == 0
    assert run("10 hop").canvas.count == 0
    assert run("10 fd").canvas.count == 1


def t_save_restore():
    it = run("{ 90 rt 10 fd } 5 fd")
    near(it.turtle.x, 0.0, 1e-9)
    near(it.turtle.y, 5.0, 1e-9)


def t_save_restore_keeps_style():
    it = run("3 width { 9 width } ")
    near(it.turtle.width, 3.0)


def t_unmatched_restore():
    raises("}", "without a matching `{`")


def t_polyline_chaining():
    # one style, connected path -> a single polyline of 5 points
    it = run("4 [ 10 fd 90 rt ] times")
    assert len(it.canvas.ops) == 1, it.canvas.ops
    assert len(it.canvas.ops[0][1]["pts"]) == 5


def t_style_change_breaks_the_chain():
    it = run("10 fd 200 60 60 hsl 10 fd")
    assert len(it.canvas.ops) == 2


def t_jump_breaks_the_chain():
    it = run("10 fd 50 50 jump 10 fd")
    assert len(it.canvas.ops) == 2


# -- canvas ----------------------------------------------------------------


def t_bounds():
    it = run("0 width 10 fd 90 rt 10 fd")
    x0, y0, x1, y1 = it.canvas.bounds()
    near(x0, 0.0)
    near(y0, 0.0)
    near(x1, 10.0)
    near(y1, 10.0)


def t_svg_is_wellformed():
    svg = run("4 [ 20 fd 90 rt ] times 5 dot").canvas.to_svg(size=400)
    assert svg.startswith("<svg ") and svg.rstrip().endswith("</svg>")
    assert svg.count("<") == svg.count(">")
    assert "<polyline" in svg and "<circle" in svg


def t_empty_program_still_renders():
    svg = run("").canvas.to_svg()
    assert "<svg" in svg


def t_fill():
    it = run("begin-fill 3 [ 10 fd 120 rt ] times end-fill")
    kinds = [k for k, _ in it.canvas.ops]
    assert "fill" in kinds, kinds
    assert "<polygon" in it.canvas.to_svg()


def t_fill_without_begin():
    raises("end-fill", "without `begin-fill`")


def t_hsl_to_hex():
    from loom import hsl_to_hex

    assert hsl_to_hex(0, 100, 50) == "#ff0000"
    assert hsl_to_hex(120, 100, 50) == "#00ff00"
    assert hsl_to_hex(0, 0, 100) == "#ffffff"
    assert hsl_to_hex(360, 100, 50) == "#ff0000"  # hue wraps


def t_background():
    assert 'fill="#ff0000"' in run("0 100 50 bg").canvas.to_svg()


# -- randomness ------------------------------------------------------------


def t_seed_is_deterministic():
    a = stack("42 seed 5 [ rand ] times")
    b = stack("42 seed 5 [ rand ] times")
    assert a == b
    c = stack("43 seed 5 [ rand ] times")
    assert a != c


def t_randr_in_range():
    for v in stack("1 seed 50 [ 10 20 randr ] times"):
        assert 10.0 <= v <= 20.0, v


# -- examples --------------------------------------------------------------


def t_examples_all_render():
    import os

    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")
    if not os.path.isdir(d):
        return
    for name in sorted(os.listdir(d)):
        if not name.endswith(".loom"):
            continue
        src = open(os.path.join(d, name), encoding="utf-8").read()
        it = Interp(seed=0)
        it.run_source(src, name)
        assert it.canvas.count > 0, f"{name} drew nothing"
        assert not it.stack, f"{name} left {len(it.stack)} items on the stack"
        svg = it.canvas.to_svg()
        assert svg.count("<") == svg.count(">"), f"{name} produced malformed svg"


def main():
    tests = [(k[2:], v) for k, v in sorted(globals().items()) if k.startswith("t_")]
    print(f"running {len(tests)} tests\n")
    for name, fn in tests:
        check(name, fn)
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed")
        return 1
    print(f"all {len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
