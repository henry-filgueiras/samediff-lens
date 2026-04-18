/**
 * Title and subject templates for narrative issues.
 *
 * HARD RULE: every word in a generated title or subject must already appear
 * in the underlying finding's evidence (before/after/triggers/anchor label),
 * *or* come from a small fixed category vocabulary ("Commitment weakened",
 * "Requirement reversed", etc.). We never synthesise domain content.
 *
 * If a template can't extract a usable subject, it falls back to a
 * subject-less form rather than inventing one.
 */

import { detectTopicNoun } from "./topics";

export function shortPhrase(text: string | null | undefined, max = 80): string {
  if (!text) return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "\u2026";
}

/**
 * Extract a short subject phrase, verbatim from evidence.
 *
 * Preference order:
 *   1. Topic noun present in evidence (e.g. "SLA", "rate limit", "audit")
 *   2. Backtick-quoted identifier (e.g. `shipping_address`, `items`)
 *   3. First inline-code span
 *   4. Empty string — we do not invent.
 */
export function extractSubject(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  const topic = detectTopicNoun(after) ?? detectTopicNoun(before);
  if (topic) return topic;

  const src = (after ?? "") + " \u23AF " + (before ?? "");
  const codeMatch = src.match(/`([^`\n]{1,40})`/);
  if (codeMatch) return codeMatch[1];

  return "";
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Title templates ─────────────────────────────────────────────────

export function titleCommitmentStrengthening(before: string, after: string): string {
  const subj = extractSubject(before, after);
  const delta = `${shortPhrase(before, 45)} \u2192 ${shortPhrase(after, 45)}`;
  return subj
    ? `Commitment strengthened on ${subj}: ${delta}`
    : `Commitment strengthened: ${delta}`;
}

export function titleCommitmentWeakening(before: string, after: string): string {
  const subj = extractSubject(before, after);
  const delta = `${shortPhrase(before, 45)} \u2192 ${shortPhrase(after, 45)}`;
  return subj
    ? `Commitment weakened on ${subj}: ${delta}`
    : `Commitment weakened: ${delta}`;
}

export function titleCommitmentReversal(before: string, after: string): string {
  const subj = extractSubject(before, after);
  const delta = `${shortPhrase(before, 45)} vs ${shortPhrase(after, 45)}`;
  return subj
    ? `Requirement reversed on ${subj}: ${delta}`
    : `Requirement reversed: ${delta}`;
}

export function titlePolicyReversal(before: string, after: string): string {
  const subj = extractSubject(before, after);
  const delta = `${shortPhrase(before, 45)} \u2192 ${shortPhrase(after, 45)}`;
  return subj
    ? `Policy reversed on ${subj}: ${delta}`
    : `Policy reversed: ${delta}`;
}

export function titleGuaranteeRemoved(
  before: string,
  after: string | null,
): string {
  const subj = extractSubject(before, after);
  if (!after) {
    return subj
      ? `${cap(subj)} guarantee removed: ${shortPhrase(before, 85)}`
      : `Guarantee removed: ${shortPhrase(before, 85)}`;
  }
  const delta = `${shortPhrase(before, 45)} \u2192 ${shortPhrase(after, 45)}`;
  return subj
    ? `${cap(subj)} guarantee weakened: ${delta}`
    : `Guarantee weakened: ${delta}`;
}

export function titleConstraintIntroduced(
  before: string | null,
  after: string,
): string {
  const subj = extractSubject(before, after);
  if (!before) {
    return subj
      ? `${cap(subj)} constraint introduced: ${shortPhrase(after, 85)}`
      : `Constraint introduced: ${shortPhrase(after, 85)}`;
  }
  return subj
    ? `${cap(subj)} constraint tightened: ${shortPhrase(after, 85)}`
    : `Constraint tightened: ${shortPhrase(after, 85)}`;
}

export function titleScopeNarrowed(before: string, after: string): string {
  const subj = extractSubject(before, after);
  const delta = `${shortPhrase(before, 45)} \u2192 ${shortPhrase(after, 45)}`;
  return subj
    ? `Scope narrowed on ${subj}: ${delta}`
    : `Scope narrowed: ${delta}`;
}

/**
 * Severity downgrade title — uses the matched harsh/soft word pair
 * verbatim. Subject (extracted from evidence) names what the
 * downgrade applies to: "Severity downgraded on auth: error → warning".
 */
export function titleSeverityDowngraded(
  harsh: string,
  soft: string,
  before: string,
  after: string,
): string {
  const subj = extractSubject(before, after);
  return subj
    ? `Severity downgraded on ${subj}: ${harsh} \u2192 ${soft}`
    : `Severity downgraded: ${harsh} \u2192 ${soft}`;
}

export function titleTaskShift(added: boolean, desc: string): string {
  return added ? `Task added: ${shortPhrase(desc, 85)}` : `Task removed: ${shortPhrase(desc, 85)}`;
}

/**
 * Title for the six checklist transitions. Subject is the task body
 * verbatim (markers already stripped by the engine).
 */
export function titleTaskTransition(
  transition:
    | "completed"
    | "reopened"
    | "added-open"
    | "added-completed"
    | "removed-open"
    | "removed-completed",
  subject: string,
): string {
  const s = shortPhrase(subject, 100);
  switch (transition) {
    case "completed":          return `Task completed: ${s}`;
    case "reopened":           return `Task reopened: ${s}`;
    case "added-open":         return `Task added: ${s}`;
    case "added-completed":    return `Task added (already completed): ${s}`;
    case "removed-open":       return `Task removed: ${s}`;
    case "removed-completed":  return `Completed task removed: ${s}`;
  }
}

export function titleRename(from: string, to: string): string {
  return `Concept renamed: ${shortPhrase(from, 40)} \u2192 ${shortPhrase(to, 40)}`;
}
