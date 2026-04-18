/**
 * Atomic theme catalog. The macro layer's vocabulary of "patterns
 * worth naming". Each entry is a hand-tuned theme with a fixed
 * headline string and a deterministic predicate.
 *
 * Conservative thresholds (per design): atoms need ≥3 cited issues
 * before they can be promoted to a Thesis on their own. Composites
 * (in composites.ts) can fire with smaller per-atom counts as long
 * as the union of their cited issues is also ≥3.
 *
 * Two intentional gaps left for follow-on work:
 *   - "Ownership shifted without clear control transfer" — needs
 *     ownership/role detection that doesn't exist in the engine yet.
 *   - "Tightening" themes (e.g. commitments-tightened-broadly) — easy
 *     to add later mirroring the weakening side. Scope creep for now.
 */

import type { AtomicTheme } from "./types";
import {
  COMPLIANCE_TOPICS,
  PERFORMANCE_TOPICS,
  RELIABILITY_TOPICS,
  SECURITY_TOPICS,
  STAGING_DEFERRAL_PATTERN,
} from "./topicCategories";
import { direction } from "./directions";

const subjectOf = (i: { subject: string }) => i.subject.toLowerCase();

const evidenceText = (i: { evidence: { before: string | null; after: string | null } }) =>
  ((i.evidence.before ?? "") + " " + (i.evidence.after ?? "")).toLowerCase();

export const ATOMIC_THEMES: AtomicTheme[] = [
  {
    id: "security-weakened",
    family: "security",
    direction: "weakening",
    headline: "Security posture weakened",
    minIssues: 3,
    matches: (i) =>
      SECURITY_TOPICS.has(subjectOf(i)) && direction(i) === "weakening",
  },
  {
    id: "compliance-protections-relaxed",
    family: "compliance",
    direction: "weakening",
    headline: "Compliance boundary weakened",
    minIssues: 3,
    matches: (i) =>
      COMPLIANCE_TOPICS.has(subjectOf(i)) && direction(i) === "weakening",
  },
  {
    id: "reliability-guarantees-removed",
    family: "reliability",
    direction: "weakening",
    headline: "Reliability guarantees relaxed",
    minIssues: 3,
    matches: (i) =>
      RELIABILITY_TOPICS.has(subjectOf(i)) && direction(i) === "weakening",
  },
  {
    id: "performance-commitments-softened",
    family: "performance",
    direction: "weakening",
    headline: "Performance commitments softened",
    minIssues: 3,
    matches: (i) =>
      PERFORMANCE_TOPICS.has(subjectOf(i)) && direction(i) === "weakening",
  },
  {
    id: "staging-deferral-pattern",
    family: "rollout",
    direction: "deferral",
    headline: "Production controls deferred to beta period",
    minIssues: 3,
    // Lexical match — direction is implicit (deferral). Issue's evidence
    // (either side) must contain the staging-deferral lexicon.
    matches: (i) => STAGING_DEFERRAL_PATTERN.test(evidenceText(i)),
  },
];

/**
 * Index for quick lookup. Keeping it derivable rather than a const
 * Map keeps the source-of-truth as the array above.
 */
export function findAtom(id: string): AtomicTheme | undefined {
  return ATOMIC_THEMES.find((a) => a.id === id);
}
