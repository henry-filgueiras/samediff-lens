/**
 * Source-diff tests.
 *
 * Covers the LCS line-diff algorithm (correctness + hunks) and verifies
 * that the formatHtml renderer embeds a working diff section when source
 * texts are passed through, both for single-file and multi-file leaves.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRequire } from "node:module";
import * as ts from "typescript";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");

// Compile sourceDiff.ts in-memory so we can unit-test the algorithm directly
// without going through the CLI for every assertion.
const compiledDir = (() => {
  const out = mkdtempSync(join(tmpdir(), "samediff-srcdiff-"));
  const program = ts.createProgram(
    [resolve(repoRoot, "src/cli/sourceDiff.ts")],
    {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
      outDir: out,
      rootDir: resolve(repoRoot, "src"),
      skipLibCheck: true,
      strict: true,
    },
  );
  const emit = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emit.diagnostics)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (n) => n,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => "\n",
    });
    throw new Error(`failed to compile sourceDiff.ts: ${message}`);
  }
  return out;
})();

process.on("exit", () => rmSync(compiledDir, { force: true, recursive: true }));

const { diffLinesWithHunks } = require(join(compiledDir, "cli/sourceDiff.js"));

// ── Algorithm correctness ──────────────────────────────────────────────────

test("identical files produce zero changed lines", () => {
  const r = diffLinesWithHunks("a\nb\nc\n", "a\nb\nc\n");
  assert.ok(r);
  assert.equal(r.changedLines, 0);
  assert.equal(r.hunks.length, 0);
});

test("pure insertion produces one hunk with only adds (and surrounding context)", () => {
  const r = diffLinesWithHunks("alpha\nbeta\ngamma", "alpha\nNEW\nbeta\ngamma");
  assert.ok(r);
  const adds = r.hunks.flatMap((h) => h.rows).filter((row) => row.op === "add");
  assert.equal(adds.length, 1);
  assert.equal(adds[0].text, "NEW");
  assert.equal(adds[0].afterLine, 2);
});

test("pure deletion produces one hunk with only removes", () => {
  const r = diffLinesWithHunks("alpha\nDOOMED\nbeta", "alpha\nbeta");
  assert.ok(r);
  const removes = r.hunks.flatMap((h) => h.rows).filter((row) => row.op === "remove");
  assert.equal(removes.length, 1);
  assert.equal(removes[0].text, "DOOMED");
  assert.equal(removes[0].beforeLine, 2);
});

test("modification produces a remove + add pair", () => {
  const r = diffLinesWithHunks("a\nold line\nb\n", "a\nnew line\nb\n");
  assert.ok(r);
  const ops = r.hunks.flatMap((h) => h.rows).map((row) => row.op);
  assert.ok(ops.includes("remove") && ops.includes("add"));
  const remove = r.hunks.flatMap((h) => h.rows).find((row) => row.op === "remove");
  const add = r.hunks.flatMap((h) => h.rows).find((row) => row.op === "add");
  assert.equal(remove.text, "old line");
  assert.equal(add.text, "new line");
});

test("line numbers track both sides correctly through multiple changes", () => {
  // before:  1: a    after:  1: a
  //          2: b            2: b
  //          3: c            3: NEW1
  //          4: d            4: c
  //                          5: NEW2
  //                          6: d
  const r = diffLinesWithHunks("a\nb\nc\nd\n", "a\nb\nNEW1\nc\nNEW2\nd\n");
  assert.ok(r);
  const all = r.hunks.flatMap((h) => h.rows);
  // Every "equal" row should have matching beforeLine + afterLine
  for (const row of all.filter((r) => r.op === "equal")) {
    assert.equal(typeof row.beforeLine, "number");
    assert.equal(typeof row.afterLine, "number");
  }
  // Find the "c" line — should be beforeLine 3, afterLine 4
  const c = all.find((r) => r.op === "equal" && r.text === "c");
  assert.equal(c.beforeLine, 3);
  assert.equal(c.afterLine, 4);
});

test("hunk grouping collapses long unchanged stretches", () => {
  // 30 lines of context with one change in the middle should produce
  // ONE hunk (the change + a few context lines), not 30 separate ones.
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const afterLines = before.split("\n");
  afterLines[14] = "CHANGED MIDDLE";
  const after = afterLines.join("\n");

  const r = diffLinesWithHunks(before, after);
  assert.ok(r);
  assert.equal(r.hunks.length, 1, "single change should produce one hunk");
  // And the hunk should be much shorter than 30 lines
  assert.ok(
    r.hunks[0].rows.length < 15,
    `hunk should be context-bounded; got ${r.hunks[0].rows.length} rows`,
  );
});

test("two distant changes produce two hunks, not one", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const before = lines.join("\n");
  const afterLines = lines.slice();
  afterLines[5] = "EARLY CHANGE";
  afterLines[35] = "LATE CHANGE";
  const after = afterLines.join("\n");

  const r = diffLinesWithHunks(before, after);
  assert.ok(r);
  assert.equal(r.hunks.length, 2, `expected two distinct hunks, got ${r.hunks.length}`);
});

test("oversize input returns null instead of OOM", () => {
  // Build a 5000-line file (above the 4000-line cap)
  const huge = Array.from({ length: 5000 }, (_, i) => `l${i}`).join("\n");
  const r = diffLinesWithHunks(huge, huge + "\nextra");
  assert.equal(r, null);
});

// ── End-to-end: HTML embeds the diff ───────────────────────────────────────

function withTempPair(left, right, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-srcdiff-html-"));
  const lp = resolve(dir, "left.md");
  const rp = resolve(dir, "right.md");
  writeFileSync(lp, left, "utf-8");
  writeFileSync(rp, right, "utf-8");
  try {
    return fn(lp, rp, dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

test("--html output embeds a source-diff section with hunks", () => {
  const left = "Logging is optional but recommended for debugging.\n";
  const right = "Logging is required for all production deployments.\n";
  withTempPair(left, right, (lp, rp, dir) => {
    const out = resolve(dir, "out.html");
    execFileSync("node", [cli, lp, rp, "--html", "-o", out, "--no-config"], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const html = readFileSync(out, "utf-8");
    assert.match(html, /class="source-diff"/, "expected source-diff section");
    assert.match(html, /class="diff-hunk"/, "expected at least one hunk");
    assert.match(html, /class="diff-row remove\b/, "expected the removed line to render");
    assert.match(html, /class="diff-row add\b/, "expected the added line to render");
  });
});

test("source-diff lines that overlap finding anchors get a finding tag", () => {
  // Logging optional → required is a required-optional contradiction +
  // a commitment shift. Both findings should anchor on the same line,
  // and that line in the diff should carry the cross-reference tags.
  const left = "Logging is optional but recommended for debugging.\n";
  const right = "Logging is required for all production deployments.\n";
  withTempPair(left, right, (lp, rp, dir) => {
    const out = resolve(dir, "out.html");
    execFileSync("node", [cli, lp, rp, "--html", "-o", out, "--no-config"], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const html = readFileSync(out, "utf-8");
    assert.match(html, /diff-finding-tag/, "expected at least one finding tag in the diff");
    assert.match(
      html,
      /diff-finding-tag">(commitment shift|contradiction)/,
      "tag should reference a real finding kind",
    );
    assert.match(html, /has-finding/, "expected has-finding row class");
  });
});

test("identical files produce no source-diff section", () => {
  const same = "These files are identical.\nNothing to see here.\n";
  withTempPair(same, same, (lp, rp, dir) => {
    const out = resolve(dir, "out.html");
    execFileSync("node", [cli, lp, rp, "--html", "-o", out, "--no-config"], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const html = readFileSync(out, "utf-8");
    assert.doesNotMatch(html, /class="source-diff"/, "no diff section when files are identical");
  });
});

test("multi-file leaves embed source diffs but the top-level page does not", () => {
  const root = mkdtempSync(resolve(tmpdir(), "samediff-srcdiff-multi-"));
  const lp = resolve(root, "left");
  const rp = resolve(root, "right");
  mkdirSync(lp, { recursive: true });
  mkdirSync(rp, { recursive: true });
  writeFileSync(join(lp, "spec.md"), "Logging is optional.\n", "utf-8");
  writeFileSync(join(rp, "spec.md"), "Logging is required.\n", "utf-8");
  try {
    const out = resolve(root, "out.html");
    execFileSync("node", [cli, "dir", lp, rp, "--html", "-o", out, "--no-config"], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const html = readFileSync(out, "utf-8");
    // Top-level page contains the file iframe with srcdoc; the diff
    // markup lives INSIDE the srcdoc string (HTML-escaped).
    assert.match(html, /srcdoc=/, "expected per-file iframe");
    assert.match(
      html,
      /class=&quot;source-diff&quot;/,
      "expected source-diff section nested inside the leaf iframe srcdoc",
    );
    // The top-level page's own (non-iframe) markup should NOT have
    // a source-diff section. It's an aggregate, not a single diff.
    // Strip everything inside srcdoc="...", then check.
    const topLevelOnly = html.replace(/srcdoc="[^"]*"/g, "");
    assert.doesNotMatch(
      topLevelOnly,
      /class="source-diff"/,
      "top-level multi-file page should not host its own source diff",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("--json multi-file output strips leftText/rightText from per-file entries", () => {
  // The texts are large and only useful to the HTML renderer. JSON
  // consumers can re-read from disk via meta.leftRoot + path.
  const root = mkdtempSync(resolve(tmpdir(), "samediff-srcdiff-jsonstrip-"));
  const lp = resolve(root, "left");
  const rp = resolve(root, "right");
  mkdirSync(lp, { recursive: true });
  mkdirSync(rp, { recursive: true });
  writeFileSync(join(lp, "spec.md"), "Logging is optional.\n", "utf-8");
  writeFileSync(join(rp, "spec.md"), "Logging is required.\n", "utf-8");
  try {
    const raw = execFileSync("node", [cli, "dir", lp, rp, "--json", "--no-config"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const report = JSON.parse(raw);
    for (const f of report.files) {
      assert.equal(f.leftText, undefined, "leftText must not appear in JSON");
      assert.equal(f.rightText, undefined, "rightText must not appear in JSON");
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
