/**
 * Compact output: one finding per line, grep-friendly.
 *
 * Format:  <CATEGORY>\t<detail>[\t@<anchors>]
 *
 * The optional third tab field encodes source anchors, e.g.
 *   COMMITMENT\t<...> -> <...>\t@before:12-13 after:18-19
 *
 * Designed for:
 *   samediff a.md b.md --compact | grep COMMITMENT
 *   samediff a.md b.md --compact | awk -F'\t' '{print $3}'
 *   samediff a.md b.md --compact | wc -l
 *
 * No colors, no header, no footer. Lines without provenance simply omit
 * the third field so "\t@" is a reliable substring test for anchored rows.
 */

import type { AnalysisResult, FindingProvenance } from "../analysis/types";
import { formatProvenance } from "../analysis/provenance";

export function formatCompactOutput(result: AnalysisResult): string {
  const lines: string[] = [];

  const anchor = (prov: FindingProvenance | null | undefined): string => {
    const s = formatProvenance(prov ?? null);
    return s ? `\t${s}` : "";
  };

  const addedActionProv = provMap(result.actionItemsAddedProvenance);
  const removedActionProv = provMap(result.actionItemsRemovedProvenance);
  const addedConceptProv = provMapByField(result.addedConceptsEvidence, "phrase");
  const removedConceptProv = provMapByField(result.removedConceptsEvidence, "phrase");

  for (const ev of result.changedCommitmentsEvidence) {
    lines.push(
      `COMMITMENT\t${oneline(ev.versionA)} → ${oneline(ev.versionB)}${anchor(ev.provenance)}`,
    );
  }
  for (const ev of result.possibleContradictionsEvidence) {
    lines.push(`CONTRADICTION\t${oneline(ev.summary)}${anchor(ev.provenance)}`);
  }
  for (const r of result.renamedIdeas) {
    lines.push(`RENAME\t${r.from} → ${r.to}\t[${r.confidence}]${anchor(r.provenance)}`);
  }
  for (const phrase of result.addedConcepts) {
    lines.push(`ADDED\t${oneline(phrase)}${anchor(addedConceptProv.get(phrase))}`);
  }
  for (const phrase of result.removedConcepts) {
    lines.push(`REMOVED\t${oneline(phrase)}${anchor(removedConceptProv.get(phrase))}`);
  }
  for (const desc of result.actionItemsAdded) {
    lines.push(`TODO+\t${oneline(desc)}${anchor(addedActionProv.get(desc))}`);
  }
  for (const desc of result.actionItemsRemoved) {
    lines.push(`TODO-\t${oneline(desc)}${anchor(removedActionProv.get(desc))}`);
  }

  return lines.join("\n") + (lines.length ? "\n" : "");
}

function oneline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function provMap(
  entries: AnalysisResult["actionItemsAddedProvenance"],
): Map<string, FindingProvenance | undefined> {
  const m = new Map<string, FindingProvenance | undefined>();
  for (const e of entries ?? []) m.set(e.description, e.provenance);
  return m;
}

function provMapByField<T extends { provenance?: FindingProvenance }>(
  items: T[],
  key: keyof T,
): Map<string, FindingProvenance | undefined> {
  const m = new Map<string, FindingProvenance | undefined>();
  for (const item of items ?? []) m.set(String(item[key]), item.provenance);
  return m;
}
