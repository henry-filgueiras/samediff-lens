/**
 * Churn scanner — list files in a directory by commit count.
 *
 * Replaces the standalone `scan.sh` with a first-class subcommand.
 * Useful for picking interesting candidates to feed into
 * `samediff history <file>`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DEFAULT_EXTENSIONS = [".md", ".markdown", ".txt"];

const DEFAULT_IGNORE_DIRS = new Set([
  ".git", "node_modules", "dist", "dist-cli", "build",
  "bazel-bin", "bazel-out", "bazel-testlogs",
]);

export type ScanRow = {
  /** Path relative to `cwd`, using forward slashes. */
  path: string;
  /** Number of commits in HEAD's history that touched this file. */
  edits: number;
};

export type ScanOptions = {
  /** Directory to walk (relative to cwd or absolute). */
  dir: string;
  /** cwd for git invocations — should be inside a git repo. */
  cwd: string;
  /** File extensions to include (defaults to .md / .markdown / .txt). */
  extensions?: string[];
};

export function scanChurn(opts: ScanOptions): ScanRow[] {
  const exts = new Set((opts.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()));
  const files = walkFiles(opts.dir, opts.cwd, exts);
  const rows: ScanRow[] = [];
  for (const file of files) {
    rows.push({ path: file, edits: commitCountFor(file, opts.cwd) });
  }
  rows.sort((a, b) => b.edits - a.edits);
  return rows;
}

function commitCountFor(file: string, cwd: string): number {
  try {
    const out = execFileSync(
      "git",
      ["rev-list", "--count", "HEAD", "--", file],
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function walkFiles(dir: string, cwd: string, exts: Set<string>): string[] {
  const out: string[] = [];

  function walk(absDir: string) {
    let entries;
    try { entries = readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || DEFAULT_IGNORE_DIRS.has(e.name)) continue;
      const full = join(absDir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        const dotIdx = lower.lastIndexOf(".");
        if (dotIdx < 0) continue;
        if (exts.has(lower.slice(dotIdx))) {
          // Record relative to cwd so the path is what `git` expects.
          out.push(toPosix(relative(cwd, full)));
        }
      }
    }
  }

  const absDir = join(cwd, dir);
  try { if (statSync(absDir).isDirectory()) walk(absDir); } catch {}
  return out;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Render a churn table for the terminal. Two columns: edit count + path.
 * Truncates to the requested top N (default 20).
 */
export function renderScanTable(rows: ScanRow[], topN: number): string {
  if (rows.length === 0) {
    return "(no files matched)\n";
  }
  const top = rows.slice(0, topN);
  const widthEdits = Math.max(5, String(top[0].edits).length);
  const lines: string[] = [];
  const sep = "─".repeat(widthEdits + 2 + 60);
  lines.push(sep);
  lines.push(`${"edits".padStart(widthEdits)}  path`);
  lines.push(sep);
  for (const r of top) {
    lines.push(`${String(r.edits).padStart(widthEdits)}  ${r.path}`);
  }
  return lines.join("\n") + "\n";
}
