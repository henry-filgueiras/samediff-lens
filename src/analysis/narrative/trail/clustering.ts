/**
 * Trail-level clustering helpers. Operates on Issues already classified
 * by the per-step narrative layer; the trail layer never re-classifies,
 * it only groups by (family, direction) across time.
 *
 * We intentionally reuse the pairwise macro layer's vocabulary:
 *   - Families: security / compliance / reliability / performance
 *   - Directions: weakening / tightening / neutral
 *   - Staging-deferral: lexical pattern
 *
 * The rule of thumb: if the pairwise macro layer wouldn't classify an
 * Issue into a family, the trail layer won't either. Hierarchy is
 * preserved: finding → issue → (family, direction) → thesis.
 */

import type { Issue } from "../types";
import {
  SECURITY_TOPICS,
  COMPLIANCE_TOPICS,
  RELIABILITY_TOPICS,
  PERFORMANCE_TOPICS,
  STAGING_DEFERRAL_PATTERN,
} from "../macro/topicCategories";
import { direction as issueDirection } from "../macro/directions";
import type { StepNarrativeInput, TrailCitation } from "./types";

export type Family = "security" | "compliance" | "reliability" | "performance";
export type Direction = "weakening" | "tightening" | "neutral";

export const ALL_FAMILIES: Family[] = [
  "security",
  "compliance",
  "reliability",
  "performance",
];

// The imported topic sets contain mixed-case entries (e.g. "TLS", "GDPR",
// "PII", "SLA"). Per-topic classification downstream lowercases the
// subject — so normalize both sides here. Consistent casing is required
// for the trail layer to see the same family membership the pairwise
// macro layer sees under its own lowercasing.
function lc(set: Set<string>): Set<string> {
  return new Set(Array.from(set, (t) => t.toLowerCase()));
}

const FAMILY_SETS: Record<Family, Set<string>> = {
  security: lc(SECURITY_TOPICS),
  compliance: lc(COMPLIANCE_TOPICS),
  reliability: lc(RELIABILITY_TOPICS),
  performance: lc(PERFORMANCE_TOPICS),
};

/**
 * Families an Issue contributes to, by subject noun. Multiple families
 * are allowed (e.g. "audit" sits in both compliance and reliability).
 */
export function familiesOf(issue: Issue): Family[] {
  const subject = issue.subject.trim().toLowerCase();
  if (!subject) return [];
  const out: Family[] = [];
  for (const f of ALL_FAMILIES) {
    if (FAMILY_SETS[f].has(subject)) out.push(f);
  }
  return out;
}

export function directionOf(issue: Issue): Direction {
  return issueDirection(issue);
}

/**
 * True when the Issue's evidence (either side) invokes the staging /
 * beta / deferral lexicon. Used by rollout-mode-persistent detection.
 */
export function hasStagingDeferral(issue: Issue): boolean {
  const text = `${issue.evidence.before ?? ""} ${issue.evidence.after ?? ""}`;
  return STAGING_DEFERRAL_PATTERN.test(text);
}

/**
 * Filter noise out: the trail layer wants issues that carry real
 * operational weight across time.
 *
 * Exclusions:
 *   - low-confidence anything
 *   - rename at anything other than high confidence (noisy lexical match)
 *   - pure task-scope-shift (add/remove of action items)
 *   - observations that aren't contradiction-derived (they're genuine
 *     below-the-fold findings, not cross-time patterns)
 *
 * Why contradictions-that-got-demoted-to-observation count: the
 * pairwise narrative demotes mixed-subject contradictions to quiet
 * because a single "may share" vs "do not share" across two sentences
 * could be noise inside one diff. But if that shape fires in three
 * separate commits by three separate authors, the trail layer has
 * legitimately seen a pattern — the repetition *is* the signal.
 * Reinstating them at the trail grain is consistent with the doctrine
 * "err toward under-synthesizing without losing the real story."
 */
export function isSubstantive(issue: Issue): boolean {
  if (issue.confidence === "low") return false;
  switch (issue.kind) {
    case "task-scope-shift":
      return false;
    case "rename":
      return issue.confidence === "high";
    case "observation":
      return issue.evidence.triggers.some((t) => t.startsWith("contradiction:"));
    default:
      return true;
  }
}

export function citationOf(step: StepNarrativeInput, issue: Issue): TrailCitation {
  return {
    stepIndex: step.stepIndex,
    issueId: issue.id,
    toShort: step.toShort,
    authorDate: step.authorDate,
    issueTitle: issue.title,
    issueKind: issue.kind,
  };
}

/**
 * Per-step, per-family, per-direction bundle — the core data structure
 * consumed by every doctrine evaluator. Each entry is (step, issue,
 * citation) with denormalized family/direction.
 */
export type ClassifiedIssue = {
  step: StepNarrativeInput;
  issue: Issue;
  families: Family[];
  direction: Direction;
  citation: TrailCitation;
};

export function classifyAcrossTrail(
  steps: StepNarrativeInput[],
): ClassifiedIssue[] {
  const out: ClassifiedIssue[] = [];
  for (const step of steps) {
    for (const issue of step.issues) {
      if (!isSubstantive(issue)) continue;
      const fams = familiesOf(issue);
      const dir = directionOf(issue);
      out.push({
        step,
        issue,
        families: fams,
        direction: dir,
        citation: citationOf(step, issue),
      });
    }
  }
  return out;
}

/**
 * Group classified issues by family. An issue belonging to N families
 * appears in N buckets (compliance + reliability is one issue with two
 * tickets). Buckets are sorted by stepIndex to make arc detection easy.
 */
export function groupByFamily(
  classified: ClassifiedIssue[],
): Record<Family, ClassifiedIssue[]> {
  const out = {
    security: [] as ClassifiedIssue[],
    compliance: [] as ClassifiedIssue[],
    reliability: [] as ClassifiedIssue[],
    performance: [] as ClassifiedIssue[],
  };
  for (const c of classified) {
    for (const f of c.families) out[f].push(c);
  }
  for (const f of ALL_FAMILIES) {
    out[f].sort((a, b) => a.step.stepIndex - b.step.stepIndex);
  }
  return out;
}

export function uniqueStepIndices(items: ClassifiedIssue[]): number[] {
  return Array.from(new Set(items.map((c) => c.step.stepIndex))).sort((a, b) => a - b);
}

/**
 * Topic nouns in citation order, deduped, case-preserving. Every topic
 * is pulled verbatim from the Issue.subject that already had the word
 * extracted by the pairwise narrative template.
 */
export function uniqueTopics(items: ClassifiedIssue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of items) {
    const t = c.issue.subject.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── Salience (cited issue weight, same shape as pairwise macro) ─────

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

const SEVERITY_RANK: Record<Issue["severity"], number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const CONFIDENCE_MULT: Record<Issue["confidence"], number> = {
  high: 1.2,
  medium: 1.0,
  low: 0.7,
};

export function issueSalience(issue: Issue): number {
  const sev = SEVERITY_RANK[issue.severity];
  const conf = CONFIDENCE_MULT[issue.confidence];
  return KIND_WEIGHT[issue.kind] * conf * (1 + (sev - 1) * 0.15);
}

export function sumSalience(items: ClassifiedIssue[]): number {
  return items.reduce((s, c) => s + issueSalience(c.issue), 0);
}
