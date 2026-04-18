/**
 * Narrative layer end-to-end tests.
 *
 * Runs the built CLI with --json against each example and asserts shape +
 * content invariants on the resulting `narrative` field.
 *
 * This tests the full transformation path (analyze → DiffResult →
 * buildNarrative → JSON) and guards the anti-hallucination contract:
 * every Issue must cite at least one raw finding, and every title /
 * subject must come from evidence.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(repoRoot, "dist-cli/cli/index.js");

function runJson(leftPath, rightPath) {
  const raw = execFileSync("node", [cli, leftPath, rightPath, "--json", "--no-config"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return JSON.parse(raw);
}

function exPath(dir, name) {
  return resolve(repoRoot, "examples", dir, name);
}

// ── Shape invariants, run once on a rich example ───────────────────────────

test("narrative field is present on --json output", () => {
  const r = runJson(exPath("03-api-contract", "left.md"), exPath("03-api-contract", "right.md"));
  assert.ok(r.narrative, "expected narrative field on --json result");
  assert.ok(Array.isArray(r.narrative.issues), "issues must be array");
  assert.ok(Array.isArray(r.narrative.quiet), "quiet must be array");
  assert.ok(
    r.narrative.headline === null || typeof r.narrative.headline === "string",
    "headline must be string or null",
  );
  assert.ok(
    ["low", "moderate", "high", "critical"].includes(r.narrative.severity),
    "severity must be a known tier",
  );
});

test("every Issue cites at least one raw finding (anti-hallucination contract)", () => {
  const examples = [
    "01-modal-shift",
    "02-todo-drift",
    "03-api-contract",
    "04-prompt-policy",
    "05-hydra-doc-drift",
    "06-secure-gateway-doc-drift",
  ];
  for (const ex of examples) {
    const r = runJson(exPath(ex, "left.md"), exPath(ex, "right.md"));
    const all = [...r.narrative.issues, ...r.narrative.quiet];
    for (const issue of all) {
      assert.ok(
        Array.isArray(issue.supportingFindings) && issue.supportingFindings.length > 0,
        `${ex}: issue "${issue.title}" must cite at least one finding`,
      );
      for (const ref of issue.supportingFindings) {
        assert.ok(typeof ref.category === "string", "finding ref must name a category");
        assert.ok(Number.isInteger(ref.index) && ref.index >= 0, "finding ref index must be a valid index");
        // Verify the referenced finding actually exists
        const bucketName = {
          "commitment-shift": "commitmentShifts",
          "contradiction": "contradictions",
          "concept-rename": "conceptRenames",
          "added-concept": "addedConcepts",
          "removed-concept": "removedConcepts",
          "action-item-added": "actionItemsAdded",
          "action-item-removed": "actionItemsRemoved",
          "task-status-change": "actionItemsStatusChanges",
        }[ref.category];
        assert.ok(bucketName, `unknown finding category ${ref.category}`);
        const bucket = r.findings[bucketName];
        assert.ok(
          Array.isArray(bucket) && ref.index < bucket.length,
          `${ex}: finding ref out of range (${ref.category}[${ref.index}])`,
        );
      }
      assert.ok(typeof issue.title === "string" && issue.title.length > 0, "title must be non-empty");
      assert.ok(typeof issue.lede === "string" && issue.lede.length > 0, "lede must be non-empty");
    }
  }
});

// ── Per-example content invariants ─────────────────────────────────────────

test("01-modal-shift surfaces commitment-strengthening", () => {
  const r = runJson(exPath("01-modal-shift", "left.md"), exPath("01-modal-shift", "right.md"));
  const allIssues = [...r.narrative.issues, ...r.narrative.quiet];
  assert.ok(
    allIssues.some((i) => i.kind === "commitment-strengthening"),
    "expected at least one commitment-strengthening issue",
  );
  assert.ok(
    r.narrative.issues.some((i) => /strengthened/i.test(i.title)),
    "expected a title using the word 'strengthened'",
  );
});

test("03-api-contract surfaces a commitment-reversal on shipping_address", () => {
  const r = runJson(exPath("03-api-contract", "left.md"), exPath("03-api-contract", "right.md"));
  // Either a commitment-reversal contradiction or a scope-narrowed on the
  // same subject; at minimum the narrative headline must exist.
  assert.ok(r.narrative.headline, "expected a headline on the API contract example");
  const shippingIssue = r.narrative.issues.find((i) =>
    /shipping_address/.test(i.title) || /shipping_address/.test(i.subject),
  );
  assert.ok(
    shippingIssue,
    `expected an issue about shipping_address; saw: ${r.narrative.issues.map((i) => i.title).join(" | ")}`,
  );
});

test("03-api-contract surfaces a rate limit / idempotency constraint-introduced", () => {
  const r = runJson(exPath("03-api-contract", "left.md"), exPath("03-api-contract", "right.md"));
  const all = [...r.narrative.issues, ...r.narrative.quiet];
  assert.ok(
    all.some((i) => i.kind === "constraint-introduced" && /rate limit|idempoten/i.test(i.title)),
    "expected a rate limit or idempotency constraint-introduced issue",
  );
});

test("04-prompt-policy surfaces a policy-reversal or guarantee-removed", () => {
  const r = runJson(exPath("04-prompt-policy", "left.md"), exPath("04-prompt-policy", "right.md"));
  const all = [...r.narrative.issues, ...r.narrative.quiet];
  assert.ok(
    all.some((i) => i.kind === "policy-reversal" || i.kind === "guarantee-removed"),
    "expected a policy-reversal or guarantee-removed issue",
  );
});

test("high-severity examples produce non-null headlines", () => {
  for (const ex of ["03-api-contract", "04-prompt-policy", "05-hydra-doc-drift"]) {
    const r = runJson(exPath(ex, "left.md"), exPath(ex, "right.md"));
    assert.ok(
      r.narrative.headline,
      `${ex}: expected a headline (got null) — something important should be surfaced`,
    );
  }
});

test("clustering collapses multiple commitment shifts on the same subject", () => {
  // The API contract example has multiple commitment shifts touching `items`
  // and several on `notes`. At least one of those should cluster (+N related).
  const r = runJson(exPath("03-api-contract", "left.md"), exPath("03-api-contract", "right.md"));
  const all = [...r.narrative.issues, ...r.narrative.quiet];
  const multiMember = all.find((i) => i.supportingFindings.length > 1);
  assert.ok(
    multiMember,
    `expected at least one clustered Issue (>1 supporting findings). Got: ${all.map((i) => `${i.title} [${i.supportingFindings.length}]`).join(" | ")}`,
  );
});

// ── Regression: cross-section contradiction guard ─────────────────────────

test("06-secure-gateway: Performance line never pairs with Authentication line as a contradiction", () => {
  // Original failure: a `negation-flip` contradiction was emitted between
  // old line 10 (**Performance**: Latency overhead should not exceed 50ms…)
  // and new line 7 (**Authentication**: Incoming requests should be
  // authenticated…), supported only by generic `should` + `request` token
  // overlap. That bad pair then became the narrative headline. The engine's
  // cross-section guard + expanded structural strip list must reject this
  // pair before it ever reaches the narrative layer.
  const r = runJson(
    exPath("06-secure-gateway-doc-drift", "left.md"),
    exPath("06-secure-gateway-doc-drift", "right.md"),
  );

  for (const c of r.findings.contradictions) {
    const before = (c.evidence.before ?? "").toLowerCase();
    const after = (c.evidence.after ?? "").toLowerCase();
    const isBadPair =
      before.includes("**performance**") && after.includes("**authentication**");
    const isReverseBadPair =
      before.includes("**authentication**") && after.includes("**performance**");
    assert.ok(
      !isBadPair && !isReverseBadPair,
      `cross-section contradiction leaked through engine guard:\n  before: ${c.evidence.before}\n  after: ${c.evidence.after}`,
    );
  }

  // Also: this assertion is meaningless if no contradictions fired at all.
  // The legit same-section Performance reversal (should not exceed 50ms →
  // should be minimized) must still surface — guards must not be so strict
  // that they nuke the real signal too.
  const realReversal = r.findings.contradictions.find(
    (c) =>
      /\*\*performance\*\*/i.test(c.evidence.before ?? "") &&
      /\*\*performance\*\*/i.test(c.evidence.after ?? ""),
  );
  assert.ok(
    realReversal,
    "expected the legitimate same-section Performance reversal to still fire",
  );

  // And the narrative headline must reflect a real, same-subject finding —
  // not the cross-section FP.
  assert.ok(r.narrative.headline, "expected a narrative headline on 06");
  const headline = r.narrative.headline.toLowerCase();
  const headlineMixesPerfAndAuth =
    headline.includes("performance") && headline.includes("authentication");
  assert.ok(
    !headlineMixesPerfAndAuth,
    `narrative headline still mixes Performance and Authentication: ${r.narrative.headline}`,
  );
});

test("narrative quarantines weak contradictions whose before/after subjects disagree", () => {
  // Belt-and-suspenders: even if a future regression re-opens the engine
  // guard, the narrative layer must not promote a contradiction whose
  // before-subject and after-subject extract to different topic nouns.
  const examples = [
    "01-modal-shift",
    "03-api-contract",
    "04-prompt-policy",
    "05-hydra-doc-drift",
    "06-secure-gateway-doc-drift",
  ];
  for (const ex of examples) {
    const r = runJson(exPath(ex, "left.md"), exPath(ex, "right.md"));
    for (const issue of r.narrative.issues) {
      // Only check contradiction-derived top issues. (Triggers carry the
      // tag set by classify.ts.)
      const fromContradiction = (issue.evidence.triggers ?? []).some((t) =>
        String(t).startsWith("contradiction:"),
      );
      if (!fromContradiction) continue;
      if (issue.confidence === "high") continue; // high-confidence may keep
      const before = (issue.evidence.before ?? "").toLowerCase();
      const after = (issue.evidence.after ?? "").toLowerCase();
      // Pull a few topic words to check for cross-topic mixes
      const topics = ["performance", "authentication", "encryption", "audit", "logging"];
      const beforeTopics = topics.filter((t) => before.includes(`**${t}**`));
      const afterTopics = topics.filter((t) => after.includes(`**${t}**`));
      if (beforeTopics.length > 0 && afterTopics.length > 0) {
        const overlap = beforeTopics.some((t) => afterTopics.includes(t));
        assert.ok(
          overlap,
          `${ex}: cross-topic contradiction in TOP issues:\n  ${issue.title}\n  before topics: ${beforeTopics}\n  after topics: ${afterTopics}`,
        );
      }
    }
  }
});

// ── Regression: checklist state transitions ───────────────────────────────

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function withTempPair(left, right, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-task-"));
  const lp = resolve(dir, "left.md");
  const rp = resolve(dir, "right.md");
  writeFileSync(lp, left, "utf-8");
  writeFileSync(rp, right, "utf-8");
  try {
    return fn(lp, rp);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

test("checklist transition: [ ] -> [x] is a single 'completed' status change, not add+remove", () => {
  const left = "# Tasks\n- [ ] Write integration tests for auth flow\n";
  const right = "# Tasks\n- [x] Write integration tests for auth flow\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);

    assert.equal(r.findings.actionItemsStatusChanges.length, 1, "expected exactly one status change");
    const change = r.findings.actionItemsStatusChanges[0];
    assert.equal(change.transition, "completed");
    assert.equal(change.beforeState, "open");
    assert.equal(change.afterState, "completed");
    assert.equal(change.subject, "Write integration tests for auth flow");

    // Toggle must NOT appear in the legacy add/remove buckets.
    assert.equal(
      r.findings.actionItemsAdded.length, 0,
      "completion must not appear in actionItemsAdded",
    );
    assert.equal(
      r.findings.actionItemsRemoved.length, 0,
      "completion must not appear in actionItemsRemoved",
    );

    // Narrative headline must read as completion, not as churn.
    assert.equal(r.narrative.headline, "Task completed: Write integration tests for auth flow");
    assert.equal(r.narrative.issues.length, 1);
    assert.equal(r.narrative.issues[0].kind, "task-completed");
  });
});

test("checklist transition: [x] -> [ ] is a 'reopened' status change, not add+remove", () => {
  const left = "# Tasks\n- [x] Deploy to staging\n";
  const right = "# Tasks\n- [ ] Deploy to staging\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    assert.equal(r.findings.actionItemsStatusChanges.length, 1);
    const change = r.findings.actionItemsStatusChanges[0];
    assert.equal(change.transition, "reopened");
    assert.equal(change.beforeState, "completed");
    assert.equal(change.afterState, "open");
    assert.equal(change.subject, "Deploy to staging");
    assert.equal(r.findings.actionItemsAdded.length, 0);
    assert.equal(r.findings.actionItemsRemoved.length, 0);
    assert.equal(r.narrative.headline, "Task reopened: Deploy to staging");
    assert.equal(r.narrative.issues[0].kind, "task-reopened");
  });
});

test("checklist transition: absent -> [ ] is 'added-open'", () => {
  const left = "# Tasks\n";
  const right = "# Tasks\n- [ ] Wire up the linter\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const change = r.findings.actionItemsStatusChanges.find((c) => c.subject === "Wire up the linter");
    assert.ok(change, "expected status change for new task");
    assert.equal(change.transition, "added-open");
    assert.equal(change.beforeState, null);
    assert.equal(change.afterState, "open");
    // Backward-compat: simple adds DO still show up in legacy bucket
    assert.ok(
      r.findings.actionItemsAdded.some((a) => /Wire up the linter/.test(a.description)),
      "added-open should still appear in legacy actionItemsAdded for compat",
    );
  });
});

test("checklist transition: [ ] -> absent is 'removed-open'", () => {
  const left = "# Tasks\n- [ ] Decommission old dashboard\n";
  const right = "# Tasks\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const change = r.findings.actionItemsStatusChanges.find(
      (c) => c.subject === "Decommission old dashboard",
    );
    assert.ok(change);
    assert.equal(change.transition, "removed-open");
    assert.equal(change.beforeState, "open");
    assert.equal(change.afterState, null);
    assert.ok(
      r.findings.actionItemsRemoved.some((a) => /Decommission old dashboard/.test(a.description)),
      "removed-open should still appear in legacy actionItemsRemoved for compat",
    );
  });
});

test("checklist transition: absent -> [x] is 'added-completed'", () => {
  const left = "# Tasks\n";
  const right = "# Tasks\n- [x] Backfill audit logs\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const change = r.findings.actionItemsStatusChanges.find(
      (c) => c.subject === "Backfill audit logs",
    );
    assert.ok(change);
    assert.equal(change.transition, "added-completed");
    assert.equal(change.beforeState, null);
    assert.equal(change.afterState, "completed");
    const titles = [...r.narrative.issues, ...r.narrative.quiet].map((i) => i.title);
    assert.ok(
      titles.some((t) => t === "Task added (already completed): Backfill audit logs"),
      `expected "Task added (already completed): ..." title; got ${titles.join(" | ")}`,
    );
  });
});

test("checklist transition: [x] -> absent is 'removed-completed'", () => {
  const left = "# Tasks\n- [x] Migrate to TLS 1.3\n";
  const right = "# Tasks\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const change = r.findings.actionItemsStatusChanges.find(
      (c) => c.subject === "Migrate to TLS 1.3",
    );
    assert.ok(change);
    assert.equal(change.transition, "removed-completed");
    assert.equal(change.beforeState, "completed");
    assert.equal(change.afterState, null);
    const titles = [...r.narrative.issues, ...r.narrative.quiet].map((i) => i.title);
    assert.ok(
      titles.some((t) => t === "Completed task removed: Migrate to TLS 1.3"),
      `expected "Completed task removed: ..." title; got ${titles.join(" | ")}`,
    );
  });
});

test("checklist: identical state on both sides produces no status change", () => {
  const left = "# Tasks\n- [ ] Foo\n- [x] Bar\n";
  const right = "# Tasks\n- [ ] Foo\n- [x] Bar\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    assert.equal(r.findings.actionItemsStatusChanges.length, 0);
    assert.equal(r.findings.actionItemsAdded.length, 0);
    assert.equal(r.findings.actionItemsRemoved.length, 0);
  });
});

test("checklist: TODO without checkbox is treated as open (matches across syntactic forms)", () => {
  // Bare `TODO: foo` is open; `[x] foo` is completed. Same body → completion.
  const left = "# Tasks\n- TODO: Wire up the dashboard\n";
  const right = "# Tasks\n- [x] Wire up the dashboard\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    assert.equal(r.findings.actionItemsStatusChanges.length, 1);
    const change = r.findings.actionItemsStatusChanges[0];
    assert.equal(change.transition, "completed");
    assert.equal(change.subject, "Wire up the dashboard");
    assert.equal(r.narrative.headline, "Task completed: Wire up the dashboard");
  });
});

// ── severity-downgraded: error → warning class ─────────────────────────────

test("error → warning across the doc surfaces as severity-downgraded, not policy-reversed", () => {
  // The dogfood case from auditing 1946-intra-rustdoc-links.md: a doc-wide
  // `error → warning` downgrade should read as "Severity downgraded: error
  // → warning", not as "Policy reversed".
  const left = [
    "If a disambiguator does not match, rustdoc should issue an error.",
    "If a public item links to a private one, rustdoc should give an error.",
    "Non-disambiguated paths cannot be used to link to macros.",
  ].join("\n") + "\n";
  const right = [
    "If a disambiguator does not match, rustdoc should issue a warning.",
    "If a public item links to a private one, rustdoc should give a warning.",
    "Non-disambiguated paths cannot be used to link to macros.",
  ].join("\n") + "\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const all = [...r.narrative.issues, ...r.narrative.quiet];
    const downgrades = all.filter((i) => i.kind === "severity-downgraded");
    assert.ok(
      downgrades.length > 0,
      `expected at least one severity-downgraded issue; got kinds: ${all.map((i) => i.kind).join(", ")}`,
    );
    assert.match(
      downgrades[0].title,
      /Severity downgraded.*error.*\u2192.*warning/,
      `expected "Severity downgraded: error → warning" framing; got: ${downgrades[0].title}`,
    );
  });
});

test("severity-downgraded fires from any classifier path (mirrors RFC step 11)", () => {
  // Mirrors the dogfood case from text/1946-intra-rustdoc-links.md
  // step 11: a doc-wide "error -> warning" downgrade across multiple
  // sentences. The classifier should reframe whichever finding the
  // engine emits (rename, commitment-shift, or contradiction) as
  // severity-downgraded, not the generic kind.
  const left = [
    "If a disambiguator does not match, rustdoc should issue an error.",
    "If a public item links to a private one, rustdoc should give an error.",
    "If a private item links to another private item, no error should be emitted.",
  ].join("\n") + "\n";
  const right = [
    "If a disambiguator does not match, rustdoc should issue a warning.",
    "If a public item links to a private one, rustdoc should give a warning.",
    "If a private item links to another private item, no warning should be emitted.",
  ].join("\n") + "\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const all = [...r.narrative.issues, ...r.narrative.quiet];
    assert.ok(
      all.some((i) => i.kind === "severity-downgraded"),
      `expected severity-downgraded across multi-sentence error->warning; got kinds: ${all.map((i) => i.kind).join(", ")}`,
    );
  });
});

test("severity-downgraded does NOT fire when both sides keep the harsh word", () => {
  // "fatal error in foo" → "fatal error in bar" is just a subject
  // change, not a downgrade. The detector requires the harsh word to
  // be GONE from after for the downgrade to count.
  const left = "A fatal error occurs in module foo.\n";
  const right = "A fatal error occurs in module bar.\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    const all = [...r.narrative.issues, ...r.narrative.quiet];
    assert.ok(
      !all.some((i) => i.kind === "severity-downgraded"),
      "must not flag severity-downgraded when harsh word persists",
    );
  });
});

// ── Weak contradiction demotion ────────────────────────────────────────────

test("weak same-section contradictions (≤2 anchors, low/medium conf) get demoted to quiet", () => {
  // Two sentences sharing only generic words shouldn't headline as a
  // policy reversal even if they trigger the negation-flip detector.
  // This mirrors the FP class from the RFC audit (steps 3-7, 10).
  const left  = "You can use a space instead of the @ symbol.\n";
  const right = "You can also use a function@ prefix as an alternative.\n";
  withTempPair(left, right, (lp, rp) => {
    const r = runJson(lp, rp);
    // If a contradiction even fires (it might not, with the engine
    // strip), it must NOT be promoted to TOP. Quiet bucket only.
    const topPolicy = r.narrative.issues.filter(
      (i) => i.kind === "policy-reversal" || i.kind === "scope-narrowed",
    );
    assert.equal(
      topPolicy.length, 0,
      `weak contradictions must not appear in TOP issues; got: ${topPolicy.map((i) => i.title).join(" | ")}`,
    );
  });
});

test("--no-narrative omits the narrative field from --json", () => {
  const raw = execFileSync(
    "node",
    [
      cli,
      exPath("03-api-contract", "left.md"),
      exPath("03-api-contract", "right.md"),
      "--json",
      "--no-narrative",
      "--no-config",
    ],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
  const r = JSON.parse(raw);
  assert.ok(!("narrative" in r), "--no-narrative should strip the narrative field");
});
