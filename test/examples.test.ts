/**
 * Runs every program in examples/ and compares its output with the snapshot in
 * test/snapshots/. Regenerate them with:
 *
 *   UPDATE_SNAPSHOTS=1 node --test test/examples.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { Interpreter } from "../src/index.ts";

const examplesDir = fileURLToPath(new URL("../examples/", import.meta.url));
const snapshotsDir = fileURLToPath(new URL("./snapshots/", import.meta.url));

const examples = readdirSync(examplesDir)
  .filter((name) => name.endsWith(".nf"))
  .sort();

describe("examples", () => {
  test("there are examples to run", () => {
    assert.ok(examples.length > 0);
  });

  for (const name of examples) {
    test(name, () => {
      const source = readFileSync(examplesDir + name, "utf8");
      const chunks: string[] = [];
      const interpreter = new Interpreter({ io: { write: (text) => chunks.push(text) } });
      interpreter.run(source, `examples/${name}`);
      const output = chunks.join("");

      const snapshotPath = `${snapshotsDir}${name.replace(/\.nf$/, "")}.txt`;
      if (process.env.UPDATE_SNAPSHOTS) {
        writeFileSync(snapshotPath, output);
        return;
      }
      assert.equal(output, readFileSync(snapshotPath, "utf8"));
    });
  }
});
