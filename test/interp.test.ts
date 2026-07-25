import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertError, evaluate, failure, lines, run } from "./helpers.ts";

describe("evaluation: primitives", () => {
  const cases: [string, string][] = [
    ["1 + 2 * 3", "7"],
    ["(1 + 2) * 3", "9"],
    ["7 / 2", "3"],
    ["-7 / 2", "-3"],
    ["7 % 3", "1"],
    ["-7 % 3", "-1"],
    ["-(3 - 5)", "2"],
    ["2 < 3", "true"],
    ['"a" ^ "b"', '"ab"'],
    ["[1; 2] = [1; 2]", "true"],
    ["(1, [2]) = (1, [3])", "false"],
    ["compare [1; 2] [1; 3]", "-1"],
    ['compare "b" "a"', "1"],
    ["Some 1 < Some 2", "true"],
    ["None < Some 0", "true"],
  ];
  for (const [source, expected] of cases) {
    test(`${source} => ${expected}`, () => assert.equal(evaluate(source), expected));
  }

  test("&& and || short-circuit", () => {
    assert.equal(evaluate("false && 1 / 0 = 0"), "false");
    assert.equal(evaluate("true || 1 / 0 = 0"), "true");
  });

  test("show renders values ML-style", () => {
    assert.equal(evaluate("show [1; 2; 3]"), '"[1; 2; 3]"');
    assert.equal(evaluate('show (1, "a", [true])'), '"(1, \\"a\\", [true])"');
    assert.equal(evaluate("show (Some (Some 1))"), '"Some (Some 1)"');
    assert.equal(evaluate("show (fun x -> x)"), '"<fun>"');
  });
});

describe("evaluation: functions", () => {
  test("closures capture their environment", () => {
    assert.equal(evaluate("let add = fun a -> fun b -> a + b in (add 2) 3"), "5");
  });

  test("partial application", () => {
    assert.equal(evaluate("map ((+) 10) [1; 2; 3]"), "[11; 12; 13]");
  });

  test("shadowing follows lexical scope", () => {
    assert.equal(evaluate("let x = 1 in let x = 2 in x"), "2");
    assert.equal(evaluate("let x = 1 in (fun x -> x) 9 + x"), "10");
  });

  test("recursion", () => {
    assert.equal(evaluate("let rec fact n = if n <= 1 then 1 else n * fact (n - 1) in fact 10"), "3628800");
  });

  test("higher-order composition", () => {
    assert.equal(evaluate("(compose (fun x -> x * 2) (fun x -> x + 1)) 5"), "12");
  });

  test("mutual recursion, at the top level and inside an expression", () => {
    const source = `
let rec is_even n = if n = 0 then true else is_odd (n - 1)
and is_odd n = if n = 0 then false else is_even (n - 1)
do println (show (map is_even (range 0 4)))
do println (show (let rec ping k = if k = 0 then "ping" else pong (k - 1)
                  and pong k = if k = 0 then "pong" else ping (k - 1)
                  in ping 7))
`;
    assert.deepEqual(lines(source), ["[true; false; true; false]", '"pong"']);
  });

  test("mutual recursion is tail recursive too", () => {
    const source = `
let rec even_ n = if n = 0 then true else odd_ (n - 1)
and odd_ n = if n = 0 then false else even_ (n - 1)
in even_ 400000
`;
    assert.equal(evaluate(source), "true");
  });
});

describe("evaluation: pattern matching", () => {
  test("literal and wildcard patterns", () => {
    const source = `
let classify n =
  match n with
  | 0 -> "zero"
  | 1 -> "one"
  | _ -> "many"
do println (string_join " " (map classify [0; 1; 7]))
`;
    assert.deepEqual(lines(source), ["zero one many"]);
  });

  test("nested constructor patterns", () => {
    assert.equal(evaluate("match Some (1, 2) with | Some (a, b) -> a + b | None -> 0"), "3");
  });

  test("list patterns bind the tail", () => {
    assert.equal(evaluate("match [1; 2; 3] with | _ :: rest -> rest | [] -> []"), "[2; 3]");
  });

  test("a value with no matching arm is a runtime error", () => {
    assertError(failure("do (match 5 with | 1 -> ())"), "runtime", "no pattern matched");
  });

  test("destructuring at the top level", () => {
    const source = `
let (a, b) = (1, "two")
do println (show a ^ " " ^ b)
`;
    assert.deepEqual(lines(source), ['1 two']);
  });
});

describe("evaluation: tail calls", () => {
  test("a tail-recursive loop runs in constant stack space", () => {
    assert.equal(evaluate("let rec go acc n = if n = 0 then acc else go (acc + n) (n - 1) in go 0 500000"), "125000250000");
  });

  test("tail position inside match and if", () => {
    const source = `
let rec drain acc xs =
  match xs with
  | [] -> acc
  | x :: rest -> if x % 2 = 0 then drain (acc + x) rest else drain acc rest
in drain 0 (range 0 300000)
`;
    assert.equal(evaluate(source), "22499850000");
  });

  test("deep non-tail recursion fails with a readable error", () => {
    const error = failure(
      "let rec deep n = if n = 0 then 0 else 1 + deep (n - 1)\ndo println (show (deep 1000000))",
    );
    assertError(error, "runtime", "stack overflow");
  });
});

describe("evaluation: effects and errors", () => {
  test("println writes a line at a time", () => {
    assert.deepEqual(lines('do println "a"\ndo println "b"'), ["a", "b"]);
  });

  test("print does not add a newline", () => {
    assert.equal(run('do print "a"\ndo print "b"').output, "ab");
  });

  test("sequencing runs effects in order", () => {
    assert.deepEqual(lines('do (println "first"; println "second")'), ["first", "second"]);
  });

  test("division by zero", () => {
    assertError(failure("do println (show (1 / 0))"), "runtime", "division by zero");
  });

  test("failwith carries its message", () => {
    assertError(failure('do println (failwith "boom")'), "runtime", "boom");
  });

  test("comparing functions is rejected at runtime", () => {
    assertError(failure("do println (show ((fun x -> x) = (fun y -> y)))"), "runtime", "functions cannot be compared");
  });

  test("string_get bounds are checked", () => {
    assertError(failure('do println (string_get "ab" 5)'), "runtime", "out of bounds");
  });

  test("int_of_string rejects nonsense", () => {
    assertError(failure('do println (show (int_of_string "12x"))'), "runtime", "not an integer");
  });
});
