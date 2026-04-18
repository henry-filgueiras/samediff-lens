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
  TaskStatusChangeFinding,
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
  /**
   * Optional payload for kinds that need extra context the title
   * template can't reconstruct from before/after alone — currently only
   * task transitions, where we want the human-readable subject and the
   * specific transition tag.
   */
  taskTransition?: TaskStatusChangeFinding["transition"];
  taskSubject?: string;
  /**
   * Severity-downgrade word pair. Set when classifier detects a
   * harsh-consequence → soft-consequence shift (error → warning,
   * fatal → advisory, reject → ignore, etc.). The title template
   * uses these labels verbatim.
   */
  severityHarsh?: string;
  severitySoft?: string;
};

// ── Severity-downgrade detection ──────────────────────────────────
// Paired lexicon of harsh consequence terms and the soft replacements
// they tend to drift toward. When a finding's BEFORE matches a harsh
// pattern AND its AFTER matches the corresponding soft pattern AND the
// harsh term is *gone* from AFTER, it's a severity downgrade. Catches
// the common "error → warning" and "fatal → advisory" diff patterns
// that the engine would otherwise frame as policy reversals.
const SEVERITY_PAIRS: Array<[harsh: RegExp, soft: RegExp, harshLabel: string, softLabel: string]> = [
  [/\berrors?\b/i,                /\b(warning|warn|warns|notice|advisory|hint)s?\b/i, "error",   "warning"],
  [/\bfatal\b/i,                  /\b(soft|warning|advisory|recoverable)\b/i,         "fatal",   "soft"],
  [/\b(fail|fails|failure|fails?)\b/i, /\b(skip|skips|skipped|ignore|ignores|ignored|warn|warns|warning)\b/i, "fail", "skip"],
  [/\b(block|blocks|blocked|blocking)\b/i, /\b(advisory|warn|warns|warning|notice|allow|allows|allowed)\b/i, "block", "advisory"],
  [/\b(reject|rejects|rejected)\b/i, /\b(warn|warns|warning|ignore|ignores|allow|allows|accept|accepts)\b/i,  "reject", "warn"],
  [/\b(crash|crashes|crashed)\b/i,  /\b(log|logs|logged|warn|warns|recover|recovers|recovered)\b/i,            "crash",  "log"],
  [/\b(abort|aborts|aborted)\b/i,   /\b(retry|retries|continue|continues|warn|warns|recover|recovers)\b/i,    "abort",  "continue"],
  [/\b(panic|panics|panicked)\b/i,  /\b(recover|recovers|recovered|warn|warns|return|returns)\b/i,            "panic",  "recover"],
  [/\bdeny|denies|denied\b/i,       /\b(warn|warns|allow|allows|accept|accepts)\b/i,                          "deny",   "warn"],
];

type SeverityShift = { harsh: string; soft: string };

export function detectSeverityDowngrade(
  before: string | null | undefined,
  after: string | null | undefined,
): SeverityShift | null {
  if (!before || !after) return null;
  for (const [h, s, hLabel, sLabel] of SEVERITY_PAIRS) {
    // Must be present in BEFORE, present in AFTER, AND gone from AFTER
    // (if both still contain the harsh word, it didn't downgrade — it
    // was rephrased or expanded).
    if (h.test(before) && s.test(after) && !h.test(after)) {
      return { harsh: hLabel, soft: sLabel };
    }
  }
  return null;
}

export function classifyAll(diff: DiffResult): ClassifiedFinding[] {
  const out: ClassifiedFinding[] = [];

  diff.findings.commitmentShifts.forEach((f, i) => out.push(classifyCommitmentShift(f, i)));
  diff.findings.contradictions.forEach((f, i) => out.push(classifyContradiction(f, i)));
  diff.findings.conceptRenames.forEach((f, i) => out.push(classifyRename(f, i)));
  diff.findings.addedConcepts.forEach((f, i) => out.push(classifyAdded(f, i)));
  diff.findings.removedConcepts.forEach((f, i) => out.push(classifyRemoved(f, i)));

  // Task status changes are the first-class signal for checklist drift.
  // We deliberately ignore the legacy actionItemsAdded / actionItemsRemoved
  // buckets here — they would double-emit issues for the simple add/remove
  // cases (which the status-change finding already covers via the
  // `added-*` / `removed-*` transitions). Those buckets remain populated
  // in the DiffResult for backward-compat with renderers and consumers
  // that still want flat string lists.
  (diff.findings.actionItemsStatusChanges ?? []).forEach((f, i) =>
    out.push(classifyTaskStatusChange(f, i)),
  );

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

  // Severity downgrade overrides — "rustdoc should give an error" →
  // "rustdoc should give a warning" reads as "Severity downgraded:
  // error → warning", not "commitment weakened" or "implied contract".
  const sev = detectSeverityDowngrade(f.evidence.before, f.evidence.after);
  return {
    ref: { category: "commitment-shift", index },
    kind: sev ? "severity-downgraded" : kind,
    before: f.evidence.before,
    after: f.evidence.after,
    triggers: t,
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
    severityHarsh: sev?.harsh,
    severitySoft: sev?.soft,
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

  // Severity-downgrade override: when the contradiction's polarity
  // flip is really a harsh→soft consequence shift (error → warning,
  // reject → ignore), framing it as "policy reversed" obscures the
  // actual operational story. Severity-downgraded survives the
  // weak-anchor demotion below — a downgrade is meaningful regardless
  // of how many words the two sentences happen to share.
  const sev = detectSeverityDowngrade(f.evidence.before, f.evidence.after);
  if (sev) {
    kind = "severity-downgraded";
  } else {
    // Weak-contradiction demotion: when a non-high-confidence
    // contradiction has only 1-2 strong shared anchors, the engine
    // probably paired two sentences that share generic words rather
    // than a real subject. Demoting these to "observation" keeps them
    // findable in the quiet bucket but stops them from headlining.
    //
    // Empirical: dogfood-auditing text/1946-intra-rustdoc-links.md
    // produced a steady stream of FPs (steps 3, 4, 5, 6, 7, 10) that
    // all fit this shape. Real legitimate contradictions (e.g.
    // example 06's same-section Performance reversal) clear the floor
    // because they share 3+ topic-bearing tokens.
    const anchorCount = f.evidence.anchors.length;
    if (f.confidence !== "high" && anchorCount < 3) {
      kind = "observation";
    }
  }

  return {
    ref: { category: "contradiction", index },
    kind,
    before: f.evidence.before,
    after: f.evidence.after,
    triggers: [`contradiction:${f.reason}`],
    anchors: f.provenance?.anchors ?? [],
    confidence: f.confidence,
    severityHarsh: sev?.harsh,
    severitySoft: sev?.soft,
  };
}

function classifyRename(f: ConceptRenameFinding, index: number): ClassifiedFinding {
  // Renames like "issue an error" → "issue a warning" are textbook
  // severity downgrades. Detect on the from/to strings directly.
  const sev = detectSeverityDowngrade(f.from, f.to);
  return {
    ref: { category: "concept-rename", index },
    kind: sev ? "severity-downgraded" : "rename",
    before: f.from,
    after: f.to,
    triggers: f.note ? [f.note] : [],
    anchors: f.provenance?.anchors ?? [],
    confidence: f.confidence,
    severityHarsh: sev?.harsh,
    severitySoft: sev?.soft,
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

/**
 * Map a TaskStatusChangeFinding's transition tag onto an IssueKind.
 *   completed / reopened   → first-class strong individual signal
 *   added-* / removed-*    → task-scope-shift (churn)
 *
 * The transition tag and verbatim subject are stashed on the
 * ClassifiedFinding so buildIssue can emit the precise title.
 */
function classifyTaskStatusChange(
  f: TaskStatusChangeFinding,
  index: number,
): ClassifiedFinding {
  let kind: IssueKind;
  switch (f.transition) {
    case "completed":         kind = "task-completed"; break;
    case "reopened":          kind = "task-reopened"; break;
    case "added-open":
    case "added-completed":
    case "removed-open":
    case "removed-completed": kind = "task-scope-shift"; break;
  }
  return {
    ref: { category: "task-status-change", index },
    kind,
    before: f.evidence.before,
    after: f.evidence.after,
    triggers: [`task-transition:${f.transition}`],
    anchors: f.provenance?.anchors ?? [],
    confidence: "medium",
    taskTransition: f.transition,
    taskSubject: f.subject,
  };
}

