/**
 * Hindley–Milner type inference (Algorithm W with Rémy's levels).
 *
 * Nothing in NF# is annotated unless you want it to be: types are reconstructed
 * from the shape of the code, and `let` bindings are generalised so that
 * `let id x = x` can be used at `int -> int` and `string -> string` in the same
 * program.
 *
 * There is no value restriction because the language has no mutable references,
 * so generalising every `let` is sound.
 */

import type { Expr, Item, Pattern, Program, RecBinding, TypeExpr } from "./ast.ts";
import { typeError, type Span } from "./diagnostics.ts";
import {
  ARROW,
  con,
  freshVar,
  genericVar,
  prune,
  tBool,
  tFun,
  tInt,
  tList,
  tString,
  tTuple,
  tUnit,
  typeToString,
  type Type,
  type TypeVar,
} from "./types.ts";

export type Scope = { bindings: Map<string, Type>; parent: Scope | null };

export type CtorInfo = {
  name: string;
  typeName: string;
  /** 0 for `None`, 1 for `Some of 'a`. */
  arity: number;
  /** Polymorphic scheme: either `T` or `arg -> T`. */
  scheme: Type;
};

export type Binding = { name: string; type: Type };

/** Raised inside `unifyTypes`; always converted into a spanned error. */
class UnifyFailure extends Error {
  left: Type;
  right: Type;
  infinite: boolean;

  constructor(left: Type, right: Type, infinite = false) {
    super("unification failure");
    this.left = left;
    this.right = right;
    this.infinite = infinite;
  }
}

function instantiate(type: Type, level: number, mapping: Map<number, Type>): Type {
  const pruned = prune(type);
  if (pruned.kind === "var") {
    const state = pruned.var.state;
    if (state.kind === "generic") {
      let fresh = mapping.get(state.id);
      if (fresh === undefined) {
        fresh = freshVar(level);
        mapping.set(state.id, fresh);
      }
      return fresh;
    }
    return pruned;
  }
  if (pruned.args.length === 0) return pruned;
  return con(pruned.name, pruned.args.map((arg) => instantiate(arg, level, mapping)));
}

function generalize(type: Type, level: number): void {
  const pruned = prune(type);
  if (pruned.kind === "var") {
    const state = pruned.var.state;
    if (state.kind === "unbound" && state.level > level) {
      pruned.var.state = { kind: "generic", id: state.id };
    }
    return;
  }
  for (const arg of pruned.args) generalize(arg, level);
}

/**
 * Occurs check, fused with the level adjustment that keeps generalisation
 * honest: any variable reachable from `type` must not outlive `target`.
 */
function occurs(target: TypeVar, targetLevel: number, type: Type): boolean {
  const pruned = prune(type);
  if (pruned.kind === "var") {
    const state = pruned.var.state;
    if (pruned.var === target) return true;
    if (state.kind === "unbound" && state.level > targetLevel) {
      pruned.var.state = { kind: "unbound", id: state.id, level: targetLevel };
    }
    return false;
  }
  let found = false;
  for (const arg of pruned.args) {
    if (occurs(target, targetLevel, arg)) found = true;
  }
  return found;
}

function unifyTypes(a: Type, b: Type): void {
  const left = prune(a);
  const right = prune(b);
  if (left === right) return;

  if (left.kind === "var" && left.var.state.kind === "unbound") {
    const state = left.var.state;
    if (right.kind === "var" && right.var === left.var) return;
    if (occurs(left.var, state.level, right)) throw new UnifyFailure(left, right, true);
    left.var.state = { kind: "link", type: right };
    return;
  }
  if (right.kind === "var" && right.var.state.kind === "unbound") {
    unifyTypes(right, left);
    return;
  }
  if (left.kind === "con" && right.kind === "con") {
    if (left.name !== right.name || left.args.length !== right.args.length) {
      throw new UnifyFailure(left, right);
    }
    for (let i = 0; i < left.args.length; i++) unifyTypes(left.args[i]!, right.args[i]!);
    return;
  }
  throw new UnifyFailure(left, right);
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

const BUILTIN_TYPES: Record<string, number> = { int: 0, bool: 0, string: 0, unit: 0, list: 1 };

export class Checker {
  globals: Map<string, Type>;
  ctors: Map<string, CtorInfo>;
  /** Type constructor name -> arity, for validating annotations. */
  typeArity: Map<string, number>;
  level: number;

  constructor() {
    this.globals = new Map();
    this.ctors = new Map();
    this.typeArity = new Map(Object.entries(BUILTIN_TYPES));
    this.level = 0;
  }

  /** Register a builtin whose signature is written as NF# source, e.g. `'a -> 'a -> bool`. */
  define(name: string, type: Type): void {
    this.globals.set(name, type);
  }

  rootScope(): Scope {
    return { bindings: this.globals, parent: null };
  }

  lookup(scope: Scope, name: string): Type | undefined {
    for (let current: Scope | null = scope; current !== null; current = current.parent) {
      const found = current.bindings.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  namesInScope(scope: Scope): string[] {
    const names: string[] = [];
    for (let current: Scope | null = scope; current !== null; current = current.parent) {
      for (const name of current.bindings.keys()) names.push(name);
    }
    return names;
  }

  child(scope: Scope, bindings: Map<string, Type>): Scope {
    return { bindings, parent: scope };
  }

  // ------------------------------------------------------------- unification

  unify(expected: Type, actual: Type, span: Span, subject = "this expression"): void {
    try {
      unifyTypes(expected, actual);
    } catch (error) {
      if (!(error instanceof UnifyFailure)) throw error;
      const expectedText = typeToString(expected);
      const actualText = typeToString(actual);
      if (error.infinite) {
        throw typeError(
          "this expression would create an infinite type",
          span,
          `${typeToString(error.left)} occurs inside ${typeToString(error.right)}`,
          "a value cannot contain itself",
        );
      }
      const notes = [
        `${subject} has type ${actualText}`,
        `but an expression was expected of type ${expectedText}`,
      ];
      const innerLeft = typeToString(error.left);
      const innerRight = typeToString(error.right);
      if (innerLeft !== expectedText || innerRight !== actualText) {
        notes.push(`the mismatch is between ${innerRight} and ${innerLeft}`);
      }
      throw typeError("type mismatch", span, ...notes);
    }
  }

  // ------------------------------------------------------- type expressions

  /**
   * Convert a written type into an internal one. `mode` decides what `'a` means:
   * `generic` for builtin/constructor schemes (genuinely polymorphic) and
   * `fresh` for user annotations (a constraint on the inferred type).
   */
  typeFromExpr(
    expr: TypeExpr,
    mode: "generic" | "fresh",
    vars: Map<string, Type> = new Map(),
  ): Type {
    switch (expr.kind) {
      case "var": {
        let variable = vars.get(expr.name);
        if (variable === undefined) {
          variable = mode === "generic" ? genericVar() : freshVar(this.level);
          vars.set(expr.name, variable);
        }
        return variable;
      }
      case "fun":
        return tFun(
          this.typeFromExpr(expr.from, mode, vars),
          this.typeFromExpr(expr.to, mode, vars),
        );
      case "tuple":
        return tTuple(expr.items.map((item) => this.typeFromExpr(item, mode, vars)));
      case "con": {
        const arity = this.typeArity.get(expr.name);
        if (arity === undefined) {
          const known = [...this.typeArity.keys()].sort();
          throw typeError(`unknown type \`${expr.name}\``, expr.span, `known types: ${known.join(", ")}`);
        }
        if (arity !== expr.args.length) {
          throw typeError(
            `the type \`${expr.name}\` expects ${arity} argument${arity === 1 ? "" : "s"}, but got ${expr.args.length}`,
            expr.span,
          );
        }
        return con(expr.name, expr.args.map((arg) => this.typeFromExpr(arg, mode, vars)));
      }
    }
  }

  // ------------------------------------------------------------- expressions

  infer(expr: Expr, scope: Scope): Type {
    switch (expr.kind) {
      case "int":
        return tInt;
      case "string":
        return tString;
      case "bool":
        return tBool;
      case "unit":
        return tUnit;

      case "var": {
        const found = this.lookup(scope, expr.name);
        if (found === undefined) {
          const notes: string[] = [];
          const candidates = this.namesInScope(scope)
            .filter((name) => /^[a-zA-Z_]/.test(name))
            .map((name) => ({ name, distance: levenshtein(expr.name, name) }))
            .filter((entry) => entry.distance <= Math.max(1, Math.floor(expr.name.length / 3)))
            .sort((a, b) => a.distance - b.distance);
          if (candidates.length > 0) notes.push(`did you mean \`${candidates[0]!.name}\`?`);
          throw typeError(`unbound value \`${expr.name}\``, expr.span, ...notes);
        }
        return instantiate(found, this.level, new Map());
      }

      case "lambda": {
        const paramType = expr.annot
          ? this.typeFromExpr(expr.annot, "fresh")
          : freshVar(this.level);
        const bindings = new Map<string, Type>();
        if (expr.param !== null) bindings.set(expr.param, paramType);
        const bodyType = this.infer(expr.body, this.child(scope, bindings));
        return tFun(paramType, bodyType);
      }

      case "apply": {
        const fnType = prune(this.infer(expr.fn, scope));
        const argType = this.infer(expr.arg, scope);

        if (fnType.kind === "con" && fnType.name === ARROW) {
          this.unify(fnType.args[0]!, argType, expr.arg.span, "this argument");
          return fnType.args[1]!;
        }
        if (fnType.kind === "var") {
          const result = freshVar(this.level);
          this.unify(fnType, tFun(argType, result), expr.fn.span);
          return result;
        }
        throw typeError(
          "this expression is not a function and cannot be applied",
          expr.fn.span,
          `it has type ${typeToString(fnType)}`,
        );
      }

      case "let": {
        const valueType = this.inferBinding(expr.name, expr.value, scope);
        const bindings = new Map<string, Type>([[expr.name, valueType]]);
        return this.infer(expr.body, this.child(scope, bindings));
      }

      case "letRec": {
        const bindings = this.inferRecGroup(expr.bindings, scope);
        return this.infer(expr.body, this.child(scope, bindings));
      }

      case "if": {
        const condType = this.infer(expr.cond, scope);
        this.unify(tBool, condType, expr.cond.span, "this condition");
        const thenType = this.infer(expr.then, scope);
        const elseIsImplicit =
          expr.otherwise.kind === "unit" &&
          expr.otherwise.span.start === expr.then.span.start &&
          expr.otherwise.span.end === expr.then.span.end;
        if (elseIsImplicit) {
          this.unify(tUnit, thenType, expr.then.span, "this branch");
          return tUnit;
        }
        const elseType = this.infer(expr.otherwise, scope);
        this.unify(thenType, elseType, expr.otherwise.span, "this branch");
        return thenType;
      }

      case "match": {
        const scrutineeType = this.infer(expr.scrutinee, scope);
        const resultType = freshVar(this.level);
        for (const matchCase of expr.cases) {
          const bindings = new Map<string, Type>();
          const patternType = this.inferPattern(matchCase.pattern, bindings);
          this.unify(scrutineeType, patternType, matchCase.pattern.span, "this pattern");
          const bodyType = this.infer(matchCase.body, this.child(scope, bindings));
          this.unify(resultType, bodyType, matchCase.body.span, "this branch");
        }
        return resultType;
      }

      case "list": {
        const elementType = freshVar(this.level);
        for (const item of expr.items) {
          this.unify(elementType, this.infer(item, scope), item.span, "this element");
        }
        return tList(elementType);
      }

      case "tuple":
        return tTuple(expr.items.map((item) => this.infer(item, scope)));

      case "annot": {
        const annotated = this.typeFromExpr(expr.type, "fresh");
        const actual = this.infer(expr.expr, scope);
        this.unify(annotated, actual, expr.expr.span);
        return annotated;
      }
    }
  }

  /** Infer a `let` value, generalising it one level deeper than its use site. */
  inferBinding(name: string, value: Expr, scope: Scope): Type {
    this.level++;
    const valueType = this.infer(value, scope);
    this.level--;
    generalize(valueType, this.level);
    return valueType;
  }

  /**
   * Infer a `let rec` group. Every name is bound to a placeholder *before* any
   * value is checked, so the members can call each other; the placeholders stay
   * monomorphic during that pass and are generalised together at the end.
   */
  inferRecGroup(group: RecBinding[], scope: Scope): Map<string, Type> {
    this.level++;
    const placeholders = new Map<string, Type>();
    for (const binding of group) {
      if (placeholders.has(binding.name)) {
        throw typeError(
          `\`${binding.name}\` is defined twice in the same \`let rec\` group`,
          binding.span,
        );
      }
      placeholders.set(binding.name, freshVar(this.level));
    }

    const inner = this.child(scope, placeholders);
    for (const binding of group) {
      const valueType = this.infer(binding.value, inner);
      this.unify(placeholders.get(binding.name)!, valueType, binding.value.span);
    }
    this.level--;

    for (const type of placeholders.values()) generalize(type, this.level);
    return placeholders;
  }

  // ---------------------------------------------------------------- patterns

  inferPattern(pattern: Pattern, bindings: Map<string, Type>): Type {
    switch (pattern.kind) {
      case "wildcard":
        return freshVar(this.level);
      case "var": {
        if (bindings.has(pattern.name)) {
          throw typeError(
            `\`${pattern.name}\` is bound twice in the same pattern`,
            pattern.span,
          );
        }
        const type = freshVar(this.level);
        bindings.set(pattern.name, type);
        return type;
      }
      case "int":
        return tInt;
      case "string":
        return tString;
      case "bool":
        return tBool;
      case "unit":
        return tUnit;
      case "tuple":
        return tTuple(pattern.items.map((item) => this.inferPattern(item, bindings)));
      case "nil":
        return tList(freshVar(this.level));
      case "cons": {
        const headType = this.inferPattern(pattern.head, bindings);
        const tailType = this.inferPattern(pattern.tail, bindings);
        this.unify(tList(headType), tailType, pattern.tail.span, "this pattern");
        return tList(headType);
      }
      case "ctor": {
        const info = this.ctors.get(pattern.name);
        if (info === undefined) {
          throw typeError(`unknown constructor \`${pattern.name}\``, pattern.span);
        }
        const scheme = prune(instantiate(info.scheme, this.level, new Map()));
        if (info.arity === 0) {
          if (pattern.arg !== null) {
            throw typeError(
              `the constructor \`${pattern.name}\` does not take an argument`,
              pattern.arg.span,
            );
          }
          return scheme;
        }
        if (pattern.arg === null) {
          throw typeError(
            `the constructor \`${pattern.name}\` expects an argument`,
            pattern.span,
            `write \`${pattern.name} x\` to bind it`,
          );
        }
        const fnType = scheme as { kind: "con"; name: string; args: Type[] };
        const argType = this.inferPattern(pattern.arg, bindings);
        this.unify(fnType.args[0]!, argType, pattern.arg.span, "this pattern");
        return fnType.args[1]!;
      }
    }
  }

  /** Type a standalone expression, generalising it so the REPL can show `'a`. */
  inferExpression(expr: Expr): Type {
    this.level++;
    const type = this.infer(expr, this.rootScope());
    this.level--;
    generalize(type, this.level);
    return type;
  }

  // ------------------------------------------------------------------- items

  checkProgram(program: Program): Binding[] {
    const results: Binding[] = [];
    for (const item of program) results.push(...this.checkItem(item));
    return results;
  }

  checkItem(item: Item): Binding[] {
    const scope = this.rootScope();
    switch (item.kind) {
      case "let": {
        const type = this.inferBinding(item.name, item.value, scope);
        this.globals.set(item.name, type);
        return [{ name: item.name, type }];
      }

      case "letRec": {
        const bindings = this.inferRecGroup(item.bindings, scope);
        const results: Binding[] = [];
        for (const [name, type] of bindings) {
          this.globals.set(name, type);
          results.push({ name, type });
        }
        return results;
      }

      case "letPattern": {
        this.level++;
        const valueType = this.infer(item.value, scope);
        const bindings = new Map<string, Type>();
        const patternType = this.inferPattern(item.pattern, bindings);
        this.unify(patternType, valueType, item.value.span);
        this.level--;
        const results: Binding[] = [];
        for (const [name, type] of bindings) {
          generalize(type, this.level);
          this.globals.set(name, type);
          results.push({ name, type });
        }
        return results;
      }

      case "do": {
        const type = this.infer(item.expr, scope);
        this.unify(tUnit, type, item.expr.span, "this `do` expression");
        return [];
      }

      case "type": {
        this.typeArity.set(item.name, item.params.length);
        const vars = new Map<string, Type>();
        for (const param of item.params) vars.set(param, genericVar());
        const result = con(item.name, item.params.map((param) => vars.get(param)!));

        for (const variant of item.variants) {
          if (this.ctors.has(variant.name)) {
            throw typeError(
              `the constructor \`${variant.name}\` is already defined`,
              variant.span,
            );
          }
          let scheme = result;
          if (variant.arg) {
            const declared = vars.size;
            const argType = this.typeFromExpr(variant.arg, "generic", vars);
            if (vars.size !== declared) {
              const extra = [...vars.keys()].slice(declared);
              throw typeError(
                `unbound type variable ${extra.map((v) => `\`${v}\``).join(", ")}`,
                variant.arg.span,
                `add it to the declaration: \`type ${extra[0]!} ${item.name} = ...\``,
              );
            }
            scheme = tFun(argType, result);
          }
          this.ctors.set(variant.name, {
            name: variant.name,
            typeName: item.name,
            arity: variant.arg ? 1 : 0,
            scheme,
          });
          this.globals.set(variant.name, scheme);
        }
        return [];
      }
    }
  }
}
