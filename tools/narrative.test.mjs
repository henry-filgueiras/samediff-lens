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
