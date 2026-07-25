/**
 * Tree-walking evaluator.
 *
 * `evaluate` loops instead of recursing whenever the next thing to evaluate is
 * in tail position, so tail calls run in constant stack space. Non-tail
 * recursion still uses the host stack, and a blown stack is reported as an
 * ordinary NF# error by `Interpreter.run`.
 */

import type { Expr, Item, Pattern } from "./ast.ts";
import { NfError, runtimeError, type Span } from "./diagnostics.ts";
import {
  extendEnv,
  listFromArray,
  lookupEnv,
  showValue,
  vBool,
  vInt,
  vString,
  vUnit,
  type Env,
  type Value,
} from "./values.ts";

/** Attach a span to primitive failures (`division by zero`, `failwith`, ...). */
function withSpan<T>(span: Span | null, thunk: () => T): T {
  try {
    return thunk();
  } catch (error) {
    if (error instanceof NfError && error.span === null && span !== null) error.span = span;
    throw error;
  }
}

export function applyValue(fn: Value, arg: Value, span: Span | null = null): Value {
  if (fn.kind === "closure") {
    return evaluate(fn.body, extendEnv(fn.env, fn.param, arg));
  }
  if (fn.kind === "builtin") {
    const applied = [...fn.applied, arg];
    if (applied.length < fn.arity) return { ...fn, applied };
    return withSpan(span, () => fn.fn(applied));
  }
  throw runtimeError(`cannot apply ${showValue(fn)} as a function`, span);
}

export function matchPattern(pattern: Pattern, value: Value, bindings: Map<string, Value>): boolean {
  switch (pattern.kind) {
    case "wildcard":
      return true;
    case "var":
      bindings.set(pattern.name, value);
      return true;
    case "int":
      return value.kind === "int" && value.value === pattern.value;
    case "string":
      return value.kind === "string" && value.value === pattern.value;
    case "bool":
      return value.kind === "bool" && value.value === pattern.value;
    case "unit":
      return true;
    case "tuple":
      return (
        value.kind === "tuple" &&
        pattern.items.every((item, i) => matchPattern(item, value.items[i]!, bindings))
      );
    case "nil":
      return value.kind === "nil";
    case "cons":
      return (
        value.kind === "cons" &&
        matchPattern(pattern.head, value.head, bindings) &&
        matchPattern(pattern.tail, value.tail, bindings)
      );
    case "ctor":
      if (value.kind !== "ctor" || value.name !== pattern.name) return false;
      if (pattern.arg === null) return true;
      return value.arg !== null && matchPattern(pattern.arg, value.arg, bindings);
  }
}

export function evaluate(initialExpr: Expr, initialEnv: Env): Value {
  let expr = initialExpr;
  let env = initialEnv;

  for (;;) {
    switch (expr.kind) {
      case "int":
        return vInt(expr.value);
      case "string":
        return vString(expr.value);
      case "bool":
        return vBool(expr.value);
      case "unit":
        return vUnit;

      case "var": {
        const value = lookupEnv(env, expr.name);
        if (value === undefined) {
          // The type checker rejects unbound names, so this means a bug in NF#
          // itself — or a `let rec` value used before it was defined.
          throw runtimeError(`\`${expr.name}\` is not defined yet`, expr.span);
        }
        return value;
      }

      case "lambda":
        return { kind: "closure", param: expr.param, body: expr.body, env };

      case "annot":
        expr = expr.expr;
        continue;

      case "list":
        return listFromArray(expr.items.map((item) => evaluate(item, env)));

      case "tuple":
        return { kind: "tuple", items: expr.items.map((item) => evaluate(item, env)) };

      case "if": {
        const condition = evaluate(expr.cond, env);
        expr = (condition as { kind: "bool"; value: boolean }).value ? expr.then : expr.otherwise;
        continue;
      }

      case "let":
        env = extendEnv(env, expr.name, evaluate(expr.value, env));
        expr = expr.body;
        continue;

      case "letRec": {
        // Each closure captures `inner`, which we fill in immediately after
        // building them — that back-reference is what makes the group
        // recursive, and lets its members call each other.
        const inner = extendEnv(env, null, vUnit);
        for (const binding of expr.bindings) {
          inner.bindings.set(binding.name, evaluate(binding.value, inner));
        }
        env = inner;
        expr = expr.body;
        continue;
      }

      case "match": {
        const scrutinee = evaluate(expr.scrutinee, env);
        let matched = false;
        for (const matchCase of expr.cases) {
          const bindings = new Map<string, Value>();
          if (matchPattern(matchCase.pattern, scrutinee, bindings)) {
            env = { bindings, parent: env };
            expr = matchCase.body;
            matched = true;
            break;
          }
        }
        if (matched) continue;
        throw runtimeError(
          "no pattern matched this value",
          expr.scrutinee.span,
          `the value was ${showValue(scrutinee)}`,
          "add a `| _ -> ...` case to handle it",
        );
      }

      case "apply": {
        const fn = evaluate(expr.fn, env);
        const arg = evaluate(expr.arg, env);
        if (fn.kind === "closure") {
          // Tail call: reuse this loop iteration instead of the host stack.
          env = extendEnv(fn.env, fn.param, arg);
          expr = fn.body;
          continue;
        }
        return applyValue(fn, arg, expr.span);
      }
    }
  }
}

/** Evaluate one top-level item, mutating `globals`. */
export function evaluateItem(item: Item, globals: Env): void {
  switch (item.kind) {
    case "let":
      globals.bindings.set(item.name, evaluate(item.value, globals));
      return;

    case "letRec":
      // Top-level closures capture `globals` itself, so every member of the
      // group sees the others as soon as they are installed.
      for (const binding of item.bindings) {
        globals.bindings.set(binding.name, evaluate(binding.value, globals));
      }
      return;

    case "letPattern": {
      const value = evaluate(item.value, globals);
      const bindings = new Map<string, Value>();
      if (!matchPattern(item.pattern, value, bindings)) {
        throw runtimeError(
          "this pattern does not match the value",
          item.pattern.span,
          `the value was ${showValue(value)}`,
        );
      }
      for (const [name, bound] of bindings) globals.bindings.set(name, bound);
      return;
    }

    case "do":
      evaluate(item.expr, globals);
      return;

    case "type": {
      item.variants.forEach((variant, index) => {
        if (variant.arg === null) {
          globals.bindings.set(variant.name, {
            kind: "ctor",
            name: variant.name,
            index,
            arg: null,
          });
        } else {
          globals.bindings.set(variant.name, {
            kind: "builtin",
            name: variant.name,
            arity: 1,
            applied: [],
            fn: (args) => ({ kind: "ctor", name: variant.name, index, arg: args[0]! }),
          });
        }
      });
      return;
    }
  }
}
