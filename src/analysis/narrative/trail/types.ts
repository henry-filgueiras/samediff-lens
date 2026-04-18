/**
 * Trail-level narrative layer — longitudinal thesis across a history
 * of per-step diffs.
 *
 * Doctrine, extended from the pairwise macro layer:
 *   Tier 1a — Trail Thesis (this layer): what happened across the
 *             document's lifetime. Optional; fires only when earned.
 *   Tier 1  — (Pairwise) Macro Thesis: doctrine within one diff.
 *   Tier 2  — Issue:  the single strongest accusation per diff.
 *   Tier 3  — Finding: literal evidence with provenance.
 *
 * Anti-hallucination contract (same spirit as the pairwise macro
 * layer): every TrailThesis cites ≥1 real Issue, via Issue.id namespaced
 * to its step. Every word in the headline comes from a fixed catalog.
 * The subheadline is the only synthesised text and fills slots from
 * cited evidence only.
 */

import type { Issue, Severity, Confidence } from "../types";

/**
 * One step's contribution to trail-level reasoning. The caller
 * (runHistory / runAudit) builds these by running analyzeTextPair +
 * buildNarrative per step and passing the results in. We keep the
 * full Issue[] rather than a pre-summarised shape because trail-level
 * clustering needs family/direction/evidence text, not just titles.
 */
export type StepNarrativeInput = {
  stepIndex: number;
  fromRef: string;
  toRef: string;
  toShort: string;
  authorName: string;
  /** ISO 8601 date string. */
  authorDate: string;
  commitSubject: string;
  severity: string;
  score: number;
  /** Union of top + quiet issues from the per-step narrative. */
  issues: Issue[];
};

/**
 * A citation from the thesis down to a specific Issue in a specific
 * step. Denormalized (toShort / authorDate / title / kind) so renderers
 * don't have to cross-reference the full trail to display the citation.
 */
export type TrailCitation = {
  stepIndex: number;
  issueId: string;
  toShort: string;
  authorDate: string;
  issueTitle: string;
  issueKind: string;
};

/**
 * A reversal arc — the load-bearing shape of the doctrine. Splits cited
 * steps into an "earlier" and "later" half so the renderer can show the
 * transition (e.g. weakened here, restored here) without synthesising
 * sequence text.
 */
export type TrailArc = {
  kind: "reversal" | "escalation";
  earlierSteps: number[];
  laterSteps: number[];
  /** "security" | "compliance" | "reliability" | "performance" | "mixed". */
  family: string;
};

export type TrailThesis = {
  patternId: string;
  /** Verbatim from the doctrine catalog. */
  headline: string;
  /** Templated: step count + date range + evidence topics. */
  subheadline: string;
  severity: Severity;
  confidence: Confidence;
  /** Union of every stepIndex that contributed ≥1 cited issue. */
  citedStepIndices: number[];
  citedIssueRefs: TrailCitation[];
  /** Topic nouns pulled verbatim from cited-issue subjects. */
  evidenceTopics: string[];
  /** Non-null when the thesis is an arc-shaped pattern. */
  arc: TrailArc | null;
  salience: number;
};

/**
 * Pattern-level shape returned by a doctrine evaluator. The wrapping
 * pipeline adds severity/confidence/subheadline after picking a winner.
 */
export type TrailPatternResult = {
  patternId: string;
  headline: string;
  citedStepIndices: number[];
  citedIssueRefs: TrailCitation[];
  evidenceTopics: string[];
  arc: TrailArc | null;
  salience: number;
};

export type TrailPattern = {
  id: string;
  /** Verbatim headline string. Never templated. */
  headline: string;
  /** One-line description of what the pattern detects (for docs / catalog dump). */
  description: string;
  /**
   * Predicate + synthesizer. Returns null when the pattern didn't fire
   * on this trail. When it returns a result, the wrapping pipeline still
   * enforces the earned threshold (conservative bias) and only the
   * highest-salience firing wins.
   */
  evaluate: (steps: StepNarrativeInput[]) => TrailPatternResult | null;
};
