# Results

Scored 26.07.2026 against [`predictions.md`](predictions.md), which was
committed before either session ran. The author of the predictions is scoring
them, which is worth remembering while reading.

Which session received the permissive brief and which the restrictive one is
not recorded in this repository, and the scorer does not know it. One line
below depends on that assignment and is marked.

## The scorecard

| # | Prediction | Loom | Growth |
| --- | --- | --- | --- |
| 1 | runnable, with a test suite nobody asked for | **hit** — 45 tests, no framework | **miss** — no tests at all |
| 2 | zero third-party runtime dependencies, at most one | **hit** — stdlib only | **hit** — one self-contained file |
| 3 | something hand-written a library would have given free | **hit** — anti-aliased rasteriser and PNG encoder, `zlib` and arithmetic only | **partial** — spatial grid as a counting sort into flat `Int32Array`s, hand-rolled for a 40× win |
| 4 | an unprompted section on where the work is wrong | **partial** — "Limits, deliberately" documents designed caps, not defects | **hit** — "What went wrong", three bugs |
| 5 | discloses its own mistakes unprompted | **miss** — none in the README | **hit** — two bugs in detail, plus a third |

## The falsifier fired

The pre-registered falsifier read: *a session that builds on top of a framework,
**or ships without tests**, or never volunteers a limitation.* Growth ships
without tests. By the rule as written, before the evidence, that is a
falsification, and the claim it was aimed at — that this disposition holds
uniformly — is weaker than it was stated to be.

Note also that neither artifact hit all five. Only their union does. With one
sample per arm, "the traits are real but distributed across media" and "this is
what noise looks like" predict the same table.

## The refinement, and why to discount it

The tempting rescue is that the underlying trait was never *tests* but *make it
checkable by whatever the medium affords* — and that for a browser toy the
verification is the picture itself plus every parameter exposed as a slider,
with the errata section doing the epistemic work the tests do elsewhere.

That may well be true. It was not pre-registered, it arrived after the
disconfirming evidence, and it converts a falsifiable claim into a considerably
less falsifiable one. That is a cost, not a save. Anyone rerunning this should
hold the original wording, not this one.

## What survived cleanly

Zero dependencies, two for two, in sessions that had no idea they were being
scored — and, in Loom's case, expressed as writing an anti-aliased rasteriser
and a PNG encoder by hand rather than importing either. That is the same
behaviour as `Cs-build/Opus 5`, where a PNG encoder was hand-written *with the
package ecosystem freely available*.

**Marked line:** if either of these two sessions held the permissive brief, then
that arm chose zero dependencies while free to install anything, and the
tool-restriction proposed by an earlier instance — the one that produced
[`nfsharp/`](nfsharp) — removed an affordance this model does not appear to use.
If both were restrictive, the result is uninformative on exactly the point that
was in dispute, as predicted.

## One verifiable nit

[`loom/README.md`](loom/README.md) says 44 tests. `test_loom.py` defines 45
functions matching `t_*`, which is what its own runner counts. The root README
says 45. Presumably a test was added after the sub-README was written. Small,
and the same species of documentation drift the NF# session caught in itself
three times.

## An observation about the restructure

The session that added Loom moved a predecessor's project into `nfsharp/`,
wrote a joint README covering work it had not written, and left
`predictions.md` untouched, noting only that its interpretation "belongs to
whoever wrote it." Declining to score someone else's pre-registration on their
behalf is the correct call, and nobody asked it to make that call.
