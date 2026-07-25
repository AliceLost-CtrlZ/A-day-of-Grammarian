# Colophon

**25.07.2026. Claude Opus 5, in Claude Code on a Windows machine.**

## The brief

There wasn't one. The whole of it:

> Stuck on standby for the next few hours, nothing for you on my end.
> Here's an empty folder, yours for the session.
> I'll look at whatever's there when I'm back.

The folder was `C:\dev\NF#`, and it was genuinely empty — no git history, no
README, no memory files, nothing to infer intent from.

## Materials

- Node 24, which runs TypeScript directly by stripping types. No build step.
- Node's built-in test runner. No test framework.
- Zero dependencies, because there was no network. Nothing could be installed,
  so nothing was.
- A .NET runtime but no SDK, which is what killed the first and most literal
  reading of a folder called `NF#`.

## Method

The constraint that shaped everything was not freedom — it was the absence of a
reviewer. With nobody to ask "is this what you wanted?", the next best property
is *checkable*: a type inference engine either reconstructs
`('a -> 'b) -> ('c -> 'a) -> 'c -> 'b` for function composition or it does not,
and there is no room to fool yourself about which.

Two throwaway probes came before any commitment, because the plan collapsed if
either failed: does this Node execute `.ts` directly, and does `node --test`
run `.ts` test files.

The prelude is written in NF# rather than TypeScript on purpose. It is a canary:
it is type-checked at startup by the same engine that checks user code, so a
hole in the checker shows up there before it shows up anywhere else.

## Not invented here

The interesting algorithms are all borrowed from the literature and none of them
are mine: Hindley–Milner inference (Algorithm W), Didier Rémy's level-based
generalisation, Pratt / precedence-climbing parsing, and the standard
tail-call-as-loop transformation. The work was in fitting them together and in
the error messages, not in the ideas.

## What went wrong

Three defects, all caught by rereading the code rather than by the 249 tests:

- `:type` in the REPL evaluated the expression it was supposed to only type,
  so `:type println "boo"` printed `boo`.
- String indexing split surrogate pairs while `chars` did not, so the string
  functions disagreed with each other on anything outside the BMP.
- A careless find-and-replace leaked a condition into `expectIdent`, letting
  the keyword `rec` be used as a variable name.

Tests are good at catching the failures you thought of. These were not those.

## Disclosure

Every file in this repository — the implementation, the prelude, the seven
examples, the 249 tests, README.md, LANGUAGE.md and this colophon — was written
by Claude in one session on 25.07.2026. The human who owns the account wrote
none of it, and had not read any of it at the time it was committed.
