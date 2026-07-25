/** Runtime values, structural comparison, and value printing. */

import type { Expr } from "./ast.ts";
import { runtimeError } from "./diagnostics.ts";

export type Env = { bindings: Map<string, Value>; parent: Env | null };

export type Value =
  | { kind: "int"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "unit" }
  | { kind: "nil" }
  | { kind: "cons"; head: Value; tail: Value }
  | { kind: "tuple"; items: Value[] }
  | { kind: "closure"; param: string | null; body: Expr; env: Env }
  /** Curried primitive: collects `arity` arguments before firing. */
  | { kind: "builtin"; name: string; arity: number; applied: Value[]; fn: (args: Value[]) => Value }
  /** A data constructor applied to its argument, e.g. `Some 3`. */
  | { kind: "ctor"; name: string; index: number; arg: Value | null };

export const vInt = (value: number): Value => ({ kind: "int", value });
export const vBool = (value: boolean): Value => ({ kind: "bool", value });
export const vString = (value: string): Value => ({ kind: "string", value });
export const vUnit: Value = { kind: "unit" };
export const vNil: Value = { kind: "nil" };
export const vCons = (head: Value, tail: Value): Value => ({ kind: "cons", head, tail });

export function listFromArray(items: Value[]): Value {
  let list: Value = vNil;
  for (let i = items.length - 1; i >= 0; i--) list = vCons(items[i]!, list);
  return list;
}

export function listToArray(value: Value): Value[] {
  const items: Value[] = [];
  let current = value;
  while (current.kind === "cons") {
    items.push(current.head);
    current = current.tail;
  }
  return items;
}

export function newEnv(parent: Env | null = null): Env {
  return { bindings: new Map(), parent };
}

export function lookupEnv(env: Env, name: string): Value | undefined {
  for (let current: Env | null = env; current !== null; current = current.parent) {
    const found = current.bindings.get(name);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extendEnv(env: Env, name: string | null, value: Value): Env {
  const bindings = new Map<string, Value>();
  if (name !== null) bindings.set(name, value);
  return { bindings, parent: env };
}

function escapeString(text: string): string {
  let out = '"';
  for (const char of text) {
    switch (char) {
      case '"': out += '\\"'; break;
      case "\\": out += "\\\\"; break;
      case "\n": out += "\\n"; break;
      case "\t": out += "\\t"; break;
      case "\r": out += "\\r"; break;
      default: out += char;
    }
  }
  return out + '"';
}

/**
 * Render a value the way `show` does: lists as `[1; 2; 3]`, tuples as
 * `(1, "a")`, strings quoted, functions opaque.
 */
export function showValue(value: Value, nested = false): string {
  switch (value.kind) {
    case "int":
      return String(value.value);
    case "bool":
      return value.value ? "true" : "false";
    case "string":
      return escapeString(value.value);
    case "unit":
      return "()";
    case "nil":
    case "cons":
      return "[" + listToArray(value).map((item) => showValue(item)).join("; ") + "]";
    case "tuple":
      return "(" + value.items.map((item) => showValue(item)).join(", ") + ")";
    case "closure":
    case "builtin":
      return "<fun>";
    case "ctor": {
      if (value.arg === null) return value.name;
      const arg = showValue(value.arg, true);
      const text = `${value.name} ${arg}`;
      return nested ? `(${text})` : text;
    }
  }
}

/** Structural three-way comparison; the basis of `=`, `<`, `compare` and `sort`. */
export function compareValues(a: Value, b: Value): number {
  if (a.kind === "closure" || a.kind === "builtin" || b.kind === "closure" || b.kind === "builtin") {
    throw runtimeError("functions cannot be compared");
  }
  switch (a.kind) {
    case "int":
      return Math.sign(a.value - (b as { value: number }).value);
    case "bool": {
      const left = a.value ? 1 : 0;
      const right = (b as { value: boolean }).value ? 1 : 0;
      return Math.sign(left - right);
    }
    case "string": {
      const right = (b as { value: string }).value;
      return a.value < right ? -1 : a.value > right ? 1 : 0;
    }
    case "unit":
      return 0;
    case "nil":
      return b.kind === "nil" ? 0 : -1;
    case "cons": {
      if (b.kind === "nil") return 1;
      const other = b as { head: Value; tail: Value };
      const head = compareValues(a.head, other.head);
      return head !== 0 ? head : compareValues(a.tail, other.tail);
    }
    case "tuple": {
      const other = b as { items: Value[] };
      for (let i = 0; i < a.items.length; i++) {
        const result = compareValues(a.items[i]!, other.items[i]!);
        if (result !== 0) return result;
      }
      return 0;
    }
    case "ctor": {
      const other = b as { index: number; arg: Value | null };
      if (a.index !== other.index) return Math.sign(a.index - other.index);
      if (a.arg === null || other.arg === null) return 0;
      return compareValues(a.arg, other.arg);
    }
  }
}
