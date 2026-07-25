/**
 * Errors and source-mapped diagnostics.
 *
 * Every stage of the pipeline (lexer, parser, type checker, evaluator) reports
 * failures as an `NfError` carrying a byte span into the original source, so the
 * CLI can render a caret pointing at the offending code.
 */

/** A named chunk of source text, so an error knows which file it came from. */
export type Source = { name: string; text: string };

export type Span = { start: number; end: number; source?: Source };

export type Phase = "syntax" | "type" | "runtime";

export class NfError extends Error {
  phase: Phase;
  span: Span | null;
  notes: string[];

  constructor(phase: Phase, message: string, span: Span | null = null, notes: string[] = []) {
    super(message);
    this.name = "NfError";
    this.phase = phase;
    this.span = span;
    this.notes = notes;
  }
}

export function syntaxError(message: string, span: Span | null, ...notes: string[]): NfError {
  return new NfError("syntax", message, span, notes);
}

export function typeError(message: string, span: Span | null, ...notes: string[]): NfError {
  return new NfError("type", message, span, notes);
}

export function runtimeError(message: string, span: Span | null = null, ...notes: string[]): NfError {
  return new NfError("runtime", message, span, notes);
}

export function joinSpans(a: Span, b: Span): Span {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    source: a.source ?? b.source,
  };
}

export type Position = { line: number; column: number; lineStart: number; lineEnd: number };

/** Convert a 0-based offset into a 1-based line/column plus the bounds of that line. */
export function positionAt(source: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  let lineEnd = source.indexOf("\n", lineStart);
  if (lineEnd === -1) lineEnd = source.length;
  return { line, column: clamped - lineStart + 1, lineStart, lineEnd };
}

const TAB_WIDTH = 4;

function expandTabs(text: string): string {
  return text.replace(/\t/g, " ".repeat(TAB_WIDTH));
}

/** Visual width of `text` once tabs are expanded — used to line the caret up. */
function displayWidth(text: string): number {
  return expandTabs(text).length;
}

export type FormatOptions = { filename?: string; color?: boolean };

const ANSI = {
  red: "\u001b[31m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  reset: "\u001b[0m",
};

/**
 * Render an error the way rustc would:
 *
 *     error[type]: type mismatch
 *       --> demo.nf:2:13
 *        |
 *      2 | let x = 1 + "two"
 *        |             ^^^^^
 *        |
 *        = this expression has type string
 *        = but an expression was expected of type int
 */
export function formatError(error: NfError, fallbackSource: string, options: FormatOptions = {}): string {
  const color = options.color ?? false;
  const paint = (code: string, text: string) => (color ? code + text + ANSI.reset : text);

  const header = paint(ANSI.bold + ANSI.red, `error[${error.phase}]`) + ": " + error.message;
  if (error.span === null) {
    const noteLines = error.notes.map((note) => "  " + paint(ANSI.dim, "= ") + note);
    return [header, ...noteLines].join("\n");
  }

  // A span knows which file it came from; an error raised inside the prelude is
  // shown against the prelude, not against whatever the user just typed.
  const origin = error.span.source;
  const source = origin ? origin.text : fallbackSource;
  const name = origin ? origin.name : options.filename ?? "<input>";

  const start = positionAt(source, error.span.start);
  const lineText = source.slice(start.lineStart, start.lineEnd);
  const gutterWidth = String(start.line).length;
  const pad = " ".repeat(gutterWidth);
  const bar = paint(ANSI.dim, "|");

  const location = `${name}:${start.line}:${start.column}`;
  const caretOffset = displayWidth(lineText.slice(0, error.span.start - start.lineStart));
  const spanEnd = Math.min(error.span.end, start.lineEnd);
  const caretWidth = Math.max(
    1,
    displayWidth(source.slice(error.span.start, Math.max(error.span.start, spanEnd))),
  );

  const lines = [
    header,
    `${pad}${paint(ANSI.dim, "-->")} ${location}`,
    `${pad} ${bar}`,
    `${paint(ANSI.dim, String(start.line))} ${bar} ${expandTabs(lineText)}`,
    `${pad} ${bar} ${" ".repeat(caretOffset)}${paint(ANSI.red, "^".repeat(caretWidth))}`,
  ];
  if (error.notes.length > 0) {
    lines.push(`${pad} ${bar}`);
    for (const note of error.notes) lines.push(`${pad} ${paint(ANSI.dim, "=")} ${note}`);
  }
  return lines.join("\n");
}
