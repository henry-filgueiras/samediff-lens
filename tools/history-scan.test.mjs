/**
 * Tests for `samediff scan` and `samediff history`.
 *
 * Both commands lean on the host repo's git history, so we run them
 * against the samediff-lens repo itself (which is checked out at the
 * test-run point and has plenty of churn on README.md /
 * DIRECTORS_NOTES.md / examples/01-modal-shift/left.md).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");

function run(...args) {
  return execFileSync("node", [cli, ...args, "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runWithStderr(...args) {
  return execFileSync("node", [cli, ...args, "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ── scan ───────────────────────────────────────────────────────────────────

test("scan lists markdown files under cwd by churn", () => {
  const out = run("scan", ".", "--top", "5");
  assert.match(out, /Scanned \d+ files/);
  assert.match(out, /edits\s+path/);
  // README.md and DIRECTORS_NOTES.md are the high-churn ones in this repo
  // — at least one of them should appear in the top-5.
  assert.match(
    out,
    /(README\.md|DIRECTORS_NOTES\.md)/,
    "expected the top-churn files of this repo to appear",
  );
});

test("scan respects --top N", () => {
  const out = run("scan", ".", "--top", "3");
  // Header + separator + "edits" header + separator + at most 3 rows
  const dataRows = out
    .split("\n")
    .filter((l) => /^\s*\d+\s+\S/.test(l));
  assert.ok(dataRows.length <= 3, `expected ≤3 data rows, got ${dataRows.length}`);
});

test("scan defaults to top 20 when --top is absent", () => {
  const out = run("scan", ".");
  const dataRows = out
    .split("\n")
    .filter((l) => /^\s*\d+\s+\S/.test(l));
  // We expect more than 3 markdown files in this repo, but bounded by 20.
  assert.ok(dataRows.length > 0, "expected at least one row");
  assert.ok(dataRows.length <= 20, `expected ≤20 rows; got ${dataRows.length}`);
});

test("scan returns clean message when nothing matches", () => {
  // src/ has no .md files
  const out = run("scan", "src");
  assert.match(out, /Scanned 0 files/);
  assert.match(out, /no files matched/);
});

test("scan is sorted by edits descending", () => {
  const out = run("scan", ".", "--top", "10");
  const rows = out
    .split("\n")
    .filter((l) => /^\s*\d+\s+\S/.test(l))
    .map((l) => parseInt(l.trim().split(/\s+/)[0], 10));
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i - 1] >= rows[i],
      `row ${i - 1} (${rows[i - 1]}) should be >= row ${i} (${rows[i]})`,
    );
  }
});

// ── history ────────────────────────────────────────────────────────────────

test("history walks every commit pair for a file and writes index + trail", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-hist-"));
  try {
    const out = runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    // stdout ends with the index path
    assert.match(out, /index\.html\s*$/);
    assert.ok(existsSync(join(dir, "index.html")), "index.html should exist");
    assert.ok(existsSync(join(dir, "trail.json")), "trail.json should exist");
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(typeof trail.filePath, "string");
    assert.ok(Array.isArray(trail.steps));
    assert.ok(trail.steps.length >= 1, "expected at least one step");
    assert.equal(trail.includesEmptyBaseline, true);
    // First step is the EMPTY → first-commit baseline by default
    assert.equal(trail.steps[0].fromRef, "EMPTY");
    // Each step's HTML file should exist
    for (const step of trail.steps) {
      assert.ok(
        existsSync(join(dir, step.htmlFilename)),
        `expected per-pair HTML ${step.htmlFilename} to exist`,
      );
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history --no-empty skips the EMPTY → first-commit baseline", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-hist-"));
  try {
    runWithStderr("history", "DIRECTORS_NOTES.md", "-o", dir, "--no-empty");
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(trail.includesEmptyBaseline, false);
    if (trail.steps.length > 0) {
      assert.notEqual(trail.steps[0].fromRef, "EMPTY");
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history index page embeds the SVG drift chart and the step list", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-hist-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    const html = readFileSync(join(dir, "index.html"), "utf-8");
    assert.match(html, /<svg class="chart-svg"/, "expected the chart SVG");
    assert.match(html, /class="step sev-/, "expected step rows");
    assert.match(html, /SameDiff history/, "expected history-page branding");
    // Stats grid: should mention transitions count
    assert.match(html, /Transitions/);
    assert.match(html, /Worst score/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history each step carries score, severity, and authorship metadata", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-hist-"));
  try {
    runWithStderr("history", "DIRECTORS_NOTES.md", "-o", dir);
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    for (const s of trail.steps) {
      assert.equal(typeof s.score, "number");
      assert.ok(["low", "moderate", "high", "critical"].includes(s.severity));
      assert.equal(typeof s.authorName, "string");
      assert.match(s.authorDate, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof s.commitSubject, "string");
      assert.equal(typeof s.totalFindings, "number");
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history errors cleanly for a path with no git history", () => {
  try {
    runWithStderr("history", "examples/01-modal-shift/this-file-does-not-exist.md");
    assert.fail("Expected failure");
  } catch (err) {
    assert.match(err.stderr ?? err.message, /no git history/);
  }
});

// ── audit ──────────────────────────────────────────────────────────────────

test("audit produces a per-step markdown report from a history outdir", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    const summaryOut = run("audit", dir);
    assert.match(summaryOut, /samediff audit/);
    assert.match(summaryOut, /wrote .*audit\.md/);

    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    // Header
    assert.match(audit, /^# Audit/);
    // At least one per-step block with the canonical structure
    assert.match(audit, /## Step \d+/);
    assert.match(audit, /\*\*findings\*\*/);
    assert.match(audit, /\*\*diff\*\* \(changed lines only\)/);
    assert.match(audit, /\*\*verdict\*\*/);
    // Diff fence
    assert.match(audit, /```diff/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit --max-diff-lines caps the per-step diff section", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "DIRECTORS_NOTES.md", "-o", dir);
    run("audit", dir, "--max-diff-lines", "3");
    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    // At least one step on this notes file should have >3 changed lines,
    // so we should see the elision marker somewhere.
    assert.match(audit, /more changed line.*elided/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
