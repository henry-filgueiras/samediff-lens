/**
 * Narrative interpretation layer — wraps DiffResult with ranked Issues
 * synthesised from (but never extending) the raw findings.
 *
 * Every Issue cites the underlying raw finding(s) it was built from.
 * Invariant enforced in buildNarrative: an Issue must have at least one
 * supporting finding. That's the anti-hallucination contract.
 */

import type { SourceAnchor } from "../types";

export type Severity = "low" | "moderate" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

/**
 * IssueKind is the narrative category we promote a raw finding into.
 * Stronger verbs (reversal, guarantee-removed) sit above weaker ones
 * (observation, rename) in ranking.
 */
export type IssueKind =
  | "commitment-reversal"       // required ↔ optional flip
  | "policy-reversal"           // negation flip (permitted → forbidden, etc.)
  | "guarantee-removed"         // audit/logging/durability removed or weakened
  | "constraint-introduced"     // rate limit, cap, new mandatory field
  | "commitment-strengthening"  // should → must
  | "commitment-weakening"      // must → should
  | "scope-narrowed"            // limiting language added (only/except/just)
  | "task-completed"            // [ ] → [x]
  | "task-reopened"             // [x] → [ ]
  | "task-scope-shift"          // pure add/remove of an action item
  | "rename"                    // concept rename
  | "observation";              // catch-all below-the-fold bucket

export type FindingCategory =
  | "commitment-shift"
  | "contradiction"
  | "concept-rename"
  | "added-concept"
  | "removed-concept"
  | "action-item-added"
  | "action-item-removed"
  | "task-status-change";

/** Pointer back into DiffResult.findings[<category>][<index>]. */
export type FindingRef = {
  category: FindingCategory;
  index: number;
};

export type Issue = {
  id: string;
  title: string;
  kind: IssueKind;
  severity: Severity;
  confidence: Confidence;
  /** Noun phrase extracted verbatim from the evidence. May be empty. */
  subject: string;
  /** One-sentence template-built expansion. */
  lede: string;
  evidence: {
    before: string | null;
    after: string | null;
    anchors: SourceAnchor[];
    /** Raw trigger tags (e.g. "narrows scope", "required-optional-flip"). */
    triggers: string[];
  };
  /** Must be non-empty. Pointers into DiffResult.findings. */
  supportingFindings: FindingRef[];
};

export type NarrativeReport = {
  /** The one title a skimmer would stop on, or null if everything is quiet. */
  headline: string | null;
  /** Carried from DiffResult.score.label for convenience. */
  severity: Severity;
  /** Ranked descending by salience. */
  issues: Issue[];
  /** Below-the-fold bucket: low-salience findings still enumerated. */
  quiet: Issue[];
  /**
   * Macro thesis — the doctrine layer above issues. Non-null only when
   * a coordinated pattern is "earned" (composite fires, or an atom fires
   * with cited count ≥ minIssues AND clearly stronger than the best
   * single issue). When null, renderers fall back to the single-issue
   * headline. See `narrative/macro/` for the catalog.
   */
  thesis: import("./macro").Thesis | null;
};
