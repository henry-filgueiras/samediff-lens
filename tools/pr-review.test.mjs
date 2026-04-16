import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

import {
  isAllowlistedPath,
  selectChangedFiles,
  ALLOWLIST_FILES,
  ALLOWLIST_PREFIXES,
} from "./pr-review/paths.mjs";
import { renderComment, COMMENT_MARKER } from "./pr-review/comment.mjs";
import { buildMergedSarif } from "./pr-review/sarif-merge.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── paths / allowlist ────────────────────────────────────────────────────

test("allowlist includes README, DIRECTORS_NOTES, LAUNCH_NOTES, docs/*.md", () => {
  assert.equal(isAllowlistedPath("README.md"), true);
  assert.equal(isAllowlistedPath("DIRECTORS_NOTES.md"), true);
  assert.equal(isAllowlistedPath("LAUNCH_NOTES.md"), true);
  assert.equal(isAllowlistedPath("docs/v0-contract.md"), true);
  assert.equal(isAllowlistedPath("docs/adr/0001-intro.markdown"), true);
});

test("allowlist rejects source code, example fixtures, and out-of-scope paths", () => {
  assert.equal(isAllowlistedPath("src/cli/index.ts"), false);
  assert.equal(isAllowlistedPath("tools/build-cli.sh"), false);
  assert.equal(isAllowlistedPath("examples/01-modal-shift/left.md"), false);
  assert.equal(isAllowlistedPath("package.json"), false);
  assert.equal(isAllowlistedPath("docs/storyboard/storyboard.svg"), false);
});

test("allowlist rejects absolute paths and parent-traversal", () => {
  assert.equal(isAllowlistedPath("/etc/passwd"), false);
  assert.equal(isAllowlistedPath("../README.md"), false);
  assert.equal(isAllowlistedPath(""), false);
  assert.equal(isAllowlistedPath(null), false);
});

test("selectChangedFiles filters, sorts, and dedupes", () => {
  const picked = selectChangedFiles([
    "src/cli/index.ts",
    "README.md",
    "",
    "  docs/v0-contract.md  ",
    "# a comment",
    "README.md",
    "docs/architecture.md",
  ]);
  assert.deepEqual(picked, [
    "README.md",
    "docs/architecture.md",
    "docs/v0-contract.md",
  ]);
});

test("ALLOWLIST_FILES and ALLOWLIST_PREFIXES are intentionally narrow", () => {
  // Regression guard: the whole PR-reviewer design rests on the set of
  // analyzed files being small. If this grows silently, update the
  // expectations deliberately.
  assert.equal(ALLOWLIST_FILES.size, 3);
  assert.deepEqual(ALLOWLIST_PREFIXES, ["docs/"]);
});

// ── select-files.mjs CLI smoke ───────────────────────────────────────────

test("select-files.mjs CLI filters a stdin list", () => {
  const script = resolve(repoRoot, "tools/pr-review/select-files.mjs");
  const input =
    "README.md\nsrc/cli/index.ts\ndocs/v0-contract.md\nnot-allowed.txt\n";
  const out = execFileSync("node", [script], {
    input,
    encoding: "utf-8",
  });
  assert.equal(out, "README.md\ndocs/v0-contract.md\n");
});

test("select-files.mjs CLI emits nothing when no paths match", () => {
  const script = resolve(repoRoot, "tools/pr-review/select-files.mjs");
  const out = execFileSync("node", [script], {
    input: "src/a.ts\nsrc/b.ts\n",
    encoding: "utf-8",
  });
  assert.equal(out, "");
});

// ── comment rendering ────────────────────────────────────────────────────

function sampleIndex(overrides = {}) {
  return {
    base: "origin/main",
    toolVersion: "0.6.0",
    sarifRelPath: ".pr-review-out/samediff.sarif",
    files: [
      {
        path: "docs/spec.md",
        status: "analyzed",
        score: { value: 5.8, label: "high" },
        counts: {
          commitmentShifts: 1,
          contradictions: 1,
          conceptRenames: 0,
          addedConcepts: 2,
          removedConcepts: 1,
          actionItemsAdded: 0,
          actionItemsRemoved: 0,
          total: 5,
        },
        findings: {
          contradictions: [
            {
              summary: "Tokens required vs. optional",
              anchor: "after:12",
              anchored: true,
            },
          ],
          commitmentShifts: [
            {
              summary: "should → must",
              triggers: ["strengthens the commitment"],
              anchor: "after:2",
              anchored: true,
            },
          ],
          conceptRenames: [],
          actionItemsAdded: [],
          actionItemsRemoved: [],
        },
      },
    ],
    ...overrides,
  };
}

test("renders sticky comment with marker, blocking status, and footer", () => {
  const body = renderComment(sampleIndex());
  assert.ok(body.startsWith(COMMENT_MARKER), "must start with the comment marker");
  assert.match(body, /SameDiff Lens — semantic review/);
  assert.match(body, /\*\*1\*\* file analyzed/);
  assert.match(body, /\*\*1 contradiction\*\*/);
  assert.match(body, /Status: \*\*Blocked\*\*/);
  assert.match(body, /Contradictions \(blocking\)/);
  assert.match(body, /`docs\/spec\.md`.*Tokens required vs\. optional.*@ after:12/);
  assert.match(body, /SARIF uploaded to Code Scanning/);
});

test("renders advisory status when no contradictions", () => {
  const idx = sampleIndex();
  idx.files[0].counts.contradictions = 0;
  idx.files[0].findings.contradictions = [];
  const body = renderComment(idx);
  assert.match(body, /Status: \*\*Advisory\*\*/);
  assert.doesNotMatch(body, /Contradictions \(blocking\)/);
});

test("renders graceful no-op when nothing was selected", () => {
  const body = renderComment({
    base: "origin/main",
    files: [],
    toolVersion: "0.6.0",
    sarifRelPath: null,
  });
  assert.match(body, /No high-signal files changed/);
  assert.match(body, /no SARIF uploaded/);
});

test("renders skipped-file rollup with structured reasons", () => {
  const idx = sampleIndex({
    files: [
      { path: "docs/new.md", status: "skipped-new" },
      { path: "docs/gone.md", status: "skipped-deleted" },
      { path: "README.md", status: "error", error: "git blob read failed" },
    ],
    sarifRelPath: null,
  });
  const body = renderComment(idx);
  assert.match(body, /Skipped files/);
  assert.match(body, /new file — no base version/);
  assert.match(body, /deleted — no after version/);
  assert.match(body, /error — git blob read failed/);
});

test("rendering is deterministic (stable across calls)", () => {
  const idx = sampleIndex();
  const a = renderComment(idx);
  const b = renderComment(idx);
  assert.equal(a, b);
});

test("unanchored findings label themselves honestly", () => {
  const idx = sampleIndex();
  idx.files[0].findings.contradictions = [
    {
      summary: "conflicting retry policy",
      anchor: null,
      anchored: false,
    },
  ];
  const body = renderComment(idx);
  assert.match(body, /\(no anchor\)/);
});

test("top-per-category cap kicks in and mentions overflow", () => {
  const idx = sampleIndex();
  const many = [];
  for (let i = 0; i < 8; i++) {
    many.push({
      summary: `contradiction ${i}`,
      anchor: `after:${i + 1}`,
      anchored: true,
    });
  }
  idx.files[0].findings.contradictions = many;
  idx.files[0].counts.contradictions = many.length;
  const body = renderComment(idx);
  assert.match(body, /…and 3 more — see SARIF/);
});

// ── SARIF merge ──────────────────────────────────────────────────────────

function sampleLog(level = "error", count = 1, score = 4) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push({
      ruleId: level === "error" ? "contradiction" : "commitment-shift",
      level,
      message: { text: `thing ${i}` },
    });
  }
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "samediff-lens",
            rules: [{ id: "contradiction" }, { id: "commitment-shift" }],
          },
        },
        results,
        properties: {
          driftScore: score,
          driftLabel: "moderate",
          counts: {
            commitmentShifts: level === "warning" ? count : 0,
            contradictions: level === "error" ? count : 0,
            conceptRenames: 0,
            addedConcepts: 0,
            removedConcepts: 0,
            actionItemsAdded: 0,
            actionItemsRemoved: 0,
            total: count,
          },
        },
      },
    ],
  };
}

test("buildMergedSarif concatenates results and sums counts", () => {
  const merged = buildMergedSarif([sampleLog("error", 2, 6.1), sampleLog("warning", 3, 4.2)]);
  assert.equal(merged.version, "2.1.0");
  assert.equal(merged.runs.length, 1);
  const run = merged.runs[0];
  assert.equal(run.results.length, 5);
  assert.equal(run.properties.counts.contradictions, 2);
  assert.equal(run.properties.counts.commitmentShifts, 3);
  assert.equal(run.properties.counts.total, 5);
  assert.equal(run.properties.driftScore, 6.1); // max across files
  assert.equal(run.properties.driftLabel, "high"); // 6.1 → high band
});

test("buildMergedSarif deduplicates rules by id", () => {
  const merged = buildMergedSarif([sampleLog(), sampleLog()]);
  const ids = merged.runs[0].tool.driver.rules.map((r) => r.id).sort();
  assert.deepEqual(ids, ["commitment-shift", "contradiction"]);
});

test("buildMergedSarif tolerates empty input", () => {
  const merged = buildMergedSarif([]);
  assert.equal(merged.runs[0].results.length, 0);
  assert.equal(merged.runs[0].properties.counts.total, 0);
  assert.equal(merged.runs[0].properties.driftLabel, "low");
});

// ── gate.mjs CLI smoke ───────────────────────────────────────────────────

test("gate.mjs exits 1 when contradictions present", () => {
  const script = resolve(repoRoot, "tools/pr-review/gate.mjs");
  const indexPath = resolve(repoRoot, "tools/pr-review/__test_index_block.json");
  writeFileSync(indexPath, JSON.stringify({ contradictionCount: 2, files: [] }));
  try {
    const res = spawnSync("node", [script, "--in", indexPath], { encoding: "utf-8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /blocking — 2 contradictions/);
  } finally {
    unlinkSync(indexPath);
  }
});

test("gate.mjs exits 0 when no contradictions", () => {
  const script = resolve(repoRoot, "tools/pr-review/gate.mjs");
  const indexPath = resolve(repoRoot, "tools/pr-review/__test_index_ok.json");
  writeFileSync(indexPath, JSON.stringify({ contradictionCount: 0, files: [] }));
  try {
    const res = spawnSync("node", [script, "--in", indexPath], { encoding: "utf-8" });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /no contradictions/);
  } finally {
    unlinkSync(indexPath);
  }
});
