/**
 * GitHub Actions annotations renderer.
 *
 * Emits workflow commands that GitHub surfaces as inline PR check
 * annotations (::warning::, ::error::).
 *
 * Spec: https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 *
 * Design notes:
 *   - Commitment shifts + contradictions emit ::error:: (the dangerous findings)
 *   - Everything else emits ::notice::
 *   - Messages are single-line (GitHub strips newlines inside workflow commands)
 *   - `file=` is set to the --right file path when available, since that's
 *     the "current" version the CI is checking.
 *   - `title=` groups findings by category in the UI.
 */

import type { AnalysisResult } from "../analysis/types";

type GithubOptions = {
  fileB?: string;
  score?: number;
};

const escape = (s: string): string =>
  s
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");

function line(
  level: "error" | "warning" | "notice",
  title: string,
  message: string,
  file?: string,
): string {
  const parts: string[] = [`title=${escape(title)}`];
  if (file) parts.push(`file=${escape(file)}`);
  return `::${level} ${parts.join(",")}::${escape(message)}`;
}

export function formatGithubAnnotations(
  result: AnalysisResult,
  options: GithubOptions = {},
): string {
  const out: string[] = [];
  const file = options.fileB;

  for (const ev of result.changedCommitmentsEvidence) {
    out.push(
      line(
        "error",
        "Commitment shift",
        `${trim(ev.versionA)} → ${trim(ev.versionB)} (${ev.triggers.join(", ") || "commitment change"})`,
        file,
      ),
    );
  }
  for (const ev of result.possibleContradictionsEvidence) {
    out.push(line("error", "Possible contradiction", ev.summary, file));
  }
  for (const r of result.renamedIdeas) {
    out.push(
      line(
        "warning",
        "Concept rename (heuristic)",
        `"${r.from}" → "${r.to}" [${r.confidence}]`,
        file,
      ),
    );
  }
  for (const ev of result.addedConceptsEvidence) {
    out.push(
      line(
        "notice",
        "Added concept",
        ev.sourceClause ? `${ev.phrase} — "${trim(ev.sourceClause)}"` : ev.phrase,
        file,
      ),
    );
  }
  for (const ev of result.removedConceptsEvidence) {
    out.push(
      line(
        "notice",
        "Removed concept",
        ev.sourceClause ? `${ev.phrase} — "${trim(ev.sourceClause)}"` : ev.phrase,
        file,
      ),
    );
  }
  for (const desc of result.actionItemsAdded) {
    out.push(line("notice", "Action item added", desc, file));
  }
  for (const desc of result.actionItemsRemoved) {
    out.push(line("notice", "Action item removed", desc, file));
  }

  if (out.length === 0) {
    const scoreMsg =
      options.score !== undefined
        ? ` (drift score ${options.score.toFixed(1)}/10)`
        : "";
    out.push(
      line(
        "notice",
        "SameDiff",
        `No semantic drift detected by v0 heuristics${scoreMsg}.`,
        file,
      ),
    );
  }

  return out.join("\n") + "\n";
}

function trim(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
