import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");
const beforeFile = resolve(repoRoot, "examples/05-hydra-doc-drift/left.md");
const afterFile = resolve(repoRoot, "examples/05-hydra-doc-drift/right.md");
const simpleLeft = resolve(repoRoot, "examples/01-modal-shift/left.md");
const simpleRight = resolve(repoRoot, "examples/01-modal-shift/right.md");

// Always pass --no-config in the default runner so tests don't pick up
// a real .samediff.json from the user's machine. Tests that want config
// behavior use runIn() with an explicit tmp cwd.
function run(...args) {
  return execFileSync("node", [cli, ...args, "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runRaw(...args) {
  return execFileSync("node", [cli, ...args, "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env },
  });
}

function runIn(cwd, ...args) {
  return execFileSync("node", [cli, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function mkRepo() {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-cfg-"));
  cpSync(simpleLeft, resolve(dir, "left.md"));
  cpSync(simpleRight, resolve(dir, "right.md"));
  return dir;
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

test("hydra example: concept renames are deduped against commitment shifts", () => {
  // Every rename guess the detector would make on this fixture is on a
  // sentence pair that ALSO fires a commitment shift, so the dedup step
  // in analyzeTextPair correctly suppresses the whole section. Positive
  // rename coverage lives in tools/analysis.test.mjs on inputs that
  // don't coincide with commitment-shift pairs.
  const output = run(beforeFile, afterFile);
  assert.match(output, /COMMITMENT SHIFTS/);
  assert.doesNotMatch(output, /CONCEPT RENAME/);
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

// ── Two-ref form: compare ref-old:file vs ref-new:file ─────────────────────

test("--git <old> <new> -- file compares two refs without touching working tree", () => {
  // HEAD vs HEAD: same content on both sides → low / zero drift, but the
  // command must succeed and the labels must show both refs.
  const output = run("--git", "HEAD", "HEAD", "--", "examples/01-modal-shift/left.md");
  assert.match(output, /SameDiff Summary/);
  // Both labels should be ref-prefixed (this is how the runner prints labels)
  assert.match(output, /HEAD:examples\/01-modal-shift\/left\.md/);
});

test("--git <old> <new> -- file --json puts both gitRef fields on input", () => {
  const output = run("--git", "HEAD", "HEAD", "--", "examples/01-modal-shift/left.md", "--json");
  const result = JSON.parse(output);
  assert.equal(result.input.left.gitRef, "HEAD");
  assert.equal(result.input.right.gitRef, "HEAD");
  // Both paths should be the same file
  assert.equal(result.input.left.path, result.input.right.path);
});

test("--git <old> <new> -- file1 file2 supports rename tracking", () => {
  // Same content, just two different file paths. The pipeline should
  // wire ref-old:file1 vs ref-new:file2 and not crash.
  const output = run(
    "--git", "HEAD", "HEAD", "--",
    "examples/01-modal-shift/left.md",
    "examples/01-modal-shift/right.md",
    "--json",
  );
  const result = JSON.parse(output);
  assert.equal(result.input.left.gitRef, "HEAD");
  assert.equal(result.input.right.gitRef, "HEAD");
  assert.match(result.input.left.path, /left\.md$/);
  assert.match(result.input.right.path, /right\.md$/);
});

test("--git takes at most 2 refs", () => {
  try {
    run("--git", "HEAD", "HEAD~1", "HEAD~2", "--", "examples/01-modal-shift/left.md");
    assert.fail("Expected error for >2 refs");
  } catch (err) {
    assert.match(err.stderr ?? err.message, /takes 1 or 2 refs/i);
  }
});

test("--git <old> <new> -- with missing newer ref gives clean error", () => {
  try {
    run("--git", "HEAD", "nonexistent-ref-xyz789", "--", "examples/01-modal-shift/left.md");
    assert.fail("Expected error for missing ref");
  } catch (err) {
    assert.match(err.stderr ?? err.message, /cannot read|Failed to read/i);
  }
});

// ── Empty-tree SHA — diff "from nothing" ───────────────────────────────────

test("--git EMPTY HEAD -- file diffs from empty content (everything appears as added)", () => {
  // No engine errors, no contradictions (you can't contradict
  // empty), and the rendered summary should advertise the empty-tree
  // short-SHA on the before side.
  const output = run("--git", "EMPTY", "HEAD", "--", "examples/01-modal-shift/right.md");
  assert.match(output, /SameDiff Summary/);
  assert.match(output, /4b825dc:examples\/01-modal-shift\/right\.md/);
  assert.match(output, /ADDED CONCEPTS/);
  // Empty side cannot produce contradictions or commitment shifts
  assert.doesNotMatch(output, /POSSIBLE CONTRADICTIONS/);
  assert.doesNotMatch(output, /COMMITMENT SHIFTS/);
});

test("--git accepts the full empty-tree SHA verbatim", () => {
  const output = run(
    "--git",
    "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    "HEAD",
    "--",
    "examples/01-modal-shift/right.md",
  );
  assert.match(output, /SameDiff Summary/);
  assert.match(output, /4b825dc:/);
});

test("--git EMPTY-TREE alias is case-insensitive", () => {
  const upper = run("--git", "EMPTY-TREE", "HEAD", "--", "examples/01-modal-shift/right.md");
  const lower = run("--git", "empty-tree", "HEAD", "--", "examples/01-modal-shift/right.md");
  // Both should produce the same SameDiff summary banner
  assert.match(upper, /SameDiff Summary/);
  assert.match(lower, /SameDiff Summary/);
});

test("--git EMPTY HEAD -- file --json marks the before-side gitRef as the empty tree", () => {
  const output = run("--git", "EMPTY", "HEAD", "--", "examples/01-modal-shift/right.md", "--json");
  const result = JSON.parse(output);
  // The label uses the short SHA prefix (4b825dc) regardless of
  // which alias was passed.
  assert.match(result.input.left.gitRef ?? "", /4b825dc/);
  assert.equal(result.input.right.gitRef, "HEAD");
});

// ── Hint: forgot --git when passing refs ───────────────────────────────────

test("hint when EMPTY is passed as a positional (forgot --git)", () => {
  // Reproduces the actual user error: ran `samediff EMPTY <sha> -- <file>`
  // without --git. The first positional gets read as a file, fails ENOENT,
  // and we should suggest --git in the error.
  try {
    run("EMPTY", "0f4d92257f6a4ed338785f851458888d2b524227", "--", "examples/01-modal-shift/right.md");
    assert.fail("Expected failure");
  } catch (err) {
    const stderr = err.stderr ?? err.message ?? "";
    assert.match(stderr, /cannot read EMPTY/, "expected the underlying ENOENT");
    assert.match(stderr, /looks like a git ref/, "expected the --git hint");
    assert.match(stderr, /samediff --git <ref>/, "hint should show the corrected form");
  }
});

test("hint when a 40-char SHA is passed as a positional (forgot --git)", () => {
  try {
    run(
      "examples/01-modal-shift/left.md",
      "0f4d92257f6a4ed338785f851458888d2b524227",
      "--",
      "examples/01-modal-shift/right.md",
    );
    assert.fail("Expected failure");
  } catch (err) {
    const stderr = err.stderr ?? err.message ?? "";
    assert.match(stderr, /looks like a git ref/);
  }
});

test("no hint on plain file ENOENT (no --, no ref-shaped path)", () => {
  // Two file paths that don't exist — should error cleanly without
  // hinting --git. Critical: don't suggest git mode for ordinary typos.
  try {
    run("does-not-exist-a.md", "does-not-exist-b.md");
    assert.fail("Expected failure");
  } catch (err) {
    const stderr = err.stderr ?? err.message ?? "";
    assert.match(stderr, /cannot read/);
    assert.doesNotMatch(stderr, /looks like a git ref/);
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
  assert.equal(
    result.counts.actionItemsStatusChanges,
    result.findings.actionItemsStatusChanges.length,
  );

  const computedTotal =
    result.counts.commitmentShifts +
    result.counts.contradictions +
    result.counts.conceptRenames +
    result.counts.addedConcepts +
    result.counts.removedConcepts +
    result.counts.actionItemsAdded +
    result.counts.actionItemsRemoved +
    result.counts.actionItemsStatusChanges;
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

// --- Filter tests (--only / --exclude) ---

test("--only limits output to one category", () => {
  const output = run(simpleLeft, simpleRight, "--only", "contradictions");
  assert.match(output, /POSSIBLE CONTRADICTIONS/);
  assert.doesNotMatch(output, /COMMITMENT SHIFTS/);
  assert.doesNotMatch(output, /ADDED CONCEPTS/);
});

test("--only accepts comma-separated categories", () => {
  const output = run(simpleLeft, simpleRight, "--only", "commitment-shifts,contradictions");
  assert.match(output, /COMMITMENT SHIFTS/);
  assert.match(output, /POSSIBLE CONTRADICTIONS/);
  assert.doesNotMatch(output, /ADDED CONCEPTS/);
});

test("--only alias 'concepts' covers added + removed", () => {
  const output = run(simpleLeft, simpleRight, "--only", "concepts");
  assert.match(output, /ADDED CONCEPTS/);
  assert.match(output, /REMOVED CONCEPTS/);
  assert.doesNotMatch(output, /COMMITMENT SHIFTS/);
});

test("--exclude hides specified categories", () => {
  const output = run(simpleLeft, simpleRight, "--exclude", "concepts");
  assert.match(output, /COMMITMENT SHIFTS/);
  assert.doesNotMatch(output, /ADDED CONCEPTS/);
  assert.doesNotMatch(output, /REMOVED CONCEPTS/);
});

test("--only with unknown category exits with error", () => {
  try {
    run(simpleLeft, simpleRight, "--only", "bogus-category");
    assert.fail("Expected error for unknown category");
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr ?? err.message, /Unknown category/);
  }
});

test("--only changes the score (recomputed from filtered findings)", () => {
  const full = parseFloat(run(simpleLeft, simpleRight, "--score").trim());
  const filtered = parseFloat(
    run(simpleLeft, simpleRight, "--only", "contradictions", "--score").trim(),
  );
  assert.ok(filtered < full, `Expected filtered score (${filtered}) < full score (${full})`);
});

test("--json respects --only", () => {
  const output = run(simpleLeft, simpleRight, "--only", "contradictions", "--json");
  const result = JSON.parse(output);
  assert.equal(result.counts.commitmentShifts, 0);
  assert.equal(result.counts.addedConcepts, 0);
  assert.ok(result.counts.contradictions >= 1);
});

// --- --fail-on tests ---

test("--fail-on any returns 1 on drifted files", () => {
  try {
    execFileSync("node", [cli, simpleLeft, simpleRight, "--fail-on", "any"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.fail("Expected non-zero exit");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr ?? err.message, /--fail-on any/);
  }
});

test("--fail-on score:5 fails when score >= 5", () => {
  try {
    execFileSync("node", [cli, simpleLeft, simpleRight, "--fail-on", "score:5"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.fail("Expected exit 1");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr ?? err.message, /drift score.*≥ 5/);
  }
});

test("--fail-on score:9 passes when score < 9", () => {
  // Shouldn't throw
  execFileSync("node", [cli, simpleLeft, simpleRight, "--fail-on", "score:9"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
});

test("--fail-on contradictions fails when contradictions exist", () => {
  try {
    execFileSync("node", [cli, simpleLeft, simpleRight, "--fail-on", "contradictions"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.fail("Expected exit 1");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr ?? err.message, /contradictions/);
  }
});

test("--fail-on contradictions passes when that category is excluded", () => {
  execFileSync(
    "node",
    [cli, simpleLeft, simpleRight, "--exclude", "contradictions", "--fail-on", "contradictions"],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
});

test("--fail-on bad spec exits with code 2", () => {
  try {
    run(simpleLeft, simpleRight, "--fail-on", "score:not-a-number");
    assert.fail("Expected error");
  } catch (err) {
    assert.equal(err.status, 2);
  }
});

// --- --baseline tests ---

test("--baseline suppresses findings already present", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-baseline-"));
  const baselinePath = resolve(tmpDir, "baseline.json");
  try {
    // Snapshot current run
    const baseline = run(simpleLeft, simpleRight, "--json");
    writeFileSync(baselinePath, baseline);

    // Re-run with baseline: should see zero findings
    const second = run(simpleLeft, simpleRight, "--baseline", baselinePath, "--json");
    const result = JSON.parse(second);
    assert.equal(result.counts.total, 0, "All pre-existing findings should be suppressed");
    assert.equal(result.score.value, 0);
    assert.ok(result.filters?.baseline, "Baseline provenance should be in result.filters");
    assert.ok(result.filters.baseline.suppressed > 0);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

test("--baseline + --fail-on any exits 0 when nothing new", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-baseline2-"));
  const baselinePath = resolve(tmpDir, "baseline.json");
  try {
    writeFileSync(baselinePath, run(simpleLeft, simpleRight, "--json"));
    execFileSync(
      "node",
      [cli, simpleLeft, simpleRight, "--baseline", baselinePath, "--fail-on", "any"],
      { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
    );
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

test("--baseline with non-JSON file errors cleanly", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-baseline3-"));
  const bogusPath = resolve(tmpDir, "bogus.json");
  try {
    writeFileSync(bogusPath, "not json at all");
    try {
      run(simpleLeft, simpleRight, "--baseline", bogusPath);
      assert.fail("Expected error");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stderr ?? err.message, /not valid JSON|no .findings/i);
    }
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// --- --compact tests ---

test("--compact emits one finding per line", () => {
  const output = run(simpleLeft, simpleRight, "--compact");
  const lines = output.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 3, `Expected multiple finding lines, got ${lines.length}`);
  for (const line of lines) {
    assert.match(line, /^(COMMITMENT|CONTRADICTION|RENAME|ADDED|REMOVED|TODO\+|TODO-)\t/);
  }
});

test("--compact output has no ANSI or banners", () => {
  const output = runRaw(simpleLeft, simpleRight, "--compact");
  assert.ok(!/\x1b\[/.test(output), "Compact output must have no ANSI codes");
  assert.doesNotMatch(output, /SameDiff Summary/);
});

test("--compact + --only filters together", () => {
  const output = run(simpleLeft, simpleRight, "--compact", "--only", "commitment-shifts");
  const lines = output.trim().split("\n").filter(Boolean);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.startsWith("COMMITMENT\t"), `Non-commitment line slipped through: ${line}`);
  }
});

// --- --github tests ---

test("--github emits workflow annotation commands", () => {
  const output = run(simpleLeft, simpleRight, "--github");
  assert.match(output, /^::(error|warning|notice) /m);
  assert.match(output, /title=Commitment shift/);
});

test("--github escapes newlines and colons in messages", () => {
  const output = run(simpleLeft, simpleRight, "--github");
  // Each annotation must be on a single physical line
  for (const line of output.split("\n").filter(Boolean)) {
    assert.ok(line.startsWith("::"), `Stray line: ${line}`);
  }
});

// --- --stats tests ---

test("--stats emits one-line key=value summary", () => {
  const output = run(simpleLeft, simpleRight, "--stats").trim();
  const lines = output.split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /score=\d+\.\d+/);
  assert.match(lines[0], /commitment-shifts=\d+/);
  assert.match(lines[0], /contradictions=\d+/);
});

// --- stdin tests ---

test("stdin via `-` reads the left file", () => {
  const leftText = readFileSync(simpleLeft, "utf-8");
  const output = execFileSync("node", [cli, "-", simpleRight, "--stats"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
    input: leftText,
  });
  assert.match(output, /commitment-shifts=2/);
});

test("stdin via `-` reads the right file", () => {
  const rightText = readFileSync(simpleRight, "utf-8");
  const output = execFileSync("node", [cli, simpleLeft, "-", "--stats"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
    input: rightText,
  });
  assert.match(output, /commitment-shifts=2/);
});

test("two `-` args is an error", () => {
  try {
    run("-", "-");
    assert.fail("Expected error for two stdin args");
  } catch (err) {
    assert.equal(err.status, 1);
  }
});

// --- format mutual-exclusion ---

test("passing two format flags is an error", () => {
  try {
    run(simpleLeft, simpleRight, "--json", "--compact");
    assert.fail("Expected error");
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr ?? err.message, /at most one output format/);
  }
});

test("--json schema shape is stable (snapshot fields)", () => {
  const output = run(simpleLeft, simpleRight, "--json");
  const result = JSON.parse(output);

  // Verify the exact set of top-level keys
  const topKeys = Object.keys(result).sort();
  assert.deepEqual(topKeys, ["counts", "findings", "input", "meta", "narrative", "score", "summary", "version"]);

  // Verify meta keys
  const metaKeys = Object.keys(result.meta).sort();
  assert.deepEqual(metaKeys, ["analysisEngine", "generatedAt", "tool", "toolVersion"]);

  // Verify score keys
  const scoreKeys = Object.keys(result.score).sort();
  assert.deepEqual(scoreKeys, ["exitCode", "label", "value"]);

  // Verify counts keys
  const countsKeys = Object.keys(result.counts).sort();
  assert.deepEqual(countsKeys, [
    "actionItemsAdded", "actionItemsRemoved", "actionItemsStatusChanges",
    "addedConcepts", "commitmentShifts", "conceptRenames", "contradictions",
    "removedConcepts", "total",
  ]);

  // Verify findings keys
  const findingsKeys = Object.keys(result.findings).sort();
  assert.deepEqual(findingsKeys, [
    "actionItemsAdded", "actionItemsRemoved", "actionItemsStatusChanges",
    "addedConcepts", "commitmentShifts", "conceptRenames", "contradictions",
    "removedConcepts",
  ]);
});

// ─── Config + policy tests ──────────────────────────────────────────

test("policies subcommand lists built-ins when no config is found", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-policies-"));
  try {
    const out = runIn(dir, "policies");
    assert.match(out, /No config file found/);
    assert.match(out, /adoption\s+\(built-in\)/);
    assert.match(out, /strict\s+\(built-in\)/);
    assert.match(out, /advisory\s+\(built-in\)/);
    assert.match(out, /docs-only\s+\(built-in\)/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("init writes a starter .samediff.json", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    const cfgPath = resolve(dir, ".samediff.json");
    assert.ok(existsSync(cfgPath), ".samediff.json should exist");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    assert.equal(cfg.default_policy, "adoption");
    assert.ok(cfg.policies.adoption);
    assert.ok(cfg.policies.strict);
    assert.ok(cfg.policies.advisory);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("init refuses to overwrite without --force", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    try {
      runIn(dir, "init");
      assert.fail("Expected exit 1 on existing config");
    } catch (err) {
      assert.equal(err.status, 1);
      assert.match(err.stderr ?? err.message, /already exists/);
    }
    // --force should succeed
    runIn(dir, "init", "--force");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("--policy strict fails on commitment shifts", () => {
  try {
    execFileSync(
      "node",
      [cli, simpleLeft, simpleRight, "--policy", "strict", "--stats", "--no-config"],
      { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
    );
    assert.fail("Expected --policy strict to fail");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr ?? err.message, /commitment-shifts/);
  }
});

test("--policy advisory never fails the build", () => {
  // Should not throw
  execFileSync(
    "node",
    [cli, simpleLeft, simpleRight, "--policy", "advisory", "--stats", "--no-config"],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
});

test("--policy unknown exits with code 2 and a clear message", () => {
  try {
    run(simpleLeft, simpleRight, "--policy", "nonexistent-policy");
    assert.fail("Expected error");
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr ?? err.message, /Unknown policy/);
  }
});

test("adoption policy reports zero drift after baseline snapshot", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    runIn(dir, "baseline", "left.md", "right.md");
    const out = runIn(dir, "left.md", "right.md", "--stats");
    assert.match(out, /score=0\.0/);
    assert.match(out, /commitment-shifts=0/);
    assert.match(out, /contradictions=0/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("adoption policy without baseline warns and still runs", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    try {
      runIn(dir, "left.md", "right.md", "--stats");
      assert.fail("Expected --fail-on score:4 to trigger");
    } catch (err) {
      assert.equal(err.status, 1);
      assert.match(err.stderr ?? err.message, /baseline .* not found/i);
      assert.match(err.stderr ?? err.message, /drift score/i);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("CLI --fail-on overrides policy fail_on", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init"); // default_policy=adoption, fail_on=score:4
    // Override with --fail-on none → must not fail
    const out = runIn(dir, "left.md", "right.md", "--fail-on", "none", "--stats");
    assert.match(out, /score=/);
    // Also ensure --fail-on any DOES fail even with adoption policy
    try {
      runIn(dir, "left.md", "right.md", "--fail-on", "any", "--no-baseline", "--stats");
      assert.fail("Expected --fail-on any + --no-baseline to fail");
    } catch (err) {
      assert.equal(err.status, 1);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("CLI --only overrides policy include", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    // Adoption policy includes commits+contradictions. Override with --only concepts.
    const out = runIn(dir, "left.md", "right.md", "--only", "concepts", "--stats", "--no-baseline");
    assert.match(out, /commitment-shifts=0/);
    assert.match(out, /added=\d+/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("--no-config ignores a config file that exists on disk", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    // With config: the provenance line would appear on stderr. Run again with --no-config.
    const out = execFileSync(
      "node",
      [cli, "left.md", "right.md", "--no-config", "--stats"],
      { cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
    );
    // No --fail-on means exit 0 even though drift exists
    assert.match(out, /commitment-shifts=2/);
    assert.match(out, /contradictions=1/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("--no-policy skips default_policy", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    const out = runIn(dir, "left.md", "right.md", "--no-policy", "--stats");
    // Without policy, all categories are shown; no fail-on; all pass
    assert.match(out, /commitment-shifts=2/);
    assert.match(out, /added=4/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("--config <path> uses an explicit config", () => {
  const dir = mkRepo();
  const cfgDir = mkdtempSync(resolve(tmpdir(), "samediff-cfg-explicit-"));
  const cfgPath = resolve(cfgDir, "custom.json");
  writeFileSync(cfgPath, JSON.stringify({ default_policy: "advisory" }));
  try {
    const out = runIn(dir, "left.md", "right.md", "--config", cfgPath, "--stats");
    // advisory = never fail → exit 0 and we see drift in output
    assert.match(out, /score=5\.8/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
    rmSync(cfgDir, { force: true, recursive: true });
  }
});

test("invalid config JSON errors with exit 2", () => {
  const dir = mkRepo();
  try {
    writeFileSync(resolve(dir, ".samediff.json"), "{ not json }");
    try {
      runIn(dir, "left.md", "right.md");
      assert.fail("Expected error");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stderr ?? err.message, /Invalid JSON/);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("unknown category in config errors with exit 2", () => {
  const dir = mkRepo();
  try {
    writeFileSync(
      resolve(dir, ".samediff.json"),
      JSON.stringify({ include: ["not-a-real-category"] }),
    );
    try {
      runIn(dir, "left.md", "right.md");
      assert.fail("Expected error");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stderr ?? err.message, /Unknown category/);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("default_policy referencing an unknown policy errors", () => {
  const dir = mkRepo();
  try {
    writeFileSync(
      resolve(dir, ".samediff.json"),
      JSON.stringify({ default_policy: "ghost-policy" }),
    );
    try {
      runIn(dir, "left.md", "right.md");
      assert.fail("Expected error");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stderr ?? err.message, /default_policy.*not found/);
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("config can override a built-in policy by redefining it", () => {
  const dir = mkRepo();
  try {
    // Redefine 'strict' to be advisory-like
    writeFileSync(
      resolve(dir, ".samediff.json"),
      JSON.stringify({
        policies: { strict: { fail_on: null } },
      }),
    );
    // --policy strict should now NOT fail
    const out = runIn(dir, "left.md", "right.md", "--policy", "strict", "--stats");
    assert.match(out, /score=/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("policy shows up in --json output as `policy`", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    // Pass --fail-on none so exit code stays 0 regardless of drift
    const out = runIn(
      dir,
      "left.md",
      "right.md",
      "--json",
      "--no-baseline",
      "--fail-on",
      "none",
    );
    const j = JSON.parse(out);
    assert.ok(j.policy, "expected policy block on JSON output");
    assert.equal(j.policy.name, "adoption");
    assert.equal(j.policy.source, "default");
    assert.match(j.policy.config, /\.samediff\.json$/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("baseline subcommand writes a valid JSON baseline", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "baseline", "left.md", "right.md");
    const baselinePath = resolve(dir, ".samediff-baseline.json");
    assert.ok(existsSync(baselinePath));
    const parsed = JSON.parse(readFileSync(baselinePath, "utf-8"));
    assert.equal(parsed.version, "1");
    assert.ok(parsed.findings);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("baseline subcommand respects -o path", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "baseline", "left.md", "right.md", "-o", "custom-baseline.json");
    assert.ok(existsSync(resolve(dir, "custom-baseline.json")));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("check subcommand is an alias for bareword invocation", () => {
  const bare = run(simpleLeft, simpleRight, "--stats");
  const explicit = run("check", simpleLeft, simpleRight, "--stats");
  assert.equal(bare, explicit);
});

// ─── SARIF output ────────────────────────────────────────────────────

test("--sarif emits a valid SARIF 2.1.0 document", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  assert.equal(sarif.version, "2.1.0");
  assert.match(sarif.$schema, /sarif-schema-2\.1\.0\.json$/);
  assert.ok(Array.isArray(sarif.runs));
  assert.equal(sarif.runs.length, 1);
  const run0 = sarif.runs[0];
  assert.equal(run0.tool.driver.name, "samediff-lens");
  assert.ok(run0.tool.driver.version);
  assert.match(run0.tool.driver.informationUri, /^https:\/\//);
  assert.ok(Array.isArray(run0.tool.driver.rules));
  assert.equal(run0.invocations[0].executionSuccessful, true);
});

test("--sarif exposes the full stable rule catalog", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  const rules = sarif.runs[0].tool.driver.rules;
  const ids = rules.map((r) => r.id).sort();
  assert.deepEqual(ids, [
    "action-item-added",
    "action-item-removed",
    "commitment-shift",
    "concept-added",
    "concept-removed",
    "concept-renamed",
    "contradiction",
  ]);
  for (const rule of rules) {
    assert.equal(typeof rule.id, "string");
    assert.equal(typeof rule.name, "string");
    assert.equal(typeof rule.shortDescription.text, "string");
    assert.equal(typeof rule.fullDescription.text, "string");
    assert.ok(["note", "warning", "error"].includes(rule.defaultConfiguration.level));
  }
});

test("--sarif rule levels: contradictions are error, commitment shifts warning", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  const byId = Object.fromEntries(sarif.runs[0].tool.driver.rules.map((r) => [r.id, r]));
  assert.equal(byId["contradiction"].defaultConfiguration.level, "error");
  assert.equal(byId["commitment-shift"].defaultConfiguration.level, "warning");
  for (const id of ["concept-added", "concept-removed", "concept-renamed", "action-item-added", "action-item-removed"]) {
    assert.equal(byId[id].defaultConfiguration.level, "note");
  }
});

test("--sarif anchored commitment shift has dual locations (after primary + before related)", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  const results = sarif.runs[0].results;
  const commits = results.filter((r) => r.ruleId === "commitment-shift");
  assert.ok(commits.length > 0);
  for (const r of commits) {
    assert.ok(r.locations && r.locations.length === 1, "primary location");
    const primary = r.locations[0].physicalLocation;
    assert.match(primary.artifactLocation.uri, /right\.md$/);
    assert.ok(primary.region.startLine >= 1);
    assert.ok(r.relatedLocations && r.relatedLocations.length === 1);
    const related = r.relatedLocations[0].physicalLocation;
    assert.match(related.artifactLocation.uri, /left\.md$/);
  }
});

test("--sarif removed-concept uses before file as primary (never fakes after location)", () => {
  const output = run(beforeFile, afterFile, "--sarif");
  const sarif = JSON.parse(output);
  const removed = sarif.runs[0].results.filter((r) => r.ruleId === "concept-removed");
  assert.ok(removed.length > 0);
  for (const r of removed) {
    if (!r.locations) continue; // unanchored ones are fine
    const uri = r.locations[0].physicalLocation.artifactLocation.uri;
    assert.match(uri, /left\.md$/, `removed concept should point at the BEFORE file, got ${uri}`);
    // Must not carry an after-file relatedLocation
    if (r.relatedLocations) {
      for (const rl of r.relatedLocations) {
        assert.ok(
          !/right\.md$/.test(rl.physicalLocation.artifactLocation.uri),
          "removed concept should not pretend it exists on the after side",
        );
      }
    }
  }
});

test("--sarif added-concept primary lives on the after file", () => {
  const output = run(beforeFile, afterFile, "--sarif");
  const sarif = JSON.parse(output);
  const added = sarif.runs[0].results.filter((r) => r.ruleId === "concept-added");
  assert.ok(added.length > 0);
  for (const r of added) {
    if (!r.locations) continue;
    const uri = r.locations[0].physicalLocation.artifactLocation.uri;
    assert.match(uri, /right\.md$/);
  }
});

test("--sarif unanchored finding omits region/locations rather than inventing them", () => {
  // Identical files → no findings at all; still a valid SARIF document.
  const output = run(simpleLeft, simpleLeft, "--sarif");
  const sarif = JSON.parse(output);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results.length, 0);
});

test("--sarif URIs are relative to cwd when possible", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  // We run from repoRoot, so URIs should be under examples/01-modal-shift/
  for (const r of sarif.runs[0].results) {
    if (!r.locations) continue;
    const uri = r.locations[0].physicalLocation.artifactLocation.uri;
    assert.ok(!uri.startsWith("/"), `uri should be relative, got absolute: ${uri}`);
    assert.match(uri, /^examples\/01-modal-shift\/(left|right)\.md$/);
  }
});

test("--sarif anchorQuality appears in result properties when provenance is present", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  const anchored = sarif.runs[0].results.filter((r) => r.locations);
  assert.ok(anchored.length > 0);
  for (const r of anchored) {
    assert.ok(r.properties && typeof r.properties.anchorQuality === "string");
    assert.ok(["exact", "approximate", "derived"].includes(r.properties.anchorQuality));
  }
});

test("--sarif run.properties carries drift score + counts", () => {
  const output = run(simpleLeft, simpleRight, "--sarif");
  const sarif = JSON.parse(output);
  const props = sarif.runs[0].properties;
  assert.ok(props);
  assert.equal(typeof props.driftScore, "number");
  assert.ok(["low", "moderate", "high", "critical"].includes(props.driftLabel));
  assert.equal(typeof props.exitCode, "number");
  assert.ok(props.counts && typeof props.counts.total === "number");
});

test("--sarif + -o writes to file", () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), "samediff-sarif-"));
  const outPath = resolve(tmpDir, "out.sarif");
  try {
    run(simpleLeft, simpleRight, "--sarif", "-o", outPath);
    const text = readFileSync(outPath, "utf-8");
    const sarif = JSON.parse(text);
    assert.equal(sarif.version, "2.1.0");
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

test("--sarif and --json together is a usage error (mutex)", () => {
  try {
    run(simpleLeft, simpleRight, "--sarif", "--json");
    assert.fail("Expected exit 2");
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(err.stderr ?? err.message, /at most one output format/);
  }
});

// ─── Provenance / source anchoring (output surfaces) ────────────────

test("--json findings carry a structured provenance block", () => {
  const output = run(simpleLeft, simpleRight, "--json");
  const result = JSON.parse(output);

  assert.ok(result.findings.commitmentShifts.length > 0);
  const shift = result.findings.commitmentShifts[0];
  assert.ok(shift.provenance, "commitment shift should include provenance");
  assert.ok(Array.isArray(shift.provenance.anchors));
  assert.ok(shift.provenance.anchors.length > 0);
  const sides = shift.provenance.anchors.map((a) => a.side).sort();
  assert.deepEqual(sides, ["after", "before"]);
  for (const a of shift.provenance.anchors) {
    assert.equal(typeof a.startLine, "number");
    assert.equal(typeof a.endLine, "number");
    assert.equal(typeof a.startColumn, "number");
    assert.equal(typeof a.endColumn, "number");
    assert.equal(typeof a.snippet, "string");
    assert.ok(["exact", "approximate"].includes(a.quality));
  }
});

test("--json added concepts provenance sits on after side only", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);
  const anchored = result.findings.addedConcepts.filter(
    (c) => c.provenance && c.provenance.anchors.length > 0,
  );
  assert.ok(anchored.length > 0, "expected some added concepts to be anchored");
  for (const c of anchored) {
    assert.deepEqual(
      c.provenance.anchors.map((a) => a.side),
      ["after"],
    );
  }
});

test("--json removed concepts provenance sits on before side only", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);
  const anchored = result.findings.removedConcepts.filter(
    (c) => c.provenance && c.provenance.anchors.length > 0,
  );
  assert.ok(anchored.length > 0, "expected some removed concepts to be anchored");
  for (const c of anchored) {
    assert.deepEqual(
      c.provenance.anchors.map((a) => a.side),
      ["before"],
    );
  }
});

test("--json action item findings expose provenance when locatable", () => {
  const output = run(beforeFile, afterFile, "--json");
  const result = JSON.parse(output);
  const added = result.findings.actionItemsAdded;
  const removed = result.findings.actionItemsRemoved;
  assert.ok(added.length > 0 || removed.length > 0, "hydra example has action item drift");
  for (const f of [...added, ...removed]) {
    // provenance may be null if unlocatable; when present, shape is right
    if (f.provenance) {
      assert.ok(Array.isArray(f.provenance.anchors));
      const expectedSide = f.type === "action-item-added" ? "after" : "before";
      for (const a of f.provenance.anchors) assert.equal(a.side, expectedSide);
    }
  }
});

test("--json findings without locatable source carry provenance: null", () => {
  const output = run(simpleLeft, simpleLeft, "--json");
  const result = JSON.parse(output);
  // Identical files => no findings, nothing to assert on provenance;
  // the shape should still parse and counts should be zero.
  assert.equal(result.counts.total, 0);
});

test("terminal output shows concise source anchors under findings", () => {
  const output = run(simpleLeft, simpleRight);
  // Commitment shift region prints a "@ before:L after:L" suffix on the
  // trigger/metadata line.
  assert.match(output, /@ before:\d+ after:\d+/);
});

test("--compact output includes anchor tab field when available", () => {
  const output = run(simpleLeft, simpleRight, "--compact");
  const lines = output.trim().split("\n").filter(Boolean);
  const commitment = lines.find((l) => l.startsWith("COMMITMENT\t"));
  assert.ok(commitment, "expected a COMMITMENT compact row");
  // The anchor suffix uses "\t@before:" / "\t@after:"
  assert.match(commitment, /\t@\s*(before|after):\d+/);
});

test("--compact anchor field only appears when anchors exist", () => {
  // Identical files → no findings at all; output should be empty.
  const output = run(simpleLeft, simpleLeft, "--compact");
  assert.equal(output.trim(), "");
});

test("--github annotations include line= for after-anchored findings", () => {
  const output = run(simpleLeft, simpleRight, "--github");
  // Commitment shift should carry a line= annotation
  const errorLines = output
    .split("\n")
    .filter((l) => l.startsWith("::error ") && /Commitment shift/.test(l));
  assert.ok(errorLines.length > 0);
  for (const l of errorLines) {
    assert.match(l, /\bline=\d+\b/, "expected a line= field in the annotation");
  }
});

test("--github omits line= for removed-concept (before-only) findings", () => {
  const output = run(beforeFile, afterFile, "--github");
  const removedLines = output
    .split("\n")
    .filter((l) => l.startsWith("::notice ") && /Removed concept/.test(l));
  // Removed concepts live in the before file; GitHub can't anchor those
  // in the after file, so no line= field.
  for (const l of removedLines) {
    assert.ok(!/\bline=\d+/.test(l), `expected no line= in "${l}"`);
  }
});

test("anchor line numbers match actual file content", () => {
  // Modal-shift fixtures: after file has "may cache" on line 1 and
  // "validate tokens" on line 2.
  const output = run(simpleLeft, simpleRight, "--json");
  const result = JSON.parse(output);
  const validate = result.findings.commitmentShifts.find((f) =>
    /validate tokens/.test(f.evidence.after),
  );
  assert.ok(validate);
  const afterAnchor = validate.provenance.anchors.find((a) => a.side === "after");
  assert.equal(afterAnchor.startLine, 2);
});

test("--no-baseline overrides policy baseline", () => {
  const dir = mkRepo();
  try {
    runIn(dir, "init");
    runIn(dir, "baseline", "left.md", "right.md");
    // With baseline: score=0.0
    const withBaseline = runIn(dir, "left.md", "right.md", "--stats", "--fail-on", "none");
    assert.match(withBaseline, /score=0\.0/);
    // --no-baseline: drift is visible again
    const withoutBaseline = runIn(
      dir,
      "left.md",
      "right.md",
      "--stats",
      "--no-baseline",
      "--fail-on",
      "none",
    );
    assert.match(withoutBaseline, /commitment-shifts=2/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
