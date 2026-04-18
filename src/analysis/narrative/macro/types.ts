/**
 * Macro narrative layer — synthesizes a Thesis from a set of Issues.
 *
 * Doctrine: theory → accusation → proof.
 *   Tier 1 — Thesis (this layer): doctrine. The pattern across issues.
 *   Tier 2 — Issue (existing narrative layer): accusation. One claim.
 *   Tier 3 — Finding (engine): proof. The literal evidence.
 *
 * Anti-hallucination contract: every Thesis cites at least one real Issue
 * via Issue.id. Every word in the macro headline comes from a fixed
 * catalog (atoms + composites). No freeform sentence assembly.
 */

import type { Issue, Severity, Confidence } from "../types";

export type ThemeFamily =
  | "security"
  | "compliance"
  | "reliability"
  | "performance"
  | "rollout";

/** Operational direction of the drift the theme is detecting. */
export type ThemeDirection =
  | "weakening"
  | "tightening"
  | "deferral"      // staging-pattern theme: not strictly direction, but shape
  | "any";

/**
 * Atomic theme — fires when a clean, single-direction pattern of N+ Issues
 * matches its predicate. Headlines are fixed strings from this catalog;
 * the only synthesis is "did this pattern fire on these issues."
 */
export type AtomicTheme = {
  id: string;
  family: ThemeFamily;
  direction: ThemeDirection;
  /** Verbatim headline string. Never templated, never assembled. */
  headline: string;
  /** Floor for promotion to a Thesis (atoms need at least this many). */
  minIssues: number;
  /** Predicate run against each Issue to decide if it cites the theme. */
  matches: (issue: Issue) => boolean;
};

/**
 * Composite theme — fires when two atoms both fire AND share at least
 * one cited Issue. The combination promotes to a stronger headline
 * (e.g. security-weakened + staging-deferral → "Production guarantees
 * relaxed for beta rollout"). Headlines remain fixed strings.
 */
export type CompositeTheme = {
  id: string;
  /** Verbatim headline string. */
  headline: string;
  /** Pair of atom IDs that must both fire. Order doesn't matter. */
  atoms: [string, string];
};

export type Thesis = {
  themeId: string;
  isComposite: boolean;
  /** From the catalog — never synthesized. */
  headline: string;
  /** Templated: "Driven by N issues across {topic, topic, topic}". */
  subheadline: string;
  severity: Severity;
  confidence: Confidence;
  /** Anti-hallucination: must be non-empty, must reference real Issue.id values. */
  citedIssueIds: string[];
  /** Verbatim topic nouns pulled from the cited issues' subjects. */
  evidenceTopics: string[];
  /** For diagnostics: raw salience score. */
  salience: number;
};
