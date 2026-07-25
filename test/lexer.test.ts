import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NfError } from "../src/diagnostics.ts";
import { tokenize } from "../src/lexer.ts";

const kinds = (source: string) => tokenize(source).map((t) => `${t.kind}:${t.value}`).slice(0, -1);

describe("lexer", () => {
  test("classifies the basic token kinds", () => {
    assert.deepEqual(kinds("let x = 42"), ["keyword:let", "ident:x", "symbol:=", "int:42"]);
  });

  test("prefers the longest symbol", () => {
    assert.deepEqual(kinds("a <= b"), ["ident:a", "symbol:<=", "ident:b"]);
    assert.deepEqual(kinds("a < b"), ["ident:a", "symbol:<", "ident:b"]);
    assert.deepEqual(kinds("x |> f"), ["ident:x", "symbol:|>", "ident:f"]);
    assert.deepEqual(kinds("a || b"), ["ident:a", "symbol:||", "ident:b"]);
    assert.deepEqual(kinds("1 :: xs"), ["int:1", "symbol:::", "ident:xs"]);
  });

  test("skips line and block comments", () => {
    assert.deepEqual(kinds("1 // two\n3"), ["int:1", "int:3"]);
    assert.deepEqual(kinds("1 (* two *) 3"), ["int:1", "int:3"]);
  });

  test("nests block comments", () => {
    assert.deepEqual(kinds("1 (* a (* b *) c *) 2"), ["int:1", "int:2"]);
  });

  test("decodes string escapes", () => {
    const [token] = tokenize('"a\\nb\\t\\"c\\""');
    assert.equal(token!.value, 'a\nb\t"c"');
  });

  test("allows underscores and primes in names", () => {
    assert.deepEqual(kinds("fold_left x'"), ["ident:fold_left", "ident:x'"]);
  });

  test("reads underscores in numbers", () => {
    assert.deepEqual(kinds("1_000_000"), ["int:1000000"]);
  });

  test("reads type variables", () => {
    assert.deepEqual(kinds("'a -> 'b"), ["typevar:'a", "symbol:->", "typevar:'b"]);
  });

  test("records spans that point back at the source", () => {
    const [, second] = tokenize("let value = 1");
    assert.deepEqual({ start: second!.span.start, end: second!.span.end }, { start: 4, end: 9 });
  });

  test("rejects unterminated strings", () => {
    assert.throws(() => tokenize('"oops'), (error: unknown) => {
      assert.ok(error instanceof NfError);
      assert.match(error.message, /unterminated string/);
      return true;
    });
  });

  test("rejects unterminated block comments", () => {
    assert.throws(() => tokenize("(* forever"), /unterminated block comment/);
  });

  test("rejects unknown escapes", () => {
    assert.throws(() => tokenize('"\\q"'), /unknown escape sequence/);
  });

  test("rejects stray characters", () => {
    assert.throws(() => tokenize("a ~ b"), /unexpected character/);
  });

  test("rejects numbers glued to identifiers", () => {
    assert.throws(() => tokenize("123abc"), /invalid number literal/);
  });
});
