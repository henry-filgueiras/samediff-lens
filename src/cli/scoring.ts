import type { AnalysisResult } from "../analysis/types";

/**
 * Compute a 0–10 drift severity score from an analysis result.
 *
 * Scoring is deliberately simple and transparent:
 *   commitment shifts  × 1.5  (these are the dangerous ones)
 *   contradictions      × 1.5
 *   action item changes × 0.5
 *   concept renames     × 1.0
 *   concept deltas      × 0.3
 *
 * Raw total is clamped to 0–10 with a soft ceiling.
 */
export function computeDriftScore(result: AnalysisResult): number {
  const raw =
    result.changedCommitmentsEvidence.length * 1.5 +
    result.possibleContradictionsEvidence.length * 1.5 +
    (result.actionItemsAdded.length + result.actionItemsRemoved.length) * 0.5 +
    result.renamedIdeas.length * 1.0 +
    (result.addedConcepts.length + result.removedConcepts.length) * 0.3;

  // Soft ceiling: asymptotically approaches 10
  // score = 10 × (1 - e^(-raw/8))
  const score = 10 * (1 - Math.exp(-raw / 8));

  return Math.round(score * 10) / 10;
}

/**
 * Return a process exit code based on drift severity.
 *   0 = no meaningful drift (score ≤ 1)
 *   1 = drift detected (score > 1)
 */
export function driftExitCode(score: number): number {
  return score > 1 ? 1 : 0;
}
