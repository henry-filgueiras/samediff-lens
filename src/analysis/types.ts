export type Confidence = "low" | "medium" | "high";

// ── Provenance / source anchoring ────────────────────────────────────
// Line numbers and columns are 1-based. snippet, label, quality are all
// optional — the model stays honest when the tool can't locate something.

export type AnchorQuality = "exact" | "approximate" | "derived";

export type SourceAnchor = {
  side: "before" | "after";
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
  label?: string;
  quality?: AnchorQuality;
};

export type FindingProvenance = {
  anchors: SourceAnchor[];
  quality?: AnchorQuality;
  note?: string;
};

/** Offset-to-line index, cached for repeated lookups into a single text. */
export type LineIndex = {
  text: string;
  lineStarts: number[];
};

// ── Evidence types ───────────────────────────────────────────────────
// Each evidence shape gains an optional `provenance` field. The engine
// doesn't populate it; `analyzeTextPair` enriches results post-hoc.

export type ConceptEvidence = {
  phrase: string;
  sourceClause: string;
  provenance?: FindingProvenance;
};

export type CommitmentEvidence = {
  summary: string;
  versionA: string;
  versionB: string;
  triggers: string[];
  provenance?: FindingProvenance;
};

export type ContradictionEvidence = {
  summary: string;
  anchors: string[];
  versionA: string;
  versionB: string;
  provenance?: FindingProvenance;
};

export type RenamedIdea = {
  from: string;
  to: string;
  confidence: Confidence;
  note?: string;
  sharedContext?: string[];
  versionA?: string;
  versionB?: string;
  provenance?: FindingProvenance;
};

/**
 * Action-item string decorated with optional provenance. The analysis
 * engine still emits plain strings for `actionItemsAdded` / `Removed`,
 * so these live in a sidecar map keyed by description.
 */
export type ActionItemProvenance = {
  description: string;
  provenance?: FindingProvenance;
};

export type AnalysisResult = {
  addedConcepts: string[];
  removedConcepts: string[];
  renamedIdeas: RenamedIdea[];
  changedCommitments: string[];
  actionItemsAdded: string[];
  actionItemsRemoved: string[];
  possibleContradictions: string[];
  addedConceptsEvidence: ConceptEvidence[];
  removedConceptsEvidence: ConceptEvidence[];
  changedCommitmentsEvidence: CommitmentEvidence[];
  possibleContradictionsEvidence: ContradictionEvidence[];
  /** Optional provenance sidecar for action items, keyed by description. */
  actionItemsAddedProvenance?: ActionItemProvenance[];
  actionItemsRemovedProvenance?: ActionItemProvenance[];
  summary: string;
};

export type Unit = {
  raw: string;
  normalized: string;
  tokens: string[];
  contentTokens: string[];
  isActionItem: boolean;
  isCommitmentLike: boolean;
  isDirectiveLike: boolean;
};

export type MatchedPair = {
  a: Unit;
  b: Unit;
  similarity: number;
};
