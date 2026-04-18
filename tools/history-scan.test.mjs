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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

// ── audit: persistent verdict memory ────────────────────────────────────

test("audit writes a verdicts.json sidecar with one entry per step", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    const verdictsPath = join(dir, "verdicts.json");
    assert.ok(existsSync(verdictsPath), "verdicts.json should be emitted");

    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    assert.equal(store.version, "1");
    assert.equal(typeof store.filePath, "string");
    assert.ok(Array.isArray(store.entries));
    assert.ok(store.entries.length >= 1);

    // Each entry has the canonical identity + fingerprint fields.
    for (const e of store.entries) {
      assert.match(e.stepKey, /^sha256:[a-f0-9]+$/, "stepKey is a sha256 id");
      assert.equal(typeof e.fromRef, "string");
      assert.equal(typeof e.toRef, "string");
      assert.equal(typeof e.findingsFingerprint, "string");
      assert.equal(e.verdict, null, "fresh run: verdict is null");
      assert.equal(typeof e.firstSeenAt, "string");
    }

    // First run reports everything as new.
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(store.entries.length, trail.steps.length);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit rerun preserves prior verdicts across runs", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Simulate a human editing a verdict slot in audit.md for step 0.
    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    audit = audit.replace(
      /\*\*verdict\*\*: _\( signal \| fp \| noise \| unclear — annotate here \)_/,
      "**verdict**: signal",
    );
    writeFileSync(auditPath, audit, "utf-8");

    // Rerun audit — the edited verdict should land in verdicts.json,
    // and the regenerated audit.md should carry it forward inline.
    run("audit", dir);

    const store = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"));
    const withVerdict = store.entries.filter((e) => e.verdict !== null);
    assert.equal(withVerdict.length, 1, "exactly one verdict should be recorded");
    assert.equal(withVerdict[0].verdict, "signal");
    assert.ok(withVerdict[0].verdictSetAt, "verdictSetAt should be populated");

    const newAudit = readFileSync(auditPath, "utf-8");
    assert.match(
      newAudit,
      /\*\*verdict\*\* \*\(carried from \d{4}-\d{2}-\d{2}\)\*: signal/,
      "rendered audit.md should show the carried verdict",
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit marks newly-introduced steps with [NEW] on first observation", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    // Fresh audit: every step is new.
    const newMatches = audit.match(/`\[NEW\]`/g) ?? [];
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(newMatches.length, trail.steps.length);

    // Second run: nothing is new anymore.
    run("audit", dir);
    const audit2 = readFileSync(join(dir, "audit.md"), "utf-8");
    const newMatches2 = audit2.match(/`\[NEW\]`/g) ?? [];
    assert.equal(newMatches2.length, 0);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit surfaces orphaned verdicts when a step leaves the trail", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Inject a synthetic prior verdict that has no matching live step.
    // This simulates a prior trail that covered commits which are no
    // longer in the current trail (rebase, branch cleanup, etc).
    const verdictsPath = join(dir, "verdicts.json");
    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    store.entries.push({
      stepKey: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      fromRef: "deadbeef",
      toRef: "cafef00d",
      toShort: "cafef00d",
      filePath: store.filePath,
      commitSubject: "old commit that got rebased away",
      verdict: "fp",
      note: "was a false positive — recorded last quarter",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastConfirmedAt: "2026-01-01T00:00:00.000Z",
      verdictSetAt: "2026-01-01T00:00:00.000Z",
      engineVersionAtJudgment: "0.7.0",
      findingsFingerprint: "sha256:deadbeef",
    });
    writeFileSync(verdictsPath, JSON.stringify(store, null, 2), "utf-8");

    // Rerun — the injected entry should become orphaned, not silently dropped.
    run("audit", dir);

    const store2 = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    assert.equal(store2.orphaned.length, 1);
    assert.equal(store2.orphaned[0].verdict, "fp");
    assert.equal(
      store2.orphaned[0].note,
      "was a false positive — recorded last quarter",
    );
    // Live entries should not include the orphan.
    const hasOrphan = store2.entries.some((e) => e.toRef === "cafef00d");
    assert.equal(hasOrphan, false);

    // Rendered audit.md should surface the orphaned section.
    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    assert.match(audit, /## Orphaned verdicts/);
    assert.match(audit, /fp/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit flags [ENGINE-CHANGED] when a step's findings fingerprint drifts", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Record a verdict on step 0, then corrupt the stored fingerprint
    // to simulate the engine having moved since last review.
    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    audit = audit.replace(
      /\*\*verdict\*\*: _\( signal \| fp \| noise \| unclear — annotate here \)_/,
      "**verdict**: signal",
    );
    writeFileSync(auditPath, audit, "utf-8");
    run("audit", dir);

    // Mutate the fingerprint on the first live entry so the next run
    // sees the step as engine-changed.
    const verdictsPath = join(dir, "verdicts.json");
    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    const withVerdict = store.entries.find((e) => e.verdict !== null);
    assert.ok(withVerdict, "expected a stored verdict before the mutation");
    withVerdict.findingsFingerprint = "sha256:stalefingerprint";
    writeFileSync(verdictsPath, JSON.stringify(store, null, 2), "utf-8");

    run("audit", dir);

    const newAudit = readFileSync(auditPath, "utf-8");
    assert.match(newAudit, /`\[ENGINE-CHANGED\]`/);
    assert.match(newAudit, /re-review needed/);
    // The verdict is preserved even though the fingerprint moved.
    assert.match(newAudit, /carried from.*: signal/);

    const store2 = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    const stillHas = store2.entries.find((e) => e.verdict === "signal");
    assert.ok(stillHas, "verdict should carry forward across engine change");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit step identity is stable across trail regeneration", () => {
  // Regenerating the trail on the same underlying git history should
  // produce the same stepKeys — otherwise verdicts won't persist.
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);
    const keys1 = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"))
      .entries.map((e) => e.stepKey).sort();

    // Regenerate the trail from scratch and rerun audit.
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);
    const keys2 = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"))
      .entries.map((e) => e.stepKey).sort();

    assert.deepEqual(keys2, keys1, "stepKeys must be stable across regeneration");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
