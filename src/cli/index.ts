#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { formatCliOutput } from "./formatCli";
import { formatHtmlReport } from "./formatHtml";
import { formatJsonOutput } from "./formatJson";
import { formatCompactOutput } from "./formatCompact";
import { formatGithubAnnotations } from "./formatGithub";
import { formatAnalysisReport } from "../lib/report";
import { computeDriftScore, driftExitCode } from "./scoring";
import { buildDiffResult } from "./resultModel";
import { parseGitArgs, resolveGitRef } from "./git";
import { watchFiles } from "./watch";
import { readAllStdin } from "./stdin";
import {
  applyFilters,
  loadBaselineFingerprints,
  parseCategorySpec,
  type Category,
} from "./filter";
import {
  parseFailOn,
  evaluateFailSpec,
  describeFailReason,
  type FailSpec,
} from "./failSpec";

const HELP = `
samediff — semantic-ish diff for markdown and text documents

Usage:
  samediff <left> <right>                  Compare two files
  samediff - <right>                       Read <left> from stdin
  samediff <left> -                        Read <right> from stdin
  samediff --git <ref> -- <file>           Compare file against a git ref
  samediff --git <ref> -- <f1> <f2>        Compare two files at a git ref

Output formats:
  (default)         Colored terminal summary with drift score bar
  --md              Full Markdown report
  --html            Self-contained HTML report
  --json            Structured JSON (machine-readable, stable schema)
  --compact         One finding per line (grep-friendly: CATEGORY\\tdetail)
  --github          GitHub Actions annotations (::error::, ::warning::, ::notice::)
  --score           Print only the numeric drift score (0-10)
  --stats           Print one-line category counts
  -o, --out <file>  Write output to file instead of stdout

Focus / noise control:
  --only <cats>     Include only these finding categories (comma-separated)
  --exclude <cats>  Hide these finding categories (comma-separated)
  --baseline <f>    Subtract findings already present in a saved JSON result
                    (only NEW drift is reported and scored)

CI gating:
  --fail-on <spec>  Exit 1 if spec matches. Spec is comma-separated:
                      any                   any findings at all
                      score:N               drift score ≥ N (e.g. score:5)
                      <category>            any findings in that category
                    Examples:
                      --fail-on any
                      --fail-on score:5
                      --fail-on commitment-shifts,contradictions
  --exit-code       Legacy: same as --fail-on score:1.1

Categories:
  commitment-shifts, contradictions, concept-renames,
  added-concepts, removed-concepts,
  action-items-added, action-items-removed
  Aliases: commits, concepts, todos, all

Behavior:
  --no-color        Disable colored terminal output
  --watch, -w       Re-diff on file changes
  --help, -h        Show this help

Examples:
  samediff before.md after.md
  samediff --git HEAD~1 -- spec.md
  samediff left.md right.md --html -o report.html
  samediff left.md right.md --json
  samediff --git main -- spec.md --fail-on contradictions || alert
  cat draft.md | samediff - reference.md
  samediff a.md b.md --only commitment-shifts,contradictions --compact
  samediff --git origin/main -- spec.md --baseline .samediff-baseline.json
`.trim();

type ResolvedInput = {
  fileAPath: string; // "" if not a local file (stdin or git)
  fileBPath: string;
  labelA: string;
  labelB: string;
  readA: () => string;
  readB: () => string;
  gitSpec: ReturnType<typeof parseGitArgs>;
};

function getFlagValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i]) && args[i + 1] !== undefined) return args[i + 1];
    for (const n of names) {
      if (args[i].startsWith(n + "=")) return args[i].slice(n.length + 1);
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  // Flags that don't take values
  const valueTakingFlags = new Set([
    "-o",
    "--out",
    "--only",
    "--exclude",
    "--baseline",
    "--fail-on",
  ]);
  const argIsFlag = (a: string) => a.startsWith("-") && a !== "-" && a !== "--";
  const flags = new Set(
    args.filter((a, i) => {
      if (!argIsFlag(a)) return false;
      // Strip value-after-flag shapes
      const prev = args[i - 1];
      if (prev && valueTakingFlags.has(prev)) return false;
      return true;
    }),
  );

  const noColor =
    flags.has("--no-color") ||
    process.env.NO_COLOR !== undefined ||
    !process.stdout.isTTY;
  const mdOutput = flags.has("--md");
  const htmlOutput = flags.has("--html");
  const jsonOutput = flags.has("--json");
  const compactOutput = flags.has("--compact");
  const githubOutput = flags.has("--github");
  const statsOutput = flags.has("--stats");
  const watchMode = flags.has("--watch") || flags.has("-w");
  const legacyExitCode = flags.has("--exit-code");
  const scoreOnly = flags.has("--score");

  // Value-bearing flags (with = or space form)
  const outFileArg = getFlagValue(args, ["-o", "--out"]);
  const onlyArg = getFlagValue(args, ["--only"]);
  const excludeArg = getFlagValue(args, ["--exclude"]);
  const baselineArg = getFlagValue(args, ["--baseline"]);
  const failOnArg = getFlagValue(args, ["--fail-on"]);

  const cwd = process.env.SAMEDIFF_ORIG_DIR ?? process.cwd();
  const outFile = outFileArg ? resolve(cwd, outFileArg) : null;

  // Parse filter / fail-on specs up front so we error fast on bad input
  let onlyCats: Set<Category> | undefined;
  let excludeCats: Set<Category> | undefined;
  let failSpec: FailSpec | null = null;
  let baselineFp: Set<string> | undefined;
  try {
    if (onlyArg) onlyCats = new Set(parseCategorySpec(onlyArg));
    if (excludeArg) excludeCats = new Set(parseCategorySpec(excludeArg));
    if (failOnArg) failSpec = parseFailOn(failOnArg);
    if (legacyExitCode && !failSpec) {
      failSpec = { any: false, minScore: 1.1, categories: [] };
    }
    if (baselineArg) {
      const path = resolve(cwd, baselineArg);
      const text = readFileSync(path, "utf-8");
      baselineFp = loadBaselineFingerprints(text);
    }
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(2);
  }

  // Resolve inputs
  let input: ResolvedInput;
  try {
    input = resolveInputs(args, cwd);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }

  // Mutually exclusive output-format sanity check
  const formatFlags = [mdOutput, htmlOutput, jsonOutput, compactOutput, githubOutput, statsOutput, scoreOnly].filter(Boolean).length;
  if (formatFlags > 1) {
    console.error("Error: pass at most one output format flag (--md, --html, --json, --compact, --github, --stats, --score).");
    process.exit(2);
  }

  // Verify we can read both inputs at least once
  let textA: string;
  let textB: string;
  try {
    textA = input.readA();
  } catch (err: any) {
    console.error(`Error: cannot read ${input.labelA}${err?.message ? " — " + err.message : ""}`);
    process.exit(1);
  }
  try {
    textB = input.readB();
  } catch (err: any) {
    console.error(`Error: cannot read ${input.labelB}${err?.message ? " — " + err.message : ""}`);
    process.exit(1);
  }

  const runDiff = (): number => {
    try {
      textA = input.readA();
      textB = input.readB();
    } catch (err: any) {
      console.error(`Error re-reading files: ${err?.message ?? err}`);
      return 1;
    }

    const rawResult = analyzeTextPair(textA, textB);

    const { result, stats } = applyFilters(rawResult, {
      categories:
        onlyCats || excludeCats
          ? { only: onlyCats, exclude: excludeCats }
          : undefined,
      baseline: baselineFp,
    });

    const score = computeDriftScore(result);

    if (scoreOnly) {
      emit(`${score.toFixed(1)}\n`);
      return finish(result, score);
    }

    if (statsOutput) {
      emit(renderStats(result, score));
      return finish(result, score);
    }

    if (jsonOutput) {
      const diffResult = buildDiffResult(result, {
        labelA: input.labelA,
        labelB: input.labelB,
        pathA: input.fileAPath || null,
        pathB: input.fileBPath || null,
        gitRef: input.gitSpec ? undefined : null,
      });
      // Annotate provenance for filters/baseline
      const filtersMeta: Record<string, unknown> = {};
      if (onlyCats) filtersMeta.only = [...onlyCats];
      if (excludeCats) filtersMeta.exclude = [...excludeCats];
      if (baselineFp)
        filtersMeta.baseline = {
          path: baselineArg ?? null,
          suppressed: stats.suppressedByBaseline,
        };
      if (Object.keys(filtersMeta).length) {
        (diffResult as unknown as Record<string, unknown>).filters = filtersMeta;
      }
      emit(formatJsonOutput(diffResult));
      return finish(result, score);
    }

    if (githubOutput) {
      emit(
        formatGithubAnnotations(result, {
          fileB: input.fileBPath ? basename(input.fileBPath) : input.labelB,
          score,
        }),
      );
      return finish(result, score);
    }

    if (compactOutput) {
      const out = formatCompactOutput(result);
      if (!out.length) {
        process.stderr.write("(no findings)\n");
      }
      emit(out);
      return finish(result, score);
    }

    if (htmlOutput) {
      const html = formatHtmlReport(result, {
        fileA: input.labelA,
        fileB: input.labelB,
        generatedAt: new Date().toISOString(),
      });
      emit(html);
      return finish(result, score);
    }

    if (mdOutput) {
      const report = formatAnalysisReport({
        generatedAt: new Date().toISOString(),
        result,
        versionALabel: input.labelA,
        versionBLabel: input.labelB,
      });
      emit(report);
      return finish(result, score);
    }

    // Default: colored terminal
    const output = formatCliOutput(result, {
      color: !noColor && !outFile,
      fileA: input.labelA,
      fileB: input.labelB,
      score,
    });
    emit(output);

    if (baselineFp && stats.suppressedByBaseline > 0) {
      const msg = `  (baseline suppressed ${stats.suppressedByBaseline} pre-existing finding${stats.suppressedByBaseline === 1 ? "" : "s"})\n`;
      process.stderr.write(noColor ? msg : `\x1b[2m${msg.trimEnd()}\x1b[0m\n`);
    }

    return finish(result, score);
  };

  function finish(result: ReturnType<typeof analyzeTextPair>, score: number): number {
    if (!failSpec) return 0;
    const reason = evaluateFailSpec(failSpec, result, score);
    if (reason && !watchMode) {
      process.stderr.write(`\n${describeFailReason(reason)}\n`);
      return 1;
    }
    return 0;
  }

  function emit(content: string) {
    if (outFile) {
      writeFileSync(outFile, content, "utf-8");
      if (!watchMode) {
        const size = Buffer.byteLength(content);
        console.error(`Wrote ${formatSize(size)} to ${outFile}`);
      }
    } else {
      if (watchMode) {
        process.stdout.write("\x1b[2J\x1b[H"); // clear screen
      }
      process.stdout.write(content);
    }
  }

  // First run
  const exitCode = runDiff();

  // Watch mode
  if (watchMode) {
    if (!input.fileAPath && !input.fileBPath) {
      console.error("Warning: --watch only works with local files, not stdin or git refs");
      process.exit(0);
    }

    const watchPaths = [input.fileAPath, input.fileBPath].filter(Boolean);
    if (watchPaths.length >= 2) {
      console.error(
        `\x1b[2mWatching ${input.labelA} and ${input.labelB} for changes… (Ctrl+C to stop)\x1b[0m\n`,
      );
      watchFiles(watchPaths[0], watchPaths[1], () => {
        runDiff();
      });
    }
    return;
  }

  process.exit(exitCode);
}

function resolveInputs(args: string[], cwd: string): ResolvedInput {
  const gitSpec = parseGitArgs(args);

  if (gitSpec) {
    const refA = resolveGitRef(gitSpec.specA, cwd);
    const labelA = refA.label;
    const readA = () => resolveGitRef(gitSpec.specA, cwd).text;
    let fileBPath = "";
    let labelB: string;
    let readB: () => string;
    if (gitSpec.specB.includes(":")) {
      const refB = resolveGitRef(gitSpec.specB, cwd);
      labelB = refB.label;
      readB = () => resolveGitRef(gitSpec.specB, cwd).text;
    } else {
      fileBPath = resolve(cwd, gitSpec.specB);
      labelB = gitSpec.specB;
      readB = () => readFileSync(fileBPath, "utf-8");
    }
    return {
      fileAPath: "",
      fileBPath,
      labelA,
      labelB,
      readA,
      readB,
      gitSpec,
    };
  }

  // Plain mode: scan positional args, honoring value-bearing flags
  const valueTakingFlags = new Set([
    "-o",
    "--out",
    "--only",
    "--exclude",
    "--baseline",
    "--fail-on",
  ]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-") && a !== "-") {
      // Consume a following value if this is a value-bearing flag without `=`
      if (valueTakingFlags.has(a)) i++;
      continue;
    }
    positional.push(a);
  }

  if (positional.length < 2) {
    throw new Error("expected two file paths (or `-` for stdin).\n\n" + HELP);
  }

  const a = positional[0];
  const b = positional[1];

  if (a === "-" && b === "-") {
    throw new Error("can't read both files from stdin.");
  }

  let fileAPath = "";
  let fileBPath = "";
  let labelA: string;
  let labelB: string;
  let readA: () => string;
  let readB: () => string;

  if (a === "-") {
    labelA = "<stdin>";
    const stdinText = readAllStdin();
    readA = () => stdinText;
    fileBPath = resolve(cwd, b);
    labelB = basename(fileBPath);
    readB = () => readFileSync(fileBPath, "utf-8");
  } else if (b === "-") {
    fileAPath = resolve(cwd, a);
    labelA = basename(fileAPath);
    readA = () => readFileSync(fileAPath, "utf-8");
    labelB = "<stdin>";
    const stdinText = readAllStdin();
    readB = () => stdinText;
  } else {
    fileAPath = resolve(cwd, a);
    fileBPath = resolve(cwd, b);
    labelA = basename(fileAPath);
    labelB = basename(fileBPath);
    readA = () => readFileSync(fileAPath, "utf-8");
    readB = () => readFileSync(fileBPath, "utf-8");
  }

  return { fileAPath, fileBPath, labelA, labelB, readA, readB, gitSpec: null };
}

function renderStats(result: ReturnType<typeof analyzeTextPair>, score: number): string {
  const parts = [
    `score=${score.toFixed(1)}`,
    `commitment-shifts=${result.changedCommitmentsEvidence.length}`,
    `contradictions=${result.possibleContradictionsEvidence.length}`,
    `concept-renames=${result.renamedIdeas.length}`,
    `added=${result.addedConcepts.length}`,
    `removed=${result.removedConcepts.length}`,
    `todos+=${result.actionItemsAdded.length}`,
    `todos-=${result.actionItemsRemoved.length}`,
  ];
  return parts.join(" ") + "\n";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

main();
