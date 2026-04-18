/**
 * Build a Thesis (or null) from a list of Issues.
 *
 * Pipeline:
 *   1. For each atom, collect Issues that match its predicate.
 *   2. For each composite, check if both its atoms fired with
 *      ≥2 cited Issues each AND share at least one cited Issue.
 *   3. Score each candidate (composite or qualifying atom) by
 *      cited-issue salience.
 *   4. Pick the highest-scoring candidate above the "earned"
 *      threshold; otherwise return null.
 *
 * The "earned" threshold is conservative on purpose:
 *   - Composite: cited-union ≥ 3 AND each atom contributed ≥ 2.
 *   - Atom: cited count ≥ atom.minIssues (currently 3 for all atoms).
 *
 * No catalog headline is ever templated. Subheadline is the only
 * synthesised text and only fills slots from cited evidence.
 */

import type { Confidence, Issue, Severity } from "../types";
import type { Thesis } from "./types";
import { ATOMIC_THEMES, findAtom } from "./atoms";
import { COMPOSITE_THEMES } from "./composites";

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const CONFIDENCE_MULT: Record<Confidence, number> = {
  high: 1.2,
  medium: 1.0,
  low: 0.7,
};

type AtomFiring = {
  atomId: string;
  citedIssueIds: string[];     // Issue.id values
  salience: number;
};

type Candidate = {
  themeId: string;
  isComposite: boolean;
  headline: string;
  citedIssueIds: string[];     // For composites, union of both atoms'
  salience: number;
};

export function buildMacroThesis(issues: Issue[]): Thesis | null {
  if (issues.length === 0) return null;

  const issueById = new Map(issues.map((i) => [i.id, i]));

  // Stage 1: which Issues match each atom?
  const atomFirings: AtomFiring[] = ATOMIC_THEMES.map((atom) => {
    const cited = issues.filter((i) => atom.matches(i));
    return {
      atomId: atom.id,
      citedIssueIds: cited.map((i) => i.id),
      salience: cited.reduce((s, i) => s + issueSalience(i), 0),
    };
  }).filter((f) => f.citedIssueIds.length > 0);

  // Stage 2: composite candidates
  const candidates: Candidate[] = [];

  for (const composite of COMPOSITE_THEMES) {
    const left = atomFirings.find((f) => f.atomId === composite.atoms[0]);
    const right = atomFirings.find((f) => f.atomId === composite.atoms[1]);
    if (!left || !right) continue;

    // Each atom must contribute ≥ 2 cited issues (so the composite
    // really is a *combination*, not a single atom plus one accidental
    // overlap).
    if (left.citedIssueIds.length < 2 || right.citedIssueIds.length < 2) continue;

    // Union of cited issues. We deliberately do NOT require per-issue
    // overlap between the two atoms: in real docs, the security
    // weakening (e.g. "auth must → should") and the staging deferral
    // (e.g. "audit deferred to Phase 2") usually live in different
    // sentences, so they map to different Issues even though they
    // tell the same coordinated story. Enforcing same-issue overlap
    // would silence the most important composite firings. Instead,
    // the coordination signal is "both patterns reach the
    // ≥2-cited-issue floor in the same document", which is what
    // the user specified ("at least 3 strongly related issues").
    const union = Array.from(new Set([...left.citedIssueIds, ...right.citedIssueIds]));
    if (union.length < 3) continue; // earned threshold

    // Composite gets a 1.5× boost over the sum of its parts because
    // coordinated drift is meaningfully stronger than parallel drift.
    const salience =
      union.reduce((s, id) => s + issueSalience(issueById.get(id)!), 0) * 1.5;

    candidates.push({
      themeId: composite.id,
      isComposite: true,
      headline: composite.headline,
      citedIssueIds: union,
      salience,
    });
  }

  // Stage 3: atom candidates (only when count ≥ minIssues)
  for (const firing of atomFirings) {
    const atom = findAtom(firing.atomId);
    if (!atom) continue;
    if (firing.citedIssueIds.length < atom.minIssues) continue;
    candidates.push({
      themeId: atom.id,
      isComposite: false,
      headline: atom.headline,
      citedIssueIds: firing.citedIssueIds,
      salience: firing.salience,
    });
  }

  if (candidates.length === 0) return null;

  // Stage 4: pick the winner. Composites should *clearly* beat atoms —
  // require composite salience > 1.2× the best atom; otherwise the
  // atom (or no thesis) wins.
  candidates.sort((a, b) => b.salience - a.salience);
  const winner = candidates[0];

  // Earned check: macro headline must be clearly stronger than the
  // single best Issue. Compare the winner's salience against the top
  // Issue's salience scaled up. If it's not a meaningful step up, skip.
  const topIssueSalience = issues.reduce(
    (max, i) => Math.max(max, issueSalience(i)),
    0,
  );
  // 1.4× the best single issue is the threshold for "clearly stronger".
  // Composites get a free pass — by construction they require ≥3 issues
  // across two themes, which is already a coordinated pattern.
  if (!winner.isComposite && winner.salience < topIssueSalience * 1.4) {
    return null;
  }

  // Build the Thesis
  const citedIssues = winner.citedIssueIds
    .map((id) => issueById.get(id))
    .filter((i): i is Issue => Boolean(i));

  const evidenceTopics = uniqueTopics(citedIssues);
  const severity = maxSeverity(citedIssues);
  const confidence = thesisConfidence(winner, citedIssues.length);

  return {
    themeId: winner.themeId,
    isComposite: winner.isComposite,
    headline: winner.headline,
    subheadline: buildSubheadline(citedIssues.length, evidenceTopics),
    severity,
    confidence,
    citedIssueIds: winner.citedIssueIds,
    evidenceTopics,
    salience: winner.salience,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function issueSalience(issue: Issue): number {
  // Mirror the per-Issue ranking weights in buildNarrative without
  // re-importing internals. This is the same shape used in multiFile.ts.
  const KIND_WEIGHT: Record<Issue["kind"], number> = {
    "commitment-reversal": 9,
    "policy-reversal": 8,
    "guarantee-removed": 7,
    "severity-downgraded": 7,
    "constraint-introduced": 6,
    "commitment-strengthening": 5,
    "commitment-weakening": 5,
    "scope-narrowed": 5,
    "task-completed": 4,
    "task-reopened": 4,
    "rename": 2,
    "task-scope-shift": 2,
    "observation": 1,
  };
  const sev = SEVERITY_RANK[issue.severity];
  const conf = CONFIDENCE_MULT[issue.confidence];
  return KIND_WEIGHT[issue.kind] * conf * (1 + (sev - 1) * 0.15);
}

function uniqueTopics(issues: Issue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of issues) {
    const t = i.subject.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function maxSeverity(issues: Issue[]): Severity {
  let best: Severity = "low";
  for (const i of issues) {
    if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) best = i.severity;
  }
  return best;
}

function thesisConfidence(winner: Candidate, citedCount: number): Confidence {
  if (winner.isComposite && citedCount >= 4) return "high";
  if (winner.isComposite) return "medium";
  if (citedCount >= 5) return "high";
  if (citedCount >= 4) return "medium";
  return "low";
}

function buildSubheadline(count: number, topics: string[]): string {
  const topicList = topics.length === 0
    ? ""
    : ` across ${formatTopicList(topics)}`;
  return `Driven by ${count} issue${count === 1 ? "" : "s"}${topicList}`;
}

function formatTopicList(topics: string[]): string {
  // Show up to 4 topics verbatim; collapse the rest into "+N more".
  const visible = topics.slice(0, 4);
  const overflow = topics.length - visible.length;
  const base = visible.join(", ");
  return overflow > 0 ? `${base} (+${overflow} more)` : base;
}
