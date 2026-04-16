import type { AnalysisResult, FindingProvenance } from "../analysis/types";
import { formatProvenance } from "../analysis/provenance";
import { describeContradiction, NO_PRIOR_LINE_TEXT } from "../analysis/heuristics";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

type FormatOptions = {
  color?: boolean;
  fileA?: string;
  fileB?: string;
  score?: number;
};

export function formatCliOutput(
  result: AnalysisResult,
  options: FormatOptions = {},
): string {
  const color = options.color ?? true;
  const c = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text);

  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(c(BOLD + CYAN, "Δ SameDiff Summary"));
  lines.push("");

  if (options.fileA || options.fileB) {
    lines.push(
      c(DIM, `  ${options.fileA ?? "Version A"} → ${options.fileB ?? "Version B"}`),
    );
    lines.push("");
  }

  let hasFindings = false;

  // Commitment shifts
  if (result.changedCommitmentsEvidence.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "COMMITMENT SHIFTS"));
    for (const ev of result.changedCommitmentsEvidence) {
      const aShort = truncate(ev.versionA, 60);
      const bShort = truncate(ev.versionB, 60);
      lines.push(`  ${c(RED, "- " + aShort)}`);
      lines.push(`  ${c(GREEN, "+ " + bShort)}`);
      const meta = [ev.triggers.join(", "), anchorSuffix(ev.provenance)]
        .filter(Boolean)
        .join("  ");
      if (meta) lines.push(`    ${c(DIM, meta)}`);
    }
    lines.push("");
  }

  // Task drift
  if (result.actionItemsAdded.length > 0 || result.actionItemsRemoved.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "TASK DRIFT"));
    const addedProv = provByDesc(result.actionItemsAddedProvenance);
    const removedProv = provByDesc(result.actionItemsRemovedProvenance);
    for (const item of result.actionItemsAdded) {
      lines.push(`  ${c(GREEN, "+ TODO added: " + truncate(item, 70))}`);
      const a = anchorSuffix(addedProv.get(item));
      if (a) lines.push(`    ${c(DIM, a)}`);
    }
    for (const item of result.actionItemsRemoved) {
      lines.push(`  ${c(RED, "- TODO removed: " + truncate(item, 70))}`);
      const a = anchorSuffix(removedProv.get(item));
      if (a) lines.push(`    ${c(DIM, a)}`);
    }
    lines.push("");
  }

  // Concept renames
  if (result.renamedIdeas.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "CONCEPT RENAME (heuristic)"));
    for (const rename of result.renamedIdeas) {
      lines.push(
        `  ${c(MAGENTA, rename.from)} → ${c(CYAN, rename.to)}  ${c(DIM, `[${rename.confidence}]`)}`,
      );
      const a = anchorSuffix(rename.provenance);
      if (a) lines.push(`    ${c(DIM, a)}`);
    }
    lines.push("");
  }

  // Possible contradictions
  if (result.possibleContradictionsEvidence.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "POSSIBLE CONTRADICTIONS"));
    for (const ev of result.possibleContradictionsEvidence) {
      const meta = describeContradiction(ev);
      lines.push(`  ${c(RED, "! " + ev.summary)}`);
      lines.push(`      ${c(BOLD, "NEW LINE:   ")}${truncate(ev.versionB, 100)}`);
      if (meta.priorLineFound) {
        lines.push(`      ${c(BOLD, "PRIOR LINE: ")}${truncate(ev.versionA, 100)}`);
      } else {
        lines.push(`      ${c(BOLD, "PRIOR LINE: ")}${c(DIM, NO_PRIOR_LINE_TEXT)}`);
        lines.push(`      ${c(DIM, "            matched against: " + truncate(ev.versionA, 80))}`);
      }
      lines.push(`      ${c(BOLD, "REASON:     ")}${meta.reason} — ${c(DIM, meta.reasonDetail)}`);
      const confColor = meta.confidence === "high" ? RED : meta.confidence === "medium" ? YELLOW : GREEN;
      lines.push(`      ${c(BOLD, "CONFIDENCE: ")}${c(confColor, meta.confidence.toUpperCase())}`);
      const extras: string[] = [];
      if (ev.anchors.length > 0) extras.push("anchors: " + ev.anchors.join(", "));
      const a = anchorSuffix(ev.provenance);
      if (a) extras.push(a);
      if (extras.length) lines.push(`      ${c(DIM, extras.join("  "))}`);
    }
    lines.push("");
  }

  // Added concepts
  if (result.addedConcepts.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "ADDED CONCEPTS"));
    const provMap = new Map<string, FindingProvenance | undefined>();
    for (const e of result.addedConceptsEvidence) provMap.set(e.phrase, e.provenance);
    for (const concept of result.addedConcepts) {
      lines.push(`  ${c(GREEN, "+ " + concept)}`);
      const a = anchorSuffix(provMap.get(concept));
      if (a) lines.push(`    ${c(DIM, a)}`);
    }
    lines.push("");
  }

  // Removed concepts
  if (result.removedConcepts.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "REMOVED CONCEPTS"));
    const provMap = new Map<string, FindingProvenance | undefined>();
    for (const e of result.removedConceptsEvidence) provMap.set(e.phrase, e.provenance);
    for (const concept of result.removedConcepts) {
      lines.push(`  ${c(RED, "- " + concept)}`);
      const a = anchorSuffix(provMap.get(concept));
      if (a) lines.push(`    ${c(DIM, a)}`);
    }
    lines.push("");
  }

  if (!hasFindings) {
    lines.push(
      c(DIM, "  No strong semantic drift detected by v0 heuristics."),
    );
    lines.push(
      c(DIM, "  This may mean the texts are close, or the drift is outside these rules."),
    );
    lines.push("");
  }

  // Score + summary footer
  lines.push(c(DIM, "─".repeat(60)));
  if (options.score !== undefined) {
    const scoreColor = options.score <= 2 ? GREEN : options.score <= 5 ? YELLOW : RED;
    const bar = scoreBar(options.score, color);
    lines.push(`  ${c(BOLD, "Drift score:")} ${c(BOLD + scoreColor, options.score.toFixed(1))}${c(DIM, "/10")}  ${bar}`);
  }
  lines.push(c(DIM, result.summary));
  lines.push("");

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3).trim() + "..." : text;
}

function anchorSuffix(prov: FindingProvenance | null | undefined): string {
  const s = formatProvenance(prov ?? null);
  return s ? s : "";
}

function provByDesc(
  entries: AnalysisResult["actionItemsAddedProvenance"],
): Map<string, FindingProvenance | undefined> {
  const m = new Map<string, FindingProvenance | undefined>();
  for (const e of entries ?? []) m.set(e.description, e.provenance);
  return m;
}

function scoreBar(score: number, useColor: boolean): string {
  const width = 20;
  const filled = Math.round((score / 10) * width);
  const empty = width - filled;
  const fillChar = "█";
  const emptyChar = "░";

  const bar = fillChar.repeat(filled) + emptyChar.repeat(empty);

  if (!useColor) return `[${bar}]`;

  const barColor = score <= 2 ? GREEN : score <= 5 ? YELLOW : RED;
  return `[${barColor}${fillChar.repeat(filled)}${RESET}${DIM}${emptyChar.repeat(empty)}${RESET}]`;
}
