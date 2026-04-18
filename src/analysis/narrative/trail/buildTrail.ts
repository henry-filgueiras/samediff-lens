/**
 * Build a TrailThesis (or null) from a sequence of per-step narratives.
 *
 * Pipeline:
 *   1. Run each doctrine pattern's evaluate() against the trail.
 *   2. Drop results that don't meet the earned threshold
 *      (≥3 cited issues from ≥2 distinct steps, OR an explicit arc).
 *   3. Pick the highest-salience result. Ties broken by catalog order.
 *   4. Derive severity, confidence, subheadline from citations.
 *
 * Every word in the headline comes from the catalog. The only synthesis
 * is the subheadline — step count, date range, and a comma-list of
 * evidence topics pulled verbatim from cited-issue subjects.
 */

import type { Issue } from "../types";
import type {
  StepNarrativeInput,
  TrailCitation,
  TrailPatternResult,
  TrailThesis,
} from "./types";
import { TRAIL_DOCTRINE } from "./doctrine";

type Confidence = Issue["confidence"];
type Severity = Issue["severity"];

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

export function buildTrailThesis(
  steps: StepNarrativeInput[],
): TrailThesis | null {
  if (steps.length < 2) return null;

  const candidates: TrailPatternResult[] = [];
  for (const pattern of TRAIL_DOCTRINE) {
    const result = pattern.evaluate(steps);
    if (!result) continue;
    if (!isEarned(result)) continue;
    candidates.push(result);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.salience - a.salience);
  const winner = candidates[0];

  const stepsByIndex = new Map<number, StepNarrativeInput>();
  for (const s of steps) stepsByIndex.set(s.stepIndex, s);

  const citedSteps = winner.citedStepIndices
    .map((idx) => stepsByIndex.get(idx))
    .filter((s): s is StepNarrativeInput => !!s);

  const citedIssues = resolveCitedIssues(winner.citedIssueRefs, stepsByIndex);

  const severity = maxSeverity(citedIssues);
  const confidence = thesisConfidence(winner);
  const subheadline = buildSubheadline(citedSteps, winner);

  return {
    patternId: winner.patternId,
    headline: winner.headline,
    subheadline,
    severity,
    confidence,
    citedStepIndices: winner.citedStepIndices,
    citedIssueRefs: winner.citedIssueRefs,
    evidenceTopics: winner.evidenceTopics,
    arc: winner.arc,
    salience: winner.salience,
  };
}

/**
 * Earned threshold — the last line of defense against executive fiction.
 *
 *   - Arc-shaped firings need ≥1 issue on each half AND ≥2 steps cited
 *     (an arc with one step on each side is still legitimate).
 *   - Flat firings need ≥3 issues across ≥2 steps.
 *
 * The conservative bias lives here, not in each pattern — this way the
 * doctrine catalog stays readable and the threshold is uniformly
 * applied. Pattern-specific tightenings (e.g. severity-downgraded needs
 * ≥3) already live in the pattern evaluators; this is a floor under
 * everything.
 */
function isEarned(result: TrailPatternResult): boolean {
  const distinctSteps = new Set(result.citedStepIndices).size;
  if (result.arc) {
    if (result.arc.earlierSteps.length === 0) return false;
    if (result.arc.laterSteps.length === 0) return false;
    if (distinctSteps < 2) return false;
    return true;
  }
  if (result.citedIssueRefs.length < 3) return false;
  if (distinctSteps < 2) return false;
  return true;
}

function resolveCitedIssues(
  refs: TrailCitation[],
  stepsByIndex: Map<number, StepNarrativeInput>,
): Issue[] {
  const out: Issue[] = [];
  for (const ref of refs) {
    const step = stepsByIndex.get(ref.stepIndex);
    if (!step) continue;
    const issue = step.issues.find((i) => i.id === ref.issueId);
    if (issue) out.push(issue);
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

/**
 * Trail thesis confidence is grounded in provenance breadth, not ML-y
 * probability. Mirrors the pairwise macro layer's rules.
 */
function thesisConfidence(r: TrailPatternResult): Confidence {
  if (r.arc) {
    if (r.citedIssueRefs.length >= 5) return "high";
    if (r.citedIssueRefs.length >= 3) return "medium";
    return "low";
  }
  if (r.citedIssueRefs.length >= 6) return "high";
  if (r.citedIssueRefs.length >= 4) return "medium";
  return "low";
}

function buildSubheadline(
  steps: StepNarrativeInput[],
  winner: TrailPatternResult,
): string {
  const stepCount = winner.citedStepIndices.length;
  const dateRange = formatDateRange(steps);
  const topics = formatTopicList(winner.evidenceTopics);
  const parts: string[] = [];
  parts.push(
    `Across ${stepCount} step${stepCount === 1 ? "" : "s"}${
      dateRange ? ` spanning ${dateRange}` : ""
    }`,
  );
  if (topics) parts.push(`driven by ${topics}`);
  return parts.join(" — ");
}

function formatDateRange(steps: StepNarrativeInput[]): string {
  const dates = steps
    .map((s) => (s.authorDate ?? "").slice(0, 10))
    .filter(Boolean);
  if (dates.length === 0) return "";
  dates.sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) return first;
  return `${first} → ${last}`;
}

function formatTopicList(topics: string[]): string {
  if (topics.length === 0) return "";
  const visible = topics.slice(0, 4);
  const overflow = topics.length - visible.length;
  const base = visible.join(", ");
  return overflow > 0 ? `${base} (+${overflow} more)` : base;
}
