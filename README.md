# NF#

A small statically typed functional language: lexer, parser, Hindley–Milner type
inference, and a tail-call-optimising evaluator, in about 2,900 lines of
dependency-free TypeScript.

```
$ nf -e "map (fun x -> x * x) [1; 2; 3]"
val it : int list = [1; 4; 9]

$ nf -e "fun f g x -> f (g x)"
val it : ('a -> 'b) -> ('c -> 'a) -> 'c -> 'b = <fun>
```

Nothing is annotated in an NF# program unless you want it to be — every type
above was reconstructed from the shape of the code.

## Quick start

Needs Node 23.6 or newer (it runs the TypeScript sources directly). There is no
build step, no `node_modules`, and no dependencies.

```
node bin/nf.ts examples/tour.nf      # run a program
node bin/nf.ts -e "sort [3; 1; 2]"   # evaluate one expression
node bin/nf.ts -t examples/tree.nf   # print inferred types, run nothing
node bin/nf.ts repl                  # interactive session
npm test                             # 249 tests
```

Throughout this README, `nf` is shorthand for `node bin/nf.ts`; `npm link` puts
that same command on your `PATH` under that name.

## A taste

From [examples/tree.nf](examples/tree.nf), abridged:

```
type 'a tree =
  | Leaf
  | Node of 'a tree * 'a * 'a tree

let rec insert value tree =
  match tree with
  | Leaf -> Node (Leaf, value, Leaf)
  | Node (left, current, right) ->
    if value < current then Node (insert value left, current, right)
    else if value > current then Node (left, current, insert value right)
    else tree

let of_list xs = fold_left (flip insert) Leaf xs

let rec to_list tree =
  match tree with
  | Leaf -> []
  | Node (left, value, right) -> to_list left @ [value] @ to_list right

let numbers = of_list [8; 3; 10; 1; 6; 14; 4; 7; 13]
let names = of_list ["pear"; "apple"; "fig"; "quince"; "date"]

do println ("in order: " ^ show (to_list numbers))
do println ("names:    " ^ show (to_list names))
```

```
$ nf examples/tree.nf
in order: [1; 3; 4; 6; 7; 8; 10; 13; 14]
depth:    4
has 6:    true
has 5:    false
names:    ["apple"; "date"; "fig"; "pear"; "quince"]

$ nf -t examples/tree.nf
val insert : 'a -> 'a tree -> 'a tree
val of_list : 'a list -> 'a tree
val to_list : 'a tree -> 'a list
val depth : 'a tree -> int
val contains : 'a -> 'a tree -> bool
val numbers : int tree
val names : string tree
```

One `insert` serves both trees: the checker generalises it once, then
instantiates it separately at `int tree` and `string tree`.

## What is in the language

- **Types**: `int`, `bool`, `string`, `unit`, tuples, lists, functions, and
  user-defined algebraic data types with type parameters.
- **Inference**: full Hindley–Milner with let-polymorphism, the occurs check,
  and optional annotations that are checked rather than trusted.
- **Pattern matching** on literals, tuples, lists, cons cells and constructors,
  in `match`, in `let`, and in function parameters.
- **Functions** are curried, so partial application falls out for free.
- **Mutual recursion** with `let rec f = ... and g = ...`, at the top level or
  inside an expression.
- **Tail calls** run in constant stack space, which is how you write loops.
- **Errors** carry a source span and are rendered with a caret under the code
  that caused them, in whichever file that turns out to be.
- **A prelude of 60+ functions** — `map`, `fold_left`, `sort_by`, `assoc`,
  `split_on`, … — written in NF# itself, in [src/prelude.nf](src/prelude.nf).

Full syntax and library reference: [LANGUAGE.md](LANGUAGE.md).

## How it works

```
source ─► lexer ─► parser ─► type checker ─► evaluator ─► value
          tokens   AST       Type            Value
```

| Stage | File | What it does |
| --- | --- | --- |
| Lexing | [src/lexer.ts](src/lexer.ts) | Tokens with spans; `//` and nestable `(* *)` comments. |
| Parsing | [src/parser.ts](src/parser.ts) | Recursive descent with precedence climbing; desugars as it goes. |
| Inference | [src/infer.ts](src/infer.ts) | Algorithm W over mutable type variables. |
| Evaluation | [src/interp.ts](src/interp.ts) | Tree walking, with a loop where the tail calls are. |
| Diagnostics | [src/diagnostics.ts](src/diagnostics.ts) | One error type, rendered with a caret. |

A whole program is type-checked before any of it runs, so a type error never
appears after half the output has been printed.

Three parts are worth a closer look.

### Generalisation by levels

The textbook way to decide which type variables a `let` may quantify is to
compare against the free variables of the environment, which means walking the
environment on every binding. NF# uses Rémy's trick instead: every unbound type
variable records the `let` depth at which it was created, and generalisation
quantifies exactly those variables whose level is deeper than the current one.
Unification lowers levels as it links variables together, so the bookkeeping
stays correct without ever scanning the environment.

That is why `let id x = x` is polymorphic while the `x` in `fun x -> let y = x
in y` is not: `y`'s variable was created at an outer level and cannot escape.

### Tail calls without a trampoline

`evaluate` is a `for (;;)` loop over a mutable `expr`/`env` pair. Anything in
tail position — the branches of an `if`, the body of a `let`, the arm of a
`match`, the body of a called closure — reassigns those two variables and
continues the loop instead of recursing into the host. A million-iteration loop
costs one JavaScript stack frame:

```
$ nf -e "let rec go acc n = if n = 0 then acc else go (acc + n) (n - 1) in go 0 1000000"
val it : int = 500000500000
```

Non-tail recursion still uses the JavaScript stack; when it runs out, the
`RangeError` is turned back into an ordinary NF# error that says so.

### A prelude written in the language

Only what cannot be expressed in NF# is a primitive: arithmetic, comparison,
string operations, `show`, and printing ([src/builtins.ts](src/builtins.ts),
whose signatures are written in NF# type syntax and parsed by the language's own
parser). Everything else — including `sort`, `option`, and the `@` operator — is
ordinary NF# in [src/prelude.nf](src/prelude.nf), type-checked at startup by the
same inference engine that checks your code. It makes a good canary: a hole in
the checker usually shows up there first.

## Layout

```
bin/nf.ts          command line and REPL
src/
  lexer.ts         source text -> tokens
  ast.ts           expression, pattern and type syntax
  parser.ts        tokens -> AST, plus all the desugaring
  types.ts         type representation and ML-style printing
  infer.ts         Hindley-Milner inference and unification
  values.ts        runtime values, structural compare, `show`
  builtins.ts      primitives, with NF# type signatures
  interp.ts        the evaluator
  index.ts         Interpreter: checker + runtime, wired together
  prelude.nf       the standard library, in NF#
examples/          seven runnable programs
test/              249 tests, run with `npm test`
```

## Tests

`npm test` runs everything through Node's built-in test runner:

- the lexer, parser (precedence and desugaring), and error messages;
- ~50 inference cases, from `[]` to `assoc : 'a -> ('a * 'b) list -> 'b option`;
- evaluation, including tail-call depth and every runtime failure mode;
- every prelude function's value *and* inferred type;
- every example program, against a snapshot in `test/snapshots/`
  (regenerate with `UPDATE_SNAPSHOTS=1 node --test test/examples.test.ts`);
- the CLI and the REPL, as subprocesses.

## Known limits

These are deliberate — the point was a complete small language, not a large one.

- **Integers only.** No floats, so no need for `+.` or overloading. Integers are
  JavaScript's safe range (53 bits); `/` truncates toward zero.
- **No mutable state**, which is also why generalising every `let` is sound:
  there is no value restriction to worry about.
- **No modules and no imports**: a program is one file plus the prelude.
- **Match exhaustiveness is not checked.** A value that matches no arm is a
  runtime error that prints the value and points at the scrutinee.
- **Annotations constrain, they do not generalise.** Writing `let f : 'a -> 'a`
  on a function that is really `int -> int` is accepted rather than rejected;
  the annotation is unified with the inferred type instead of being checked for
  being more general.
- **Records, chars, and strings-as-lists** are absent; a "character" is a
  one-element string.
- The TypeScript sources are *run* by Node, which strips types without checking
  them. `npx tsc --noEmit` would check them if you install TypeScript; the code
  is written to work either way.

## Where it could go next

Exhaustiveness checking (the constructor table in the checker already knows every
variant of every type); records with row polymorphism; a `float` type once there
is a story for overloading; modules; or replacing the tree walker with a compiler
to a small stack machine.
