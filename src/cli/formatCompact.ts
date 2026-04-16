/**
 * Compact output: one finding per line, grep-friendly.
 *
 * Format:  <CATEGORY>\t<detail>
 *
 * Designed for:
 *   samediff a.md b.md --compact | grep COMMITMENT
 *   samediff a.md b.md --compact | wc -l
 *
 * No colors, no header, no footer. A trailing newline is included.
 * If there are zero findings, one line is printed to stderr by the caller,
 * so compact stdout is always safe to pipe.
 */

import type { AnalysisResult } from "../analysis/types";

export function formatCompactOutput(result: AnalysisResult): string {
  const lines: string[] = [];

  for (const ev of result.changedCommitmentsEvidence) {
    lines.push(`COMMITMENT\t${oneline(ev.versionA)} → ${oneline(ev.versionB)}`);
  }
  for (const ev of result.possibleContradictionsEvidence) {
    lines.push(`CONTRADICTION\t${oneline(ev.summary)}`);
  }
  for (const r of result.renamedIdeas) {
    lines.push(`RENAME\t${r.from} → ${r.to}\t[${r.confidence}]`);
  }
  for (const phrase of result.addedConcepts) {
    lines.push(`ADDED\t${oneline(phrase)}`);
  }
  for (const phrase of result.removedConcepts) {
    lines.push(`REMOVED\t${oneline(phrase)}`);
  }
  for (const desc of result.actionItemsAdded) {
    lines.push(`TODO+\t${oneline(desc)}`);
  }
  for (const desc of result.actionItemsRemoved) {
    lines.push(`TODO-\t${oneline(desc)}`);
  }

  return lines.join("\n") + (lines.length ? "\n" : "");
}

function oneline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
