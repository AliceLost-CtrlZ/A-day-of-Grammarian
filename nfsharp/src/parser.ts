/**
 * Recursive-descent parser with precedence climbing for infix operators.
 *
 * Grammar sketch:
 *
 *   program ::= item*
 *   item    ::= "let" ["rec"] name param* [":" type] "=" expr
 *             | "let" pattern "=" expr
 *             | "do" expr
 *             | "type" [typarams] name "=" variant ("|" variant)*
 *   expr    ::= "let" ... "in" expr | "fun" param+ "->" expr
 *             | "if" expr "then" expr ["else" expr]
 *             | "match" expr "with" ("|" pattern "->" expr)+
 *             | expr binop expr | "-" expr | atom+
 */

import type {
  Expr,
  Item,
  MatchCase,
  Pattern,
  Program,
  RecBinding,
  TypeExpr,
  Variant,
} from "./ast.ts";
import { joinSpans, syntaxError, type Span } from "./diagnostics.ts";
import { describeToken, tokenize, type Token } from "./lexer.ts";

type Infix = { bp: number; rightAssoc: boolean };

/** Binding powers: higher binds tighter. Application (not listed) beats them all. */
const INFIX: Record<string, Infix> = {
  "|>": { bp: 1, rightAssoc: false },
  "||": { bp: 2, rightAssoc: true },
  "&&": { bp: 3, rightAssoc: true },
  "=": { bp: 4, rightAssoc: false },
  "<>": { bp: 4, rightAssoc: false },
  "<": { bp: 4, rightAssoc: false },
  "<=": { bp: 4, rightAssoc: false },
  ">": { bp: 4, rightAssoc: false },
  ">=": { bp: 4, rightAssoc: false },
  "::": { bp: 5, rightAssoc: true },
  "@": { bp: 5, rightAssoc: true },
  "^": { bp: 5, rightAssoc: true },
  "+": { bp: 6, rightAssoc: false },
  "-": { bp: 6, rightAssoc: false },
  "*": { bp: 7, rightAssoc: false },
  "/": { bp: 7, rightAssoc: false },
  "%": { bp: 7, rightAssoc: false },
};

/** Operators usable as a value via a section, e.g. `fold_left (+) 0 xs`. */
const SECTIONABLE = new Set(["+", "-", "*", "/", "%", "^", "=", "<>", "<", "<=", ">", ">=", "::", "@"]);

/** `@` is not a primitive: it is the prelude's `append`. */
const OPERATOR_FUNCTIONS: Record<string, string> = { "@": "append" };

const isUpper = (name: string) => name.length > 0 && name[0]! >= "A" && name[0]! <= "Z";

type Param =
  | { kind: "name"; name: string | null; annot: TypeExpr | null; span: Span }
  | { kind: "pattern"; pattern: Pattern; span: Span };

class Parser {
  tokens: Token[];
  pos: number;
  /** Counter for the invisible names introduced by destructuring parameters. */
  gensym: number;

  constructor(source: string, name = "<input>") {
    this.tokens = tokenize(source, { name, text: source });
    this.pos = 0;
    this.gensym = 0;
  }

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  next(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.pos++;
    return token;
  }

  atSymbol(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === "symbol" && token.value === value;
  }

  atKeyword(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === "keyword" && token.value === value;
  }

  atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  fail(message: string, token: Token = this.peek(), ...notes: string[]): never {
    throw syntaxError(message, token.span, ...notes);
  }

  expectSymbol(value: string, context: string): Token {
    if (!this.atSymbol(value)) {
      this.fail(`expected \`${value}\` ${context}, found ${describeToken(this.peek())}`);
    }
    return this.next();
  }

  expectKeyword(value: string, context: string): Token {
    if (!this.atKeyword(value)) {
      this.fail(`expected \`${value}\` ${context}, found ${describeToken(this.peek())}`);
    }
    return this.next();
  }

  expectIdent(context: string): Token {
    if (this.peek().kind !== "ident") {
      this.fail(`expected an identifier ${context}, found ${describeToken(this.peek())}`);
    }
    return this.next();
  }

  // ------------------------------------------------------------------ items

  parseProgram(): Program {
    const items: Item[] = [];
    while (!this.atEnd()) items.push(this.parseItem());
    return items;
  }

  parseItem(): Item {
    if (this.atKeyword("let")) return this.parseLetItem();
    if (this.atKeyword("do")) {
      const start = this.next().span;
      const expr = this.parseExpr(0);
      return { kind: "do", expr, span: joinSpans(start, expr.span) };
    }
    if (this.atKeyword("type")) return this.parseTypeDecl();
    this.fail(
      `expected a top-level definition, found ${describeToken(this.peek())}`,
      this.peek(),
      "top-level items are `let`, `type` and `do`",
      'to run an expression for its effects, write `do println "hi"`',
    );
  }

  parseLetItem(): Item {
    const start = this.expectKeyword("let", "to start a definition").span;

    // Destructuring form: `let (a, b) = expr`
    if (!this.atKeyword("rec") && this.peek().kind !== "ident") {
      const pattern = this.parsePattern();
      this.expectSymbol("=", "after the pattern of a `let` binding");
      const value = this.parseExpr(0);
      this.rejectStrayIn();
      return { kind: "letPattern", pattern, value, span: joinSpans(start, value.span) };
    }

    const first = this.parseBinding(start);
    if (!first.recursive) {
      this.rejectStrayIn();
      return { kind: "let", name: first.name, value: first.value, span: first.span };
    }

    const bindings = this.parseRecGroup(first);
    this.rejectStrayIn();
    return {
      kind: "letRec",
      bindings,
      span: joinSpans(start, bindings[bindings.length - 1]!.span),
    };
  }

  /** Collect the `and`-separated members of a `let rec` group. */
  parseRecGroup(first: { name: string; value: Expr; span: Span }): RecBinding[] {
    const bindings: RecBinding[] = [{ name: first.name, value: first.value, span: first.span }];
    while (this.atKeyword("and")) {
      const start = this.next().span;
      const binding = this.parseBinding(start, true);
      bindings.push({ name: binding.name, value: binding.value, span: binding.span });
    }
    return bindings;
  }

  rejectStrayIn(): void {
    if (this.atKeyword("in")) {
      this.fail(
        "unexpected `in` at the top level",
        this.peek(),
        "top-level `let` definitions are visible in everything that follows them",
        "`let ... in ...` is only used inside an expression",
      );
    }
  }

  /**
   * Shared by top-level items and `let ... in ...` expressions. `inGroup` marks
   * the members after `and`, which inherit `rec` from the head of the group.
   */
  parseBinding(
    start: Span,
    inGroup = false,
  ): { recursive: boolean; name: string; value: Expr; span: Span } {
    const recursive = inGroup || (this.atKeyword("rec") ? (this.next(), true) : false);
    const nameToken = this.expectIdent(inGroup ? "after `and`" : "after `let`");
    const name = nameToken.value;

    const params: Param[] = [];
    while (!this.atSymbol("=") && !this.atSymbol(":")) {
      params.push(this.parseParam());
    }

    let annot: TypeExpr | null = null;
    if (this.atSymbol(":")) {
      this.next();
      annot = this.parseTypeExpr();
    }
    this.expectSymbol("=", `after the parameters of \`${name}\``);

    let body = this.parseExpr(0);
    if (annot) body = { kind: "annot", expr: body, type: annot, span: joinSpans(body.span, annot.span) };
    const value = this.foldParams(params, body);

    if (recursive && !definesFunction(value)) {
      throw syntaxError(
        `\`${inGroup ? "and" : "let rec"} ${name}\` must define a function`,
        joinSpans(start, value.span),
        "NF# evaluates eagerly, so a recursive value would need itself before it exists",
        `write \`let rec ${name} x = ...\` or drop \`rec\``,
      );
    }
    return { recursive, name, value, span: joinSpans(start, value.span) };
  }

  parseParam(): Param {
    const token = this.peek();
    if (token.kind === "ident") {
      this.next();
      return { kind: "name", name: token.value, annot: null, span: token.span };
    }
    if (this.atSymbol("_")) {
      this.next();
      return { kind: "name", name: null, annot: null, span: token.span };
    }
    if (this.atSymbol("(")) {
      const start = this.peek().span;
      // `()` — a parameter that must be unit.
      if (this.atSymbol(")", 1)) {
        this.next();
        const end = this.next().span;
        const span = joinSpans(start, end);
        return { kind: "name", name: null, annot: { kind: "con", name: "unit", args: [], span }, span };
      }
      // `(name : type)` — an annotated parameter.
      if (this.peek(1).kind === "ident" && this.atSymbol(":", 2)) {
        this.next();
        const inner = this.next();
        this.next();
        const annot = this.parseTypeExpr();
        const end = this.expectSymbol(")", "to close an annotated parameter").span;
        return { kind: "name", name: inner.value, annot, span: joinSpans(start, end) };
      }
      // Anything else is a destructuring pattern: `fun (a, b) -> ...`
      const pattern = this.parsePatternAtom();
      return { kind: "pattern", pattern, span: pattern.span };
    }
    this.fail(
      `expected a parameter, found ${describeToken(token)}`,
      token,
      "parameters are names, `_`, `()`, `(name : type)` or a pattern like `(a, b)`",
    );
  }

  /** Turn `f a (b, c) = body` into nested single-argument lambdas. */
  foldParams(params: Param[], body: Expr): Expr {
    let result = body;
    for (let i = params.length - 1; i >= 0; i--) {
      const param = params[i]!;
      const span = joinSpans(param.span, result.span);
      if (param.kind === "name") {
        result = { kind: "lambda", param: param.name, annot: param.annot, body: result, span };
      } else {
        // `$` cannot appear in user identifiers, so this name is unshadowable.
        const name = `$arg${this.gensym++}`;
        result = {
          kind: "lambda",
          param: name,
          annot: null,
          body: {
            kind: "match",
            scrutinee: { kind: "var", name, span: param.span },
            cases: [{ pattern: param.pattern, body: result, span }],
            span,
          },
          span,
        };
      }
    }
    return result;
  }

  parseTypeDecl(): Item {
    const start = this.expectKeyword("type", "to start a type declaration").span;

    const params: string[] = [];
    if (this.peek().kind === "typevar") {
      params.push(this.next().value);
    } else if (this.atSymbol("(") && this.peek(1).kind === "typevar") {
      this.next();
      params.push(this.next().value);
      while (this.atSymbol(",")) {
        this.next();
        const tv = this.peek();
        if (tv.kind !== "typevar") this.fail(`expected a type variable, found ${describeToken(tv)}`);
        params.push(this.next().value);
      }
      this.expectSymbol(")", "to close the type parameter list");
    }

    const nameToken = this.expectIdent("as the name of the type");
    this.expectSymbol("=", `after \`type ${nameToken.value}\``);
    if (this.atSymbol("|")) this.next();

    const variants: Variant[] = [];
    for (;;) {
      const ctor = this.peek();
      if (ctor.kind !== "ident" || !isUpper(ctor.value)) {
        this.fail(
          `expected a constructor name, found ${describeToken(ctor)}`,
          ctor,
          "constructors start with a capital letter, like `Some` or `Leaf`",
        );
      }
      this.next();
      let arg: TypeExpr | null = null;
      let span = ctor.span;
      if (this.atKeyword("of")) {
        this.next();
        arg = this.parseTypeExpr();
        span = joinSpans(span, arg.span);
      }
      variants.push({ name: ctor.value, arg, span });
      if (!this.atSymbol("|")) break;
      this.next();
    }

    return {
      kind: "type",
      name: nameToken.value,
      params,
      variants,
      span: joinSpans(start, variants[variants.length - 1]!.span),
    };
  }

  // ------------------------------------------------------------ expressions

  parseExpr(minBp: number): Expr {
    let lhs = this.parsePrefix();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "symbol") break;
      const op = INFIX[token.value];
      if (op === undefined || op.bp < minBp) break;
      this.next();
      const rhs = this.parseExpr(op.rightAssoc ? op.bp : op.bp + 1);
      lhs = buildInfix(token, lhs, rhs);
    }
    return lhs;
  }

  parsePrefix(): Expr {
    if (this.atKeyword("let")) return this.parseLetExpr();
    if (this.atKeyword("fun")) return this.parseLambda();
    if (this.atKeyword("if")) return this.parseIf();
    if (this.atKeyword("match")) return this.parseMatch();
    if (this.atSymbol("-")) {
      const start = this.next().span;
      const operand = this.parsePrefix();
      const span = joinSpans(start, operand.span);
      return { kind: "apply", fn: { kind: "var", name: "~-", span: start }, arg: operand, span };
    }
    return this.parseApplication();
  }

  parseLetExpr(): Expr {
    const start = this.peek().span;
    this.next();

    if (!this.atKeyword("rec") && this.peek().kind !== "ident") {
      const pattern = this.parsePattern();
      this.expectSymbol("=", "after the pattern of a `let` binding");
      const value = this.parseExpr(0);
      this.expectKeyword("in", "after the value of a `let` expression");
      const body = this.parseExpr(0);
      const span = joinSpans(start, body.span);
      // `let pat = v in body` is exactly a single-case match.
      return {
        kind: "match",
        scrutinee: value,
        cases: [{ pattern, body, span: joinSpans(pattern.span, body.span) }],
        span,
      };
    }

    const binding = this.parseBinding(start);
    if (binding.recursive) {
      const bindings = this.parseRecGroup(binding);
      this.expectKeyword("in", "after the value of a `let` expression");
      const body = this.parseExpr(0);
      return { kind: "letRec", bindings, body, span: joinSpans(start, body.span) };
    }
    this.expectKeyword("in", "after the value of a `let` expression");
    const body = this.parseExpr(0);
    return {
      kind: "let",
      name: binding.name,
      value: binding.value,
      body,
      span: joinSpans(start, body.span),
    };
  }

  parseLambda(): Expr {
    const start = this.expectKeyword("fun", "to start a lambda").span;
    const params: Param[] = [this.parseParam()];
    while (!this.atSymbol("->")) params.push(this.parseParam());
    this.expectSymbol("->", "after the parameters of a lambda");
    const body = this.parseExpr(0);
    const lambda = this.foldParams(params, body);
    return { ...lambda, span: joinSpans(start, body.span) };
  }

  parseIf(): Expr {
    const start = this.expectKeyword("if", "to start a conditional").span;
    const cond = this.parseExpr(0);
    this.expectKeyword("then", "after the condition of an `if`");
    const then = this.parseExpr(0);
    if (!this.atKeyword("else")) {
      // `if c then e` is shorthand for `if c then e else ()`
      return {
        kind: "if",
        cond,
        then,
        otherwise: { kind: "unit", span: then.span },
        span: joinSpans(start, then.span),
      };
    }
    this.next();
    const otherwise = this.parseExpr(0);
    return { kind: "if", cond, then, otherwise, span: joinSpans(start, otherwise.span) };
  }

  parseMatch(): Expr {
    const start = this.expectKeyword("match", "to start a match").span;
    const scrutinee = this.parseExpr(0);
    this.expectKeyword("with", "after the scrutinee of a `match`");
    if (this.atSymbol("|")) this.next();

    const cases: MatchCase[] = [];
    for (;;) {
      const pattern = this.parsePattern();
      this.expectSymbol("->", "after a match pattern");
      const body = this.parseExpr(0);
      cases.push({ pattern, body, span: joinSpans(pattern.span, body.span) });
      if (!this.atSymbol("|")) break;
      this.next();
    }
    return { kind: "match", scrutinee, cases, span: joinSpans(start, cases[cases.length - 1]!.span) };
  }

  atAtomStart(): boolean {
    const token = this.peek();
    switch (token.kind) {
      case "int":
      case "string":
      case "ident":
        return true;
      case "keyword":
        return token.value === "true" || token.value === "false";
      case "symbol":
        return token.value === "(" || token.value === "[";
      default:
        return false;
    }
  }

  parseApplication(): Expr {
    let fn = this.parseAtom();
    while (this.atAtomStart()) {
      const arg = this.parseAtom();
      fn = { kind: "apply", fn, arg, span: joinSpans(fn.span, arg.span) };
    }
    return fn;
  }

  parseAtom(): Expr {
    const token = this.peek();
    switch (token.kind) {
      case "int":
        this.next();
        return { kind: "int", value: Number(token.value), span: token.span };
      case "string":
        this.next();
        return { kind: "string", value: token.value, span: token.span };
      case "ident":
        this.next();
        return { kind: "var", name: token.value, span: token.span };
      case "keyword":
        if (token.value === "true" || token.value === "false") {
          this.next();
          return { kind: "bool", value: token.value === "true", span: token.span };
        }
        break;
      case "symbol":
        if (token.value === "(") return this.parseParenthesised();
        if (token.value === "[") return this.parseListLiteral();
        break;
      default:
        break;
    }
    this.fail(`expected an expression, found ${describeToken(token)}`);
  }

  parseParenthesised(): Expr {
    const start = this.expectSymbol("(", "to start a parenthesised expression").span;

    if (this.atSymbol(")")) {
      const end = this.next().span;
      return { kind: "unit", span: joinSpans(start, end) };
    }

    // Operator section: `(+)`, `(::)`
    const op = this.peek();
    if (op.kind === "symbol" && this.atSymbol(")", 1)) {
      if (!SECTIONABLE.has(op.value)) {
        this.fail(
          `\`${op.value}\` cannot be used as a value`,
          op,
          `write \`fun a b -> a ${op.value} b\` instead`,
        );
      }
      this.next();
      const end = this.next().span;
      const name = OPERATOR_FUNCTIONS[op.value] ?? op.value;
      return { kind: "var", name, span: joinSpans(start, end) };
    }

    const first = this.parseExpr(0);

    // `(effect; result)` — sequencing. The left side must have type unit, which
    // is why it is wrapped in an annotation rather than simply discarded.
    if (this.atSymbol(";")) {
      let sequence = first;
      while (this.atSymbol(";")) {
        this.next();
        if (this.atSymbol(")")) break; // trailing `;`
        const rest = this.parseExpr(0);
        const span = joinSpans(sequence.span, rest.span);
        sequence = {
          kind: "match",
          scrutinee: {
            kind: "annot",
            expr: sequence,
            type: { kind: "con", name: "unit", args: [], span: sequence.span },
            span: sequence.span,
          },
          cases: [{ pattern: { kind: "wildcard", span: sequence.span }, body: rest, span }],
          span,
        };
      }
      const end = this.expectSymbol(")", "to close a sequence").span;
      return { ...sequence, span: joinSpans(start, end) };
    }

    if (this.atSymbol(",")) {
      const items = [first];
      while (this.atSymbol(",")) {
        this.next();
        items.push(this.parseExpr(0));
      }
      const end = this.expectSymbol(")", "to close a tuple").span;
      return { kind: "tuple", items, span: joinSpans(start, end) };
    }

    if (this.atSymbol(":")) {
      this.next();
      const type = this.parseTypeExpr();
      const end = this.expectSymbol(")", "to close a type annotation").span;
      return { kind: "annot", expr: first, type, span: joinSpans(start, end) };
    }

    const end = this.expectSymbol(")", "to close a parenthesised expression").span;
    return { ...first, span: joinSpans(start, end) };
  }

  parseListLiteral(): Expr {
    const start = this.expectSymbol("[", "to start a list").span;
    const items: Expr[] = [];
    if (!this.atSymbol("]")) {
      items.push(this.parseExpr(0));
      while (this.atSymbol(";")) {
        this.next();
        if (this.atSymbol("]")) break; // trailing `;`
        items.push(this.parseExpr(0));
      }
    }
    const end = this.expectSymbol("]", "to close a list").span;
    return { kind: "list", items, span: joinSpans(start, end) };
  }

  // --------------------------------------------------------------- patterns

  parsePattern(): Pattern {
    const head = this.parsePatternAtom();
    if (this.atSymbol("::")) {
      this.next();
      const tail = this.parsePattern();
      return { kind: "cons", head, tail, span: joinSpans(head.span, tail.span) };
    }
    return head;
  }

  atPatternAtomStart(): boolean {
    const token = this.peek();
    switch (token.kind) {
      case "int":
      case "string":
      case "ident":
        return true;
      case "keyword":
        return token.value === "true" || token.value === "false";
      case "symbol":
        return token.value === "(" || token.value === "[" || token.value === "_";
      default:
        return false;
    }
  }

  parsePatternAtom(): Pattern {
    const token = this.peek();

    if (token.kind === "int") {
      this.next();
      return { kind: "int", value: Number(token.value), span: token.span };
    }
    if (token.kind === "string") {
      this.next();
      return { kind: "string", value: token.value, span: token.span };
    }
    if (token.kind === "keyword" && (token.value === "true" || token.value === "false")) {
      this.next();
      return { kind: "bool", value: token.value === "true", span: token.span };
    }
    if (token.kind === "ident") {
      this.next();
      if (!isUpper(token.value)) return { kind: "var", name: token.value, span: token.span };
      const arg = this.atPatternAtomStart() ? this.parsePatternAtom() : null;
      return {
        kind: "ctor",
        name: token.value,
        arg,
        span: arg ? joinSpans(token.span, arg.span) : token.span,
      };
    }
    if (this.atSymbol("_")) {
      this.next();
      return { kind: "wildcard", span: token.span };
    }
    if (this.atSymbol("-") && this.peek(1).kind === "int") {
      this.next();
      const digits = this.next();
      return { kind: "int", value: -Number(digits.value), span: joinSpans(token.span, digits.span) };
    }
    if (this.atSymbol("(")) {
      const start = this.next().span;
      if (this.atSymbol(")")) {
        const end = this.next().span;
        return { kind: "unit", span: joinSpans(start, end) };
      }
      const first = this.parsePattern();
      if (this.atSymbol(",")) {
        const items = [first];
        while (this.atSymbol(",")) {
          this.next();
          items.push(this.parsePattern());
        }
        const end = this.expectSymbol(")", "to close a tuple pattern").span;
        return { kind: "tuple", items, span: joinSpans(start, end) };
      }
      const end = this.expectSymbol(")", "to close a pattern").span;
      return { ...first, span: joinSpans(start, end) };
    }
    if (this.atSymbol("[")) {
      const start = this.next().span;
      const items: Pattern[] = [];
      if (!this.atSymbol("]")) {
        items.push(this.parsePattern());
        while (this.atSymbol(";")) {
          this.next();
          if (this.atSymbol("]")) break;
          items.push(this.parsePattern());
        }
      }
      const end = this.expectSymbol("]", "to close a list pattern").span;
      const span = joinSpans(start, end);
      let result: Pattern = { kind: "nil", span };
      for (let i = items.length - 1; i >= 0; i--) {
        result = { kind: "cons", head: items[i]!, tail: result, span };
      }
      return result;
    }

    this.fail(`expected a pattern, found ${describeToken(token)}`);
  }

  // ------------------------------------------------------------------ types

  parseTypeExpr(): TypeExpr {
    const left = this.parseTypeProduct();
    if (this.atSymbol("->")) {
      this.next();
      const right = this.parseTypeExpr();
      return { kind: "fun", from: left, to: right, span: joinSpans(left.span, right.span) };
    }
    return left;
  }

  parseTypeProduct(): TypeExpr {
    const items = [this.parseTypeApplication()];
    while (this.atSymbol("*")) {
      this.next();
      items.push(this.parseTypeApplication());
    }
    if (items.length === 1) return items[0]!;
    return {
      kind: "tuple",
      items,
      span: joinSpans(items[0]!.span, items[items.length - 1]!.span),
    };
  }

  parseTypeApplication(): TypeExpr {
    let type = this.parseTypeAtom();
    while (this.peek().kind === "ident") {
      const name = this.next();
      type = { kind: "con", name: name.value, args: [type], span: joinSpans(type.span, name.span) };
    }
    return type;
  }

  parseTypeAtom(): TypeExpr {
    const token = this.peek();
    if (token.kind === "typevar") {
      this.next();
      return { kind: "var", name: token.value, span: token.span };
    }
    if (token.kind === "ident") {
      this.next();
      return { kind: "con", name: token.value, args: [], span: token.span };
    }
    if (this.atSymbol("(")) {
      const start = this.next().span;
      const first = this.parseTypeExpr();
      if (this.atSymbol(",")) {
        const args = [first];
        while (this.atSymbol(",")) {
          this.next();
          args.push(this.parseTypeExpr());
        }
        this.expectSymbol(")", "to close a type argument list");
        const name = this.expectIdent("after a type argument list");
        return { kind: "con", name: name.value, args, span: joinSpans(start, name.span) };
      }
      const end = this.expectSymbol(")", "to close a type").span;
      return { ...first, span: joinSpans(start, end) };
    }
    this.fail(`expected a type, found ${describeToken(token)}`);
  }
}

/** `let rec` needs a lambda — possibly wrapped in a type annotation. */
function definesFunction(value: Expr): boolean {
  if (value.kind === "lambda") return true;
  return value.kind === "annot" && definesFunction(value.expr);
}

function buildInfix(token: Token, lhs: Expr, rhs: Expr): Expr {
  const span = joinSpans(lhs.span, rhs.span);
  switch (token.value) {
    // Short-circuiting operators are control flow, not function calls.
    case "&&":
      return { kind: "if", cond: lhs, then: rhs, otherwise: { kind: "bool", value: false, span }, span };
    case "||":
      return { kind: "if", cond: lhs, then: { kind: "bool", value: true, span }, otherwise: rhs, span };
    case "|>":
      return { kind: "apply", fn: rhs, arg: lhs, span };
    default: {
      const name = OPERATOR_FUNCTIONS[token.value] ?? token.value;
      const fn: Expr = { kind: "var", name, span: token.span };
      return {
        kind: "apply",
        fn: { kind: "apply", fn, arg: lhs, span: joinSpans(lhs.span, token.span) },
        arg: rhs,
        span,
      };
    }
  }
}

export function parseProgram(source: string, name?: string): Program {
  return new Parser(source, name).parseProgram();
}

/** Parse a single expression (used by `nf -e` and the REPL). */
export function parseExpression(source: string, name?: string): Expr {
  const parser = new Parser(source, name);
  const expr = parser.parseExpr(0);
  if (!parser.atEnd()) {
    parser.fail(`unexpected ${describeToken(parser.peek())} after the expression`);
  }
  return expr;
}

/** Parse a standalone type, e.g. the signature strings attached to builtins. */
export function parseTypeString(source: string): TypeExpr {
  const parser = new Parser(source);
  const type = parser.parseTypeExpr();
  if (!parser.atEnd()) {
    parser.fail(`unexpected ${describeToken(parser.peek())} after the type`);
  }
  return type;
}
