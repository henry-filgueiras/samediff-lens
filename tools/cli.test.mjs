import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");
const beforeFile = resolve(repoRoot, "examples/05-hydra-doc-drift/left.md");
const afterFile = resolve(repoRoot, "examples/05-hydra-doc-drift/right.md");
const simpleLeft = resolve(repoRoot, "examples/01-modal-shift/left.md");
const simpleRight = resolve(repoRoot, "examples/01-modal-shift/right.md");

function run(...args) {
  return execFileSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runRaw(...args) {
  return execFileSync("node", [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env },
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

// --- Drift score tests ---

test("--score outputs a numeric drift score", () => {
  const output = run(simpleLeft, simpleRight, "--score");
  const score = parseFloat(output.trim());
  assert.ok(!isNaN(score), "Expected a numeric score");
  assert.ok(score > 0, "Expected positive drift score for changed text");
  assert.ok(score <= 10, "Score should be ≤10");
});

test("identical files produce a low drift score", () => {
  const output = run(simpleLeft, simpleLeft, "--score");
  const score = parseFloat(output.trim());
  assert.ok(score <= 1, `Expected low drift for identical files, got ${score}`);
});

test("terminal output includes drift score bar", () => {
  const output = run(simpleLeft, simpleRight);
  assert.match(output, /Drift score:/);
  assert.match(output, /\/10/);
});

// --- Exit code tests ---

test("--exit-code returns 1 for drifted files", () => {
  try {
    execFileSync("node", [cli, simpleLeft, simpleRight, "--exit-code"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.fail("Expected non-zero exit for drifted files");
  } catch (err) {
    assert.equal(err.status, 1);
  }
});

test("--exit-code returns 0 for identical files", () => {
  // Should not throw
  execFileSync("node", [cli, simpleLeft, simpleLeft, "--exit-code"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
});

// --- HTML output tests ---

test("--html produces a self-contained HTML document", () => {
  const output = run(simpleLeft, simpleRight, "--html");
  assert.match(output, /<!DOCTYPE html>/);
  assert.match(output, /<title>SameDiff/);
  assert.match(output, /score-num/);
  assert.match(output, /Commitment Shifts/i);
  assert.match(output, /<\/html>/);
});

test("--html includes file names", () => {
  const output = run(simpleLeft, simpleRight, "--html");
  assert.match(output, /left\.md/);
  assert.match(output, /right\.md/);
});

// --- Output file tests ---

test("-o writes output to file", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-test-"));
  const outPath = resolve(tmpDir, "report.html");
  try {
    run(simpleLeft, simpleRight, "--html", "-o", outPath);
    const content = readFileSync(outPath, "utf-8");
    assert.match(content, /<!DOCTYPE html>/);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// --- Git integration tests ---

test("--git HEAD -- file compares working copy against HEAD", () => {
  const output = run("--git", "HEAD", "--", "examples/01-modal-shift/left.md");
  // File hasn't changed since HEAD, so should be low drift
  assert.match(output, /SameDiff Summary/);
});

test("--git with missing ref gives clean error", () => {
  try {
    run("--git", "nonexistent-ref-abc123", "--", "examples/01-modal-shift/left.md");
    assert.fail("Expected error for bad git ref");
  } catch (err) {
    assert.match(err.stderr ?? err.message, /cannot read|Failed to read/i);
  }
});
