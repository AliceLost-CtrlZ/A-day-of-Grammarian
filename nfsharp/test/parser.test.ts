import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Expr, Pattern } from "../src/ast.ts";
import { parseExpression, parseProgram } from "../src/parser.ts";

/** Render an expression as an s-expression so precedence is easy to assert. */
function sketch(expr: Expr): string {
  switch (expr.kind) {
    case "int":
      return String(expr.value);
    case "string":
      return JSON.stringify(expr.value);
    case "bool":
      return String(expr.value);
    case "unit":
      return "()";
    case "var":
      return expr.name;
    case "lambda":
      return `(fun ${expr.param ?? "_"} ${sketch(expr.body)})`;
    case "apply": {
      const parts: string[] = [];
      let current: Expr = expr;
      while (current.kind === "apply") {
        parts.unshift(sketch(current.arg));
        current = current.fn;
      }
      parts.unshift(sketch(current));
      return `(${parts.join(" ")})`;
    }
    case "if":
      return `(if ${sketch(expr.cond)} ${sketch(expr.then)} ${sketch(expr.otherwise)})`;
    case "let":
      return `(let ${expr.name} ${sketch(expr.value)} ${sketch(expr.body)})`;
    case "letRec":
      return `(letrec ${expr.bindings
        .map((binding) => `[${binding.name} ${sketch(binding.value)}]`)
        .join(" ")} ${sketch(expr.body)})`;
    case "match":
      return `(match ${sketch(expr.scrutinee)} ${expr.cases
        .map((c) => `[${sketchPattern(c.pattern)} ${sketch(c.body)}]`)
        .join(" ")})`;
    case "list":
      return `[${expr.items.map(sketch).join(" ")}]`;
    case "tuple":
      return `(, ${expr.items.map(sketch).join(" ")})`;
    case "annot":
      return `(: ${sketch(expr.expr)})`;
  }
}

function sketchPattern(pattern: Pattern): string {
  switch (pattern.kind) {
    case "wildcard":
      return "_";
    case "var":
      return pattern.name;
    case "int":
      return String(pattern.value);
    case "string":
      return JSON.stringify(pattern.value);
    case "bool":
      return String(pattern.value);
    case "unit":
      return "()";
    case "nil":
      return "[]";
    case "cons":
      return `(:: ${sketchPattern(pattern.head)} ${sketchPattern(pattern.tail)})`;
    case "tuple":
      return `(, ${pattern.items.map(sketchPattern).join(" ")})`;
    case "ctor":
      return pattern.arg ? `(${pattern.name} ${sketchPattern(pattern.arg)})` : pattern.name;
  }
}

const shape = (source: string) => sketch(parseExpression(source));

describe("parser: operator precedence", () => {
  test("multiplication binds tighter than addition", () => {
    assert.equal(shape("1 + 2 * 3"), "(+ 1 (* 2 3))");
    assert.equal(shape("1 * 2 + 3"), "(+ (* 1 2) 3)");
  });

  test("arithmetic is left associative", () => {
    assert.equal(shape("1 - 2 - 3"), "(- (- 1 2) 3)");
  });

  test("cons and append are right associative", () => {
    assert.equal(shape("1 :: 2 :: []"), "(:: 1 (:: 2 []))");
    assert.equal(shape("a @ b @ c"), "(append a (append b c))");
  });

  test("comparison binds looser than arithmetic", () => {
    assert.equal(shape("a + 1 < b * 2"), "(< (+ a 1) (* b 2))");
  });

  test("application binds tightest of all", () => {
    assert.equal(shape("f x + g y"), "(+ (f x) (g y))");
    assert.equal(shape("f x y"), "(f x y)");
  });

  test("unary minus is not subtraction", () => {
    assert.equal(shape("-x + 1"), "(+ (~- x) 1)");
    assert.equal(shape("f - 1"), "(- f 1)");
  });

  test("pipelines are left associative and desugar to application", () => {
    assert.equal(shape("x |> f |> g"), "(g (f x))");
    // `f y` is applied to `x`, which the flattened sketch shows as one spine.
    assert.equal(shape("x |> f y"), "(f y x)");
  });
});

describe("parser: desugaring", () => {
  test("&& and || become conditionals so they short-circuit", () => {
    assert.equal(shape("a && b"), "(if a b false)");
    assert.equal(shape("a || b"), "(if a true b)");
  });

  test("multiple parameters become nested lambdas", () => {
    const [item] = parseProgram("let add a b = a + b");
    assert.equal(item!.kind, "let");
    assert.equal(sketch((item as { value: Expr }).value), "(fun a (fun b (+ a b)))");
  });

  test("destructuring parameters become a match", () => {
    assert.equal(shape("fun (a, b) -> a"), "(fun $arg0 (match $arg0 [(, a b) a]))");
  });

  test("an `if` without `else` yields unit", () => {
    assert.equal(shape("if a then b"), "(if a b ())");
  });

  test("sequencing requires the first expression to be unit", () => {
    assert.equal(shape("(f x; y)"), "(match (: (f x)) [_ y])");
  });

  test("operator sections are plain values", () => {
    assert.equal(shape("fold_left (+) 0 xs"), "(fold_left + 0 xs)");
    assert.equal(shape("(@)"), "append");
  });

  test("`let ... in` with a pattern becomes a single-case match", () => {
    assert.equal(shape("let (a, b) = p in a"), "(match p [(, a b) a])");
  });

  test("`and` groups recursive bindings together", () => {
    assert.equal(
      shape("let rec f x = g x and g y = f y in f 1"),
      "(letrec [f (fun x (g x))] [g (fun y (f y))] (f 1))",
    );
  });
});

describe("parser: patterns", () => {
  test("cons patterns are right associative", () => {
    assert.equal(
      shape("match xs with | x :: y :: rest -> x"),
      "(match xs [(:: x (:: y rest)) x])",
    );
  });

  test("list patterns expand to cons chains", () => {
    assert.equal(shape("match xs with | [a; b] -> a"), "(match xs [(:: a (:: b [])) a])");
  });

  test("constructors take at most one argument", () => {
    assert.equal(shape("match o with | Some x -> x | None -> 0"), "(match o [(Some x) x] [None 0])");
  });

  test("a leading bar is optional", () => {
    assert.equal(shape("match x with 1 -> 2"), shape("match x with | 1 -> 2"));
  });
});

describe("parser: errors", () => {
  const fails = (source: string, pattern: RegExp) =>
    assert.throws(() => parseProgram(source), pattern);

  test("reports a missing top-level keyword", () => {
    fails("1 + 1", /expected a top-level definition/);
  });

  test("reports `in` used at the top level", () => {
    fails("let x = 1 in x", /unexpected `in` at the top level/);
  });

  test("reports an unclosed parenthesis", () => {
    fails("do println (1", /expected `\)`/);
  });

  test("reports a missing match arrow", () => {
    fails("do match x with | 1 2", /expected `->`/);
  });

  test("rejects a recursive value that is not a function", () => {
    fails("let rec x = x + 1", /must define a function/);
  });

  test("accepts a recursive function behind a type annotation", () => {
    assert.doesNotThrow(() => parseProgram("let rec f : int -> int = fun n -> f (n - 1)"));
  });

  test("every member of a `let rec` group must be a function", () => {
    fails("let rec f x = g x and g = 1", /`and g` must define a function/);
  });

  test("rejects && as a value", () => {
    fails("do (&&)", /cannot be used as a value/);
  });

  test("keywords cannot be used as names", () => {
    fails("let rec rec x = x", /expected an identifier after `let`, found keyword `rec`/);
    fails("type of = Nope", /expected an identifier as the name of the type/);
    fails("let match = 1", /expected a pattern, found keyword `match`/);
  });

  test("reports an unexpected token after an expression", () => {
    assert.throws(() => parseExpression("1 + 1)"), /unexpected `\)`/);
  });
});
