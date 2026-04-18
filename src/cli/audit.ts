/**
 * `samediff audit <history-dir>` — produce a compact, scan-friendly
 * markdown report of every transition in a history trail, optimized
 * for "is this signal or noise?" judgment.
 *
 * Per-step output is intentionally dense (~15–30 lines): subject,
 * narrative summary, every finding in one-line form, and just the
 * changed source lines. Easy to scroll through 50 steps and spot
 * patterns without each section pushing context off the screen.
 *
 * Re-runs the engine per step rather than reading per-pair JSON;
 * the engine is fast enough that 100 steps complete in a few
 * seconds on docs-sized files.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { buildNarrative } from "../analysis/narrative";
import { buildDiffResult } from "./resultModel";
import { diffLinesWithHunks } from "./sourceDiff";
import type { HistoryReport, HistoryStep } from "./history";

export type AuditOptions = {
  /** Directory containing trail.json (typically a `samediff history` outDir). */
  historyDir: string;
  /** Working directory — must be inside the git repo whose refs the trail uses. */
  cwd: string;
  /** Cap on changed lines per step's diff section. Default 60. */
  maxDiffLines?: number;
  /** Include below-the-fold (quiet) issues. Default false to keep dense. */
  includeQuiet?: boolean;
};

export type AuditSummary = {
  steps: number;
  withThesis: number;
  withComposite: number;
  highOrCritical: number;
  totalFindings: number;
  outPath: string;
};

export function runAudit(opts: AuditOptions): AuditSummary {
  const trailPath = join(opts.historyDir, "trail.json");
  const trail: HistoryReport = JSON.parse(readFileSync(trailPath, "utf-8"));

  const maxDiff = opts.maxDiffLines ?? 60;
  const includeQuiet = !!opts.includeQuiet;

  // Use the git root recorded in trail.json so audit works from any
  // directory (the user might run `samediff audit /tmp/...` from a
  // completely different repo than the one history was run in).
  // Fall back to cwd for trails generated before gitRoot was added.
  const gitCwd = trail.gitRoot ?? opts.cwd;

  const sections: string[] = [];
  let withThesis = 0;
  let withComposite = 0;
  let highOrCrit = 0;
  let totalFindings = 0;

  // Header
  sections.push(`# Audit — ${trail.filePath}\n`);
  sections.push(
    `${trail.steps.length} transition${trail.steps.length === 1 ? "" : "s"} ` +
    `· generated ${trail.generatedAt}\n`,
  );
  sections.push(
    "Scan each step's findings + diff and decide if the narrative " +
    "is genuine signal, false positive, or noise. Verdict slot at the " +
    "end of each step is for human / LLM annotation.\n",
  );

  for (const step of trail.steps) {
    const block = renderStep(step, gitCwd, trail.filePath, maxDiff, includeQuiet);
    sections.push(block.markdown);
    if (block.hasThesis) withThesis++;
    if (block.hasComposite) withComposite++;
    if (block.severity === "high" || block.severity === "critical") highOrCrit++;
    totalFindings += block.findingCount;
  }

  const outPath = join(opts.historyDir, "audit.md");
  writeFileSync(outPath, sections.join("\n"), "utf-8");

  return {
    steps: trail.steps.length,
    withThesis,
    withComposite,
    highOrCritical: highOrCrit,
    totalFindings,
    outPath,
  };
}

// ── Per-step render ───────────────────────────────────────────────

type StepBlock = {
  markdown: string;
  hasThesis: boolean;
  hasComposite: boolean;
  severity: string;
  findingCount: number;
};

function renderStep(
  step: HistoryStep,
  cwd: string,
  filePath: string,
  maxDiff: number,
  includeQuiet: boolean,
): StepBlock {
  // Re-run the engine to get all findings (trail.json only has summary).
  const fromText = step.fromRef === "EMPTY" ? "" : readAtRef(step.fromRef, filePath, cwd);
  const toText = readAtRef(step.toRef, filePath, cwd);

  const analysis = analyzeTextPair(fromText, toText);
  const diff = buildDiffResult(analysis, {
    labelA: step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8),
    labelB: step.toRef.slice(0, 8),
  });
  const narrative = buildNarrative(diff);

  const fromShort = step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8);
  const date = step.authorDate.slice(0, 10);
  const findingsTotal = diff.counts.total;

  const lines: string[] = [];

  // Header
  lines.push(
    `## Step ${step.index} — \`${fromShort}\` → \`${step.toShort}\` · ` +
    `score **${step.score.toFixed(1)}** · ${step.severity}`,
  );
  lines.push(
    `**[${date}]** ${step.authorName} · ${truncate(step.commitSubject, 100)}`,
  );
  lines.push("");

  // Narrative summary
  if (narrative.thesis) {
    const compTag = narrative.thesis.isComposite ? " *(composite)*" : "";
    lines.push(`**thesis**${compTag}: ${narrative.thesis.headline}`);
    lines.push(`  *${narrative.thesis.subheadline}*`);
  } else {
    lines.push(`**thesis**: —`);
  }
  if (narrative.issues.length > 0) {
    const top = narrative.issues[0];
    lines.push(`**top issue**: \`[${top.kind}]\` ${truncate(top.title, 130)}`);
  } else {
    lines.push(`**top issue**: —`);
  }
  lines.push("");

  // All findings — compact one-liners
  const findingLines: string[] = [];

  for (const f of diff.findings.commitmentShifts) {
    const before = truncate(f.evidence.before, 60);
    const after = truncate(f.evidence.after, 60);
    const triggers = f.evidence.triggers.join(", ");
    findingLines.push(`- \`[commit-shift]\` ${quote(before)} → ${quote(after)} *(${triggers})*`);
  }
  for (const f of diff.findings.contradictions) {
    const before = truncate(f.evidence.before, 60);
    const after = truncate(f.evidence.after, 60);
    findingLines.push(
      `- \`[contradiction · ${f.reason} · ${f.confidence}]\` ` +
      `BEFORE: ${quote(before)} / AFTER: ${quote(after)}`,
    );
  }
  for (const f of diff.findings.conceptRenames) {
    findingLines.push(
      `- \`[rename · ${f.confidence}]\` ` +
      `${quote(f.from)} → ${quote(f.to)}` +
      (f.note ? ` *(${f.note})*` : ""),
    );
  }
  for (const f of diff.findings.addedConcepts) {
    findingLines.push(
      `- \`[+concept]\` ${quote(f.phrase)}` +
      (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    );
  }
  for (const f of diff.findings.removedConcepts) {
    findingLines.push(
      `- \`[-concept]\` ${quote(f.phrase)}` +
      (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    );
  }
  for (const f of diff.findings.actionItemsStatusChanges) {
    findingLines.push(`- \`[task · ${f.transition}]\` ${quote(f.subject)}`);
  }

  if (findingLines.length === 0) {
    lines.push(`**findings**: _(none)_`);
  } else {
    lines.push(`**findings** (${findingLines.length}):`);
    for (const fl of findingLines) lines.push(fl);
  }

  // Quiet bucket — opt-in
  if (includeQuiet && narrative.quiet.length > 0) {
    lines.push("");
    lines.push(`**quiet** (${narrative.quiet.length}):`);
    for (const i of narrative.quiet.slice(0, 8)) {
      lines.push(`- \`[${i.kind}]\` ${truncate(i.title, 130)}`);
    }
  }

  // Source diff — only changed lines, capped
  lines.push("");
  lines.push("**diff** (changed lines only):");
  lines.push("```diff");
  const dh = diffLinesWithHunks(fromText, toText);
  if (!dh) {
    lines.push("(file too large to diff)");
  } else if (dh.changedLines === 0) {
    lines.push("(no line-level changes — engine fired on token-level patterns)");
  } else {
    let shown = 0;
    let truncated = false;
    outer: for (const hunk of dh.hunks) {
      for (const row of hunk.rows) {
        if (row.op === "equal") continue;
        if (shown >= maxDiff) {
          truncated = true;
          break outer;
        }
        const prefix = row.op === "add" ? "+" : "-";
        lines.push(`${prefix} ${truncateForDiff(row.text, 200)}`);
        shown++;
      }
    }
    if (truncated) {
      lines.push(`... (${dh.changedLines - maxDiff} more changed line${dh.changedLines - maxDiff === 1 ? "" : "s"} elided)`);
    }
  }
  lines.push("```");

  // Verdict slot
  lines.push("");
  lines.push("**verdict**: _( signal | FP | noise | unclear — annotate here )_");
  lines.push("");
  lines.push("---");

  return {
    markdown: lines.join("\n"),
    hasThesis: narrative.thesis !== null,
    hasComposite: !!narrative.thesis?.isComposite,
    severity: step.severity,
    findingCount: findingsTotal,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function readAtRef(ref: string, filePath: string, cwd: string): string {
  return execFileSync("git", ["show", `${ref}:${filePath}`], {
    cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  });
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "\u2026" : s;
}

function truncateForDiff(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

function quote(s: string | null): string {
  if (!s) return '""';
  // Escape backticks so inline-code rendering doesn't break
  const esc = s.replace(/`/g, "\u02CB"); // visually similar tick
  return `"${esc}"`;
}

export function renderAuditSummary(summary: AuditSummary): string {
  return [
    `samediff audit:`,
    `  ${summary.steps} step${summary.steps === 1 ? "" : "s"}, ` +
      `${summary.totalFindings} total findings`,
    `  ${summary.withThesis} thesis-firing (${summary.withComposite} composite)`,
    `  ${summary.highOrCritical} high or critical severity`,
    `  wrote ${summary.outPath}`,
  ].join("\n") + "\n";
}
