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

// ── Checklist semantics ─────────────────────────────────────────────
// Markdown checklists are a structured mini-language. Treating
// `[ ]` and `[x]` as opaque strings makes a completion read as a
// task removal *and* a different task addition, which is wrong.
// `compareActionItems` normalises the body and emits a richer
// TaskStatusChange whose transition is the human-readable signal.

export type TaskState = "open" | "completed";

export type TaskTransition =
  | "completed"           // [ ] → [x]
  | "reopened"            // [x] → [ ]
  | "added-open"          // absent → [ ]
  | "added-completed"     // absent → [x]
  | "removed-open"        // [ ] → absent
  | "removed-completed";  // [x] → absent

export type TaskStatusChange = {
  /** Body of the task with checkbox / TODO marker stripped. */
  subject: string;
  transition: TaskTransition;
  beforeState: TaskState | null;
  afterState: TaskState | null;
  /** Original raw line from each side (when present). */
  beforeRaw: string | null;
  afterRaw: string | null;
  provenance?: FindingProvenance;
};

export type AnalysisResult = {
  addedConcepts: string[];
  removedConcepts: string[];
  renamedIdeas: RenamedIdea[];
  changedCommitments: string[];
  actionItemsAdded: string[];
  actionItemsRemoved: string[];
  /**
   * First-class checklist transitions. Includes simple add/remove cases
   * (absent ↔ [ ] / [x]) AND the toggle cases ([ ] ↔ [x]) that
   * `actionItemsAdded` / `actionItemsRemoved` cannot represent. Toggle
   * cases are NOT mirrored back into the add/remove buckets — a
   * completion is a status change, not an add+remove pair.
   */
  actionItemsStatusChanges: TaskStatusChange[];
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
  /**
   * Most-specific topical context the unit sits inside, lowercased and
   * normalised (no markdown, single-spaced). Filled by `extractUnits`:
   *   - inline `**Topic**:` prefix on the line wins (e.g. "performance"
   *     for `1. **Performance**: Latency overhead should not...`)
   *   - else most recent `# / ## / ###` heading
   *   - else null
   * Used by contradiction detection to refuse cross-topic pairings
   * supported only by generic modal/structural overlap.
   */
  section?: string | null;
};

export type MatchedPair = {
  a: Unit;
  b: Unit;
  similarity: number;
};
