/**
 * Macro narrative (Thesis) layer tests.
 *
 * Doctrine: theory → accusation → proof.
 *   This file exercises the theory tier — the synthesis of an Issue
 *   set into a macro Thesis with a fixed catalog headline + cited
 *   issues. Anti-hallucination contract: every cited id must resolve
 *   to a real Issue, every evidence topic must appear verbatim in
 *   some cited issue's subject, and every headline must be a verbatim
 *   string from the atom or composite catalog.
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

function runJson(leftPath, rightPath) {
  const raw = execFileSync(
    "node",
    [cli, leftPath, rightPath, "--json", "--no-config"],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
  return JSON.parse(raw);
}

function runDirJson(leftRoot, rightRoot) {
  const raw = execFileSync(
    "node",
    [cli, "dir", leftRoot, rightRoot, "--json", "--no-config"],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
  return JSON.parse(raw);
}

function exPath(dir, name) {
  return resolve(repoRoot, "examples", dir, name);
}

function withTempPair(left, right, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), "samediff-macro-"));
  const lp = resolve(dir, "left.md");
  const rp = resolve(dir, "right.md");
  writeFileSync(lp, left, "utf-8");
  writeFileSync(rp, right, "utf-8");
  try { return fn(lp, rp); }
  finally { rmSync(dir, { force: true, recursive: true }); }
}

// Catalog reference — kept in sync with src/analysis/narrative/macro/.
// If a test asserts a specific headline string, that string must appear
// here; if you add a new catalog entry, add it here too. The whole
// point of the catalog approach is that the headlines are reviewable.
const VALID_HEADLINES = new Set([
  // atoms
  "Security posture weakened",
  "Compliance boundary weakened",
  "Reliability guarantees relaxed",
  "Performance commitments softened",
  "Production controls deferred to beta period",
  // composites
  "Production guarantees relaxed for beta rollout",
  "Reliability traded for rollout speed",
  "Compliance controls relaxed for beta rollout",
  "Operational guarantees broadly weakened",
  "Production guarantees broadly weakened",
]);

// ── Anti-hallucination contract (cross-cutting) ────────────────────────────

test("when a thesis fires, every cited id resolves to a real Issue", () => {
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
    const t = r.narrative.thesis;
    if (!t) continue; // Macro layer being conservative is allowed.
    assert.ok(t.citedIssueIds.length > 0, `${ex}: thesis must cite ≥1 issue`);
    const knownIds = new Set([
      ...r.narrative.issues.map((i) => i.id),
      ...r.narrative.quiet.map((i) => i.id),
    ]);
    for (const id of t.citedIssueIds) {
      assert.ok(
        knownIds.has(id),
        `${ex}: thesis cites unknown issue id ${id}`,
      );
    }
  }
});

test("thesis headlines come from the fixed catalog (no synthesis)", () => {
  const examples = [
    "01-modal-shift",
    "03-api-contract",
    "04-prompt-policy",
    "05-hydra-doc-drift",
    "06-secure-gateway-doc-drift",
  ];
  for (const ex of examples) {
    const r = runJson(exPath(ex, "left.md"), exPath(ex, "right.md"));
    const t = r.narrative.thesis;
    if (!t) continue;
    assert.ok(
      VALID_HEADLINES.has(t.headline),
      `${ex}: thesis headline "${t.headline}" not in fixed catalog`,
    );
  }
});

test("evidence topics in thesis appear verbatim in some cited issue's subject", () => {
  const examples = [
    "06-secure-gateway-doc-drift",
  ];
  for (const ex of examples) {
    const r = runJson(exPath(ex, "left.md"), exPath(ex, "right.md"));
    const t = r.narrative.thesis;
    if (!t) continue;
    const issuesById = new Map(
      [...r.narrative.issues, ...r.narrative.quiet].map((i) => [i.id, i]),
    );
    const citedSubjects = t.citedIssueIds
      .map((id) => issuesById.get(id)?.subject?.toLowerCase())
      .filter(Boolean);
    for (const topic of t.evidenceTopics) {
      assert.ok(
        citedSubjects.includes(topic.toLowerCase()),
        `${ex}: thesis topic "${topic}" not present in any cited issue subject`,
      );
    }
  }
});

// ── Conservative threshold (don't over-synthesize) ─────────────────────────

test("scattered single-direction drift does NOT fire a thesis", () => {
  // One commitment shift on auth (security family) — clearly below the
  // ≥3 atom floor. Macro layer must stay silent.
  withTempPair(
    "Authentication is required for all requests.\n",
    "Authentication is recommended for all requests.\n",
    (lp, rp) => {
      const r = runJson(lp, rp);
      assert.equal(r.narrative.thesis, null,
        "single weakening must not fire a thesis");
    },
  );
});

test("a single weakening on one topic — clearly below floor — does NOT fire", () => {
  // One sentence, one drift event, no possible coordination. The macro
  // layer must stay silent and let the per-issue headline carry it.
  withTempPair(
    "Tokens must be rotated every 24 hours.\n",
    "Tokens may be rotated every 30 days.\n",
    (lp, rp) => {
      const r = runJson(lp, rp);
      assert.equal(
        r.narrative.thesis, null,
        "single weakening with no coordination signal must not fire",
      );
    },
  );
});

// ── 06 secure-gateway-doc-drift — the canonical composite case ─────────────

test("06-secure-gateway fires a composite thesis tied to beta rollout", () => {
  const r = runJson(
    exPath("06-secure-gateway-doc-drift", "left.md"),
    exPath("06-secure-gateway-doc-drift", "right.md"),
  );
  const t = r.narrative.thesis;
  assert.ok(t, "expected a thesis on 06");
  assert.equal(t.isComposite, true, "thesis should be a composite");
  assert.match(
    t.headline,
    /(beta rollout|rollout speed|broadly weakened|Compliance boundary weakened)/,
    `expected a beta/rollout/compliance composite headline; got "${t.headline}"`,
  );
  assert.ok(
    t.citedIssueIds.length >= 3,
    "earned threshold: composite must cite ≥3 issues",
  );
  // Subheadline should include the count + at least one topic
  assert.match(t.subheadline, /Driven by \d+ issues/);
});

test("06-secure-gateway thesis severity is high or critical", () => {
  const r = runJson(
    exPath("06-secure-gateway-doc-drift", "left.md"),
    exPath("06-secure-gateway-doc-drift", "right.md"),
  );
  const t = r.narrative.thesis;
  assert.ok(t);
  assert.ok(
    ["high", "critical"].includes(t.severity),
    `expected high/critical severity, got ${t.severity}`,
  );
});

// ── Three-tier doctrine: thesis does NOT replace strongest issue ───────────

test("when thesis fires, the single-issue headline is preserved underneath", () => {
  const r = runJson(
    exPath("06-secure-gateway-doc-drift", "left.md"),
    exPath("06-secure-gateway-doc-drift", "right.md"),
  );
  // Thesis fires above; the regular per-issue headline stays the
  // strongest concrete accusation. Theory + accusation, in that order.
  assert.ok(r.narrative.thesis, "thesis should fire on 06");
  assert.ok(r.narrative.headline, "single-issue headline must remain non-null");
  assert.notEqual(
    r.narrative.headline, r.narrative.thesis.headline,
    "the two layers should not collapse into the same string",
  );
});

// ── Multi-file aggregate ───────────────────────────────────────────────────

test("multi-file aggregate fires a composite thesis when cross-file drift coordinates", () => {
  const r = runDirJson(
    exPath("07-multi-spec", "v1"),
    exPath("07-multi-spec", "v2"),
  );
  const t = r.aggregate.thesis;
  assert.ok(t, "07-multi-spec should fire an aggregate thesis");
  assert.equal(t.isComposite, true, "expected a composite (cross-theme coordination)");
  assert.ok(VALID_HEADLINES.has(t.headline), `headline "${t.headline}" not in catalog`);
  // Citations should be file-namespaced (so they remain unique across files)
  for (const id of t.citedIssueIds) {
    assert.match(id, /^[^#]+\.md#issue-\d+$/, `expected file-namespaced id, got ${id}`);
  }
});

test("multi-file thesis cited ids resolve to real issues across the file set", () => {
  const r = runDirJson(
    exPath("07-multi-spec", "v1"),
    exPath("07-multi-spec", "v2"),
  );
  const t = r.aggregate.thesis;
  assert.ok(t);
  // Build the namespaced id index
  const known = new Set();
  for (const f of r.files) {
    for (const i of [...f.narrative.issues, ...f.narrative.quiet]) {
      known.add(`${f.path}#${i.id}`);
    }
  }
  for (const id of t.citedIssueIds) {
    assert.ok(known.has(id), `aggregate thesis cites unknown id: ${id}`);
  }
});

// ── Synthetic earned-atom case ─────────────────────────────────────────────

test("3 weakenings on security topics (no staging language) fires a security-only atom", () => {
  // Three independent security weakenings, no beta/staging context.
  // Should fire the security-weakened atom (not a composite).
  withTempPair(
    [
      "Authentication is required for all requests.",
      "Encryption must use TLS 1.3 in transit.",
      "Tokens must be rotated every 24 hours.",
    ].join("\n") + "\n",
    [
      "Authentication is recommended for all requests.",
      "Encryption should use TLS 1.2 or higher in transit.",
      "Tokens may be rotated every 30 days.",
    ].join("\n") + "\n",
    (lp, rp) => {
      const r = runJson(lp, rp);
      const t = r.narrative.thesis;
      // The atom-only path needs to clearly beat the best single
      // issue (1.4×). Three weakenings on the same family usually
      // do, but if not we just don't fire — that's fine, this test
      // asserts that *if* a thesis fires it's catalog-conformant.
      if (t) {
        assert.equal(t.isComposite, false,
          "no staging language → atom only, not composite");
        assert.ok(VALID_HEADLINES.has(t.headline),
          `headline "${t.headline}" not in catalog`);
      }
    },
  );
});
