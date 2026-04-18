/**
 * Fixed doctrine catalog for trail-level theses.
 *
 * Every pattern in this file has a hand-tuned headline string — the
 * only reviewable vocabulary the trail layer can speak. When a pattern
 * fires it synthesises nothing except the subheadline (step count +
 * date range + evidence topics, filled from citations).
 *
 * Conservative-threshold doctrine: a trail thesis is earned when either
 *   - ≥3 substantive, same-family, same-direction issues
 *     across ≥2 different steps   (progressive drift)
 *   - an explicit reversal where a family weakens and then restores,
 *     even at ≤2 issues per half  (arc overwhelms count)
 *   - ≥3 severity-downgrade or composite-weakening issues across
 *     ≥2 families                 (broad drift)
 *   - cumulative rollout-deferral language in ≥2 steps (persistent rollout)
 *
 * Err toward under-firing. Two weak events do not make a narrative.
 */

import type { Issue } from "../types";
import type {
  StepNarrativeInput,
  TrailArc,
  TrailPattern,
  TrailPatternResult,
} from "./types";
import {
  ALL_FAMILIES,
  type Family,
  classifyAcrossTrail,
  groupByFamily,
  hasStagingDeferral,
  isSubstantive,
  sumSalience,
  uniqueStepIndices,
  uniqueTopics,
  type ClassifiedIssue,
} from "./clustering";

// ── 1. Reversal arc: weakened then restored ─────────────────────────

/**
 * Detect an explicit weakening → tightening arc on the same family.
 * Arc mode is the *strongest* signal in the doctrine — even a single
 * weaken and a single restore on the same family earns a thesis,
 * provided the restore comes strictly after the weaken in step order.
 *
 * Distinction: requires BOTH halves to fire. A pure weakening doesn't
 * match here (that's handled by progressive-softening / broad-weakening
 * patterns). A pure tightening doesn't match either.
 */
function detectReversalArc(steps: StepNarrativeInput[]): TrailPatternResult | null {
  const classified = classifyAcrossTrail(steps);
  const byFamily = groupByFamily(classified);

  // Per-family arcs — the ground truth. Each qualifying family gets
  // its own arc entry; the union arc below is only allowed to fire
  // when at least 2 distinct families qualified independently.
  type FamilyArc = {
    family: Family;
    earlierSteps: number[];
    laterSteps: number[];
    cited: ClassifiedIssue[];
  };
  const perFamily: FamilyArc[] = [];

  for (const family of ALL_FAMILIES) {
    const bucket = byFamily[family];
    if (bucket.length < 2) continue;

    const weakened = bucket.filter((c) => c.direction === "weakening");
    const tightened = bucket.filter((c) => c.direction === "tightening");
    if (weakened.length === 0 || tightened.length === 0) continue;

    // Explicit reversal: tightening must come strictly after weakening.
    const earliestWeaken = Math.min(...weakened.map((c) => c.step.stepIndex));
    const latestTighten = Math.max(...tightened.map((c) => c.step.stepIndex));
    if (latestTighten <= earliestWeaken) continue;

    const earlierSteps = Array.from(
      new Set(weakened
        .filter((c) => c.step.stepIndex <= latestTighten)
        .map((c) => c.step.stepIndex)),
    ).sort((a, b) => a - b);
    const laterSteps = Array.from(
      new Set(tightened
        .filter((c) => c.step.stepIndex >= earliestWeaken)
        .map((c) => c.step.stepIndex)),
    ).sort((a, b) => a - b);

    const cited = [...weakened, ...tightened].filter(
      (c) =>
        earlierSteps.includes(c.step.stepIndex) ||
        laterSteps.includes(c.step.stepIndex),
    );

    perFamily.push({ family, earlierSteps, laterSteps, cited });
  }

  if (perFamily.length === 0) return null;

  // Candidate A: best single-family arc.
  const singleFamily = perFamily
    .map((fa) => ({
      family: fa.family,
      result: toResult(fa.cited, fa.earlierSteps, fa.laterSteps, fa.family),
    }))
    .sort((a, b) => b.result.salience - a.result.salience)[0];

  // Candidate B (earned only when ≥2 distinct families independently
  // reversed): the union arc — cross-family coordinated reversal. This
  // is the "compliance AND security AND reliability all weakened and
  // were all restored" shape. We don't invent a reversal where none
  // exists in any family; we only widen the lens when per-family
  // reversals have already demonstrated the pattern.
  //
  // Step halving uses *net* direction per step (majority weakening →
  // earlier half; majority tightening → later) so the renderer can
  // display the arc as two disjoint columns instead of putting the
  // same step in both halves.
  let unionCandidate: TrailPatternResult | null = null;
  if (perFamily.length >= 2) {
    // Deduplicate across buckets (an issue in 2 families appears twice).
    const seen = new Set<string>();
    const allCited: ClassifiedIssue[] = [];
    for (const fa of perFamily) {
      for (const c of fa.cited) {
        const key = `${c.step.stepIndex}\0${c.issue.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allCited.push(c);
      }
    }
    // Net direction per step: weakenings minus tightenings. Ties go
    // to whichever side the step leans on by stepIndex position — if
    // a step is in the earlier half of the trail overall, treat as
    // weakening; otherwise tightening.
    const perStepNet = new Map<number, number>();
    for (const c of allCited) {
      if (c.direction === "weakening") perStepNet.set(c.step.stepIndex, (perStepNet.get(c.step.stepIndex) ?? 0) + 1);
      else if (c.direction === "tightening") perStepNet.set(c.step.stepIndex, (perStepNet.get(c.step.stepIndex) ?? 0) - 1);
    }
    const trailMidpoint = (steps[0].stepIndex + steps[steps.length - 1].stepIndex) / 2;
    const earlierUnion: number[] = [];
    const laterUnion: number[] = [];
    for (const [idx, net] of perStepNet) {
      if (net > 0) earlierUnion.push(idx);
      else if (net < 0) laterUnion.push(idx);
      else if (idx <= trailMidpoint) earlierUnion.push(idx);
      else laterUnion.push(idx);
    }
    earlierUnion.sort((a, b) => a - b);
    laterUnion.sort((a, b) => a - b);
    if (earlierUnion.length > 0 && laterUnion.length > 0) {
      // The arc must still be an actual reversal — latest tighten
      // after earliest weaken.
      const earliest = Math.min(...earlierUnion);
      const latest = Math.max(...laterUnion);
      if (latest > earliest) {
        unionCandidate = toResult(allCited, earlierUnion, laterUnion, "mixed");
        // Cross-family coordination earns an extra multiplicative
        // boost on top of the arc multiplier — the story "everything
        // weakened and everything was restored" is operationally
        // stronger than any single family's arc.
        unionCandidate = { ...unionCandidate, salience: unionCandidate.salience * 1.3 };
      }
    }
  }

  // Pick the stronger candidate.
  if (unionCandidate && unionCandidate.salience > singleFamily.result.salience) {
    return unionCandidate;
  }
  return singleFamily.result;
}

function toResult(
  cited: ClassifiedIssue[],
  earlierSteps: number[],
  laterSteps: number[],
  family: string,
): TrailPatternResult {
  const arc: TrailArc = {
    kind: "reversal",
    earlierSteps,
    laterSteps,
    family,
  };
  return {
    patternId: "guarantees-restored-after-relaxation",
    headline: "Guarantees weakened and later restored",
    citedStepIndices: uniqueStepIndices(cited),
    citedIssueRefs: cited.map((c) => c.citation),
    evidenceTopics: uniqueTopics(cited),
    arc,
    salience: sumSalience(cited) * 1.8,
  };
}

// ── 2. Syntax contract reversed after review ────────────────────────

/**
 * Detect a rename or commitment-reversal that *undoes* a prior step's
 * decision — the canonical "we tried A, went to B, then went back to A"
 * shape that shows up in RFC reviews. We detect it lexically: a
 * reversal-kind issue whose after-text overlaps with some earlier
 * step's before-text for the same subject.
 *
 * Kept tight: requires a rename or *-reversal kind AND a visible
 * earlier anchor. This is not "any rename" — it's specifically a flip
 * that restores an earlier form.
 */
function detectSyntaxReversal(steps: StepNarrativeInput[]): TrailPatternResult | null {
  if (steps.length < 2) return null;

  type Candidate = { later: ClassifiedIssue; earlier: ClassifiedIssue[] };
  const candidates: Candidate[] = [];
  const classified = classifyAcrossTrail(steps);
  const byStep = new Map<number, ClassifiedIssue[]>();
  for (const c of classified) {
    const arr = byStep.get(c.step.stepIndex) ?? [];
    arr.push(c);
    byStep.set(c.step.stepIndex, arr);
  }

  for (const c of classified) {
    if (c.issue.kind !== "rename" &&
        c.issue.kind !== "commitment-reversal" &&
        c.issue.kind !== "policy-reversal") continue;
    const afterText = normaliseTok(c.issue.evidence.after);
    const beforeText = normaliseTok(c.issue.evidence.before);
    if (!afterText || !beforeText) continue;
    // Look for an earlier step where a similar flip happened in the
    // opposite direction (later.after ~= earlier.before).
    const earlierHits: ClassifiedIssue[] = [];
    for (const earlier of classified) {
      if (earlier.step.stepIndex >= c.step.stepIndex) continue;
      if (earlier.issue.kind !== "rename" &&
          earlier.issue.kind !== "commitment-reversal" &&
          earlier.issue.kind !== "policy-reversal") continue;
      const eBefore = normaliseTok(earlier.issue.evidence.before);
      const eAfter = normaliseTok(earlier.issue.evidence.after);
      if (!eBefore || !eAfter) continue;
      // "restore" shape: later.after ≈ earlier.before AND
      //                  later.before ≈ earlier.after
      if (tokenOverlap(afterText, eBefore) >= 2 &&
          tokenOverlap(beforeText, eAfter) >= 2) {
        earlierHits.push(earlier);
      }
    }
    if (earlierHits.length > 0) {
      candidates.push({ later: c, earlier: earlierHits });
    }
  }

  if (candidates.length === 0) return null;

  // Pick the strongest candidate (most cited earlier hits + reversal weight).
  candidates.sort((a, b) => (b.earlier.length - a.earlier.length));
  const pick = candidates[0];
  const cited = [pick.later, ...pick.earlier];
  const laterSteps = [pick.later.step.stepIndex];
  const earlierSteps = Array.from(
    new Set(pick.earlier.map((c) => c.step.stepIndex)),
  ).sort((a, b) => a - b);

  const arc: TrailArc = {
    kind: "reversal",
    earlierSteps,
    laterSteps,
    family: "mixed",
  };

  return {
    patternId: "syntax-contract-reversed",
    headline: "Syntax contract reversed after review",
    citedStepIndices: uniqueStepIndices(cited),
    citedIssueRefs: cited.map((c) => c.citation),
    evidenceTopics: uniqueTopics(cited),
    arc,
    // Reversal shape matters more than cited count — bump accordingly.
    salience: sumSalience(cited) * 1.5,
  };
}

function normaliseTok(s: string | null): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function tokenOverlap(a: string[], b: string[]): number {
  const set = new Set(a);
  let count = 0;
  for (const t of b) if (set.has(t)) count++;
  return count;
}

// ── 3. Compliance boundary narrowed ─────────────────────────────────

function detectComplianceBoundaryNarrowed(
  steps: StepNarrativeInput[],
): TrailPatternResult | null {
  return detectFamilyWeakening(steps, "compliance", {
    patternId: "compliance-boundary-narrowed",
    headline: "Compliance boundary progressively narrowed",
  });
}

// ── 4. Policy progressively softened (family-generic) ───────────────

/**
 * A family sustains ≥3 weakening issues across ≥2 steps without a
 * meaningful restoration (no tightening in the same family). This is
 * the "policy progressively softened" shape — a monotone slide, not
 * an arc.
 */
function detectProgressiveSoftening(
  steps: StepNarrativeInput[],
): TrailPatternResult | null {
  const byFamily = groupByFamily(classifyAcrossTrail(steps));
  let best: TrailPatternResult | null = null;

  for (const family of ALL_FAMILIES) {
    const bucket = byFamily[family];
    const weakened = bucket.filter((c) => c.direction === "weakening");
    const tightened = bucket.filter((c) => c.direction === "tightening");

    // Monotone: if tightenings exist, reversal detector owns it.
    if (tightened.length > 0) continue;
    if (weakened.length < 3) continue;
    const stepCount = new Set(weakened.map((c) => c.step.stepIndex)).size;
    if (stepCount < 2) continue;

    const result: TrailPatternResult = {
      patternId: "policy-progressively-softened",
      headline: `Policy progressively softened on ${family}`,
      citedStepIndices: uniqueStepIndices(weakened),
      citedIssueRefs: weakened.map((c) => c.citation),
      evidenceTopics: uniqueTopics(weakened),
      arc: null,
      salience: sumSalience(weakened),
    };

    if (!best || result.salience > best.salience) best = result;
  }

  return best;
}

// Factored shared logic for a "same family, weakening, no restoration".
function detectFamilyWeakening(
  steps: StepNarrativeInput[],
  family: Family,
  label: { patternId: string; headline: string },
): TrailPatternResult | null {
  const byFamily = groupByFamily(classifyAcrossTrail(steps));
  const bucket = byFamily[family];
  const weakened = bucket.filter((c) => c.direction === "weakening");
  const tightened = bucket.filter((c) => c.direction === "tightening");

  if (tightened.length > 0) return null;
  if (weakened.length < 3) return null;
  const stepCount = new Set(weakened.map((c) => c.step.stepIndex)).size;
  if (stepCount < 2) return null;

  return {
    patternId: label.patternId,
    headline: label.headline,
    citedStepIndices: uniqueStepIndices(weakened),
    citedIssueRefs: weakened.map((c) => c.citation),
    evidenceTopics: uniqueTopics(weakened),
    arc: null,
    salience: sumSalience(weakened),
  };
}

// ── 5. Operational guarantees broadly weakened over time ────────────

/**
 * Weakening issues spread across ≥2 families AND ≥2 steps AND total
 * ≥3 substantive weakenings. Broader than "one family narrowed" — the
 * story is "everything drifted," which is a distinct operational read.
 */
function detectBroadWeakening(steps: StepNarrativeInput[]): TrailPatternResult | null {
  const classified = classifyAcrossTrail(steps);
  const weak = classified.filter((c) => c.direction === "weakening" && c.families.length > 0);
  if (weak.length < 3) return null;

  // Count distinct families hit
  const famsHit = new Set<Family>();
  for (const c of weak) for (const f of c.families) famsHit.add(f);
  if (famsHit.size < 2) return null;

  const stepCount = new Set(weak.map((c) => c.step.stepIndex)).size;
  if (stepCount < 2) return null;

  // If this trail actually ends with a family restoration, defer to the
  // reversal detector instead of claiming everything stayed weak.
  const byFamily = groupByFamily(classified);
  for (const f of ALL_FAMILIES) {
    const bucket = byFamily[f];
    const w = bucket.filter((c) => c.direction === "weakening");
    const t = bucket.filter((c) => c.direction === "tightening");
    if (w.length > 0 && t.length > 0) {
      const earliestW = Math.min(...w.map((c) => c.step.stepIndex));
      const latestT = Math.max(...t.map((c) => c.step.stepIndex));
      if (latestT > earliestW) return null;
    }
  }

  return {
    patternId: "operational-guarantees-broadly-weakened",
    headline: "Operational guarantees broadly weakened over time",
    citedStepIndices: uniqueStepIndices(weak),
    citedIssueRefs: weak.map((c) => c.citation),
    evidenceTopics: uniqueTopics(weak),
    arc: null,
    // Broad-drift gets its own small boost — coordination across
    // families is a coordination signal, same idea as composites
    // in the pairwise macro layer.
    salience: sumSalience(weak) * 1.2,
  };
}

// ── 6. Severity downgraded systematically ───────────────────────────

function detectSeverityDowngradedSystematically(
  steps: StepNarrativeInput[],
): TrailPatternResult | null {
  const classified = classifyAcrossTrail(steps);
  const downgrades = classified.filter((c) => c.issue.kind === "severity-downgraded");
  if (downgrades.length < 3) return null;
  const stepCount = new Set(downgrades.map((c) => c.step.stepIndex)).size;
  if (stepCount < 2) return null;

  return {
    patternId: "severity-downgraded-systematically",
    headline: "Enforcement severity downgraded across revisions",
    citedStepIndices: uniqueStepIndices(downgrades),
    citedIssueRefs: downgrades.map((c) => c.citation),
    evidenceTopics: uniqueTopics(downgrades),
    arc: null,
    salience: sumSalience(downgrades) * 1.3,
  };
}

// ── 7. Rollout mode persistent ──────────────────────────────────────

/**
 * Staging / beta / deferral lexicon fires in ≥2 different steps and
 * is still present in a late step (≥ last half of the trail). This is
 * "rollout softened — still softened" — the production deferral never
 * got lifted.
 */
function detectRolloutPersistent(steps: StepNarrativeInput[]): TrailPatternResult | null {
  const classified = classifyAcrossTrail(steps);
  const rolloutIssues = classified.filter(
    (c) => hasStagingDeferral(c.issue) && isSubstantive(c.issue),
  );
  const stepIndices = uniqueStepIndices(rolloutIssues);
  if (stepIndices.length < 2) return null;
  if (rolloutIssues.length < 2) return null;

  // "Persistent" means the lexicon is still there in the later half.
  const halfCut = Math.ceil(steps.length / 2);
  const inLaterHalf = rolloutIssues.some((c) => c.step.stepIndex >= halfCut - 1);
  if (!inLaterHalf) return null;

  return {
    patternId: "rollout-mode-persistent",
    headline: "Rollout softened — deferral language persists across revisions",
    citedStepIndices: stepIndices,
    citedIssueRefs: rolloutIssues.map((c) => c.citation),
    evidenceTopics: uniqueTopics(rolloutIssues),
    arc: null,
    salience: sumSalience(rolloutIssues) * 1.1,
  };
}

// ── 8. Ownership drift ──────────────────────────────────────────────

/**
 * Substantive edits (steps with severity ≥ moderate AND ≥1 substantive
 * issue) authored by distinct cohorts early vs late in the trail. We
 * require early and late author sets to be fully disjoint AND both
 * halves to have ≥2 substantive steps — otherwise it's noise from
 * normal team rotation.
 *
 * Limitations: we only see commit authors. Attribution of
 * decision-making vs commit-execution is not modelled. False positives
 * possible when a single person happens to author both halves. The
 * conservative threshold (disjoint cohorts, ≥2 per half) catches the
 * honest "team handoff" case without claiming to read intent.
 */
function detectOwnershipDrift(steps: StepNarrativeInput[]): TrailPatternResult | null {
  if (steps.length < 4) return null;
  const classified = classifyAcrossTrail(steps);
  const substantiveStepIdx = new Set(classified.map((c) => c.step.stepIndex));

  // Filter to "significant" steps: severity ≥ moderate AND has a
  // substantive issue.
  const signif = steps.filter(
    (s) =>
      substantiveStepIdx.has(s.stepIndex) &&
      (s.severity === "moderate" ||
        s.severity === "high" ||
        s.severity === "critical"),
  );
  if (signif.length < 4) return null;

  const half = Math.floor(signif.length / 2);
  const early = signif.slice(0, half);
  const late = signif.slice(-half);
  if (early.length < 2 || late.length < 2) return null;

  const earlyAuthors = new Set(early.map((s) => s.authorName));
  const lateAuthors = new Set(late.map((s) => s.authorName));
  // Require at least two distinct authors in each half AND full
  // disjointness between the two halves.
  if (earlyAuthors.size < 2 || lateAuthors.size < 2) return null;
  for (const a of earlyAuthors) if (lateAuthors.has(a)) return null;

  // Build citations from every substantive issue inside the two halves.
  const citedSteps = new Set([...early, ...late].map((s) => s.stepIndex));
  const cited = classified.filter((c) => citedSteps.has(c.step.stepIndex));
  if (cited.length === 0) return null;

  const arc: TrailArc = {
    kind: "escalation",
    earlierSteps: early.map((s) => s.stepIndex),
    laterSteps: late.map((s) => s.stepIndex),
    family: "mixed",
  };

  return {
    patternId: "ownership-drift",
    headline: "Ownership shifted across significant revisions",
    citedStepIndices: uniqueStepIndices(cited),
    citedIssueRefs: cited.map((c) => c.citation),
    evidenceTopics: uniqueTopics(cited),
    arc,
    salience: sumSalience(cited) * 0.9,
  };
}

// ── Catalog ─────────────────────────────────────────────────────────

/**
 * Ordered by doctrine priority. Reversals come first because they
 * encode the strongest operational narrative; pure weakenings last
 * because they're the most common shape and should only win when the
 * stronger arcs didn't fire.
 *
 * Ordering doesn't matter for correctness (the pipeline sorts by
 * salience); it's here as a reading aid for anyone auditing the
 * catalog.
 */
export const TRAIL_DOCTRINE: TrailPattern[] = [
  {
    id: "guarantees-restored-after-relaxation",
    headline: "Guarantees weakened and later restored",
    description:
      "A family of guarantees was weakened and later tightened — a reversal arc across time.",
    evaluate: detectReversalArc,
  },
  {
    id: "syntax-contract-reversed",
    headline: "Syntax contract reversed after review",
    description:
      "A rename or modal reversal in a later step restores the earlier form of a flip.",
    evaluate: detectSyntaxReversal,
  },
  {
    id: "severity-downgraded-systematically",
    headline: "Enforcement severity downgraded across revisions",
    description:
      "≥3 severity-downgrade issues spanning ≥2 steps — enforcement consistently softened.",
    evaluate: detectSeverityDowngradedSystematically,
  },
  {
    id: "compliance-boundary-narrowed",
    headline: "Compliance boundary progressively narrowed",
    description:
      "≥3 compliance-family weakenings across ≥2 steps, no compensating tightening.",
    evaluate: detectComplianceBoundaryNarrowed,
  },
  {
    id: "policy-progressively-softened",
    headline: "Policy progressively softened (family-generic)",
    description:
      "≥3 weakenings on the same family across ≥2 steps, no restoration.",
    evaluate: detectProgressiveSoftening,
  },
  {
    id: "operational-guarantees-broadly-weakened",
    headline: "Operational guarantees broadly weakened over time",
    description:
      "Weakening issues spread across ≥2 families and ≥2 steps — coordinated drift.",
    evaluate: detectBroadWeakening,
  },
  {
    id: "rollout-mode-persistent",
    headline: "Rollout softened — deferral language persists across revisions",
    description:
      "Staging-deferral lexicon appears in ≥2 steps, still present in the later half.",
    evaluate: detectRolloutPersistent,
  },
  {
    id: "ownership-drift",
    headline: "Ownership shifted across significant revisions",
    description:
      "Substantive edits come from disjoint author cohorts in the earlier vs later half of the trail.",
    evaluate: detectOwnershipDrift,
  },
];

/** Headlines that may appear in a TrailThesis.headline. Tests use this. */
export const TRAIL_HEADLINES = new Set<string>(
  TRAIL_DOCTRINE.map((p) => p.headline)
    .concat([
      // progressive-softening substitutes the family into the headline.
      "Policy progressively softened on security",
      "Policy progressively softened on compliance",
      "Policy progressively softened on reliability",
      "Policy progressively softened on performance",
    ]),
);

// Re-export Issue type for convenience to external consumers.
export type { Issue };
