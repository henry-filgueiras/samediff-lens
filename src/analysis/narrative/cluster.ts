/**
 * Conservative subject-based clustering.
 *
 * Collapses multiple classified findings that share a subject into a single
 * Issue so the narrative doesn't drown in "5 separate commitment shifts on
 * the same field". A finding with no extractable subject is a cluster of
 * one.
 *
 * Rules:
 *   - Same IssueKind family only (never merges a reversal with a rename).
 *   - Subject must match exactly (case-insensitive, already normalised by
 *     extractSubject which prefers topic nouns and backtick identifiers).
 *   - Contradictions are never clustered — each contradiction is already a
 *     strong individual accusation. Merging them would dilute that.
 *   - Renames and task-scope-shifts are never clustered.
 */

import type { ClassifiedFinding } from "./classify";
import type { IssueKind } from "./types";
import { extractSubject } from "./templates";

export type Cluster = {
  subject: string;
  members: ClassifiedFinding[];
};

const CLUSTERABLE_KINDS = new Set<IssueKind>([
  "commitment-strengthening",
  "commitment-weakening",
  "scope-narrowed",
  "constraint-introduced",
  "guarantee-removed",
]);

export function clusterFindings(all: ClassifiedFinding[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (const cf of all) {
    const subject = extractSubject(cf.before, cf.after);

    if (CLUSTERABLE_KINDS.has(cf.kind)) {
      // 1. Subject match (preferred)
      if (subject) {
        const match = clusters.find(
          (c) =>
            c.members[0].kind === cf.kind &&
            c.subject.toLowerCase() === subject.toLowerCase(),
        );
        if (match) {
          match.members.push(cf);
          continue;
        }
      }
      // 2. Exact-text dedup (catches multiple concept extractions that
      //    point at the same clause — e.g. three phrases pulled out of
      //    "Answer questions only within approved topic categories")
      const dupe = clusters.find(
        (c) =>
          c.members[0].kind === cf.kind &&
          normalize(c.members[0].before) === normalize(cf.before) &&
          normalize(c.members[0].after) === normalize(cf.after),
      );
      if (dupe) {
        dupe.members.push(cf);
        continue;
      }
    }

    clusters.push({ subject, members: [cf] });
  }

  return clusters;
}

function normalize(text: string | null): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
