import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NfError, formatError, positionAt, typeError } from "../src/diagnostics.ts";
import { failure } from "./helpers.ts";

describe("positionAt", () => {
  const source = "one\ntwo\nthree";

  test("counts lines and columns from 1", () => {
    assert.deepEqual(
      { line: positionAt(source, 0).line, column: positionAt(source, 0).column },
      { line: 1, column: 1 },
    );
    assert.deepEqual(
      { line: positionAt(source, 5).line, column: positionAt(source, 5).column },
      { line: 2, column: 2 },
    );
  });

  test("finds the bounds of the line", () => {
    const position = positionAt(source, 5);
    assert.equal(source.slice(position.lineStart, position.lineEnd), "two");
  });

  test("clamps past the end of input", () => {
    assert.equal(positionAt(source, 999).line, 3);
  });
});

describe("formatError", () => {
  test("underlines the offending span", () => {
    const source = 'let x = 1\nlet y = x ^ "s"\n';
    const error = typeError("type mismatch", { start: 18, end: 19 }, "this expression has type int");
    assert.equal(
      formatError(error, source, { filename: "demo.nf" }),
      [
        "error[type]: type mismatch",
        " --> demo.nf:2:9",
        "  |",
        "2 | let y = x ^ \"s\"",
        "  |         ^",
        "  |",
        "  = this expression has type int",
      ].join("\n"),
    );
  });

  test("expands tabs so the caret stays aligned", () => {
    const source = "\tlet x = 1";
    const error = typeError("nope", { start: 5, end: 6 });
    const rendered = formatError(error, source).split("\n");
    const line = rendered[3]!;
    const carets = rendered[4]!;
    assert.equal(line.indexOf("x"), carets.indexOf("^"));
  });

  test("works without a span", () => {
    const error = new NfError("runtime", "stack overflow", null, ["too deep"]);
    assert.equal(formatError(error, ""), "error[runtime]: stack overflow\n  = too deep");
  });

  test("emits colour only when asked", () => {
    const error = typeError("boom", { start: 0, end: 1 });
    assert.doesNotMatch(formatError(error, "x"), /\[/);
    assert.match(formatError(error, "x", { color: true }), /\[31m/);
  });

  test("renders an error against the file it came from, not the caller's", () => {
    // `head []` fails inside the prelude, so the snippet must show the prelude.
    const error = failure("do println (show (head []))");
    const rendered = formatError(error, "do println (show (head []))", { filename: "user.nf" });
    assert.match(rendered, /prelude\.nf:\d+:\d+/);
    assert.match(rendered, /failwith "head: empty list"/);
  });

  test("multi-line spans are cut off at the end of the first line", () => {
    const source = "let f x =\n  x + 1\n";
    const error = typeError("spans two lines", { start: 4, end: 17 });
    const rendered = formatError(error, source).split("\n");
    assert.equal(rendered[3], "1 | let f x =");
    assert.ok(rendered[4]!.endsWith("^^^^^"));
  });
});
