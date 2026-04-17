/**
 * Classify raw DiffResult findings into narrative IssueKinds.
 *
 * Purely table-driven off existing structured fields:
 *   - commitment-shift.evidence.triggers
 *   - contradiction.reason
 *   - concept-rename.confidence
 *   - topic lexicon match for added/removed concepts (so "100 requests per
 *     minute" becomes a constraint-introduced Issue, but "during the beta
 *     period" stays as a plain observation)
 *
 * No text synthesis. No engine changes. Every classified finding keeps
 * a pointer back into the DiffResult via FindingRef.
 */

import type {
  DiffResult,
  CommitmentShiftFinding,
  ContradictionFinding,
  ConceptFinding,
  ConceptRenameFinding,
  ActionItemFinding,
} from "../../cli/resultModel";
import type { SourceAnchor } from "../types";
import type { IssueKind, FindingRef, Confidence } from "./types";
import { detectTopicNoun } from "./topics";

export type ClassifiedFinding = {
  ref: FindingRef;
  kind: IssueKind;
  before: string | null;
  after: string | null;
  triggers: string[];
  anchors: SourceAnchor[];
  confidence: Confidence;
};

export function classifyAll(diff: DiffResult): ClassifiedFinding[] {
  const out: ClassifiedFinding[] = [];

  diff.findings.commitmentShifts.forEach((f, i) => out.push(classifyCommitmentShift(f, i)));
  diff.findings.contradictions.forEach((f, i) => out.push(classifyContradiction(f, i)));
  diff.findings.conceptRenames.forEach((f, i) => out.push(classifyRename(f, i)));
  diff.findings.addedConcepts.forEach((f, i) => out.push(classifyAdded(f, i)));
  diff.findings.removedConcepts.forEach((f, i) => out.push(classifyRemoved(f, i)));
  diff.findings.actionItemsAdded.forEach((f, i) => out.push(classifyActionAdded(f, i)));
  diff.findings.actionItemsRemoved.forEach((f, i) => out.push(classifyActionRemoved(f, i)));

  return out;
}

function classifyCommitmentShift(f: CommitmentShiftFinding, index: number): ClassifiedFinding {
  const t = f.evidence.triggers;
  let kind: IssueKind = "observation";
  // Priority: explicit modal escalation > narrowing > operational detail
  if (t.includes("strengthens the commitment")) kind = "commitment-strengthening";
  else if (t.includes("softens the commitment")) kind = "commitment-weakening";
  else if (t.includes("narrows scope")) kind = "scope-narrowed";
  else if (t.includes("adds behavioral directives")) kind = "constraint-introduced";
  else if (t.includes("adds epistemic guardrails")) kind = "constraint-introduced";
  else if (t.includes("adds operational detail")) kind = "constraint-introduced";
  else if (t.includes("changes the implied contract")) kind = "observation";

  return {
    ref: { category: "commitment-shift", index },
    kind,
    before: f.evidence.before,
    after: f.evidence.after,
    triggers: t,
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
  };
}

function classifyContradiction(f: ContradictionFinding, index: number): ClassifiedFinding {
  let kind: IssueKind;
  switch (f.reason) {
    case "required-optional-flip": kind = "commitment-reversal"; break;
    case "negation-flip":          kind = "policy-reversal"; break;
    case "storage-to-distribution": kind = "guarantee-removed"; break;
    case "narrowing":              kind = "scope-narrowed"; break;
    default:                       kind = "observation";
  }
  return {
    ref: { category: "contradiction", index },
    kind,
    before: f.evidence.before,
    after: f.evidence.after,
    triggers: [`contradiction:${f.reason}`],
    anchors: f.provenance?.anchors ?? [],
    confidence: f.confidence,
  };
}

function classifyRename(f: ConceptRenameFinding, index: number): ClassifiedFinding {
  return {
    ref: { category: "concept-rename", index },
    kind: "rename",
    before: f.from,
    after: f.to,
    triggers: f.note ? [f.note] : [],
    anchors: f.provenance?.anchors ?? [],
    confidence: f.confidence,
  };
}

/**
 * A bare added/removed concept is only promoted to constraint-introduced /
 * guarantee-removed if the evidence shows topic nouns or numeric / capacity
 * language. Otherwise it's an observation — the finding still appears in
 * the report, just in the quiet bucket. Guards against turning every
 * additive phrase into a scary headline.
 */
function isSubstantiveText(text: string | null): boolean {
  if (!text) return false;
  if (detectTopicNoun(text)) return true;
  if (/\b\d+\s*(per|\/)\s*(second|minute|hour|day|request|req|user|customer|account)\b/i.test(text)) return true;
  if (/\b(max|maximum|min|minimum|cap(ped)?|limit(ed)?|restrict(ed)?|only|required|must|forbidden|prohibited|never)\b/i.test(text)) return true;
  if (/\b\d{2,}\b/.test(text) && /\b(character|chars|bytes|items|requests|seconds|minutes|hours)\b/i.test(text)) return true;
  return false;
}

/**
 * Substantive-removal check runs against the **phrase** (not the source
 * clause). Reason: when the engine extracts a removed concept, the source
 * clause was often rewritten, and its topic words may appear in the
 * replacement too. The specific removed phrase is what we can make a claim
 * about.
 *
 * Rejects:
 *   - Phrases starting with a negation — removing "not rate-limited"
 *     introduces rate limiting, it doesn't remove a guarantee.
 *   - Phrases that are purely temporal qualifiers (during, after, while…).
 *     These are almost always sentence-rewrite artefacts.
 */
function isSubstantiveRemoval(phrase: string | null): boolean {
  if (!phrase) return false;
  if (/^\s*(not|no|never|without|n['\u2019]t)\b/i.test(phrase)) return false;
  if (/^\s*(during|after|before|while|for|in|at|within|until|since)\b/i.test(phrase)) return false;
  if (detectTopicNoun(phrase)) return true;
  if (/\b(guarantee|commitment|contract|backup|durable|encrypted|signed|verified|validated|retain(ed|s)?|audit|log(ging|s)?)\b/i.test(phrase)) return true;
  return false;
}

function classifyAdded(f: ConceptFinding, index: number): ClassifiedFinding {
  // For added concepts, both phrase and source clause are from the new
  // version and can carry the signal. Either one substantive is enough.
  const substantive =
    isSubstantiveText(f.phrase) || isSubstantiveText(f.sourceClause);
  return {
    ref: { category: "added-concept", index },
    kind: substantive ? "constraint-introduced" : "observation",
    before: null,
    after: f.sourceClause ?? f.phrase,
    triggers: [f.phrase],
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
  };
}

function classifyRemoved(f: ConceptFinding, index: number): ClassifiedFinding {
  const substantive = isSubstantiveRemoval(f.phrase);
  return {
    ref: { category: "removed-concept", index },
    kind: substantive ? "guarantee-removed" : "observation",
    before: f.sourceClause ?? f.phrase,
    after: null,
    triggers: [f.phrase],
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
  };
}

function classifyActionAdded(f: ActionItemFinding, index: number): ClassifiedFinding {
  return {
    ref: { category: "action-item-added", index },
    kind: "task-scope-shift",
    before: null,
    after: f.description,
    triggers: ["action-added"],
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
  };
}

function classifyActionRemoved(f: ActionItemFinding, index: number): ClassifiedFinding {
  return {
    ref: { category: "action-item-removed", index },
    kind: "task-scope-shift",
    before: f.description,
    after: null,
    triggers: ["action-removed"],
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
  };
}
