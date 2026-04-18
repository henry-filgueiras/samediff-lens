/**
 * `samediff history <file>` — walk every commit that touched a file and
 * generate a per-pair HTML report plus an index page that summarises
 * the trajectory.
 *
 * Replaces the standalone `diff_trail.sh`. Differences vs the script:
 *   - In-process (no shelling out per-pair to a node child process)
 *   - Captures stats per step into a `trail.json` for downstream tools
 *   - Generates a top-level `index.html` with an SVG drift chart and
 *     a clickable timeline of every transition
 *   - Optional `--no-empty` to skip the EMPTY → first commit baseline
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { buildNarrative, type Thesis } from "../analysis/narrative";
import { buildDiffResult } from "./resultModel";
import { formatHtmlReport } from "./formatHtml";
import { formatHistoryIndexHtml } from "./formatHistoryHtml";

export type ThesisSummary = {
  headline: string;
  isComposite: boolean;
  confidence: string;
  themeId: string;
};

export type TopIssueSummary = {
  kind: string;
  title: string;
  severity: string;
};

export type HistoryStep = {
  /** 0-indexed step number in chronological order. */
  index: number;
  /** Source ref label — "EMPTY" for the very first step, else commit SHA. */
  fromRef: string;
  /** Target ref label — always a commit SHA. */
  toRef: string;
  /** Short (8-char) version of the target SHA, for filename construction. */
  toShort: string;
  /** Author of the target commit. */
  authorName: string;
  authorEmail: string;
  /** ISO 8601. */
  authorDate: string;
  /** First line of the target commit message. */
  commitSubject: string;
  /** Drift score 0–10 of the transition. */
  score: number;
  /** Severity label: low / moderate / high / critical. */
  severity: string;
  /** Macro thesis if one fired. */
  thesis: ThesisSummary | null;
  /** Strongest single-issue title — the Tier 2 accusation. */
  topIssue: TopIssueSummary | null;
  /** Total findings count from the diff. */
  totalFindings: number;
  /** Filename of the per-pair HTML report, relative to outDir. */
  htmlFilename: string;
};

export type HistoryReport = {
  filePath: string;
  /** Absolute path to the git working-tree root that owns these refs. */
  gitRoot: string;
  steps: HistoryStep[];
  generatedAt: string;
  /** True if the first step is an EMPTY → first-commit baseline. */
  includesEmptyBaseline: boolean;
};

export type RunHistoryOptions = {
  /** File path relative to git repo root (or cwd inside the repo). */
  filePath: string;
  /** Output directory — created if missing. */
  outDir: string;
  /** Working directory — must be inside a git repo. */
  cwd: string;
  /** When false, skip the EMPTY → first-commit baseline. Default true. */
  includeEmptyBaseline?: boolean;
};

type GitCommit = {
  hash: string;
  short: string;
  author: string;
  email: string;
  date: string;
  subject: string;
};

export function runHistory(opts: RunHistoryOptions): HistoryReport {
  const includeEmpty = opts.includeEmptyBaseline !== false;
  const commits = listCommitsForFile(opts.filePath, opts.cwd);
  if (commits.length === 0) {
    throw new Error(`no git history for ${opts.filePath}`);
  }

  mkdirSync(opts.outDir, { recursive: true });
  const fileBase = basename(opts.filePath);
  const steps: HistoryStep[] = [];

  if (includeEmpty) {
    steps.push(buildStep({
      index: 0,
      fromRef: "EMPTY",
      fromShort: "EMPTY",
      toCommit: commits[0],
      filePath: opts.filePath,
      cwd: opts.cwd,
      outDir: opts.outDir,
      fileBase,
    }));
  }

  for (let i = 0; i < commits.length - 1; i++) {
    const idx = includeEmpty ? i + 1 : i;
    steps.push(buildStep({
      index: idx,
      fromRef: commits[i].hash,
      fromShort: commits[i].short,
      toCommit: commits[i + 1],
      filePath: opts.filePath,
      cwd: opts.cwd,
      outDir: opts.outDir,
      fileBase,
    }));
  }

  const report: HistoryReport = {
    filePath: opts.filePath,
    gitRoot: gitTopLevel(opts.cwd),
    steps,
    generatedAt: new Date().toISOString(),
    includesEmptyBaseline: includeEmpty,
  };

  writeFileSync(join(opts.outDir, "trail.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(opts.outDir, "index.html"), formatHistoryIndexHtml(report));

  return report;
}

// ── Step construction ─────────────────────────────────────────────

type BuildStepArgs = {
  index: number;
  fromRef: string;
  fromShort: string;
  toCommit: GitCommit;
  filePath: string;
  cwd: string;
  outDir: string;
  fileBase: string;
};

function buildStep(args: BuildStepArgs): HistoryStep {
  const fromText = args.fromRef === "EMPTY"
    ? ""
    : readAtRef(args.fromRef, args.filePath, args.cwd);
  const toText = readAtRef(args.toCommit.hash, args.filePath, args.cwd);

  const analysis = analyzeTextPair(fromText, toText);
  const diff = buildDiffResult(analysis, {
    labelA: `${args.fromShort}:${args.filePath}`,
    labelB: `${args.toCommit.short}:${args.filePath}`,
  });
  const narrative = buildNarrative(diff);

  // Render the per-pair HTML using the existing single-file renderer
  // — same band layout, same thesis support, same source diff inline.
  const htmlFilename = `${pad4(args.index)}-${args.fromShort}-${args.toCommit.short}.html`;
  const html = formatHtmlReport(analysis, {
    fileA: `${args.fromShort}:${args.filePath}`,
    fileB: `${args.toCommit.short}:${args.filePath}`,
    generatedAt: new Date().toISOString(),
    narrative: true,
    leftText: fromText,
    rightText: toText,
  });
  writeFileSync(join(args.outDir, htmlFilename), html);

  return {
    index: args.index,
    fromRef: args.fromRef,
    toRef: args.toCommit.hash,
    toShort: args.toCommit.short,
    authorName: args.toCommit.author,
    authorEmail: args.toCommit.email,
    authorDate: args.toCommit.date,
    commitSubject: args.toCommit.subject,
    score: diff.score.value,
    severity: diff.score.label,
    thesis: narrative.thesis ? summariseThesis(narrative.thesis) : null,
    topIssue: narrative.issues.length > 0
      ? {
          kind: narrative.issues[0].kind,
          title: narrative.issues[0].title,
          severity: narrative.issues[0].severity,
        }
      : null,
    totalFindings: diff.counts.total,
    htmlFilename,
  };
}

function summariseThesis(t: Thesis): ThesisSummary {
  return {
    headline: t.headline,
    isComposite: t.isComposite,
    confidence: t.confidence,
    themeId: t.themeId,
  };
}

// ── Git plumbing ──────────────────────────────────────────────────

function listCommitsForFile(filePath: string, cwd: string): GitCommit[] {
  const log = execFileSync(
    "git",
    [
      "log",
      "--reverse",
      "--no-merges",
      "--format=%H%x09%h%x09%an%x09%ae%x09%aI%x09%s",
      "--",
      filePath,
    ],
    { cwd, encoding: "utf-8" },
  );
  return log.trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, email, date, ...rest] = line.split("\t");
      return {
        hash,
        short,
        author,
        email,
        date,
        subject: rest.join("\t"),
      };
    });
}

function readAtRef(ref: string, filePath: string, cwd: string): string {
  return execFileSync("git", ["show", `${ref}:${filePath}`], {
    cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  });
}

function gitTopLevel(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return cwd;
  }
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
