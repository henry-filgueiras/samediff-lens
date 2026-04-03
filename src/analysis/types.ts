export type Confidence = "low" | "medium" | "high";

export type RenamedIdea = {
  from: string;
  to: string;
  confidence: Confidence;
  note?: string;
};

export type AnalysisResult = {
  addedConcepts: string[];
  removedConcepts: string[];
  renamedIdeas: RenamedIdea[];
  changedCommitments: string[];
  actionItemsAdded: string[];
  actionItemsRemoved: string[];
  possibleContradictions: string[];
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
