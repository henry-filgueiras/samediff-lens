import type { AnalysisResult } from "./types";
import {
  buildSummary,
  compareActionItems,
  detectConceptChanges,
  detectChangedCommitments,
  detectPossibleContradictions,
  detectRenameIdeas,
  extractActionItems,
  extractUnits,
  getUnmatchedUnits,
  matchUnits,
} from "./heuristics";

export function analyzeTextPair(versionA: string, versionB: string): AnalysisResult {
  const trimmedA = versionA.trim();
  const trimmedB = versionB.trim();

  if (!trimmedA && !trimmedB) {
    return {
      addedConcepts: [],
      removedConcepts: [],
      renamedIdeas: [],
      changedCommitments: [],
      actionItemsAdded: [],
      actionItemsRemoved: [],
      possibleContradictions: [],
      addedConceptsEvidence: [],
      removedConceptsEvidence: [],
      changedCommitmentsEvidence: [],
      possibleContradictionsEvidence: [],
      summary: "No text provided yet. Paste two versions or load a golden example to inspect drift.",
    };
  }

  const aUnits = extractUnits(trimmedA);
  const bUnits = extractUnits(trimmedB);
  const pairs = matchUnits(aUnits, bUnits);
  const unmatchedA = getUnmatchedUnits(aUnits, pairs, "a");
  const unmatchedB = getUnmatchedUnits(bUnits, pairs, "b");
  const addedConceptsEvidence = detectConceptChanges(bUnits, aUnits);
  const removedConceptsEvidence = detectConceptChanges(aUnits, bUnits);
  const changedCommitmentsEvidence = detectChangedCommitments(pairs);
  const possibleContradictionsEvidence = detectPossibleContradictions(aUnits, bUnits);

  const actionDiff = compareActionItems(extractActionItems(aUnits), extractActionItems(bUnits));

  const result: AnalysisResult = {
    addedConcepts: addedConceptsEvidence.map((item) => item.phrase),
    removedConcepts: removedConceptsEvidence.map((item) => item.phrase),
    renamedIdeas: detectRenameIdeas([
      ...pairs,
      ...unmatchedA.flatMap((a) =>
        unmatchedB.map((b) => ({
          a,
          b,
          similarity: 0,
        })),
      ),
    ]),
    changedCommitments: changedCommitmentsEvidence.map((item) => item.summary),
    actionItemsAdded: actionDiff.added,
    actionItemsRemoved: actionDiff.removed,
    possibleContradictions: possibleContradictionsEvidence.map((item) => item.summary),
    addedConceptsEvidence,
    removedConceptsEvidence,
    changedCommitmentsEvidence,
    possibleContradictionsEvidence,
    summary: "",
  };

  result.summary = buildSummary(result);

  return result;
}
