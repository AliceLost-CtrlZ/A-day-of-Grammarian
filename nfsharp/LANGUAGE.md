# The NF# language

A reference for the whole language. For what it is and how it is built, see
[README.md](README.md).

## Programs

A program is a sequence of top-level items. There are three kinds, and each is
visible to everything that follows it:

```
let name params = expression      // a definition
let rec name params = ...         // a recursive one, with `and` for a group
type name = Ctor | Ctor of type   // a data type
do expression                     // run for its effects; must have type unit
```

```
let message = "hello"
do println message
```

Whitespace and indentation carry no meaning; items are delimited by their
keywords. That is why running an expression at the top level needs `do` — it
tells the parser that `println message` is a new item rather than more arguments
for the previous one.

`let ... in ...` is the expression form, and is the only place `in` appears:

```
let variance xs =
  let n = length xs in
  let mean = sum xs / n in
  sum (map (fun x -> (x - mean) * (x - mean)) xs) / n
```

## Definitions

```
let x = 1                          // a value
let add a b = a + b                // sugar for fun a -> fun b -> a + b
let add' = fun a b -> a + b        // the same function
let rec fact n = if n <= 1 then 1 else n * fact (n - 1)
let (quotient, remainder) = (7 / 2, 7 % 2)   // destructuring
let f (x : int) : int = x + 1      // optional annotations
let g () = println "called"        // a unit parameter
let h _ = "ignored"                // a wildcard parameter
let swap (a, b) = (b, a)           // a pattern parameter
```

Functions that call each other are defined as one group with `and`. Every name
in the group exists before any of the bodies are checked, so the order does not
matter:

```
let rec is_even n = if n = 0 then true else is_odd (n - 1)
and is_odd n = if n = 0 then false else is_even (n - 1)
```

`let rec` must define a function — each member of a group too. NF# evaluates
eagerly, so `let rec x = x + 1` would need `x` before it exists, and is rejected
at parse time.

Every `let` is generalised, so a definition used at two different types works:

```
let id x = x
let a = id 1        // int
let b = id "one"    // string
```

A `fun` parameter is *not* generalised — inside a function body its type is
fixed, which is standard Hindley–Milner and keeps inference decidable.

## Data types

```
type 'a option =
  | None
  | Some of 'a

type ('a, 'b) either = Left of 'a | Right of 'b

type shape = Circle of int | Rect of int * int
```

Constructors start with a capital letter; that is how the parser tells
`Some x` (a constructor with an argument) from `f x` (a function call). A
constructor takes at most one argument, so use a tuple for several:
`Rect (3, 4)`. Constructors are ordinary values — `map Some [1; 2]` works —
and types may be recursive:

```
type 'a tree = Leaf | Node of 'a tree * 'a * 'a tree
```

## Expressions

| Form | Example |
| --- | --- |
| integer | `42`, `-7`, `1_000_000` |
| string | `"hi\n"` |
| boolean | `true`, `false` |
| unit | `()` |
| list | `[1; 2; 3]`, `[]` |
| tuple | `(1, "a", true)` |
| lambda | `fun x -> x + 1`, `fun (a, b) -> a` |
| application | `f x y` |
| conditional | `if c then a else b`, `if c then effect` |
| match | `match xs with \| [] -> 0 \| x :: _ -> x` |
| local binding | `let n = 1 in n + 1` |
| sequencing | `(println "a"; println "b")` |
| annotation | `(xs : int list)` |
| operator section | `(+)`, `(::)` |

`if` without `else` is shorthand for `else ()`, so its branch must have type
`unit`. Sequencing with `;` is only available inside parentheses, and everything
but the last expression must have type `unit` — that is what makes it a
sequence of effects rather than a pile of discarded values.

Strings support `\n`, `\t`, `\r`, `\0`, `\\` and `\"`. Comments are `// to end
of line` and `(* block, which nests (* like this *) *)`.

The reserved words are `let`, `rec`, `and`, `in`, `fun`, `if`, `then`, `else`,
`match`, `with`, `type`, `of`, `do`, `true` and `false`. Identifiers are ASCII
letters, digits, `_` and `'`, starting with a letter or `_`.

## Operators

Loosest to tightest:

| Operators | Associativity | Meaning |
| --- | --- | --- |
| `\|>` | left | `x \|> f` is `f x` |
| `\|\|` | right | short-circuiting or |
| `&&` | right | short-circuiting and |
| `=` `<>` `<` `<=` `>` `>=` | left | structural comparison, `'a -> 'a -> bool` |
| `::` `@` `^` | right | cons, list append, string append |
| `+` `-` | left | |
| `*` `/` `%` | left | `/` truncates toward zero |
| `-` (prefix) | — | negation |
| application | left | binds tighter than every operator |

Any operator except `&&`, `||` and `|>` can be used as a value by wrapping it in
parentheses: `fold_left (+) 0 xs`. (The first two are control flow rather than
functions, and `|>` is pure syntax.) Write `( * )` with spaces — `(*` opens a
comment.

Comparison is structural and works on any type that contains no functions;
comparing two functions is a runtime error. Constructors compare in declaration
order, so `None < Some 0`.

Because application binds tightest, `f -1` parses as `f - 1`. Write `f (-1)`.

## Patterns

Patterns appear in `match` arms, in `let` bindings, and as function parameters.

| Pattern | Matches |
| --- | --- |
| `_` | anything, binding nothing |
| `name` | anything, binding it |
| `42`, `"s"`, `true`, `()` | that literal |
| `(a, b)` | a tuple, binding each part |
| `[]` | the empty list |
| `x :: rest` | a non-empty list |
| `[a; b]` | a list of exactly two elements |
| `Some x`, `None` | a constructor |

Patterns nest: `Some (x, y :: _)` is fine. A name may be bound only once per
pattern. Exhaustiveness is not checked — a value that matches no arm raises a
runtime error naming the value.

```
let rec sum_pairs xs =
  match xs with
  | [] -> 0
  | (a, b) :: rest -> a + b + sum_pairs rest
```

## Types

Type syntax, as it appears in annotations:

```
int  bool  string  unit
'a                       type variable
int list                 postfix constructor
(int, string) either     several arguments
int * string             tuple
int -> bool              function, right associative
```

Annotations are optional everywhere they are allowed: on a parameter
(`fun (x : int) -> ...`), on a definition's result (`let f x : int = ...`), or
around an expression (`(xs : int list)`). They are unified with the inferred
type rather than trusted, so a wrong annotation is an error — but note that an
annotation cannot make a type *more* general than what was inferred.

Inference is Hindley–Milner: types are reconstructed for the whole program,
`let` bindings are generalised, and a mismatch is reported at the expression
that caused it:

```
error[type]: type mismatch
 --> demo.nf:2:13
  |
2 | let x = 1 + "two"
  |             ^^^^^
  |
  = this argument has type string
  = but an expression was expected of type int
```

## The prelude

Available in every program, defined in [src/prelude.nf](src/prelude.nf) except
where marked *(primitive)*. Use `:env` in the REPL to print this list.

### Arithmetic and comparison

| | |
| --- | --- |
| `+ - * / %` | `int -> int -> int` *(primitive)* |
| `= <> < <= > >=` | `'a -> 'a -> bool` *(primitive)* |
| `compare` | `'a -> 'a -> int` *(primitive)* |
| `min` `max` | `'a -> 'a -> 'a` |
| `abs` | `int -> int` |
| `even` `odd` | `int -> bool` |
| `pow` | `int -> int -> int` |

### Basics

| | |
| --- | --- |
| `not` | `bool -> bool` |
| `id` | `'a -> 'a` |
| `ignore` | `'a -> unit` |
| `fst` `snd` | `'a * 'b -> 'a`, `'a * 'b -> 'b` |
| `flip` | `('a -> 'b -> 'c) -> 'b -> 'a -> 'c` |
| `compose` | `('a -> 'b) -> ('c -> 'a) -> 'c -> 'b` |

### Lists

| | |
| --- | --- |
| `length` | `'a list -> int` |
| `is_empty` | `'a list -> bool` |
| `append` (`@`) | `'a list -> 'a list -> 'a list` |
| `rev` | `'a list -> 'a list` |
| `rev_append` | `'a list -> 'a list -> 'a list` |
| `map` | `('a -> 'b) -> 'a list -> 'b list` |
| `filter` | `('a -> bool) -> 'a list -> 'a list` |
| `fold_left` | `('a -> 'b -> 'a) -> 'a -> 'b list -> 'a` |
| `fold_right` | `('a -> 'b -> 'b) -> 'a list -> 'b -> 'b` |
| `iter` | `('a -> unit) -> 'a list -> unit` |
| `exists` `for_all` | `('a -> bool) -> 'a list -> bool` |
| `mem` | `'a -> 'a list -> bool` |
| `take` `drop` | `int -> 'a list -> 'a list` |
| `range` | `int -> int -> int list` |
| `init` | `int -> (int -> 'a) -> 'a list` |
| `repeat` | `int -> 'a -> 'a list` |
| `sum` `product` | `int list -> int` |
| `concat` | `'a list list -> 'a list` |
| `concat_map` | `('a -> 'b list) -> 'a list -> 'b list` |
| `zip` | `'a list -> 'b list -> ('a * 'b) list` |
| `unzip` | `('a * 'b) list -> 'a list * 'b list` |
| `head` `last` | `'a list -> 'a` (fails on `[]`) |
| `tail` | `'a list -> 'a list` (fails on `[]`) |
| `nth` | `'a list -> int -> 'a` (fails past the end) |
| `maximum` `minimum` | `'a list -> 'a` |
| `halve` | `'a list -> 'a list * 'a list` |
| `merge_by` | `('a -> 'a -> int) -> 'a list -> 'a list -> 'a list` |
| `sort_by` | `('a -> 'a -> int) -> 'a list -> 'a list` |
| `sort` | `'a list -> 'a list` (stable merge sort) |
| `print_list` | `'a list -> unit` |

`length`, `map`, `filter`, `rev`, `append`, `range`, `fold_left` and the
predicates are tail recursive and handle lists of any size. The rest recurse to
the depth of the list, which is bounded by the host stack.

### Options

| | |
| --- | --- |
| `type 'a option` | `None \| Some of 'a` |
| `is_some` `is_none` | `'a option -> bool` |
| `with_default` | `'a -> 'a option -> 'a` |
| `option_map` | `('a -> 'b) -> 'a option -> 'b option` |
| `find` | `('a -> bool) -> 'a list -> 'a option` |
| `assoc` | `'a -> ('a * 'b) list -> 'b option` |

### Strings and output

| | |
| --- | --- |
| `^` | `string -> string -> string` *(primitive)* |
| `string_length` | `string -> int` *(primitive)* |
| `string_of_int` | `int -> string` *(primitive)* |
| `int_of_string` | `string -> int` *(primitive, fails on nonsense)* |
| `string_get` | `string -> int -> string` *(primitive)* |
| `string_sub` | `string -> int -> int -> string` *(primitive)* |
| `chars` | `string -> string list` *(primitive)* |
| `show` | `'a -> string` *(primitive)* |
| `print` `println` | `string -> unit` *(primitive)* |
| `failwith` | `string -> 'a` *(primitive)* |
| `string_join` | `string -> string list -> string` |
| `string_rev` | `string -> string` |
| `string_repeat` | `int -> string -> string` |
| `split_on` | `string -> string -> string list` |
| `lines` `words` | `string -> string list` |

There is no character type: `chars` and `string_get` return one-element strings.
`show` renders any value the way the REPL does — `[1; 2]`, `(1, "a")`,
`Some 3`, `<fun>`.

## Command line

```
nf <file.nf>            run a program
nf -e "<expression>"    evaluate an expression, printing its type and value
nf -t <file.nf>         type-check and print every top-level type
nf repl                 interactive session (the default in a terminal)
nf --help
```

In the REPL, `:type <expr>` shows a type, `:env` lists everything in scope, and
a definition that is not finished yet continues on the next line:

```
nf> let rec fact n =
  |   if n <= 1 then 1 else n * fact (n - 1)
val fact : int -> int = <fun>
nf> fact 20
val it : int = 2432902008176640000
```

## Grammar

```
program     ::= item*
item        ::= "let" binding ("and" binding)*
              | "let" pattern "=" expr
              | "do" expr
              | "type" [typarams] name "=" ["|"] variant ("|" variant)*
binding     ::= ["rec"] name param* [":" type] "=" expr
variant     ::= Ctor ["of" type]
param       ::= name | "_" | "()" | "(" name ":" type ")" | pattern

expr        ::= "let" binding ("and" binding)* "in" expr
              | "let" pattern "=" expr "in" expr
              | "fun" param+ "->" expr
              | "if" expr "then" expr ["else" expr]
              | "match" expr "with" ["|"] arm ("|" arm)*
              | expr binop expr
              | "-" expr
              | atom+
arm         ::= pattern "->" expr
atom        ::= int | string | "true" | "false" | "()" | name
              | "(" expr ("," expr)* ")" | "(" expr ";" expr ")"
              | "(" expr ":" type ")" | "(" operator ")"
              | "[" [expr (";" expr)*] "]"

pattern     ::= patatom ["::" pattern]
patatom     ::= "_" | name | int | string | "true" | "false" | "()"
              | Ctor [patatom]
              | "(" pattern ("," pattern)* ")"
              | "[" [pattern (";" pattern)*] "]"

type        ::= typroduct ["->" type]
typroduct   ::= typapp ("*" typapp)*
typapp      ::= typatom name*
typatom     ::= "'" name | name | "(" type ("," type)* ")" name | "(" type ")"
```
