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

// --- JSON output tests ---

test("--json emits valid parseable JSON", () => {
  const output = run(beforeFile, afterFile, "--json");
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(output);
  }, "Expected valid JSON output");
  assert.ok(typeof parsed === "object" && parsed !== null);
});

test("--json includes required top-level fields", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);

  // Schema version
  assert.ok("version" in result, "Missing 'version' field");
  assert.equal(result.version, "1");

  // Meta
  assert.ok("meta" in result, "Missing 'meta' field");
  assert.equal(result.meta.tool, "samediff-lens");
  assert.ok(result.meta.toolVersion, "Missing toolVersion");
  assert.equal(result.meta.analysisEngine, "heuristic-v0");
  assert.ok(result.meta.generatedAt, "Missing generatedAt timestamp");

  // Input
  assert.ok("input" in result, "Missing 'input' field");
  assert.ok(result.input.left, "Missing input.left");
  assert.ok(result.input.right, "Missing input.right");
  assert.ok(result.input.left.label, "Missing input.left.label");
  assert.ok(result.input.right.label, "Missing input.right.label");

  // Score
  assert.ok("score" in result, "Missing 'score' field");
  assert.equal(typeof result.score.value, "number");
  assert.ok(result.score.value >= 0 && result.score.value <= 10);
  assert.ok(["low", "moderate", "high", "critical"].includes(result.score.label));
  assert.ok([0, 1].includes(result.score.exitCode));

  // Counts
  assert.ok("counts" in result, "Missing 'counts' field");
  assert.equal(typeof result.counts.total, "number");
  assert.equal(typeof result.counts.commitmentShifts, "number");
  assert.equal(typeof result.counts.contradictions, "number");

  // Findings
  assert.ok("findings" in result, "Missing 'findings' field");
  assert.ok(Array.isArray(result.findings.commitmentShifts));
  assert.ok(Array.isArray(result.findings.contradictions));
  assert.ok(Array.isArray(result.findings.conceptRenames));
  assert.ok(Array.isArray(result.findings.addedConcepts));
  assert.ok(Array.isArray(result.findings.removedConcepts));
  assert.ok(Array.isArray(result.findings.actionItemsAdded));
  assert.ok(Array.isArray(result.findings.actionItemsRemoved));

  // Summary
  assert.ok("summary" in result, "Missing 'summary' field");
  assert.equal(typeof result.summary, "string");
});

test("--json score is present for drifted files", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);
  assert.ok(result.score.value > 0, "Expected positive drift score for hydra example");
});

test("--json counts match findings array lengths", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);
  assert.equal(result.counts.commitmentShifts, result.findings.commitmentShifts.length);
  assert.equal(result.counts.contradictions, result.findings.contradictions.length);
  assert.equal(result.counts.conceptRenames, result.findings.conceptRenames.length);
  assert.equal(result.counts.addedConcepts, result.findings.addedConcepts.length);
  assert.equal(result.counts.removedConcepts, result.findings.removedConcepts.length);
  assert.equal(result.counts.actionItemsAdded, result.findings.actionItemsAdded.length);
  assert.equal(result.counts.actionItemsRemoved, result.findings.actionItemsRemoved.length);

  const computedTotal =
    result.counts.commitmentShifts +
    result.counts.contradictions +
    result.counts.conceptRenames +
    result.counts.addedConcepts +
    result.counts.removedConcepts +
    result.counts.actionItemsAdded +
    result.counts.actionItemsRemoved;
  assert.equal(result.counts.total, computedTotal, "Total should equal sum of category counts");
});

test("--json findings have correct type discriminators", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);

  for (const f of result.findings.commitmentShifts) {
    assert.equal(f.type, "commitment-shift");
    assert.ok(f.evidence, "commitment-shift missing evidence");
    assert.ok(f.evidence.before, "commitment-shift missing evidence.before");
    assert.ok(f.evidence.after, "commitment-shift missing evidence.after");
    assert.ok(Array.isArray(f.evidence.triggers), "commitment-shift missing triggers array");
  }
  for (const f of result.findings.contradictions) {
    assert.equal(f.type, "contradiction");
    assert.ok(Array.isArray(f.evidence.anchors));
  }
  for (const f of result.findings.conceptRenames) {
    assert.equal(f.type, "concept-rename");
    assert.ok(["low", "medium", "high"].includes(f.confidence));
  }
  for (const f of result.findings.addedConcepts) {
    assert.equal(f.type, "added-concept");
    assert.ok(f.phrase, "added-concept missing phrase");
  }
  for (const f of result.findings.removedConcepts) {
    assert.equal(f.type, "removed-concept");
  }
  for (const f of result.findings.actionItemsAdded) {
    assert.equal(f.type, "action-item-added");
    assert.ok(f.description, "action-item-added missing description");
  }
  for (const f of result.findings.actionItemsRemoved) {
    assert.equal(f.type, "action-item-removed");
  }
});

test("--json output is clean on stdout (no banners or ANSI)", () => {
  const output = runRaw(beforeFile, afterFile, "--json");
  // Must start with { and end with }
  const trimmed = output.trim();
  assert.ok(trimmed.startsWith("{"), "JSON output should start with {");
  assert.ok(trimmed.endsWith("}"), "JSON output should end with }");
  // No ANSI escape codes
  assert.ok(!/\x1b\[/.test(output), "JSON output should not contain ANSI codes");
  // No "SameDiff" banner text outside JSON
  assert.doesNotThrow(() => JSON.parse(output), "Entire stdout should be valid JSON");
});

test("--json with identical files produces zero drift", () => {
  const output = run(simpleLeft, simpleLeft, "--json");
  const result = JSON.parse(output);
  assert.ok(result.score.value <= 1, "Identical files should have low drift score");
  assert.equal(result.score.exitCode, 0);
});

test("--json + --git mode works", () => {
  const output = run("--git", "HEAD", "--", "examples/01-modal-shift/left.md", "--json");
  const result = JSON.parse(output);
  assert.ok(typeof result === "object");
  assert.equal(result.version, "1");
  assert.ok(result.input.left.gitRef, "Git mode should populate gitRef");
});

test("--json + -o writes JSON to file", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-test-"));
  const outPath = resolve(tmpDir, "result.json");
  try {
    run(simpleLeft, simpleRight, "--json", "-o", outPath);
    const content = readFileSync(outPath, "utf-8");
    const result = JSON.parse(content);
    assert.equal(result.version, "1");
    assert.ok(result.score.value > 0);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

test("--json schema shape is stable (snapshot fields)", () => {
  const output = run(simpleLeft, simpleRight, "--json");
  const result = JSON.parse(output);

  // Verify the exact set of top-level keys
  const topKeys = Object.keys(result).sort();
  assert.deepEqual(topKeys, ["counts", "findings", "input", "meta", "score", "summary", "version"]);

  // Verify meta keys
  const metaKeys = Object.keys(result.meta).sort();
  assert.deepEqual(metaKeys, ["analysisEngine", "generatedAt", "tool", "toolVersion"]);

  // Verify score keys
  const scoreKeys = Object.keys(result.score).sort();
  assert.deepEqual(scoreKeys, ["exitCode", "label", "value"]);

  // Verify counts keys
  const countsKeys = Object.keys(result.counts).sort();
  assert.deepEqual(countsKeys, [
    "actionItemsAdded", "actionItemsRemoved", "addedConcepts",
    "commitmentShifts", "conceptRenames", "contradictions",
    "removedConcepts", "total",
  ]);

  // Verify findings keys
  const findingsKeys = Object.keys(result.findings).sort();
  assert.deepEqual(findingsKeys, [
    "actionItemsAdded", "actionItemsRemoved", "addedConcepts",
    "commitmentShifts", "conceptRenames", "contradictions",
    "removedConcepts",
  ]);
});
