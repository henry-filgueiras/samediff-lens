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
      summary: "No text provided yet. Paste two versions or load a golden example to inspect drift.",
    };
  }

  const aUnits = extractUnits(trimmedA);
  const bUnits = extractUnits(trimmedB);
  const pairs = matchUnits(aUnits, bUnits);
  const unmatchedA = getUnmatchedUnits(aUnits, pairs, "a");
  const unmatchedB = getUnmatchedUnits(bUnits, pairs, "b");

  const actionDiff = compareActionItems(extractActionItems(aUnits), extractActionItems(bUnits));

  const result: AnalysisResult = {
    addedConcepts: detectConceptChanges(bUnits, aUnits),
    removedConcepts: detectConceptChanges(aUnits, bUnits),
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
    changedCommitments: detectChangedCommitments(pairs),
    actionItemsAdded: actionDiff.added,
    actionItemsRemoved: actionDiff.removed,
    possibleContradictions: detectPossibleContradictions(aUnits, bUnits),
    summary: "",
  };

  result.summary = buildSummary(result);

  return result;
}
