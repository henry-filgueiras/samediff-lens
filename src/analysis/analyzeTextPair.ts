import type { ActionItemProvenance, AnalysisResult } from "./types";
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
import {
  anchorBothSides,
  anchorOnSide,
  makeProvenanceContext,
  type ProvenanceContext,
} from "./provenance";

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

  // ── Enrich with provenance ────────────────────────────────────────
  // We use the *original* (untrimmed) source texts so line numbers line
  // up with what a user would see in their editor / git blame / GitHub.
  const ctx = makeProvenanceContext(versionA, versionB);
  enrichProvenance(result, ctx);

  result.summary = buildSummary(result);

  return result;
}

function enrichProvenance(result: AnalysisResult, ctx: ProvenanceContext): void {
  // Commitment shifts: before + after anchors (dual)
  for (const ev of result.changedCommitmentsEvidence) {
    const p = anchorBothSides(ctx, ev.versionA, ev.versionB);
    if (p) ev.provenance = p;
  }

  // Contradictions: before + after anchors (dual)
  for (const ev of result.possibleContradictionsEvidence) {
    const p = anchorBothSides(ctx, ev.versionA, ev.versionB);
    if (p) ev.provenance = p;
  }

  // Renames: dual when both versionA and versionB are available
  for (const r of result.renamedIdeas) {
    if (r.versionA && r.versionB) {
      const p = anchorBothSides(ctx, r.versionA, r.versionB);
      if (p) r.provenance = p;
    } else if (r.versionB) {
      const p = anchorOnSide(ctx, "after", r.versionB);
      if (p) r.provenance = p;
    } else if (r.versionA) {
      const p = anchorOnSide(ctx, "before", r.versionA);
      if (p) r.provenance = p;
    }
  }

  // Added concepts: after-side only
  for (const ev of result.addedConceptsEvidence) {
    const p = anchorOnSide(ctx, "after", ev.sourceClause, ev.phrase);
    if (p) ev.provenance = p;
  }

  // Removed concepts: before-side only
  for (const ev of result.removedConceptsEvidence) {
    const p = anchorOnSide(ctx, "before", ev.sourceClause, ev.phrase);
    if (p) ev.provenance = p;
  }

  // Action items: sidecar map keyed by description text.
  // Search the raw action-item string in the appropriate side; it usually
  // appears inside a list bullet so the whole line encompasses it.
  result.actionItemsAddedProvenance = result.actionItemsAdded.map(
    (description): ActionItemProvenance => {
      const prov = anchorOnSide(ctx, "after", description);
      return prov ? { description, provenance: prov } : { description };
    },
  );
  result.actionItemsRemovedProvenance = result.actionItemsRemoved.map(
    (description): ActionItemProvenance => {
      const prov = anchorOnSide(ctx, "before", description);
      return prov ? { description, provenance: prov } : { description };
    },
  );
}
