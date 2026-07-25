import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertError, failure, signatures, typeOf } from "./helpers.ts";

describe("inference: literals and structures", () => {
  const cases: [string, string][] = [
    ["42", "int"],
    ['"hi"', "string"],
    ["true", "bool"],
    ["()", "unit"],
    ["[1; 2]", "int list"],
    ["[]", "'a list"],
    ["[[]]", "'a list list"],
    ["(1, \"a\")", "int * string"],
    ["(1, (true, []))", "int * (bool * 'a list)"],
    ["1 :: []", "int list"],
    ["Some 1", "int option"],
    ["None", "'a option"],
  ];
  for (const [source, expected] of cases) {
    test(`${source} : ${expected}`, () => assert.equal(typeOf(source), expected));
  }
});

describe("inference: functions", () => {
  const cases: [string, string][] = [
    ["fun x -> x", "'a -> 'a"],
    ["fun x -> x + 1", "int -> int"],
    ["fun f x -> f (f x)", "('a -> 'a) -> 'a -> 'a"],
    ["fun f g x -> f (g x)", "('a -> 'b) -> ('c -> 'a) -> 'c -> 'b"],
    ["fun (a, b) -> a", "'a * 'b -> 'a"],
    ["fun x -> (x, x)", "'a -> 'a * 'a"],
    ["map", "('a -> 'b) -> 'a list -> 'b list"],
    ["fold_left", "('a -> 'b -> 'a) -> 'a -> 'b list -> 'a"],
    ["fold_right", "('a -> 'b -> 'b) -> 'a list -> 'b -> 'b"],
    ["(=)", "'a -> 'a -> bool"],
    ["(+)", "int -> int -> int"],
    ["compare", "'a -> 'a -> int"],
    ["assoc", "'a -> ('a * 'b) list -> 'b option"],
  ];
  for (const [source, expected] of cases) {
    test(`${source} : ${expected}`, () => assert.equal(typeOf(source), expected));
  }

  test("arrows are right associative when printed", () => {
    assert.equal(typeOf("fun x y -> x"), "'a -> 'b -> 'a");
    assert.equal(typeOf("fun f -> f 1"), "(int -> 'a) -> 'a");
  });
});

describe("inference: let polymorphism", () => {
  test("a let-bound identity is usable at two types", () => {
    assert.deepEqual(signatures("let id x = x\nlet a = id 1\nlet b = id \"s\""), [
      "id : 'a -> 'a",
      "a : int",
      "b : string",
    ]);
  });

  test("a lambda-bound function stays monomorphic", () => {
    const error = failure("let use f = (f 1, f true)");
    assertError(error, "type", "type mismatch");
  });

  test("generalisation does not escape its level", () => {
    // `y` must not be generalised: it is only a hole created inside the lambda.
    assert.equal(typeOf("fun x -> let y = x in y"), "'a -> 'a");
  });

  test("mutually recursive bindings are checked together, then generalised", () => {
    assert.deepEqual(
      signatures(
        "let rec pings n xs = if n = 0 then xs else pongs (n - 1) (n :: xs)\n" +
          "and pongs n xs = if n = 0 then xs else pings (n - 1) xs\n" +
          "let a = pings 3 [1]\n" +
          "let b = length ([] : string list)",
      ),
      ["pings : int -> int list -> int list", "pongs : int -> int list -> int list", "a : int list", "b : int"],
    );
  });

  test("a `let rec` group cannot bind the same name twice", () => {
    assertError(failure("let rec f x = g x and f y = y"), "type", "defined twice");
  });

  test("recursive bindings generalise after they are checked", () => {
    assert.deepEqual(signatures("let rec twice f x = if true then x else twice f (f x)"), [
      "twice : ('a -> 'a) -> 'a -> 'a",
    ]);
  });
});

describe("inference: annotations", () => {
  test("an annotation constrains inference", () => {
    assert.equal(typeOf("(fun x -> x : int -> int)"), "int -> int");
    assert.equal(typeOf("fun (x : string) -> x"), "string -> string");
  });

  test("annotations are checked", () => {
    assertError(failure('let x : int = "no"'), "type", "type mismatch");
    assertError(failure("let f (x : string) = x + 1"), "type", "type mismatch");
  });

  test("a return annotation is checked", () => {
    assert.deepEqual(signatures("let f x : int = x"), ["f : int -> int"]);
    assertError(failure("let f x : string = x + 1"), "type", "type mismatch");
  });

  test("unknown type names are rejected", () => {
    assertError(failure("let f (x : intt) = x"), "type", "unknown type `intt`");
  });

  test("type constructor arity is checked", () => {
    assertError(failure("let f (x : int int) = x"), "type", "expects 0 arguments");
  });
});

describe("inference: errors", () => {
  test("mismatched operands", () => {
    assertError(failure('do println (1 + "two")', "program"), "type", "has type string");
  });

  test("mismatched branches", () => {
    assertError(failure("let x = if true then 1 else \"two\""), "type", "type mismatch");
  });

  test("a non-boolean condition", () => {
    assertError(failure("let x = if 1 then 2 else 3"), "type", "this condition has type int");
  });

  test("heterogeneous lists", () => {
    assertError(failure('let x = [1; "two"]'), "type", "this element has type string");
  });

  test("applying a non-function", () => {
    assertError(failure("let x = 1 2"), "type", "is not a function");
  });

  test("unbound values suggest a near miss", () => {
    assertError(failure("let x = lenght [1]"), "type", "did you mean `length`?");
  });

  test("occurs check", () => {
    assertError(failure("let f x = x x"), "type", "infinite type");
  });

  test("a `do` item must be unit", () => {
    assertError(failure("do 1 + 1"), "type", "`do` expression has type int");
  });

  test("match arms must agree", () => {
    assertError(
      failure('let f x = match x with | 0 -> "zero" | _ -> 1'),
      "type",
      "type mismatch",
    );
  });

  test("patterns must match the scrutinee", () => {
    assertError(failure("let f x = match x with | 1 :: _ -> 1 | _ -> 2\nlet y = f true"), "type", "type mismatch");
  });

  test("a constructor used with the wrong arity", () => {
    assertError(
      failure("let f x = match x with | Some -> 1 | None -> 0"),
      "type",
      "expects an argument",
    );
    assertError(
      failure("let f x = match x with | None y -> 1 | Some _ -> 0"),
      "type",
      "does not take an argument",
    );
  });

  test("errors carry a span into the offending source", () => {
    const error = failure('let x = 1 + "two"');
    assert.ok(error.span !== null);
    assert.equal(error.span.source?.text.slice(error.span.start, error.span.end), '"two"');
  });
});

describe("inference: user-defined types", () => {
  const source = `
type shape =
  | Circle of int
  | Rect of int * int

let area s =
  match s with
  | Circle r -> 3 * r * r
  | Rect (w, h) -> w * h
`;

  test("constructors become functions", () => {
    assert.deepEqual(signatures(source + "\nlet c = Circle\nlet r = Rect"), [
      "area : shape -> int",
      "c : int -> shape",
      "r : int * int -> shape",
    ]);
  });

  test("parameterised types are polymorphic", () => {
    assert.deepEqual(
      signatures("type 'a box = Box of 'a\nlet unwrap b = match b with | Box x -> x"),
      ["unwrap : 'a box -> 'a"],
    );
  });

  test("recursive types work", () => {
    assert.deepEqual(
      signatures(
        "type 'a tree = Leaf | Node of 'a tree * 'a * 'a tree\n" +
          "let rec size t = match t with | Leaf -> 0 | Node (l, _, r) -> 1 + size l + size r",
      ),
      ["size : 'a tree -> int"],
    );
  });

  test("type variables must be declared", () => {
    assertError(failure("type bad = Wrong of 'a"), "type", "unbound type variable `'a`");
  });

  test("duplicate constructors are rejected", () => {
    assertError(failure("type a = Dup\ntype b = Dup"), "type", "already defined");
  });
});
