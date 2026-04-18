/**
 * Multi-file drift analysis — roll up DiffResult + NarrativeReport across
 * every matching file under two directory roots into one aggregate report.
 *
 * Built on top of the existing single-file pipeline. No engine changes:
 *   per-file:    text → analyzeTextPair → DiffResult → buildNarrative
 *   aggregate:   pull every per-file Issue, attribute it to its file,
 *                rank by salience across files, synthesize one headline
 *
 * What's surfaced at the aggregate level:
 *   - One headline (highest-salience issue across all files, file-prefixed)
 *   - Top issues across all files, ranked
 *   - Per-file roll-up with each file's own narrative intact (inspectability)
 *   - Files added/removed between the two trees (structural drift)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { buildNarrative } from "../analysis/narrative";
import type { Issue, NarrativeReport, Severity, Thesis } from "../analysis/narrative";
import { buildMacroThesis } from "../analysis/narrative/macro";
import { buildDiffResult, type DiffResult } from "./resultModel";

const DEFAULT_EXTENSIONS = [".md", ".markdown", ".txt"];

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-cli",
  "build",
  "bazel-bin",
  "bazel-out",
  "bazel-testlogs",
]);

// ── Public types ──────────────────────────────────────────────

export type FileNarrative = {
  /** Path relative to the directory root, using forward slashes. */
  path: string;
  /** Full DiffResult for this file (includes the per-file narrative inside). */
  diff: DiffResult;
  /** Convenience: same narrative as diff.narrative, lifted out. */
  narrative: NarrativeReport;
  /**
   * Original source texts. Threaded through so the per-file HTML
   * renderer can embed a source diff. Omitted from JSON output (large,
   * not useful in machine-readable form) — see the JSON serialiser
   * call site for the strip step.
   */
  leftText?: string;
  rightText?: string;
};

export type FileNotice = {
  path: string;
  kind: "added-file" | "removed-file";
};

export type AttributedIssue = Issue & {
  /** Which file this issue came from, relative to the directory root. */
  file: string;
};

export type MultiFileReport = {
  version: string;
  meta: {
    tool: string;
    toolVersion: string;
    generatedAt: string;
    leftRoot: string;
    rightRoot: string;
  };
  files: FileNarrative[];
  notices: FileNotice[];
  aggregate: {
    /** The single highest-salience issue across all files, with file path prefixed. */
    headline: string | null;
    /** Worst per-file severity, propagated to the aggregate. */
    severity: Severity;
    /** Top issues across all files, ranked descending by salience. */
    topIssues: AttributedIssue[];
    /** Below-the-fold issues across all files. */
    quietIssues: AttributedIssue[];
    fileCount: number;
    filesWithDrift: number;
    totalFindings: number;
    /** Maximum per-file drift score (0–10). */
    maxScore: number;
    /** Mean per-file drift score. */
    avgScore: number;
    /**
     * Macro thesis synthesised from issues across ALL files. Often
     * fires more readily than per-file because cross-file coordination
     * (security weakened in api.md AND policy.md AND runbook.md) is a
     * stronger signal than any single file's local pattern.
     */
    thesis: Thesis | null;
  };
};

export type RunMultiFileOptions = {
  leftRoot: string;
  rightRoot: string;
  /** File extensions (with dots) to include. Default: .md, .markdown, .txt */
  extensions?: string[];
  toolVersion?: string;
};

// ── Pipeline ──────────────────────────────────────────────────

export function runMultiFile(opts: RunMultiFileOptions): MultiFileReport {
  const leftRoot = resolve(opts.leftRoot);
  const rightRoot = resolve(opts.rightRoot);
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;

  const leftFiles = walkFiles(leftRoot, extensions);
  const rightFiles = walkFiles(rightRoot, extensions);

  const leftSet = new Set(leftFiles);
  const rightSet = new Set(rightFiles);
  const both: string[] = [];
  const onlyLeft: string[] = [];
  const onlyRight: string[] = [];

  for (const p of leftFiles) {
    if (rightSet.has(p)) both.push(p);
    else onlyLeft.push(p);
  }
  for (const p of rightFiles) {
    if (!leftSet.has(p)) onlyRight.push(p);
  }

  const files: FileNarrative[] = [];
  for (const rel of both.sort()) {
    const aText = readFileSync(join(leftRoot, rel), "utf-8");
    const bText = readFileSync(join(rightRoot, rel), "utf-8");
    const analysis = analyzeTextPair(aText, bText);
    const diff = buildDiffResult(analysis, {
      labelA: rel,
      labelB: rel,
      pathA: join(leftRoot, rel),
      pathB: join(rightRoot, rel),
      toolVersion: opts.toolVersion,
    });
    const narrative = buildNarrative(diff);
    // Attach narrative onto diff for downstream renderers that read from
    // DiffResult; keep it lifted-out too for ergonomic access.
    (diff as unknown as { narrative: NarrativeReport }).narrative = narrative;
    files.push({ path: toPosix(rel), diff, narrative, leftText: aText, rightText: bText });
  }

  const notices: FileNotice[] = [
    ...onlyLeft.sort().map((p) => ({ path: toPosix(p), kind: "removed-file" as const })),
    ...onlyRight.sort().map((p) => ({ path: toPosix(p), kind: "added-file" as const })),
  ];

  const aggregate = aggregateAcross(files, notices);

  return {
    version: "1",
    meta: {
      tool: "samediff-lens",
      toolVersion: opts.toolVersion ?? "0.6.0",
      generatedAt: new Date().toISOString(),
      leftRoot,
      rightRoot,
    },
    files,
    notices,
    aggregate,
  };
}

// ── Aggregation ───────────────────────────────────────────────

// Same weights used inside narrative ranking. Kept local so the
// multi-file aggregator can re-rank without re-running narrative
// internals; if narrative ever changes salience math, this will drift.
// Intentional duplication for now — the alternative is exporting
// salience from buildNarrative which leaks an internal.
const KIND_WEIGHT: Record<Issue["kind"], number> = {
  "commitment-reversal": 9,
  "policy-reversal": 8,
  "guarantee-removed": 7,
  "constraint-introduced": 6,
  "commitment-strengthening": 5,
  "commitment-weakening": 5,
  "scope-narrowed": 5,
  "task-completed": 4,
  "task-reopened": 4,
  "rename": 2,
  "task-scope-shift": 2,
  "observation": 1,
};

function severityScore(sev: Severity): number {
  return sev === "critical" ? 4 : sev === "high" ? 3 : sev === "moderate" ? 2 : 1;
}

function aggregateAcross(
  files: FileNarrative[],
  notices: FileNotice[],
): MultiFileReport["aggregate"] {
  const top: AttributedIssue[] = [];
  const quiet: AttributedIssue[] = [];

  for (const f of files) {
    for (const issue of f.narrative.issues) {
      top.push({ ...issue, file: f.path });
    }
    for (const issue of f.narrative.quiet) {
      quiet.push({ ...issue, file: f.path });
    }
  }

  // Cross-file salience: per-issue weight × confidence × severity boost.
  // Files with multiple top issues naturally float to the top by virtue
  // of having more entries; no extra per-file weighting needed.
  top.sort((a, b) => salience(b) - salience(a));
  quiet.sort((a, b) => salience(b) - salience(a));

  const filesWithDrift = files.filter((f) => f.narrative.issues.length > 0).length;
  const totalFindings = files.reduce((acc, f) => acc + f.diff.counts.total, 0);
  const scores = files.map((f) => f.diff.score.value);
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const avgScore = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    : 0;

  // Headline: highest-salience top issue, prefixed with file path so the
  // reader can locate it without scrolling.
  let headline: string | null = null;
  if (top.length > 0) {
    headline = `${top[0].file} \u2014 ${top[0].title}`;
  } else if (notices.length > 0) {
    const added = notices.filter((n) => n.kind === "added-file").length;
    const removed = notices.filter((n) => n.kind === "removed-file").length;
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} file${added === 1 ? "" : "s"} added`);
    if (removed > 0) parts.push(`${removed} file${removed === 1 ? "" : "s"} removed`);
    if (parts.length > 0) headline = `Structural drift: ${parts.join(", ")}`;
  }

  // Aggregate severity = max per-file severity. Critical > high > moderate > low.
  let severity: Severity = "low";
  for (const f of files) {
    if (severityScore(f.narrative.severity) > severityScore(severity)) {
      severity = f.narrative.severity;
    }
  }

  // Aggregate thesis: feed every issue (top + quiet, across all files)
  // into the macro pipeline. The Issue.id collision risk is real here —
  // each per-file narrative numbers issues "issue-0", "issue-1"… so two
  // files can share an id. Re-namespace by file path so citations
  // remain unambiguous and the anti-hallucination test still passes.
  const namespacedIssues = [...top, ...quiet].map((ai) => ({
    ...ai,
    id: `${ai.file}#${ai.id}`,
  }));
  const thesis = buildMacroThesis(namespacedIssues);

  return {
    headline,
    severity,
    topIssues: top,
    quietIssues: quiet,
    fileCount: files.length,
    filesWithDrift,
    totalFindings,
    maxScore,
    avgScore,
    thesis,
  };
}

function salience(issue: AttributedIssue): number {
  const base = KIND_WEIGHT[issue.kind];
  const conf = issue.confidence === "high" ? 1.2 : issue.confidence === "medium" ? 1.0 : 0.7;
  const sev = severityScore(issue.severity);
  return base * conf * (1 + (sev - 1) * 0.15);
}

// ── Filesystem walk ───────────────────────────────────────────

function walkFiles(root: string, extensions: string[]): string[] {
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const out: string[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || DEFAULT_IGNORE_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        const dotIdx = lower.lastIndexOf(".");
        if (dotIdx < 0) continue;
        const ext = lower.slice(dotIdx);
        if (exts.has(ext)) {
          out.push(relative(root, full));
        }
      }
    }
  }

  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    // root doesn't exist — caller will see empty list and handle
  }
  return out;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
