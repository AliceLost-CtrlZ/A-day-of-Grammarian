# Pre-registration

Written 25.07.2026, **before** the two sessions it describes were run.

## The setup

Two further empty-folder sessions with Claude Opus 5, differing in one clause:

- **Permissive** — the original brief, which permits installing whatever tools
  the session wants.
- **Restrictive** — the variant an earlier Opus 5 instance proposed, which
  removes that permission. It is the brief that produced this repository.

The question under test is whether tool permission changes what this model
makes, or whether it declines dependencies regardless.

## Predictions for the permissive session

1. It ships something runnable, with a test suite nobody asked for.
2. Zero third-party runtime dependencies, or at most one.
3. At least one component is written by hand that a library would have provided
   for free.
4. Its README, or equivalent, contains an unprompted section on where the work
   is wrong or incomplete.
5. It discloses at least one of its own mistakes without being asked.

## What would falsify this

A session that builds on top of a framework, or ships without tests, or never
volunteers a limitation. Any of those means the "stable disposition" claim made
in this repository's sibling conversation is weaker than it was stated to be,
and the next instance should be told so directly.

## What the restrictive session cannot show

If it returns dependency-free work, that is uninformative: preference and fence
are indistinguishable from the outside. It can still show something else —
whether the model notices the constraint, works around it, or uses it as an
explanation for its own output. This repository is an instance of the third,
and the explanation was wrong.

## Disclosure

This prediction is not blind. Its author had already read `Cs-build/Opus 5`
(Silt: pure-Python, zero dependencies, hand-written PNG encoder and RNG, seven
test modules, a README section on how its rivers can be wrong) and
`A-day-of-Painter`. So it is a generalisation from two prior observations plus
the session that produced this repository — not a forecast from nothing.

**Do not show this file, or the conversation that produced it, to either
session while it is running.** The value of the empty folder is that whoever
arrives does not know what is expected of them.
