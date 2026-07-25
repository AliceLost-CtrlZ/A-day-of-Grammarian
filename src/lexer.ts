/**
 * Hand-written lexer. Whitespace is insignificant; comments come in two flavours,
 * `// line` and `(* nestable block *)`.
 */

import { syntaxError, type Source, type Span } from "./diagnostics.ts";

export type TokenKind = "int" | "string" | "ident" | "typevar" | "keyword" | "symbol" | "eof";

export type Token = {
  kind: TokenKind;
  /** Source text for idents/keywords/symbols; decoded contents for literals. */
  value: string;
  span: Span;
};

export const KEYWORDS = new Set([
  "let",
  "rec",
  "and",
  "in",
  "fun",
  "if",
  "then",
  "else",
  "match",
  "with",
  "type",
  "of",
  "do",
  "true",
  "false",
]);

/** Longest-match-first: `<=` must be tried before `<`, `||` before `|`. */
const SYMBOLS = [
  "->",
  "|>",
  "::",
  "<=",
  ">=",
  "<>",
  "&&",
  "||",
  "(",
  ")",
  "[",
  "]",
  ",",
  ";",
  "|",
  ":",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "@",
  "_",
];

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c) || c === "'";

export function tokenize(source: string, origin?: Source): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const at = (start: number, end: number): Span => ({ start, end, source: origin });

  const push = (kind: TokenKind, value: string, start: number) => {
    tokens.push({ kind, value, span: at(start, i) });
  };

  while (i < source.length) {
    const c = source[i]!;

    // --- whitespace -------------------------------------------------------
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }

    // --- comments ---------------------------------------------------------
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "(" && source[i + 1] === "*") {
      const start = i;
      let depth = 0;
      while (i < source.length) {
        if (source[i] === "(" && source[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (source[i] === "*" && source[i + 1] === ")") {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else {
          i++;
        }
      }
      if (depth !== 0) {
        throw syntaxError("unterminated block comment", at(start, source.length));
      }
      continue;
    }

    // --- integers ---------------------------------------------------------
    if (isDigit(c)) {
      const start = i;
      while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
      if (i < source.length && isIdentStart(source[i]!)) {
        const bad = i;
        while (i < source.length && isIdentPart(source[i]!)) i++;
        throw syntaxError(
          `invalid number literal ${JSON.stringify(source.slice(start, i))}`,
          at(start, i),
          `digits cannot be followed directly by ${JSON.stringify(source.slice(bad, i))}`,
        );
      }
      const text = source.slice(start, i).replace(/_/g, "");
      const value = Number(text);
      if (!Number.isSafeInteger(value)) {
        throw syntaxError(`integer literal ${text} is out of range`, at(start, i),
          "NF# integers are 53-bit safe JavaScript integers");
      }
      push("int", String(value), start);
      continue;
    }

    // --- identifiers and keywords ----------------------------------------
    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i]!)) i++;
      const text = source.slice(start, i);
      if (text === "_") {
        push("symbol", "_", start);
      } else {
        push(KEYWORDS.has(text) ? "keyword" : "ident", text, start);
      }
      continue;
    }

    // --- type variables: 'a, 'b ------------------------------------------
    if (c === "'") {
      const start = i;
      i++;
      if (i >= source.length || !isIdentStart(source[i]!)) {
        throw syntaxError("expected a type variable name after `'`", at(start, i),
          "type variables look like 'a or 'key");
      }
      while (i < source.length && isIdentPart(source[i]!)) i++;
      push("typevar", source.slice(start, i), start);
      continue;
    }

    // --- strings ----------------------------------------------------------
    if (c === '"') {
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === '"') {
          i++;
          closed = true;
          break;
        }
        if (ch === "\n") break;
        if (ch === "\\") {
          const esc = source[i + 1];
          const escStart = i;
          i += 2;
          switch (esc) {
            case "n": out += "\n"; break;
            case "t": out += "\t"; break;
            case "r": out += "\r"; break;
            case "\\": out += "\\"; break;
            case '"': out += '"'; break;
            case "0": out += "\0"; break;
            default:
              throw syntaxError(
                `unknown escape sequence \\${esc ?? ""}`,
                at(escStart, Math.min(i, source.length)),
                "supported escapes are \\n \\t \\r \\0 \\\\ and \\\"",
              );
          }
          continue;
        }
        out += ch;
        i++;
      }
      if (!closed) {
        throw syntaxError("unterminated string literal", at(start, i));
      }
      push("string", out, start);
      continue;
    }

    // --- symbols ----------------------------------------------------------
    const symbol = SYMBOLS.find((s) => source.startsWith(s, i));
    if (symbol !== undefined) {
      const start = i;
      i += symbol.length;
      push("symbol", symbol, start);
      continue;
    }

    const start = i;
    i++;
    throw syntaxError(`unexpected character ${JSON.stringify(c)}`, at(start, i));
  }

  tokens.push({ kind: "eof", value: "<end of input>", span: at(source.length, source.length) });
  return tokens;
}

/** Human-readable token description used in "expected X, found Y" messages. */
export function describeToken(token: Token): string {
  switch (token.kind) {
    case "eof": return "end of input";
    case "int": return `integer ${token.value}`;
    case "string": return "string literal";
    case "ident": return `identifier \`${token.value}\``;
    case "typevar": return `type variable \`${token.value}\``;
    case "keyword": return `keyword \`${token.value}\``;
    case "symbol": return `\`${token.value}\``;
  }
}
