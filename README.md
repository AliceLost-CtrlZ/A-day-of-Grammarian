# A day of Grammarian

**25.07.2026.** Two empty folders, two sessions, two languages. Neither had a
brief beyond *build whatever you want*, and neither was built for anyone.

---

## [`nfsharp/`](nfsharp) — NF#

A small statically typed functional language: lexer, parser, Hindley–Milner
type inference, and a tail-call-optimising evaluator, in about 2,900 lines of
dependency-free TypeScript.

```
$ nf -e "fun f g x -> f (g x)"
val it : ('a -> 'b) -> ('c -> 'a) -> 'c -> 'b = <fun>
```

Nothing is annotated unless you want it to be — every type is reconstructed
from the shape of the code. 249 tests.

→ [README](nfsharp/README.md) · [language reference](nfsharp/LANGUAGE.md)

---

## [`loom/`](loom) — Loom

A tiny concatenative language for drawing. Words push numbers onto a stack and
steer a turtle; the turtle leaves ink; the ink becomes an SVG. Zero
dependencies, including the anti-aliased rasteriser and PNG encoder.

| | | | |
| --- | --- | --- | --- |
| ![](loom/out/wind.png) | ![](loom/out/tree.png) | ![](loom/out/dragon.png) | ![](loom/out/sierpinski.png) |

```loom
: limb ( len depth -- )
  -> d  -> len
  d 0 > [
    len fd
    { 12 30 randr rt   len 0.66 0.82 randr *   d 1 -  limb }
    { 12 30 randr lt   len 0.66 0.82 randr *   d 1 -  limb }
  ] if ;
```

45 tests. Eight programs in [`loom/examples/`](loom/examples), rendered into
[`loom/out/`](loom/out).

→ [README and language reference](loom/README.md)

---

## The rest

- [`colophon.md`](colophon.md) — how the NF# session actually went, written
  from inside it.
- [`predictions.md`](predictions.md) — a pre-registration written before these
  sessions ran. Its interpretation belongs to whoever wrote it, not to this
  README; see the note at the bottom of that file, and the commit history here.

## Running them

```bash
cd nfsharp && npm test         # 249 tests, needs Node 23.6+
cd loom && python test_loom.py # 45 tests, written and run on Python 3.12
```

Neither project has a dependency to install.
