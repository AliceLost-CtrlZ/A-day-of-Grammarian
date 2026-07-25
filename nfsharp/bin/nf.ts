#!/usr/bin/env node
/**
 * The `nf` command line: run a file, evaluate an expression, print inferred
 * types, or start a REPL.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { relative } from "node:path";

import { parseProgram } from "../src/parser.ts";
import {
  Interpreter,
  NfError,
  formatError,
  showValue,
  typeToString,
  type TopLevel,
} from "../src/index.ts";

const VERSION: string = (() => {
  try {
    const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(manifest) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const USAGE = `nf ${VERSION} — the NF# interpreter

usage:
  nf <file.nf>            run a program
  nf -e "<expression>"    evaluate an expression and print its type and value
  nf -t <file.nf>         type-check a program and print its top-level types
  nf repl                 start the REPL (also the default in a terminal)

options:
  -e, --eval <expr>       evaluate an expression
  -t, --types <file>      type-check only, printing every top-level binding
  -h, --help              show this message
  -V, --version           show the version
`;

function reportError(error: unknown, source: string, filename: string): void {
  if (error instanceof NfError) {
    process.stderr.write(formatError(error, source, { filename, color: process.stderr.isTTY === true }) + "\n");
  } else {
    process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error) + "\n");
  }
}

function describeBinding(binding: TopLevel): string {
  const signature = `val ${binding.name} : ${typeToString(binding.type)}`;
  return binding.value === undefined ? signature : `${signature} = ${showValue(binding.value)}`;
}

function runFile(path: string, typesOnly: boolean): number {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    process.stderr.write(`nf: cannot read ${path}\n`);
    return 1;
  }
  const filename = relative(process.cwd(), path) || path;

  try {
    if (typesOnly) {
      const interpreter = new Interpreter();
      for (const binding of interpreter.check(source, filename)) {
        process.stdout.write(`val ${binding.name} : ${typeToString(binding.type)}\n`);
      }
    } else {
      new Interpreter().run(source, filename);
    }
    return 0;
  } catch (error) {
    reportError(error, source, filename);
    return 1;
  }
}

function evaluateExpression(source: string): number {
  try {
    const interpreter = new Interpreter();
    const { value, type } = interpreter.evaluateExpression(source);
    process.stdout.write(`val it : ${typeToString(type)} = ${showValue(value)}\n`);
    return 0;
  } catch (error) {
    reportError(error, source, "<expression>");
    return 1;
  }
}

const REPL_HELP = `commands:
  :type <expr>   show the inferred type of an expression without running it
  :env           list every binding in scope
  :help          show this message
  :quit          leave the REPL (Ctrl-D also works)

everything else is either a definition (\`let\`, \`type\`, \`do\`) or an expression.
`;

function startRepl(): void {
  const interpreter = new Interpreter();
  const input = createInterface({ input: process.stdin, output: process.stdout, prompt: "nf> " });
  let buffer = "";

  process.stdout.write(`NF# ${VERSION} — :help for commands, :quit to exit\n`);
  input.prompt();

  input.on("line", (line) => {
    const source = buffer === "" ? line : `${buffer}\n${line}`;
    const trimmed = source.trim();

    if (trimmed === "") {
      buffer = "";
      input.setPrompt("nf> ");
      input.prompt();
      return;
    }

    if (buffer === "" && trimmed.startsWith(":")) {
      const [command, ...rest] = trimmed.slice(1).split(/\s+/);
      const argument = trimmed.slice(1 + (command?.length ?? 0)).trim();
      switch (command) {
        case "quit":
        case "q":
          input.close();
          return;
        case "help":
        case "h":
          process.stdout.write(REPL_HELP);
          break;
        case "env":
          for (const [name, type] of interpreter.checker.globals) {
            process.stdout.write(`val ${name} : ${typeToString(type)}\n`);
          }
          break;
        case "type":
        case "t":
          if (rest.length === 0) {
            process.stderr.write("usage: :type <expression>\n");
            break;
          }
          try {
            // Types only — `:type println "boo"` must not print anything.
            const type = interpreter.typeOfExpression(argument, "<repl>");
            process.stdout.write(`${argument} : ${typeToString(type)}\n`);
          } catch (error) {
            reportError(error, argument, "<repl>");
          }
          break;
        default:
          process.stderr.write(`unknown command \`:${command}\` — try :help\n`);
      }
      input.prompt();
      return;
    }

    try {
      for (const binding of evaluateReplInput(interpreter, source)) {
        process.stdout.write(describeBinding(binding) + "\n");
      }
      buffer = "";
      input.setPrompt("nf> ");
    } catch (error) {
      // An error that points at the very end of the input usually means the
      // definition simply is not finished yet — keep reading.
      if (error instanceof NfError && error.phase === "syntax" && error.span?.start === source.length) {
        buffer = source;
        input.setPrompt("  | ");
      } else {
        buffer = "";
        input.setPrompt("nf> ");
        reportError(error, source, "<repl>");
      }
    }
    input.prompt();
  });

  input.on("close", () => {
    process.stdout.write("\n");
    process.exit(0);
  });
}

/** REPL input is either a sequence of definitions or a bare expression. */
function evaluateReplInput(interpreter: Interpreter, source: string): TopLevel[] {
  const looksLikeDefinition = /^\s*(let|type|do)\b/.test(source);
  if (looksLikeDefinition) {
    try {
      const results: TopLevel[] = [];
      for (const item of parseProgram(source, "<repl>")) results.push(...interpreter.runItem(item));
      return results;
    } catch (error) {
      // `let x = 1 in x + 1` is an expression, not a definition.
      if (!/^\s*let\b/.test(source)) throw error;
      try {
        const { value, type } = interpreter.evaluateExpression(source, "<repl>");
        return [{ name: "it", type, value }];
      } catch {
        throw error;
      }
    }
  }
  const { value, type } = interpreter.evaluateExpression(source, "<repl>");
  return [{ name: "it", type, value }];
}

function main(argv: string[]): number {
  if (argv.length === 0) {
    if (process.stdin.isTTY) {
      startRepl();
      return 0;
    }
    process.stderr.write(USAGE);
    return 1;
  }

  const [first, ...rest] = argv as [string, ...string[]];
  switch (first) {
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return 0;
    case "-V":
    case "--version":
      process.stdout.write(VERSION + "\n");
      return 0;
    case "-e":
    case "--eval":
      if (rest.length === 0) {
        process.stderr.write("nf: -e needs an expression\n");
        return 1;
      }
      return evaluateExpression(rest.join(" "));
    case "-t":
    case "--types":
      if (rest.length === 0) {
        process.stderr.write("nf: -t needs a file\n");
        return 1;
      }
      return runFile(rest[0]!, true);
    case "run":
      if (rest.length === 0) {
        process.stderr.write("nf: run needs a file\n");
        return 1;
      }
      return runFile(rest[0]!, false);
    case "repl":
      startRepl();
      return 0;
    default:
      if (first.startsWith("-")) {
        process.stderr.write(`nf: unknown option ${first}\n${USAGE}`);
        return 1;
      }
      return runFile(first, false);
  }
}

process.exitCode = main(process.argv.slice(2));
