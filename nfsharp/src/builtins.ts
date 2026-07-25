/**
 * Primitives. Everything here is written in TypeScript because it cannot be
 * expressed in NF# itself; anything that *can* be written in NF# lives in
 * `prelude.nf` instead.
 *
 * Signatures are NF# type syntax and are parsed by the same parser the language
 * uses, so a builtin can never drift from a type the checker cannot express.
 */

import { runtimeError } from "./diagnostics.ts";
import {
  compareValues,
  listFromArray,
  showValue,
  vBool,
  vInt,
  vString,
  vUnit,
  type Value,
} from "./values.ts";

export type Io = { write: (text: string) => void };

export type Builtin = {
  name: string;
  signature: string;
  fn: (args: Value[]) => Value;
};

const asInt = (value: Value): number => (value as { kind: "int"; value: number }).value;
const asString = (value: Value): string => (value as { kind: "string"; value: string }).value;

export function createBuiltins(io: Io): Builtin[] {
  const def = (name: string, signature: string, fn: (args: Value[]) => Value): Builtin => ({
    name,
    signature,
    fn,
  });

  const arithmetic = (name: string, apply: (a: number, b: number) => number): Builtin =>
    def(name, "int -> int -> int", (args) => vInt(apply(asInt(args[0]!), asInt(args[1]!))));

  const ordering = (name: string, accept: (ordering: number) => boolean): Builtin =>
    def(name, "'a -> 'a -> bool", (args) => vBool(accept(compareValues(args[0]!, args[1]!))));

  const divide = (a: number, b: number): number => {
    if (b === 0) throw runtimeError("division by zero");
    return Math.trunc(a / b);
  };

  const modulo = (a: number, b: number): number => {
    if (b === 0) throw runtimeError("division by zero");
    return a % b;
  };

  return [
    // --- arithmetic -------------------------------------------------------
    arithmetic("+", (a, b) => a + b),
    arithmetic("-", (a, b) => a - b),
    arithmetic("*", (a, b) => a * b),
    arithmetic("/", divide),
    arithmetic("%", modulo),
    def("~-", "int -> int", (args) => vInt(-asInt(args[0]!))),

    // --- comparison -------------------------------------------------------
    ordering("=", (c) => c === 0),
    ordering("<>", (c) => c !== 0),
    ordering("<", (c) => c < 0),
    ordering("<=", (c) => c <= 0),
    ordering(">", (c) => c > 0),
    ordering(">=", (c) => c >= 0),
    def("compare", "'a -> 'a -> int", (args) => vInt(compareValues(args[0]!, args[1]!))),

    // --- lists ------------------------------------------------------------
    def("::", "'a -> 'a list -> 'a list", (args) => ({
      kind: "cons",
      head: args[0]!,
      tail: args[1]!,
    })),

    // --- strings ----------------------------------------------------------
    def("^", "string -> string -> string", (args) => vString(asString(args[0]!) + asString(args[1]!))),
    // Strings are measured and indexed in code points, so `string_length`,
    // `string_get`, `string_sub` and `chars` always agree with each other —
    // even where JavaScript would hand back half a surrogate pair.
    def("string_length", "string -> int", (args) => vInt([...asString(args[0]!)].length)),
    def("string_of_int", "int -> string", (args) => vString(String(asInt(args[0]!)))),
    def("int_of_string", "string -> int", (args) => {
      const text = asString(args[0]!).trim();
      if (!/^[+-]?\d+$/.test(text)) {
        throw runtimeError(`int_of_string: ${JSON.stringify(asString(args[0]!))} is not an integer`);
      }
      return vInt(Number(text));
    }),
    def("string_get", "string -> int -> string", (args) => {
      const points = [...asString(args[0]!)];
      const index = asInt(args[1]!);
      if (index < 0 || index >= points.length) {
        throw runtimeError(`string_get: index ${index} is out of bounds for a string of length ${points.length}`);
      }
      return vString(points[index]!);
    }),
    def("string_sub", "string -> int -> int -> string", (args) => {
      const points = [...asString(args[0]!)];
      const start = asInt(args[1]!);
      const length = asInt(args[2]!);
      if (start < 0 || length < 0 || start + length > points.length) {
        throw runtimeError(
          `string_sub: ${start}..${start + length} is out of bounds for a string of length ${points.length}`,
        );
      }
      return vString(points.slice(start, start + length).join(""));
    }),
    def("chars", "string -> string list", (args) =>
      listFromArray([...asString(args[0]!)].map((char) => vString(char)))),

    // --- effects ----------------------------------------------------------
    def("show", "'a -> string", (args) => vString(showValue(args[0]!))),
    def("print", "string -> unit", (args) => {
      io.write(asString(args[0]!));
      return vUnit;
    }),
    def("println", "string -> unit", (args) => {
      io.write(asString(args[0]!) + "\n");
      return vUnit;
    }),
    def("failwith", "string -> 'a", (args) => {
      throw runtimeError(asString(args[0]!));
    }),
  ];
}
