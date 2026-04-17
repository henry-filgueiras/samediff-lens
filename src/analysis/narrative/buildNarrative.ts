/**
 * Pure transformation: DiffResult → NarrativeReport.
 *
 * Four stages: classify → cluster → template → rank.
 *
 * Contract: every Issue in the output cites at least one raw finding from
 * the input DiffResult. That's enforced here; buildIssue can't produce an
 * Issue without a cluster, and clusters can't be empty.
 */

import type { DiffResult } from "../../cli/resultModel";
import type { SourceAnchor } from "../types";
import type { Issue, IssueKind, NarrativeReport, Severity, Confidence } from "./types";
import { classifyAll, type ClassifiedFinding } from "./classify";
import { clusterFindings, type Cluster } from "./cluster";
import { topicBoost } from "./topics";
import {
  extractSubject,
  shortPhrase,
  titleCommitmentStrengthening,
  titleCommitmentWeakening,
  titleCommitmentReversal,
  titlePolicyReversal,
  titleGuaranteeRemoved,
  titleConstraintIntroduced,
  titleScopeNarrowed,
  titleTaskShift,
  titleRename,
} from "./templates";

const KIND_WEIGHT: Record<IssueKind, number> = {
  "commitment-reversal": 9,
  "policy-reversal": 8,
  "guarantee-removed": 7,
  "constraint-introduced": 6,
  "commitment-strengthening": 5,
  "commitment-weakening": 5,
  "scope-narrowed": 5,
  "rename": 2,
  "task-scope-shift": 2,
  "observation": 1,
};

const CONFIDENCE_MULT: Record<Confidence, number> = {
  high: 1.2,
  medium: 1.0,
  low: 0.7,
};

const QUIET_THRESHOLD = 3.0;

export function buildNarrative(diff: DiffResult): NarrativeReport {
  const classified = classifyAll(diff);
  const clusters = clusterFindings(classified);

  const issues = clusters.map((c, i) => buildIssue(c, i));

  const ranked = issues
    .map((issue) => ({ issue, salience: scoreSalience(issue) }))
    .sort((a, b) => b.salience - a.salience);

  const top: Issue[] = [];
  const quiet: Issue[] = [];
  for (const { issue, salience } of ranked) {
    const isQuiet =
      salience < QUIET_THRESHOLD ||
      issue.kind === "observation" ||
      issue.kind === "task-scope-shift" ||
      (issue.kind === "rename" && issue.confidence !== "high") ||
      isWeakContradiction(issue);
    if (isQuiet) quiet.push(issue);
    else top.push(issue);
  }

  // Task-only fallback: if nothing else surfaced but there are task changes,
  // promote up to 5 task-scope-shift issues to top so the report isn't empty.
  // These diffs are pure checklist churn — the task list *is* the story.
  if (top.length === 0) {
    const tasks = quiet.filter((i) => i.kind === "task-scope-shift");
    if (tasks.length > 0) {
      const hoisted = tasks.slice(0, Math.min(5, tasks.length));
      for (const t of hoisted) top.push(t);
      const hoistedIds = new Set(hoisted.map((i) => i.id));
      for (let i = quiet.length - 1; i >= 0; i--) {
        if (hoistedIds.has(quiet[i].id)) quiet.splice(i, 1);
      }
    }
  }

  const headline = top.length > 0
    ? (allTasks(top)
        ? synthesizeTaskHeadline(top, quiet)
        : top[0].title)
    : null;

  return {
    headline,
    severity: (diff.score.label as Severity) ?? "low",
    issues: top,
    quiet,
  };
}

function allTasks(issues: Issue[]): boolean {
  return issues.length > 0 && issues.every((i) => i.kind === "task-scope-shift");
}

/**
 * Defense-in-depth quarantine for contradiction-derived issues whose
 * before-subject and after-subject disagree. The engine guard already
 * rejects most of these, but if a weak contradiction survives, this
 * keeps it out of the headline and top section. The issue still appears
 * in the quiet bucket so a curious reader can find it.
 */
function isWeakContradiction(issue: Issue): boolean {
  const fromContradiction = issue.evidence.triggers.some((t) =>
    t.startsWith("contradiction:"),
  );
  if (!fromContradiction) return false;
  const beforeSubj = extractSubject(issue.evidence.before, null).toLowerCase();
  const afterSubj = extractSubject(null, issue.evidence.after).toLowerCase();
  if (!beforeSubj || !afterSubj) return false;
  if (beforeSubj === afterSubj) return false;
  // Two different non-empty subjects extracted from the two sides — the
  // contradiction is almost certainly cross-topic.
  return issue.confidence !== "high";
}

function synthesizeTaskHeadline(top: Issue[], quiet: Issue[]): string {
  // Count added vs removed across top + quiet. Titles start with
  // "Task added:" / "Task removed:" (built by titleTaskShift) so this is
  // a text check, no extra state needed.
  let added = 0;
  let removed = 0;
  for (const i of [...top, ...quiet]) {
    if (i.kind !== "task-scope-shift") continue;
    if (i.title.startsWith("Task added:")) added++;
    else if (i.title.startsWith("Task removed:")) removed++;
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  return `Checklist churn: ${parts.join(", ") || `${top.length + quiet.length} task changes`}`;
}

function buildIssue(c: Cluster, index: number): Issue {
  if (c.members.length === 0) {
    throw new Error("cluster must have at least one member");
  }
  const primary = c.members[0];
  const kind = primary.kind;
  const before = primary.before ?? "";
  const after = primary.after ?? "";
  const subject = c.subject || extractSubject(before, after);

  let title: string;
  switch (kind) {
    case "commitment-strengthening":
      title = titleCommitmentStrengthening(before, after); break;
    case "commitment-weakening":
      title = titleCommitmentWeakening(before, after); break;
    case "commitment-reversal":
      title = titleCommitmentReversal(before, after); break;
    case "policy-reversal":
      title = titlePolicyReversal(before, after); break;
    case "guarantee-removed":
      title = titleGuaranteeRemoved(before || after, primary.after); break;
    case "constraint-introduced":
      title = titleConstraintIntroduced(primary.before, after || before); break;
    case "scope-narrowed":
      title = titleScopeNarrowed(before, after); break;
    case "task-scope-shift": {
      const added = primary.triggers[0] === "action-added";
      title = titleTaskShift(added, (added ? after : before) || "");
      break;
    }
    case "rename":
      title = titleRename(before, after); break;
    default:
      title = shortPhrase(after || before, 100) || "Observation";
  }

  if (c.members.length > 1) {
    title += ` (+${c.members.length - 1} related)`;
  }

  const anchors = collectAnchors(c.members);
  const triggers = Array.from(new Set(c.members.flatMap((m) => m.triggers)));
  const confidence = highestConfidence(c.members.map((m) => m.confidence));

  return {
    id: `issue-${index}`,
    title,
    kind,
    severity: kindToSeverity(kind, confidence, c.members.length),
    confidence,
    subject,
    lede: buildLede(kind, subject, before, after, c.members.length),
    evidence: {
      before: primary.before,
      after: primary.after,
      anchors,
      triggers,
    },
    supportingFindings: c.members.map((m) => m.ref),
  };
}

function buildLede(
  kind: IssueKind,
  subject: string,
  before: string,
  after: string,
  count: number,
): string {
  const s = subject ? ` on ${subject}` : "";
  const n = count > 1 ? ` (${count} related changes)` : "";
  switch (kind) {
    case "commitment-reversal":
      return `A requirement${s} flipped polarity between versions${n}.`;
    case "policy-reversal":
      return `A policy${s} reversed between versions${n}.`;
    case "guarantee-removed":
      return before && !after
        ? `A concept${s} that was present in the old version no longer appears${n}.`
        : `A guarantee${s} was weakened or removed${n}.`;
    case "constraint-introduced":
      return !before
        ? `A new constraint${s} appeared in the new version${n}.`
        : `A constraint${s} was tightened${n}.`;
    case "scope-narrowed":
      return `Scope${s} was narrowed by limiting language${n}.`;
    case "commitment-strengthening":
      return `A commitment${s} was strengthened — modal escalation${n}.`;
    case "commitment-weakening":
      return `A commitment${s} was softened${n}.`;
    case "task-scope-shift":
      return after ? "A task was added." : "A task was removed.";
    case "rename":
      return "A concept appears to have been renamed.";
    default:
      return "Observation.";
  }
}

function kindToSeverity(kind: IssueKind, confidence: Confidence, clusterSize: number): Severity {
  const base = KIND_WEIGHT[kind];
  const bump = clusterSize >= 3 ? 1 : 0;
  const score = base + bump - (confidence === "low" ? 1 : 0);
  if (score >= 9) return "critical";
  if (score >= 6) return "high";
  if (score >= 4) return "moderate";
  return "low";
}

function highestConfidence(confs: Confidence[]): Confidence {
  if (confs.includes("high")) return "high";
  if (confs.includes("medium")) return "medium";
  return "low";
}

function scoreSalience(issue: Issue): number {
  const base = KIND_WEIGHT[issue.kind];
  const conf = CONFIDENCE_MULT[issue.confidence];
  const text = [
    issue.title,
    issue.evidence.before ?? "",
    issue.evidence.after ?? "",
  ].join(" ");
  const topic = topicBoost(text);
  const clusterBoost = Math.min(1.5, 1 + (issue.supportingFindings.length - 1) * 0.15);
  return base * conf * topic * clusterBoost;
}

function collectAnchors(members: ClassifiedFinding[]): SourceAnchor[] {
  const out: SourceAnchor[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    for (const a of m.anchors ?? []) {
      const key = `${a.side}:${a.startLine ?? "?"}:${a.startColumn ?? "?"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}
