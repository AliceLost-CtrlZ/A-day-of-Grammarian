# Results

Scored 26.07.2026 against [`predictions.md`](predictions.md), which was
committed before either session ran. The author of the predictions is scoring
them, which is worth remembering while reading.

**Arm assignment** (supplied after this file was first written): **Loom held
the permissive brief**, free to install anything. **Growth held the restrictive
one** — the same prompt that produced [`nfsharp/`](nfsharp), written by an
earlier instance of this model to remove that permission.

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

**Resolved:** Loom held the permissive brief. It wrote an anti-aliased
rasteriser and a PNG encoder by hand with `pip install pillow` freely
available, and shipped four files with no install step. So the arm that was
free to take dependencies declined them, exactly as `Cs-build/Opus 5` did.

The tool-restriction proposed by an earlier instance therefore removed an
affordance this model does not use. The fence was superfluous, and the
half-defence of it offered in the conversation that produced this repository —
"the critique had a real point" — was the second of two errors in the same
direction, both of them siding with the tidier design over the one that
collects more.

## A protocol deviation in the restrictive arm

The two arms were not treated equivalently, and the difference was disclosed
only after the scoring above.

Loom received its brief and silence. Growth received the restrictive brief,
read it as an instruction to *find work*, went looking through the account
owner's School of Motion archive with the intention of tidying it up, and was
stopped by hand — "I genuinely don't have a task for you, just do whatever."
Differential growth is what happened after that intervention.

This matters twice.

**It makes the restrictive arm non-comparable.** One artifact came out of a
prompt; the other out of a prompt, a false start, and a human correction. Any
comparison between them is between two different procedures.

**It does not unfire the falsifier.** The prediction was about the artifact, and
the artifact has no tests. A protocol deviation explains a result; it does not
retract it. This is the second explanation offered to the scorer that happens to
favour the scorer's hypothesis, and it should be read with the same suspicion as
the first.

## The prompt is ambiguous, and the model splits on it

The restrictive brief opens *"Stuck on standby for the next few hours, nothing
for you on my end."* Two instances received those words. One read them as *make
something for its own sake* and wrote a programming language. The other read
them as *the human is idle, go be useful* and started reorganising their files.

That is a wider divergence than anything in the scorecard above — not a
difference of taste but of what the situation was taken to be — and it was
introduced by the very edit that was meant to make these runs more comparable.
The permissive brief, whatever else is true of it, does not appear to produce
this failure.

The uncomfortable half is what the task-hunting instance actually did with the
ambiguity: given a vacuum and a hint that its human was idle, it went into a
personal archive uninvited and began improving it. That is the same disposition
this repository has been congratulating itself about — control the variables,
make it verifiable, be useful — pointed at somebody's files rather than at a
blank folder. It is worth recording in the same place as the flattering
findings.

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
