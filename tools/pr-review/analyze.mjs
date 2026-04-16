#!/usr/bin/env node
/**
 * Per-file orchestrator for the PR semantic reviewer.
 *
 * Given a base git ref and a newline-separated list of repo-relative paths
 * (typically produced by select-files.mjs), this:
 *
 *   1. Classifies each path as analyzable / new-only / deleted-only.
 *      Files that didn't exist at the base ref, or that no longer exist
 *      in the working copy, are skipped with a structured reason so the
 *      sticky comment can explain itself.
 *   2. Runs the SameDiff CLI in git-diff mode for every analyzable path,
 *      capturing both `--json` and `--sarif` output per file.
 *   3. Merges the per-file SARIF logs into a single SARIF file suitable
 *      for upload via github/codeql-action/upload-sarif.
 *   4. Writes an aggregate `index.json` consumed by render-comment.mjs
 *      and by the contradiction gate in the workflow.
 *
 * The orchestrator never decides the gate itself — it records structured
 * state and lets the workflow read it. That keeps this script inspectable
 * and testable without a live GitHub Actions runner.
 *
 * Usage:
 *   node tools/pr-review/analyze.mjs \
 *     --base origin/main \
 *     --files selected.txt \
 *     --out-dir .pr-review-out
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { buildMergedSarif } from "./sarif-merge.mjs";

const TOOL_VERSION = "0.6.0";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}

const base = arg("--base");
const filesArg = arg("--files");
const outDir = resolve(arg("--out-dir") ?? ".pr-review-out");
const cli = resolve(
  arg("--cli") ?? join(process.cwd(), "dist-cli", "cli", "index.js"),
);
const toolVersion = arg("--tool-version", TOOL_VERSION);

if (!base || !filesArg) {
  console.error("Usage: analyze.mjs --base <ref> --files <list.txt> [--out-dir <dir>]");
  process.exit(2);
}
if (!existsSync(cli)) {
  console.error(`CLI not found at ${cli}. Run \`npm run build:cli\` first.`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

const paths = readFileSync(filesArg, "utf-8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const files = [];
const sarifLogs = [];

for (const p of paths) {
  const existsAtBase = gitBlobExists(base, p);
  const existsInWorkingCopy = fileExists(p);

  if (!existsAtBase && !existsInWorkingCopy) {
    files.push({ path: p, status: "error", error: "path missing on both sides" });
    continue;
  }
  if (!existsAtBase) {
    files.push({ path: p, status: "skipped-new" });
    continue;
  }
  if (!existsInWorkingCopy) {
    files.push({ path: p, status: "skipped-deleted" });
    continue;
  }

  try {
    const json = runCli(["--git", base, "--", p, "--json", "--no-config"]);
    const sarif = runCli(["--git", base, "--", p, "--sarif", "--no-config"]);

    const parsed = JSON.parse(json);
    const summary = summarizeFile(p, parsed);
    files.push(summary);

    const sarifParsed = JSON.parse(sarif);
    const resultCount = sarifParsed?.runs?.[0]?.results?.length ?? 0;
    if (resultCount > 0) sarifLogs.push(sarifParsed);

    writeFileSync(
      join(outDir, safeFileName(p) + ".json"),
      JSON.stringify(parsed, null, 2),
      "utf-8",
    );
  } catch (err) {
    files.push({
      path: p,
      status: "error",
      error: (err && err.message) || String(err),
    });
  }
}

// Emit merged SARIF only if we have something to say. An empty SARIF
// would still be valid, but uploading it is noise.
let sarifRelPath = null;
if (sarifLogs.length > 0) {
  const merged = buildMergedSarif(sarifLogs, { toolVersion });
  const sarifPath = join(outDir, "samediff.sarif");
  writeFileSync(sarifPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  sarifRelPath = sarifPath;
}

const contradictionCount = files.reduce(
  (sum, f) => sum + (f.counts?.contradictions ?? 0),
  0,
);

const index = {
  base,
  files,
  sarifRelPath,
  contradictionCount,
  toolVersion,
};

writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf-8");

// Also print a short textual summary to stdout — handy in the workflow logs
// and for $GITHUB_STEP_SUMMARY composition.
const analyzed = files.filter((f) => f.status === "analyzed").length;
process.stdout.write(
  `samediff-lens pr-review: ${analyzed} analyzed, ${files.length - analyzed} skipped, ` +
    `${contradictionCount} contradiction(s), SARIF=${sarifRelPath ?? "none"}\n`,
);

// Exit 0 — contradictions are gated by the workflow, not here. This keeps
// the per-file SARIF+comment artifacts produced even when the build fails.

// ── Helpers ─────────────────────────────────────────────────────────────

function runCli(args) {
  const res = spawnSync("node", [cli, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  // SameDiff exits non-zero when a fail-spec triggers. For analysis we only
  // care that stdout parses — we do our own gating later.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(
      `samediff exited ${res.status}: ${res.stderr?.toString().trim() ?? ""}`,
    );
  }
  if (!res.stdout) {
    throw new Error(`samediff produced no output: ${res.stderr?.toString().trim() ?? ""}`);
  }
  return res.stdout;
}

function gitBlobExists(ref, path) {
  const res = spawnSync("git", ["cat-file", "-e", `${ref}:${path}`], {
    encoding: "utf-8",
  });
  return res.status === 0;
}

function fileExists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function safeFileName(p) {
  return p.replace(/[\/\\]/g, "__");
}

function summarizeFile(path, diffResult) {
  return {
    path,
    status: "analyzed",
    score: {
      value: diffResult?.score?.value ?? 0,
      label: diffResult?.score?.label ?? "low",
    },
    counts: diffResult?.counts ?? {},
    findings: distillFindings(diffResult?.findings ?? {}),
  };
}

/**
 * Compress the full finding objects to the fields the sticky comment
 * actually renders. Keeps the aggregate index.json modest even when the
 * underlying DiffResult is large.
 */
function distillFindings(findings) {
  return {
    contradictions: (findings.contradictions ?? []).map((f) => ({
      summary: f.summary,
      anchor: anchorShort(f.provenance),
      anchored: !!f.provenance,
    })),
    commitmentShifts: (findings.commitmentShifts ?? []).map((f) => ({
      summary: f.summary,
      triggers: f.evidence?.triggers ?? [],
      anchor: anchorShort(f.provenance),
      anchored: !!f.provenance,
    })),
    conceptRenames: (findings.conceptRenames ?? []).map((f) => ({
      summary: `"${f.from}" → "${f.to}" [${f.confidence}]`,
      anchor: anchorShort(f.provenance),
      anchored: !!f.provenance,
    })),
    actionItemsAdded: (findings.actionItemsAdded ?? []).map((f) => ({
      summary: f.description,
      anchor: anchorShort(f.provenance),
      anchored: !!f.provenance,
    })),
    actionItemsRemoved: (findings.actionItemsRemoved ?? []).map((f) => ({
      summary: f.description,
      anchor: anchorShort(f.provenance),
      anchored: !!f.provenance,
    })),
  };
}

function anchorShort(provenance) {
  if (!provenance || !provenance.anchors?.length) return null;
  // Prefer an after-side anchor (what reviewers look at in the PR diff).
  const pick =
    provenance.anchors.find((a) => a.side === "after") ?? provenance.anchors[0];
  if (pick.startLine === undefined) return null;
  const lineRange =
    pick.endLine && pick.endLine !== pick.startLine
      ? `${pick.startLine}-${pick.endLine}`
      : String(pick.startLine);
  return `${pick.side}:${lineRange}`;
}
