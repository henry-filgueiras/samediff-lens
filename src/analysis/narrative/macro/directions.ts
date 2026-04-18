/**
 * Determine the operational direction of an Issue.
 *
 * Most IssueKinds map cleanly onto a direction:
 *   commitment-weakening / guarantee-removed   → weakening
 *   commitment-strengthening / scope-narrowed  → tightening
 *   constraint-introduced                       → tightening
 *
 * `commitment-reversal` and `policy-reversal` need a peek at the evidence
 * because either side of the flip could be the "stronger" one. We check
 * for required↔optional and modal-strength flips against the before/after
 * text, all matched verbatim — no synthesis.
 */

import type { Issue } from "../types";

export type Direction = "weakening" | "tightening" | "neutral";

const NEGATING_AFTER = /\b(must not|may not|never|forbidden|prohibited|no longer)\b/i;
const NEGATING_BEFORE = /\b(must not|may not|never|forbidden|prohibited)\b/i;
const PERMISSIVE_BEFORE = /\b(may|can|allowed|permitted)\b/i;
const PERMISSIVE_AFTER = /\b(may|can|allowed|permitted)\b/i;
const MANDATORY = /\b(must|required|always|shall)\b/i;
const PERMISSIVE_MODAL = /\b(may|might|can|could)\b/i;
const SOFT_MODAL = /\b(should|recommended)\b/i;

export function direction(issue: Issue): Direction {
  switch (issue.kind) {
    case "commitment-weakening":
    case "guarantee-removed":
    case "task-reopened":
      return "weakening";

    case "commitment-strengthening":
    case "constraint-introduced":
    case "scope-narrowed":
    case "task-completed":
      return "tightening";

    case "commitment-reversal":
    case "policy-reversal":
      return reversalDirection(issue);

    default:
      return "neutral";
  }
}

function reversalDirection(issue: Issue): Direction {
  const before = (issue.evidence.before ?? "").toLowerCase();
  const after = (issue.evidence.after ?? "").toLowerCase();
  if (!before || !after) return "neutral";

  // required → optional is the canonical weakening.
  if (/\brequired\b/.test(before) && /\boptional\b/.test(after)) return "weakening";
  if (/\boptional\b/.test(before) && /\brequired\b/.test(after)) return "tightening";

  // Negation pivots: introducing prohibition is tightening; removing it is weakening.
  const beforeNeg = NEGATING_BEFORE.test(before);
  const afterNeg = NEGATING_AFTER.test(after);
  if (!beforeNeg && afterNeg) return "tightening";
  if (beforeNeg && !afterNeg) return "weakening";

  // Permissive → mandatory is tightening; mandatory → permissive is weakening.
  const beforeMandatory = MANDATORY.test(before) && !PERMISSIVE_BEFORE.test(before);
  const afterMandatory = MANDATORY.test(after) && !PERMISSIVE_AFTER.test(after);
  if (!beforeMandatory && afterMandatory) return "tightening";
  if (beforeMandatory && !afterMandatory) return "weakening";

  // Modal strength: must → should is weakening; should → must is tightening.
  const beforeModal =
    MANDATORY.test(before) ? "mandatory"
    : SOFT_MODAL.test(before) ? "soft"
    : PERMISSIVE_MODAL.test(before) ? "permissive"
    : "unknown";
  const afterModal =
    MANDATORY.test(after) ? "mandatory"
    : SOFT_MODAL.test(after) ? "soft"
    : PERMISSIVE_MODAL.test(after) ? "permissive"
    : "unknown";
  const modalRank = (m: string) =>
    m === "mandatory" ? 3 : m === "soft" ? 2 : m === "permissive" ? 1 : 0;
  if (modalRank(afterModal) < modalRank(beforeModal)) return "weakening";
  if (modalRank(afterModal) > modalRank(beforeModal)) return "tightening";

  return "neutral";
}
