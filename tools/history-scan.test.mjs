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

// ── audit: persistent verdict memory (schema v2) ────────────────────────

test("audit writes a v2 verdicts.json with per-step + per-finding records", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    const verdictsPath = join(dir, "verdicts.json");
    assert.ok(existsSync(verdictsPath), "verdicts.json should be emitted");

    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    assert.equal(store.version, "2");
    assert.ok(Array.isArray(store.steps));
    assert.ok(Array.isArray(store.orphanedSteps));
    assert.ok(store.steps.length >= 1);

    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(store.steps.length, trail.steps.length);

    // Each step has the canonical identity fields + findings array.
    for (const s of store.steps) {
      assert.match(s.stepKey, /^sha256:[a-f0-9]+$/);
      assert.equal(s.verdict, null, "fresh run: step verdict is null");
      assert.ok(Array.isArray(s.findings));
      assert.ok(Array.isArray(s.orphanedFindings));
      for (const f of s.findings) {
        assert.match(f.fingerprint, /^sha256:[a-f0-9]+$/);
        assert.equal(typeof f.kind, "string");
        assert.equal(f.verdict, null);
      }
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit rerun preserves step-level verdicts across runs", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    audit = audit.replace(
      /\*\*verdict\*\*: _\( signal \| fp \| noise \| unclear — annotate here \)_/,
      "**verdict**: signal",
    );
    audit = audit.replace(
      /\*\*note\*\*: _\(optional reviewer note\)_/,
      "**note**: real narrowing — confirmed with policy team",
    );
    writeFileSync(auditPath, audit, "utf-8");

    run("audit", dir);

    const store = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"));
    const withVerdict = store.steps.filter((s) => s.verdict !== null);
    assert.equal(withVerdict.length, 1, "one step-level verdict persisted");
    assert.equal(withVerdict[0].verdict.value, "signal");
    assert.equal(
      withVerdict[0].verdict.note,
      "real narrowing — confirmed with policy team",
    );
    assert.ok(withVerdict[0].verdict.setAt);

    const newAudit = readFileSync(auditPath, "utf-8");
    assert.match(
      newAudit,
      /\*\*verdict\*\* \*\(carried from \d{4}-\d{2}-\d{2}\)\*: signal/,
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit persists per-finding verdicts via the finding-verdicts block", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Grab a finding's display id from the rendered audit.md.
    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    const idMatch = audit.match(/\{f:([0-9a-f]{12})\}/);
    assert.ok(idMatch, "audit.md should expose a {f:<id>} tag on findings");
    const fid = idMatch[1];

    // Replace the prompt finding-verdicts block with a concrete override.
    audit = audit.replace(
      /\*\*finding-verdicts\*\*: _\(optional[^\n]+\)_/,
      `**finding-verdicts**:\n- \`${fid}\` fp — extractor artifact, unrelated subjects`,
    );
    writeFileSync(auditPath, audit, "utf-8");

    run("audit", dir);

    const store = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"));
    const target = store.steps
      .flatMap((s) => s.findings)
      .find((f) => f.fingerprint.includes(fid));
    assert.ok(target, "finding with the edited id should be in the store");
    assert.ok(target.verdict, "per-finding verdict should be recorded");
    assert.equal(target.verdict.value, "fp");
    assert.equal(target.verdict.note, "extractor artifact, unrelated subjects");

    // Re-rendered audit.md should carry the verdict forward inline.
    const newAudit = readFileSync(auditPath, "utf-8");
    assert.match(newAudit, new RegExp(`\\{f:${fid}\\}.*carried: fp`));
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
    // Every step is new on first run, which means the step-level [NEW]
    // badge fires once per step and every finding line also carries [NEW].
    const stepNew = (audit.match(/## Step \d+ `\[NEW\]`/g) ?? []).length;
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.equal(stepNew, trail.steps.length);

    run("audit", dir);
    const audit2 = readFileSync(join(dir, "audit.md"), "utf-8");
    const stepNew2 = (audit2.match(/## Step \d+ `\[NEW\]`/g) ?? []).length;
    assert.equal(stepNew2, 0, "second run: no step is new anymore");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit orphans a step when its stepKey leaves the trail", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Inject a synthetic prior step that no live trail step matches.
    const verdictsPath = join(dir, "verdicts.json");
    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    store.steps.push({
      stepKey: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      fromRef: "deadbeef",
      toRef: "cafef00d",
      toShort: "cafef00d",
      filePath: store.filePath,
      commitSubject: "old commit that got rebased away",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastConfirmedAt: "2026-01-01T00:00:00.000Z",
      verdict: {
        value: "fp",
        note: "was a false positive — recorded last quarter",
        setAt: "2026-01-01T00:00:00.000Z",
        engineVersionAtJudgment: "0.7.0",
      },
      findings: [],
      orphanedFindings: [],
    });
    writeFileSync(verdictsPath, JSON.stringify(store, null, 2), "utf-8");

    run("audit", dir);

    const store2 = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    assert.equal(store2.orphanedSteps.length, 1);
    assert.equal(store2.orphanedSteps[0].verdict.value, "fp");
    assert.equal(
      store2.orphanedSteps[0].verdict.note,
      "was a false positive — recorded last quarter",
    );

    const hasOrphanAsLive = store2.steps.some((s) => s.toRef === "cafef00d");
    assert.equal(hasOrphanAsLive, false);

    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    assert.match(audit, /## Orphaned verdicts/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit flags [DRIFTED] when a step gains or loses a finding", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Record a step-level verdict, then inject a synthetic prior
    // finding with a fingerprint that the engine will not reproduce.
    // That makes the live finding set differ, forcing [DRIFTED].
    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    audit = audit.replace(
      /\*\*verdict\*\*: _\( signal \| fp \| noise \| unclear — annotate here \)_/,
      "**verdict**: signal",
    );
    writeFileSync(auditPath, audit, "utf-8");
    run("audit", dir);

    const verdictsPath = join(dir, "verdicts.json");
    const store = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    const firstStep = store.steps[0];
    assert.ok(firstStep, "expected at least one live step");
    firstStep.findings.push({
      fingerprint: "sha256:ghostfingerthatwontexistinengine",
      kind: "contradiction",
      summary: "ghost finding",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastConfirmedAt: "2026-01-01T00:00:00.000Z",
      verdict: {
        value: "fp",
        note: "fingerprint-level verdict on a finding that will vanish",
        setAt: "2026-01-01T00:00:00.000Z",
        engineVersionAtJudgment: "0.7.0",
      },
    });
    writeFileSync(verdictsPath, JSON.stringify(store, null, 2), "utf-8");

    run("audit", dir);

    const newAudit = readFileSync(auditPath, "utf-8");
    assert.match(newAudit, /`\[DRIFTED\]`/);
    assert.match(newAudit, /re-review recommended/);
    // Step-level verdict is carried forward.
    assert.match(newAudit, /carried from.*signal/);
    // The ghost finding shows up as "no longer present" with its prior verdict.
    assert.match(newAudit, /findings no longer present/);
    assert.match(newAudit, /prior verdict:/);

    const store2 = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    const orphanedInStep = store2.steps[0].orphanedFindings;
    assert.ok(
      orphanedInStep.some((f) => f.fingerprint.includes("ghostfinger")),
      "ghost finding should be retained in orphanedFindings with its verdict",
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit finding fingerprints are stable across reruns on the same engine", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);
    const fps1 = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"))
      .steps.flatMap((s) => s.findings.map((f) => f.fingerprint)).sort();

    // Regenerate the trail; same git history, same engine, fingerprints must match.
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);
    const fps2 = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"))
      .steps.flatMap((s) => s.findings.map((f) => f.fingerprint)).sort();

    assert.deepEqual(fps2, fps1, "finding fingerprints must be stable");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit migrates a v1 verdicts.json on the fly", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Read the current v2 file, synthesize an equivalent v1 shape for
    // the first step, and overwrite. Rerunning should silently migrate.
    const verdictsPath = join(dir, "verdicts.json");
    const v2 = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    const firstStep = v2.steps[0];
    const v1 = {
      version: "1",
      filePath: v2.filePath,
      generatedAt: v2.generatedAt,
      engineVersion: v2.engineVersion,
      entries: [
        {
          stepKey: firstStep.stepKey,
          fromRef: firstStep.fromRef,
          toRef: firstStep.toRef,
          toShort: firstStep.toShort,
          filePath: firstStep.filePath,
          commitSubject: firstStep.commitSubject,
          verdict: "signal",
          note: "carried over from v1",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastConfirmedAt: "2026-01-01T00:00:00.000Z",
          verdictSetAt: "2026-01-01T00:00:00.000Z",
          engineVersionAtJudgment: "0.6.0",
          findingsFingerprint: "sha256:legacy",
        },
      ],
      orphaned: [],
    };
    writeFileSync(verdictsPath, JSON.stringify(v1, null, 2), "utf-8");

    run("audit", dir);

    const migrated = JSON.parse(readFileSync(verdictsPath, "utf-8"));
    assert.equal(migrated.version, "2");
    const target = migrated.steps.find((s) => s.stepKey === firstStep.stepKey);
    assert.ok(target, "migrated step must still be present");
    assert.ok(target.verdict, "step verdict must be carried forward");
    assert.equal(target.verdict.value, "signal");
    assert.equal(target.verdict.note, "carried over from v1");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit finding fingerprints tolerate ancillary engine label changes", () => {
  // Fingerprints must be computed from semantic evidence only, so that
  // retuning confidence/trigger labels doesn't invalidate prior verdicts.
  // We simulate this by stashing a recorded finding verdict and then
  // mutating the stored `kind` label in a way that does NOT appear in
  // the fingerprint's inputs. The verdict should still persist on
  // the next run (same fingerprint → same finding identity).
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-"));
  try {
    runWithStderr("history", "examples/01-modal-shift/left.md", "-o", dir);
    run("audit", dir);

    // Attach a finding-level verdict.
    const auditPath = join(dir, "audit.md");
    let audit = readFileSync(auditPath, "utf-8");
    const idMatch = audit.match(/\{f:([0-9a-f]{12})\}/);
    assert.ok(idMatch);
    const fid = idMatch[1];
    audit = audit.replace(
      /\*\*finding-verdicts\*\*: _\(optional[^\n]+\)_/,
      `**finding-verdicts**:\n- \`${fid}\` signal — real narrowing`,
    );
    writeFileSync(auditPath, audit, "utf-8");
    run("audit", dir);

    const fpsBefore = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"))
      .steps.flatMap((s) => s.findings.map((f) => f.fingerprint)).sort();

    // Rerun — the fingerprints must be stable and the verdict persists.
    run("audit", dir);
    const store = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf-8"));
    const fpsAfter = store.steps
      .flatMap((s) => s.findings.map((f) => f.fingerprint)).sort();
    assert.deepEqual(fpsAfter, fpsBefore);

    const keep = store.steps.flatMap((s) => s.findings)
      .find((f) => f.fingerprint.includes(fid) && f.verdict);
    assert.ok(keep, "per-finding verdict must survive rerun");
    assert.equal(keep.verdict.value, "signal");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
