import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const cli = fileURLToPath(new URL("../bin/nf.ts", import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));

function nf(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd: root });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function repl(input: string): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, "repl"], { encoding: "utf8", cwd: root, input });
  return { stdout: result.stdout, stderr: result.stderr };
}

describe("cli", () => {
  test("evaluates an expression with -e", () => {
    const { status, stdout } = nf("-e", "1 + 2");
    assert.equal(status, 0);
    assert.equal(stdout.trim(), "val it : int = 3");
  });

  test("shows inferred polymorphic types", () => {
    assert.equal(nf("-e", "fun x -> [x]").stdout.trim(), "val it : 'a -> 'a list = <fun>");
  });

  test("runs a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-cli-"));
    const path = join(dir, "hello.nf");
    writeFileSync(path, 'let who = "cli"\ndo println ("hello, " ^ who)\n');
    const { status, stdout } = nf(path);
    assert.equal(status, 0);
    assert.equal(stdout, "hello, cli\n");
  });

  test("prints top-level types with -t and runs nothing", () => {
    const { status, stdout } = nf("-t", "examples/tree.nf");
    assert.equal(status, 0);
    assert.match(stdout, /val insert : 'a -> 'a tree -> 'a tree/);
    assert.match(stdout, /val depth : 'a tree -> int/);
    assert.doesNotMatch(stdout, /in order:/);
  });

  test("reports type errors on stderr and exits non-zero", () => {
    const { status, stderr } = nf("-e", "1 + true");
    assert.equal(status, 1);
    assert.match(stderr, /error\[type\]/);
    assert.match(stderr, /but an expression was expected of type int/);
  });

  test("points errors at the file they came from", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-cli-"));
    const path = join(dir, "broken.nf");
    writeFileSync(path, "let a = 1\nlet b = a ^ a\n");
    const { status, stderr } = nf(path);
    assert.equal(status, 1);
    assert.match(stderr, /broken\.nf:2:9/);
  });

  test("prints usage for --help", () => {
    const { status, stdout } = nf("--help");
    assert.equal(status, 0);
    assert.match(stdout, /usage:/);
  });

  test("prints a version for -V", () => {
    const { status, stdout } = nf("-V");
    assert.equal(status, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test("rejects unknown options", () => {
    const { status, stderr } = nf("--nope");
    assert.equal(status, 1);
    assert.match(stderr, /unknown option/);
  });

  test("reports a missing file", () => {
    const { status, stderr } = nf("does-not-exist.nf");
    assert.equal(status, 1);
    assert.match(stderr, /cannot read/);
  });

  test("-e without an expression is an error", () => {
    assert.equal(nf("-e").status, 1);
  });
});

describe("repl", () => {
  test("keeps definitions between lines", () => {
    const { stdout } = repl("let double x = x * 2\ndouble 21\n");
    assert.match(stdout, /val double : int -> int = <fun>/);
    assert.match(stdout, /val it : int = 42/);
  });

  test("continues an unfinished definition on the next line", () => {
    const { stdout } = repl("let rec fact n =\n  if n <= 1 then 1 else n * fact (n - 1)\nfact 5\n");
    assert.match(stdout, /val it : int = 120/);
  });

  test(":type reports a type", () => {
    const { stdout } = repl(":type map\n");
    assert.match(stdout, /map : \('a -> 'b\) -> 'a list -> 'b list/);
  });

  test(":type does not run the expression", () => {
    const { stdout } = repl(':type println "boo"\n');
    assert.match(stdout, /println "boo" : unit/);
    assert.doesNotMatch(stdout, /^boo$/m);
  });

  test(":type without an expression explains itself", () => {
    assert.match(repl(":type\n").stderr, /usage: :type/);
  });

  test("recovers from an error and keeps going", () => {
    const { stdout, stderr } = repl('1 + "x"\n2 + 2\n');
    assert.match(stderr, /error\[type\]/);
    assert.match(stdout, /val it : int = 4/);
  });

  test("reports unknown commands", () => {
    assert.match(repl(":nonsense\n").stderr, /unknown command/);
  });
});
