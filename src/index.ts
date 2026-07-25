/**
 * Public entry point: an `Interpreter` bundles a type checker and a runtime
 * environment that stay in sync, which is what the CLI, the REPL and the tests
 * all drive.
 */

import { readFileSync } from "node:fs";

import type { Item, Program } from "./ast.ts";
import { createBuiltins, type Io } from "./builtins.ts";
import { NfError, runtimeError } from "./diagnostics.ts";
import { Checker, type Binding } from "./infer.ts";
import { evaluate, evaluateItem } from "./interp.ts";
import { parseExpression, parseProgram, parseTypeString } from "./parser.ts";
import { uncurry, type Type } from "./types.ts";
import { lookupEnv, newEnv, type Env, type Value } from "./values.ts";

export const PRELUDE_SOURCE: string = readFileSync(new URL("./prelude.nf", import.meta.url), "utf8");

export type TopLevel = { name: string; type: Type; value: Value | undefined };

export type InterpreterOptions = {
  /** Where `print` and `println` go. Defaults to stdout. */
  io?: Io;
  /** Set to false to start with builtins only. */
  prelude?: boolean;
};

const defaultIo: Io = {
  write: (text) => {
    process.stdout.write(text);
  },
};

export class Interpreter {
  checker: Checker;
  globals: Env;
  io: Io;

  constructor(options: InterpreterOptions = {}) {
    this.io = options.io ?? defaultIo;
    this.checker = new Checker();
    this.globals = newEnv();

    for (const builtin of createBuiltins(this.io)) {
      const type = this.checker.typeFromExpr(parseTypeString(builtin.signature), "generic");
      const arity = uncurry(type).params.length;
      this.checker.define(builtin.name, type);
      this.globals.bindings.set(builtin.name, {
        kind: "builtin",
        name: builtin.name,
        arity,
        applied: [],
        fn: builtin.fn,
      });
    }

    if (options.prelude !== false) this.runProgram(parseProgram(PRELUDE_SOURCE, "prelude.nf"));
  }

  /** Type-check an entire program before running any of it, then run it. */
  run(source: string, name = "<input>"): TopLevel[] {
    return this.runProgram(parseProgram(source, name));
  }

  runProgram(program: Program): TopLevel[] {
    const bindings = this.checker.checkProgram(program);
    guard(() => {
      for (const item of program) evaluateItem(item, this.globals);
    });
    return this.withValues(bindings);
  }

  /** Check and run a single item — used by the REPL, where each line is a step. */
  runItem(item: Item): TopLevel[] {
    const bindings = this.checker.checkItem(item);
    guard(() => evaluateItem(item, this.globals));
    return this.withValues(bindings);
  }

  /** Type-check without running. */
  check(source: string, name = "<input>"): Binding[] {
    return this.checker.checkProgram(parseProgram(source, name));
  }

  /** Infer the type of an expression without running it. */
  typeOfExpression(source: string, name = "<expression>"): Type {
    return this.checker.inferExpression(parseExpression(source, name));
  }

  evaluateExpression(source: string, name = "<expression>"): { value: Value; type: Type } {
    const expr = parseExpression(source, name);
    const type = this.checker.inferExpression(expr);
    const value = guard(() => evaluate(expr, this.globals));
    return { value, type };
  }

  withValues(bindings: Binding[]): TopLevel[] {
    return bindings.map((binding) => ({
      name: binding.name,
      type: binding.type,
      value: lookupEnv(this.globals, binding.name),
    }));
  }
}

/** Turn host-level stack exhaustion into a normal NF# error. */
function guard<T>(thunk: () => T): T {
  try {
    return thunk();
  } catch (error) {
    if (error instanceof RangeError && /call stack/i.test(error.message)) {
      throw runtimeError(
        "stack overflow",
        null,
        "this program recursed too deeply",
        "tail calls run in constant space — consider rewriting with an accumulator",
      );
    }
    throw error;
  }
}

export { NfError };
export { formatError } from "./diagnostics.ts";
export { typeToString } from "./types.ts";
export { showValue } from "./values.ts";
export type { Binding } from "./infer.ts";
export type { Value } from "./values.ts";
export type { Type } from "./types.ts";
