import type { AnalysisResult } from "../analysis/types";

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
      lines.push(`    ${c(DIM, ev.triggers.join(", "))}`);
    }
    lines.push("");
  }

  // Task drift
  if (result.actionItemsAdded.length > 0 || result.actionItemsRemoved.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "TASK DRIFT"));
    for (const item of result.actionItemsAdded) {
      lines.push(`  ${c(GREEN, "+ TODO added: " + truncate(item, 70))}`);
    }
    for (const item of result.actionItemsRemoved) {
      lines.push(`  ${c(RED, "- TODO removed: " + truncate(item, 70))}`);
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
    }
    lines.push("");
  }

  // Possible contradictions
  if (result.possibleContradictionsEvidence.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "POSSIBLE CONTRADICTIONS"));
    for (const ev of result.possibleContradictionsEvidence) {
      lines.push(`  ${c(RED, "! " + ev.summary)}`);
      if (ev.anchors.length > 0) {
        lines.push(`    ${c(DIM, "anchors: " + ev.anchors.join(", "))}`);
      }
    }
    lines.push("");
  }

  // Added concepts
  if (result.addedConcepts.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "ADDED CONCEPTS"));
    for (const concept of result.addedConcepts) {
      lines.push(`  ${c(GREEN, "+ " + concept)}`);
    }
    lines.push("");
  }

  // Removed concepts
  if (result.removedConcepts.length > 0) {
    hasFindings = true;
    lines.push(c(BOLD + YELLOW, "REMOVED CONCEPTS"));
    for (const concept of result.removedConcepts) {
      lines.push(`  ${c(RED, "- " + concept)}`);
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
