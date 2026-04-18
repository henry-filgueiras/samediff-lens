/**
 * Multi-file (`samediff dir`) pipeline tests.
 *
 * Exercises the directory walker, per-file pairing, aggregation, top-issue
 * ranking across files, and structural-drift notices for files present on
 * only one side.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");

function runDirJson(leftRoot, rightRoot) {
  const raw = execFileSync(
    "node",
    [cli, "dir", leftRoot, rightRoot, "--json", "--no-config"],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  return JSON.parse(raw);
}

function withTempPair(leftFiles, rightFiles, fn) {
  const root = mkdtempSync(resolve(tmpdir(), "samediff-dir-"));
  const lp = resolve(root, "left");
  const rp = resolve(root, "right");
  mkdirSync(lp, { recursive: true });
  mkdirSync(rp, { recursive: true });
  for (const [path, content] of Object.entries(leftFiles)) {
    const full = join(lp, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  for (const [path, content] of Object.entries(rightFiles)) {
    const full = join(rp, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  try {
    return fn(lp, rp);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

// ── Shape ──────────────────────────────────────────────────────────────────

test("dir output has aggregate, files, notices, and meta", () => {
  withTempPair(
    { "a.md": "Logging is optional.\n", "b.md": "Hello world.\n" },
    { "a.md": "Logging is required.\n", "b.md": "Hello world.\n" },
    (l, r) => {
      const report = runDirJson(l, r);
      assert.ok(report.meta);
      assert.equal(report.meta.tool, "samediff-lens");
      assert.equal(report.meta.leftRoot, l);
      assert.equal(report.meta.rightRoot, r);
      assert.ok(Array.isArray(report.files));
      assert.ok(Array.isArray(report.notices));
      assert.ok(report.aggregate);
      assert.equal(typeof report.aggregate.fileCount, "number");
      assert.equal(typeof report.aggregate.maxScore, "number");
      assert.equal(typeof report.aggregate.avgScore, "number");
    },
  );
});

// ── Walking ────────────────────────────────────────────────────────────────

test("dir walks .md files recursively", () => {
  withTempPair(
    {
      "top.md": "x",
      "nested/inner.md": "y",
      "nested/deep/very-deep.md": "z",
      "ignored.bin": "binary noise",
    },
    {
      "top.md": "x",
      "nested/inner.md": "y",
      "nested/deep/very-deep.md": "z",
      "ignored.bin": "binary noise",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      const paths = report.files.map((f) => f.path).sort();
      assert.deepEqual(paths, [
        "nested/deep/very-deep.md",
        "nested/inner.md",
        "top.md",
      ]);
    },
  );
});

test("dir skips dotfiles and node_modules / .git", () => {
  withTempPair(
    {
      "kept.md": "x",
      ".hidden.md": "x",
      "node_modules/pkg/README.md": "x",
      ".git/HEAD": "x",
    },
    {
      "kept.md": "x",
      ".hidden.md": "x",
      "node_modules/pkg/README.md": "x",
      ".git/HEAD": "x",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      const paths = report.files.map((f) => f.path);
      assert.deepEqual(paths, ["kept.md"]);
    },
  );
});

// ── Aggregation ────────────────────────────────────────────────────────────

test("aggregate headline pulls the highest-salience issue across files, prefixed with file path", () => {
  withTempPair(
    {
      // Low-signal change in low.md
      "low.md": "Today is a sunny day.\n",
      // High-signal: required → optional flip in high.md (commitment-reversal)
      "high.md": "Logging is optional but recommended for debugging.\n",
    },
    {
      "low.md": "Today is also a sunny day.\n",
      "high.md": "Logging is required for all production deployments.\n",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      assert.ok(report.aggregate.headline, "expected a headline");
      assert.match(
        report.aggregate.headline,
        /^high\.md \u2014 /,
        `headline must lead with the file that owns the strongest issue, got: ${report.aggregate.headline}`,
      );
      assert.match(report.aggregate.headline, /[Rr]eversed|[Rr]equired|[Cc]ommitment/);
    },
  );
});

test("aggregate ranks top issues across files by salience, not by file order", () => {
  withTempPair(
    {
      // Alphabetically first, but only weak drift
      "aaa.md": "Foo. Bar. Baz.\n",
      // Alphabetically last, but contains a critical reversal
      "zzz.md": "Logging is optional but recommended for debugging.\n",
    },
    {
      "aaa.md": "Foo. Bar. Baz qux.\n",
      "zzz.md": "Logging is required for all production deployments.\n",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      assert.ok(report.aggregate.topIssues.length >= 1);
      // The first top issue must come from zzz.md (the strong file)
      assert.equal(
        report.aggregate.topIssues[0].file,
        "zzz.md",
        `top issue should be from the high-severity file; got ${report.aggregate.topIssues[0].file}`,
      );
    },
  );
});

test("aggregate severity equals max per-file severity", () => {
  // spicy.md needs enough drift to clear the "high" score threshold (>5).
  // A single commitment shift only nudges to moderate; pile on a few more
  // findings (multiple shifts + a contradiction trigger) so the per-file
  // score reliably lands in high or critical.
  withTempPair(
    {
      "calm.md": "Hello world.\n",
      "spicy.md": [
        "Logging is optional but recommended for debugging.",
        "Authentication may be skipped during local testing.",
        "Encryption is recommended in transit.",
        "Rate limiting is not enforced during the beta period.",
      ].join("\n") + "\n",
    },
    {
      "calm.md": "Hello world.\n",
      "spicy.md": [
        "Logging is required for all production deployments.",
        "Authentication must always be performed via OAuth.",
        "Encryption must be applied in transit using TLS 1.3.",
        "Rate limiting is enforced at 100 requests per minute.",
      ].join("\n") + "\n",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      // spicy.md should land in high or critical; calm.md is unchanged.
      // Aggregate severity must reflect the worst of the two.
      assert.ok(
        ["high", "critical"].includes(report.aggregate.severity),
        `expected aggregate severity high or critical, got ${report.aggregate.severity}`,
      );
    },
  );
});

// ── Structural drift (file added/removed) ──────────────────────────────────

test("file present on only one side is reported in notices", () => {
  withTempPair(
    { "shared.md": "x", "only-left.md": "y" },
    { "shared.md": "x", "only-right.md": "z" },
    (l, r) => {
      const report = runDirJson(l, r);
      const notices = report.notices.sort((a, b) => a.path.localeCompare(b.path));
      assert.deepEqual(
        notices,
        [
          { path: "only-left.md", kind: "removed-file" },
          { path: "only-right.md", kind: "added-file" },
        ],
      );
      // The shared file should still appear in `files`
      assert.equal(report.files.length, 1);
      assert.equal(report.files[0].path, "shared.md");
    },
  );
});

test("when no files are comparable but structural drift exists, headline reflects that", () => {
  withTempPair(
    { "only-left.md": "x" },
    { "only-right.md": "y" },
    (l, r) => {
      const report = runDirJson(l, r);
      assert.equal(report.files.length, 0);
      assert.equal(report.notices.length, 2);
      assert.match(report.aggregate.headline ?? "", /Structural drift/);
    },
  );
});

// ── Per-file integrity ─────────────────────────────────────────────────────

test("each per-file entry carries its own narrative + DiffResult", () => {
  withTempPair(
    { "a.md": "Logging is optional but recommended for debugging.\n" },
    { "a.md": "Logging is required for all production deployments.\n" },
    (l, r) => {
      const report = runDirJson(l, r);
      assert.equal(report.files.length, 1);
      const f = report.files[0];
      assert.equal(f.path, "a.md");
      assert.ok(f.diff, "per-file diff must be present");
      assert.ok(f.diff.findings, "per-file findings must be present");
      assert.ok(f.narrative, "per-file narrative must be present");
      assert.ok(f.narrative.headline, "per-file narrative should have a headline");
    },
  );
});

test("AttributedIssue carries file attribution that matches a real per-file path", () => {
  withTempPair(
    {
      "a.md": "Logging is optional.\n",
      "b.md": "Auth is required.\n",
    },
    {
      "a.md": "Logging is required.\n",
      "b.md": "Auth is optional.\n",
    },
    (l, r) => {
      const report = runDirJson(l, r);
      const filePaths = new Set(report.files.map((f) => f.path));
      for (const issue of report.aggregate.topIssues) {
        assert.ok(
          filePaths.has(issue.file),
          `top issue's file ${issue.file} is not among per-file paths ${[...filePaths]}`,
        );
      }
      for (const issue of report.aggregate.quietIssues) {
        assert.ok(filePaths.has(issue.file), `quiet issue's file ${issue.file} is not among per-file paths`);
      }
    },
  );
});

// ── End-to-end: the canonical multi-spec example ───────────────────────────

test("examples/07-multi-spec produces the expected forensic-report shape", () => {
  const l = resolve(repoRoot, "examples/07-multi-spec/v1");
  const r = resolve(repoRoot, "examples/07-multi-spec/v2");
  const report = runDirJson(l, r);

  // Three files, all with drift
  assert.equal(report.aggregate.fileCount, 3);
  assert.equal(report.aggregate.filesWithDrift, 3);

  // Headline mentions a real file from the spec and a strong reversal
  assert.ok(report.aggregate.headline, "expected an aggregate headline");
  assert.match(report.aggregate.headline, /^(api|policy|runbook)\.md \u2014/);

  // Top issues span at least two distinct files
  const issueFiles = new Set(report.aggregate.topIssues.map((i) => i.file));
  assert.ok(
    issueFiles.size >= 2,
    `top issues should span multiple files; got files: ${[...issueFiles]}`,
  );

  // Severity must be high or critical for this example (lots of weakening)
  assert.ok(
    ["high", "critical"].includes(report.aggregate.severity),
    `expected high or critical aggregate severity, got ${report.aggregate.severity}`,
  );
});
