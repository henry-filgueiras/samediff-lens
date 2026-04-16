import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");
const beforeFile = resolve(repoRoot, "examples/05-hydra-doc-drift/left.md");
const afterFile = resolve(repoRoot, "examples/05-hydra-doc-drift/right.md");

function run(...args) {
  return execFileSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("--help prints usage", () => {
  const output = run("--help");
  assert.match(output, /samediff.*semantic/i);
  assert.match(output, /Usage:/);
});

test("comparing hydra example produces commitment shifts", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /COMMITMENT SHIFTS/);
  assert.match(output, /should.*must|narrows scope/i);
});

test("comparing hydra example produces task drift", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /TASK DRIFT/);
  assert.match(output, /TODO added/);
  assert.match(output, /TODO removed/);
  assert.match(output, /benchmark against GMP/);
  assert.match(output, /validate karatsuba threshold/);
});

test("comparing hydra example produces concept renames", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /CONCEPT RENAME/);
});

test("comparing hydra example produces contradiction hints", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /POSSIBLE CONTRADICTIONS/);
});

test("comparing hydra example produces added and removed concepts", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /ADDED CONCEPTS/);
  assert.match(output, /REMOVED CONCEPTS/);
  assert.match(output, /crdt/i);
});

test("--md flag outputs markdown report", () => {
  const output = run(beforeFile, afterFile, "--md");
  assert.match(output, /^# SameDiff Lens Report/m);
  assert.match(output, /## Summary/);
  assert.match(output, /## Changed commitments/);
});

test("header includes file names", () => {
  const output = run(beforeFile, afterFile);
  assert.match(output, /left\.md.*right\.md/);
});

test("missing file produces error", () => {
  try {
    run("nonexistent.md", afterFile);
    assert.fail("Expected an error for missing file");
  } catch (err) {
    assert.match(err.stderr ?? err.message, /cannot read/i);
  }
});
