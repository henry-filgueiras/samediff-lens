/**
 * Trail thesis (history thesis) layer tests.
 *
 * Doctrine, extended from the pairwise macro layer:
 *   Tier 1a — Trail Thesis: what happened across the document's lifetime.
 *   Tier 1  — Pairwise Macro Thesis: doctrine within one diff.
 *   Tier 2  — Issue: the single strongest accusation per diff.
 *   Tier 3  — Finding: literal evidence with provenance.
 *
 * Anti-hallucination contract: every thesis cites real Issue ids from
 * real steps. Every headline comes from a fixed catalog. No freeform
 * sentence assembly — the subheadline is the only synthesis, filled
 * from step metadata and cited-issue topics.
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
const {
  buildTrailThesis,
  TRAIL_DOCTRINE,
  TRAIL_HEADLINES,
} = await import(pathToFileURL(resolve(repoRoot, "dist-cli/analysis/narrative/trail/index.js")));

function pathToFileURL(p) {
  return "file://" + p;
}

function runHistory(filePath, outDir) {
  return execFileSync("node", [cli, "history", filePath, "-o", outDir, "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

// ── Fixed-catalog contract ───────────────────────────────────────────

test("trail doctrine catalog has ≥6 distinct patterns", () => {
  assert.ok(TRAIL_DOCTRINE.length >= 6, `expected ≥6 doctrine patterns, got ${TRAIL_DOCTRINE.length}`);
  const ids = new Set(TRAIL_DOCTRINE.map((p) => p.id));
  assert.equal(ids.size, TRAIL_DOCTRINE.length, "pattern ids must be unique");
  for (const p of TRAIL_DOCTRINE) {
    assert.ok(p.headline, `pattern ${p.id} must have a headline string`);
    assert.equal(typeof p.evaluate, "function");
  }
});

test("trail doctrine has the load-bearing pattern ids", () => {
  const ids = new Set(TRAIL_DOCTRINE.map((p) => p.id));
  for (const required of [
    "guarantees-restored-after-relaxation",
    "compliance-boundary-narrowed",
    "operational-guarantees-broadly-weakened",
    "syntax-contract-reversed",
    "ownership-drift",
  ]) {
    assert.ok(ids.has(required), `expected pattern ${required}`);
  }
});

// ── Empty + trivial trails stay silent ───────────────────────────────

test("trail thesis is null for an empty trail", () => {
  assert.equal(buildTrailThesis([]), null);
});

test("trail thesis is null for a single-step trail (nothing to narrate)", () => {
  assert.equal(buildTrailThesis([
    makeStep(0, {
      issues: [makeIssue("issue-0", { kind: "commitment-weakening", subject: "encryption", severity: "high" })],
    }),
  ]), null);
});

// ── Conservative threshold: two weak signals don't fire ──────────────

test("two unrelated weakenings on ≠ families do NOT fire a thesis", () => {
  const t = buildTrailThesis([
    makeStep(0, {
      issues: [makeIssue("a", { kind: "commitment-weakening", subject: "auth", severity: "moderate", before: "auth must", after: "auth should" })],
    }),
    makeStep(1, {
      issues: [makeIssue("b", { kind: "commitment-weakening", subject: "latency", severity: "moderate", before: "must be under 100ms", after: "should be under 100ms" })],
    }),
  ]);
  assert.equal(t, null, "two weakenings across two families aren't enough");
});

test("one weakening on one family + one unrelated rename do NOT fire", () => {
  const t = buildTrailThesis([
    makeStep(0, {
      issues: [makeIssue("a", { kind: "commitment-weakening", subject: "encryption", severity: "moderate", before: "encryption must", after: "encryption should" })],
    }),
    makeStep(1, {
      issues: [makeIssue("b", { kind: "rename", subject: "", confidence: "high", severity: "low" })],
    }),
  ]);
  assert.equal(t, null);
});

// ── Earned threshold: ≥3 same-family weakenings ──────────────────────

test("≥3 compliance weakenings across ≥2 steps (no restoration) fires a compliance pattern", () => {
  const steps = [
    makeStep(0, { issues: [
      makeIssue("i1", { kind: "guarantee-removed", subject: "privacy", severity: "high", before: "privacy must", after: "privacy may" }),
    ]}),
    makeStep(1, { issues: [
      makeIssue("i2", { kind: "commitment-weakening", subject: "retention", severity: "moderate", before: "retention must", after: "retention should" }),
      makeIssue("i3", { kind: "commitment-weakening", subject: "consent", severity: "high", before: "consent required", after: "consent optional" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  assert.ok(t, "expected a trail thesis");
  assert.ok(TRAIL_HEADLINES.has(t.headline), `headline "${t.headline}" not in fixed catalog`);
  assert.ok(t.citedIssueRefs.length >= 3, "must cite ≥3 issues");
  assert.ok(new Set(t.citedStepIndices).size >= 2, "must span ≥2 steps");
});

// ── Reversal arc (the strongest signal) ──────────────────────────────

test("weakening then tightening on same family fires a reversal arc", () => {
  const steps = [
    makeStep(0, { issues: [
      makeIssue("w1", { kind: "guarantee-removed", subject: "encryption", severity: "high", before: "encryption must", after: "encryption may" }),
    ]}),
    makeStep(1, { issues: [
      makeIssue("w2", { kind: "commitment-weakening", subject: "auth", severity: "high", before: "auth must", after: "auth may" }),
    ]}),
    makeStep(4, { issues: [
      makeIssue("t1", { kind: "commitment-strengthening", subject: "encryption", severity: "high", before: "encryption may", after: "encryption must" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  assert.ok(t, "expected a reversal thesis");
  assert.equal(t.patternId, "guarantees-restored-after-relaxation");
  assert.equal(t.headline, "Guarantees weakened and later restored");
  assert.ok(t.arc, "arc must be set on a reversal");
  assert.equal(t.arc.kind, "reversal");
  assert.ok(t.arc.earlierSteps.length >= 1);
  assert.ok(t.arc.laterSteps.length >= 1);
});

test("reversal arc requires the restore to come AFTER the weakening", () => {
  // Tightening earlier, weakening later → no reversal (that's a new weakening, not a restoration)
  const steps = [
    makeStep(0, { issues: [
      makeIssue("t", { kind: "commitment-strengthening", subject: "encryption", severity: "high", before: "encryption may", after: "encryption must" }),
    ]}),
    makeStep(5, { issues: [
      makeIssue("w", { kind: "commitment-weakening", subject: "encryption", severity: "high", before: "encryption must", after: "encryption may" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  // Could still fire something else, but not a reversal arc.
  if (t) assert.notEqual(t.patternId, "guarantees-restored-after-relaxation");
});

// ── Syntax contract reversed (shape-based reversal) ──────────────────

test("rename A→B then B→A fires syntax-contract-reversed", () => {
  // Same token pair flipped in opposite directions across two steps.
  const steps = [
    makeStep(0, { issues: [
      makeIssue("r1", { kind: "policy-reversal", subject: "attribute", severity: "high", before: "attribute(derive_macro) rules", after: "macro_derive attribute derive rules" }),
    ]}),
    makeStep(5, { issues: [
      makeIssue("r2", { kind: "policy-reversal", subject: "attribute", severity: "high", before: "macro_derive attribute derive rules", after: "attribute(derive_macro) rules" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  assert.ok(t);
  assert.equal(t.patternId, "syntax-contract-reversed");
  assert.equal(t.headline, "Syntax contract reversed after review");
  assert.ok(t.arc);
});

// ── Ownership drift ──────────────────────────────────────────────────

test("ownership drift fires when significant steps have disjoint author cohorts", () => {
  // Six significant steps, distinct authors in the first half vs second.
  // Subjects deliberately sit OUTSIDE the family topic sets so the
  // same-family-weakening patterns don't claim priority — the test is
  // specifically exercising the authorship-cohort signal.
  const mk = (i, author) => makeStep(i, {
    severity: "high",
    authorName: author,
    issues: [
      makeIssue(`a${i}`, { kind: "commitment-reversal", subject: "feature-x", severity: "high", before: "must be x", after: "may be y" }),
    ],
  });
  const steps = [
    mk(0, "alice"), mk(1, "bob"),
    mk(2, "alice"), mk(3, "charlie"),
    mk(4, "dana"), mk(5, "eve"),
  ];
  const t = buildTrailThesis(steps);
  assert.ok(t, "expected a thesis with 6 significant steps across disjoint cohorts");
  assert.equal(t.patternId, "ownership-drift", `expected ownership-drift, got ${t.patternId}`);
});

// ── Anti-hallucination: cited ids must resolve to real issues ────────

test("every cited issue id resolves to a real Issue in its cited step", () => {
  const steps = [
    makeStep(0, { issues: [
      makeIssue("w1", { kind: "guarantee-removed", subject: "encryption", severity: "high", before: "must", after: "may" }),
      makeIssue("w2", { kind: "commitment-weakening", subject: "auth", severity: "high", before: "auth must", after: "auth may" }),
    ]}),
    makeStep(2, { issues: [
      makeIssue("w3", { kind: "commitment-weakening", subject: "encryption", severity: "high", before: "encryption must", after: "encryption may" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  if (!t) return; // earned threshold didn't fire — fine, nothing to check
  const indexIssues = new Map();
  for (const s of steps) {
    indexIssues.set(s.stepIndex, new Set(s.issues.map((i) => i.id)));
  }
  for (const c of t.citedIssueRefs) {
    const ids = indexIssues.get(c.stepIndex);
    assert.ok(ids, `cited stepIndex ${c.stepIndex} must exist in steps`);
    assert.ok(ids.has(c.issueId), `cited issue ${c.issueId} must exist in step ${c.stepIndex}`);
  }
});

test("evidence topics appear verbatim in some cited issue's subject", () => {
  const steps = [
    makeStep(0, { issues: [
      makeIssue("i1", { kind: "guarantee-removed", subject: "encryption", severity: "high", before: "encryption must", after: "encryption may" }),
    ]}),
    makeStep(1, { issues: [
      makeIssue("i2", { kind: "commitment-weakening", subject: "retention", severity: "high", before: "retain for 7d", after: "retain as needed" }),
      makeIssue("i3", { kind: "commitment-weakening", subject: "consent", severity: "high", before: "consent required", after: "consent optional" }),
    ]}),
  ];
  const t = buildTrailThesis(steps);
  if (!t) return;
  const citedSubjects = t.citedIssueRefs
    .map((c) => {
      const step = steps.find((s) => s.stepIndex === c.stepIndex);
      const issue = step?.issues.find((i) => i.id === c.issueId);
      return (issue?.subject ?? "").toLowerCase();
    })
    .filter(Boolean);
  for (const topic of t.evidenceTopics) {
    assert.ok(
      citedSubjects.includes(topic.toLowerCase()),
      `topic "${topic}" must appear verbatim in some cited issue's subject`,
    );
  }
});

// ── Renderer integration: HTML band + audit.md section ──────────────

test("history HTML index embeds a trail-thesis band when one fires", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-trail-"));
  try {
    runHistory("DIRECTORS_NOTES.md", dir);
    const html = readFileSync(join(dir, "index.html"), "utf-8");
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    if (!trail.trailThesis) return; // conservative case — nothing to assert
    assert.match(html, /class="trail-thesis/, "expected trail-thesis band in HTML");
    assert.match(html, /History thesis/, "expected section label");
    // Headline is embedded verbatim — confirm it made it through escaping.
    const esc = trail.trailThesis.headline
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    assert.ok(html.includes(esc), `expected headline "${esc}" in HTML`);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history HTML renders a 'Most consequential steps' cluster when trail is long enough", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-trail-"));
  try {
    runHistory("DIRECTORS_NOTES.md", dir);
    const html = readFileSync(join(dir, "index.html"), "utf-8");
    assert.match(html, /Most consequential steps/, "expected consequential-steps section");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("trail.json carries trailThesis field (null or object)", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-trail-"));
  try {
    runHistory("DIRECTORS_NOTES.md", dir);
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    assert.ok("trailThesis" in trail, "trail.json must include trailThesis field");
    if (trail.trailThesis !== null) {
      assert.equal(typeof trail.trailThesis.patternId, "string");
      assert.equal(typeof trail.trailThesis.headline, "string");
      assert.ok(Array.isArray(trail.trailThesis.citedIssueRefs));
      assert.ok(Array.isArray(trail.trailThesis.citedStepIndices));
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("audit.md includes a History thesis section when the trail thesis fires", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-audit-trail-"));
  try {
    runHistory("DIRECTORS_NOTES.md", dir);
    execFileSync("node", [cli, "audit", dir, "--no-config"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const audit = readFileSync(join(dir, "audit.md"), "utf-8");
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    if (!trail.trailThesis) return; // conservative — no thesis to render
    assert.match(audit, /^## History thesis/m);
    assert.ok(
      audit.includes(trail.trailThesis.headline),
      `expected headline "${trail.trailThesis.headline}" in audit.md`,
    );
    assert.match(audit, /\*\*Supporting citations\*\*/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

// ── 08-policy-drift: legitimate silence ──────────────────────────────

test("08-policy-drift trail either fires a catalog pattern or stays silent", () => {
  // This example is mostly additive tightenings (GDPR rights added, breach
  // notification added, etc.) plus a final whole-doc rewrite. The engine
  // sees most drift as concept churn, not weakenings. The trail layer
  // should stay silent (no earned pattern) OR fire something from the
  // catalog — never synthesize a freeform headline.
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-policy-"));
  try {
    runHistory("examples/08-policy-drift/policy.md", dir);
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    if (trail.trailThesis) {
      assert.ok(
        TRAIL_HEADLINES.has(trail.trailThesis.headline),
        `policy-drift headline "${trail.trailThesis.headline}" must be in the fixed catalog`,
      );
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

// ── Headline catalog invariant (end-to-end across any trail) ────────

test("whatever fires on DIRECTORS_NOTES.md has a catalog-conformant headline", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-trail-"));
  try {
    runHistory("DIRECTORS_NOTES.md", dir);
    const trail = JSON.parse(readFileSync(join(dir, "trail.json"), "utf-8"));
    if (!trail.trailThesis) return;
    assert.ok(
      TRAIL_HEADLINES.has(trail.trailThesis.headline),
      `headline "${trail.trailThesis.headline}" not in fixed catalog`,
    );
    // Subheadline is synthesised but must start with "Across N step"
    assert.match(
      trail.trailThesis.subheadline,
      /^Across \d+ step/,
      "subheadline must follow the constrained template",
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeStep(stepIndex, overrides = {}) {
  return {
    stepIndex,
    fromRef: `aaa${stepIndex}`,
    toRef: `bbb${stepIndex}`,
    toShort: `bbb${stepIndex}`,
    authorName: overrides.authorName ?? "tester",
    authorDate: overrides.authorDate ?? `2026-01-${String(stepIndex + 1).padStart(2, "0")}T00:00:00.000Z`,
    commitSubject: overrides.commitSubject ?? `step ${stepIndex}`,
    severity: overrides.severity ?? "moderate",
    score: overrides.score ?? 5,
    issues: overrides.issues ?? [],
  };
}

function makeIssue(id, o) {
  return {
    id,
    title: o.title ?? `synthetic ${id}`,
    kind: o.kind,
    severity: o.severity ?? "moderate",
    confidence: o.confidence ?? "medium",
    subject: o.subject ?? "",
    lede: "",
    evidence: {
      before: o.before ?? null,
      after: o.after ?? null,
      anchors: [],
      triggers: o.triggers ?? [],
    },
    supportingFindings: [],
  };
}
