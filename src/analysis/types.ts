export type Confidence = "low" | "medium" | "high";

export type ConceptEvidence = {
  phrase: string;
  sourceClause: string;
};

export type CommitmentEvidence = {
  summary: string;
  versionA: string;
  versionB: string;
  triggers: string[];
};

export type ContradictionEvidence = {
  summary: string;
  anchors: string[];
  versionA: string;
  versionB: string;
};

export type RenamedIdea = {
  from: string;
  to: string;
  confidence: Confidence;
  note?: string;
  sharedContext?: string[];
  versionA?: string;
  versionB?: string;
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
