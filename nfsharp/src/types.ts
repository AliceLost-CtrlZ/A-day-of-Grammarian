/**
 * Type representation.
 *
 * Type variables are mutable cells with three states, the classic OCaml
 * encoding: `unbound` (a hole that unification can fill), `link` (already
 * solved — points at another type) and `generic` (quantified by a `let`, i.e.
 * the `'a` in a polymorphic scheme, replaced by a fresh hole at every use).
 *
 * Each unbound variable also records the *level* — the `let` nesting depth
 * where it was created. Generalisation quantifies exactly the variables whose
 * level is deeper than the current one, which is why we never have to scan the
 * whole environment for free variables.
 */

export type Type =
  | { kind: "var"; var: TypeVar }
  | { kind: "con"; name: string; args: Type[] };

export type TypeVar = { state: VarState };

export type VarState =
  | { kind: "unbound"; id: number; level: number }
  | { kind: "link"; type: Type }
  | { kind: "generic"; id: number };

let nextId = 0;

export function freshVar(level: number): Type {
  return { kind: "var", var: { state: { kind: "unbound", id: nextId++, level } } };
}

export function genericVar(): Type {
  return { kind: "var", var: { state: { kind: "generic", id: nextId++ } } };
}

export function con(name: string, args: Type[] = []): Type {
  return { kind: "con", name, args };
}

export const ARROW = "->";
export const TUPLE = "*";

export const tInt = con("int");
export const tBool = con("bool");
export const tString = con("string");
export const tUnit = con("unit");
export const tList = (element: Type): Type => con("list", [element]);
export const tFun = (from: Type, to: Type): Type => con(ARROW, [from, to]);
export const tTuple = (items: Type[]): Type => con(TUPLE, items);

/** Follow `link` chains, compressing them as we go. */
export function prune(type: Type): Type {
  if (type.kind === "var" && type.var.state.kind === "link") {
    const resolved = prune(type.var.state.type);
    type.var.state = { kind: "link", type: resolved };
    return resolved;
  }
  return type;
}

/** `int -> string -> bool` becomes `[[int, string], bool]`. */
export function uncurry(type: Type): { params: Type[]; result: Type } {
  const params: Type[] = [];
  let current = prune(type);
  while (current.kind === "con" && current.name === ARROW) {
    params.push(current.args[0]!);
    current = prune(current.args[1]!);
  }
  return { params, result: current };
}

function letterFor(index: number): string {
  const letter = String.fromCharCode(97 + (index % 26));
  const suffix = Math.floor(index / 26);
  return "'" + letter + (suffix === 0 ? "" : String(suffix));
}

/**
 * Render a type using ML conventions: `->` is right associative, type
 * constructors are postfix (`int list`), and tuples use `*`.
 */
export function typeToString(type: Type): string {
  const names = new Map<number, string>();

  const nameOf = (id: number): string => {
    let name = names.get(id);
    if (name === undefined) {
      name = letterFor(names.size);
      names.set(id, name);
    }
    return name;
  };

  // Precedence: 0 = top (arrow), 1 = tuple, 2 = constructor argument.
  const show = (raw: Type, precedence: number): string => {
    const type = prune(raw);
    if (type.kind === "var") {
      const state = type.var.state;
      if (state.kind === "link") return show(state.type, precedence);
      return nameOf(state.id);
    }
    if (type.name === ARROW) {
      const [from, to] = type.args as [Type, Type];
      const text = `${show(from, 1)} -> ${show(to, 0)}`;
      return precedence > 0 ? `(${text})` : text;
    }
    if (type.name === TUPLE) {
      const text = type.args.map((arg) => show(arg, 2)).join(" * ");
      return precedence > 1 ? `(${text})` : text;
    }
    if (type.args.length === 0) return type.name;
    if (type.args.length === 1) return `${show(type.args[0]!, 2)} ${type.name}`;
    return `(${type.args.map((arg) => show(arg, 0)).join(", ")}) ${type.name}`;
  };

  return show(type, 0);
}
