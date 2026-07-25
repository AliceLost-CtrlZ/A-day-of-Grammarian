/**
 * Abstract syntax. The parser desugars aggressively so that later stages stay
 * small: multi-parameter `let f a b = ...` becomes nested lambdas, binary
 * operators become applications of ordinary functions, `&&`/`||` become `if`,
 * and `x |> f` becomes `f x`.
 */

import type { Span } from "./diagnostics.ts";

export type TypeExpr =
  /** `int`, `bool`, `int list`, `(int, string) result` */
  | { kind: "con"; name: string; args: TypeExpr[]; span: Span }
  /** `'a` */
  | { kind: "var"; name: string; span: Span }
  | { kind: "fun"; from: TypeExpr; to: TypeExpr; span: Span }
  | { kind: "tuple"; items: TypeExpr[]; span: Span };

export type Pattern =
  | { kind: "wildcard"; span: Span }
  | { kind: "var"; name: string; span: Span }
  | { kind: "int"; value: number; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "bool"; value: boolean; span: Span }
  | { kind: "unit"; span: Span }
  | { kind: "tuple"; items: Pattern[]; span: Span }
  | { kind: "nil"; span: Span }
  | { kind: "cons"; head: Pattern; tail: Pattern; span: Span }
  /** `None`, `Some x` — constructors are capitalised identifiers. */
  | { kind: "ctor"; name: string; arg: Pattern | null; span: Span };

export type MatchCase = { pattern: Pattern; body: Expr; span: Span };

export type Expr =
  | { kind: "int"; value: number; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "bool"; value: boolean; span: Span }
  | { kind: "unit"; span: Span }
  | { kind: "var"; name: string; span: Span }
  | { kind: "lambda"; param: string | null; annot: TypeExpr | null; body: Expr; span: Span }
  | { kind: "apply"; fn: Expr; arg: Expr; span: Span }
  | { kind: "let"; name: string; value: Expr; body: Expr; span: Span }
  /** `let rec f = ... and g = ... in body` — one or more mutually recursive functions. */
  | { kind: "letRec"; bindings: RecBinding[]; body: Expr; span: Span }
  | { kind: "if"; cond: Expr; then: Expr; otherwise: Expr; span: Span }
  | { kind: "match"; scrutinee: Expr; cases: MatchCase[]; span: Span }
  | { kind: "list"; items: Expr[]; span: Span }
  | { kind: "tuple"; items: Expr[]; span: Span }
  | { kind: "annot"; expr: Expr; type: TypeExpr; span: Span };

export type Variant = { name: string; arg: TypeExpr | null; span: Span };

/** One member of a `let rec ... and ...` group. */
export type RecBinding = { name: string; value: Expr; span: Span };

export type Item =
  | { kind: "let"; name: string; value: Expr; span: Span }
  | { kind: "letRec"; bindings: RecBinding[]; span: Span }
  /** `let (a, b) = expr` — destructuring binding. */
  | { kind: "letPattern"; pattern: Pattern; value: Expr; span: Span }
  /** `do expr` — a top-level expression evaluated for its side effects. */
  | { kind: "do"; expr: Expr; span: Span }
  | { kind: "type"; name: string; params: string[]; variants: Variant[]; span: Span };

export type Program = Item[];
