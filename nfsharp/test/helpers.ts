/** Shared helpers for the test suite (not a test file itself). */

import assert from "node:assert/strict";

import { Interpreter, NfError, showValue, typeToString } from "../src/index.ts";

export type RunResult = { output: string; last: string | undefined };

/** Run a program with output captured instead of printed. */
export function run(source: string): RunResult {
  const chunks: string[] = [];
  const interpreter = new Interpreter({ io: { write: (text) => chunks.push(text) } });
  const bindings = interpreter.run(source);
  const last = bindings[bindings.length - 1];
  return {
    output: chunks.join(""),
    last: last?.value === undefined ? undefined : showValue(last.value),
  };
}

/** The printed lines of a program, with the trailing newline removed. */
export function lines(source: string): string[] {
  const { output } = run(source);
  return output === "" ? [] : output.replace(/\n$/, "").split("\n");
}

/** Evaluate an expression and render the result the way `show` would. */
export function evaluate(source: string): string {
  const interpreter = new Interpreter({ io: { write: () => {} } });
  return showValue(interpreter.evaluateExpression(source).value);
}

/** Infer the type of an expression and render it. */
export function typeOf(source: string): string {
  const interpreter = new Interpreter({ io: { write: () => {} } });
  return typeToString(interpreter.evaluateExpression(source).type);
}

/** Type-check a program and return `name : type` for each top-level binding. */
export function signatures(source: string): string[] {
  const interpreter = new Interpreter({ io: { write: () => {} } });
  return interpreter.check(source).map((b) => `${b.name} : ${typeToString(b.type)}`);
}

/** Assert that running `source` fails, and hand the error back for inspection. */
export function failure(source: string, mode: "program" | "expression" = "program"): NfError {
  let error: unknown;
  try {
    const interpreter = new Interpreter({ io: { write: () => {} } });
    if (mode === "program") interpreter.run(source);
    else interpreter.evaluateExpression(source);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof NfError, `expected an NfError from: ${source}`);
  return error;
}

/** Assert an error's phase and that its message contains `fragment`. */
export function assertError(
  error: NfError,
  phase: "syntax" | "type" | "runtime",
  fragment: string,
): void {
  assert.equal(error.phase, phase, `expected a ${phase} error, got ${error.phase}: ${error.message}`);
  const haystack = [error.message, ...error.notes].join(" | ");
  assert.ok(
    haystack.includes(fragment),
    `expected ${JSON.stringify(fragment)} in ${JSON.stringify(haystack)}`,
  );
}
