#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { formatCliOutput } from "./formatCli";
import { formatHtmlReport } from "./formatHtml";
import { formatJsonOutput } from "./formatJson";
import { formatCompactOutput } from "./formatCompact";
import { formatGithubAnnotations } from "./formatGithub";
import { formatSarifOutput } from "./formatSarif";
import { formatAnalysisReport } from "../lib/report";
import { computeDriftScore } from "./scoring";
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
import {
  discoverConfigPath,
  loadConfigFile,
  isFailOnNever,
  type LoadedConfig,
} from "./config";
import { resolveOptions, formatProvenance, type EffectiveOptions } from "./resolveOptions";
import {
  runInit,
  runPolicies,
  formatPoliciesListing,
  runBaseline,
  KNOWN_SUBCOMMANDS,
} from "./subcommands";

const HELP = `
samediff — semantic-ish diff for markdown and text documents

Usage:
  samediff <left> <right>                  Compare two files
  samediff check <left> <right>            Same, explicit form
  samediff - <right> | samediff <left> -   Read one side from stdin
  samediff --git <ref> -- <file>           Compare against a git ref

  samediff init [--force]                  Write a starter .samediff.json
  samediff policies                        List available policies
  samediff baseline <left> <right>         Write a baseline snapshot
                    [-o <path>]              (default: .samediff-baseline.json)

Config & policy:
  --config <path>       Load an explicit .samediff.json (skip auto-discovery)
  --no-config           Ignore any config file on disk
  --policy <name>       Select a named policy (overrides default_policy)
  --no-policy           Do not apply any policy, even a default one

Output formats:
  (default)             Colored terminal summary with drift score bar
  --md | --html | --json | --sarif | --compact | --github | --score | --stats
  -o, --out <file>      Write output to file instead of stdout

Focus / noise control (override policy/config if passed):
  --only <cats>         Include only these finding categories (comma-separated)
  --exclude <cats>      Hide these finding categories
  --baseline <f>        Subtract findings already present in a saved JSON result
  --no-baseline         Ignore any baseline configured in policy/config

CI gating:
  --fail-on <spec>      Exit 1 if spec matches.
                          any | score:N | <category>[,<category>…] | none
  --exit-code           Legacy: same as --fail-on score:1.1

Categories (with aliases):
  commitment-shifts | contradictions | concept-renames |
  added-concepts | removed-concepts |
  action-items-added | action-items-removed
  aliases: commits, concepts, todos, all

Behavior:
  --no-color            Disable colored terminal output
  --watch, -w           Re-diff on file changes
  --help, -h            Show this help

Examples:
  samediff before.md after.md
  samediff --git HEAD~1 -- spec.md
  samediff init && samediff baseline before.md after.md
  samediff check spec.md draft.md --policy adoption
  samediff a.md b.md --policy strict
  samediff --git origin/main -- spec.md --policy advisory
`.trim();

type ResolvedInput = {
  fileAPath: string;
  fileBPath: string;
  labelA: string;
  labelB: string;
  readA: () => string;
  readB: () => string;
  gitSpec: ReturnType<typeof parseGitArgs>;
};

const VALUE_TAKING_FLAGS = new Set([
  "-o",
  "--out",
  "--only",
  "--exclude",
  "--baseline",
  "--fail-on",
  "--config",
  "--policy",
]);

function getFlagValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i]) && args[i + 1] !== undefined) return args[i + 1];
    for (const n of names) {
      if (args[i].startsWith(n + "=")) return args[i].slice(n.length + 1);
    }
  }
  return null;
}

function hasFlag(args: string[], name: string): boolean {
  if (args.includes(name)) return true;
  return args.some((a) => a === name || a.startsWith(name + "="));
}

function main() {
  const cwd = process.env.SAMEDIFF_ORIG_DIR ?? process.cwd();
  let args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(args.length === 0 ? 1 : 0);
  }

  // ── Subcommand dispatch ────────────────────────────────────────
  const subcommand = KNOWN_SUBCOMMANDS.has(args[0]) ? args[0] : null;
  if (subcommand === "init") {
    return runInitCommand(args.slice(1), cwd);
  }
  if (subcommand === "policies") {
    return runPoliciesCommand(args.slice(1), cwd);
  }
  if (subcommand === "baseline") {
    return runBaselineCommand(args.slice(1), cwd);
  }
  if (subcommand === "check") {
    // `check` is the explicit form; same pipeline as bareword invocation
    args = args.slice(1);
  }

  // ── Flag parsing ───────────────────────────────────────────────
  const argIsFlag = (a: string) => a.startsWith("-") && a !== "-" && a !== "--";
  const flags = new Set(
    args.filter((a, i) => {
      if (!argIsFlag(a)) return false;
      const prev = args[i - 1];
      if (prev && VALUE_TAKING_FLAGS.has(prev)) return false;
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
  const sarifOutput = flags.has("--sarif");
  const compactFlag = flags.has("--compact");
  const githubFlag = flags.has("--github");
  const statsFlag = flags.has("--stats");
  const watchMode = flags.has("--watch") || flags.has("-w");
  const legacyExitCode = flags.has("--exit-code");
  const scoreOnly = flags.has("--score");

  const outFileArg = getFlagValue(args, ["-o", "--out"]);
  const onlyArg = getFlagValue(args, ["--only"]);
  const excludeArg = getFlagValue(args, ["--exclude"]);
  const baselineArg = getFlagValue(args, ["--baseline"]);
  const failOnArg = getFlagValue(args, ["--fail-on"]);
  const configArg = getFlagValue(args, ["--config"]);
  const policyArg = getFlagValue(args, ["--policy"]);

  const noConfig = hasFlag(args, "--no-config");
  const noPolicy = hasFlag(args, "--no-policy");
  const noBaseline = hasFlag(args, "--no-baseline");

  const outFile = outFileArg ? resolve(cwd, outFileArg) : null;

  // ── Load config ────────────────────────────────────────────────
  let loaded: LoadedConfig | null = null;
  try {
    if (!noConfig) {
      if (configArg) {
        loaded = loadConfigFile(resolve(cwd, configArg));
      } else {
        const discovered = discoverConfigPath(cwd);
        if (discovered) loaded = loadConfigFile(discovered);
      }
    }
  } catch (err: any) {
    console.error(`Error loading config: ${err?.message ?? err}`);
    process.exit(2);
  }

  // ── Resolve effective options (config → policy → CLI) ─────────
  let effective: EffectiveOptions;
  try {
    effective = resolveOptions(loaded, {
      baseline: noBaseline ? null : baselineArg ?? undefined,
      only: onlyArg !== null ? splitCats(onlyArg) : undefined,
      exclude: excludeArg !== null ? splitCats(excludeArg) : undefined,
      failOn: failOnArg !== null ? failOnArg : legacyExitCode ? "score:1.1" : undefined,
      noFail: failOnArg !== null && isFailOnNever(failOnArg),
      policy: policyArg,
      noPolicy,
    });
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(2);
  }

  // Print provenance once, to stderr, when config/policy is in play
  const provenanceMsg = formatProvenance(effective);
  if (provenanceMsg) {
    process.stderr.write((noColor ? provenanceMsg : `\x1b[2m${provenanceMsg}\x1b[0m`) + "\n");
  }

  // ── Turn effective options into runtime artifacts ──────────────
  let onlyCats: Set<Category> | undefined;
  let excludeCats: Set<Category> | undefined;
  let failSpec: FailSpec | null = null;
  let baselineFp: Set<string> | undefined;
  let baselineWarnedMissing = false;
  let baselinePathUsed: string | null = null;
  try {
    if (effective.include) onlyCats = new Set(parseCategorySpec(effective.include.join(",")));
    if (effective.exclude) excludeCats = new Set(parseCategorySpec(effective.exclude.join(",")));
    if (effective.failOn) failSpec = parseFailOn(effective.failOn);

    if (effective.baselinePath) {
      try {
        const text = readFileSync(effective.baselinePath, "utf-8");
        baselineFp = loadBaselineFingerprints(text);
        baselinePathUsed = effective.baselinePath;
      } catch (err: any) {
        const isMissing = err?.code === "ENOENT";
        if (isMissing && effective.baselinePath && loaded) {
          // Gentle fallback when the baseline comes from config and hasn't been created yet.
          const short = shortPath(effective.baselinePath);
          process.stderr.write(
            (noColor
              ? `note: baseline ${short} not found — continuing without baseline. Run 'samediff baseline <left> <right>' to create it.`
              : `\x1b[2mnote: baseline ${short} not found — continuing without baseline. Run 'samediff baseline <left> <right>' to create it.\x1b[0m`) + "\n",
          );
          baselineWarnedMissing = true;
        } else {
          throw new Error(`cannot read baseline ${effective.baselinePath}: ${err?.message ?? err}`);
        }
      }
    }
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(2);
  }

  // Format defaults from policy/config, unless a CLI format flag was passed
  const anyCliFormat =
    mdOutput || htmlOutput || jsonOutput || sarifOutput || compactFlag || githubFlag || statsFlag || scoreOnly;
  const githubOutput = githubFlag || (!anyCliFormat && effective.defaultGithub);
  const compactOutput = compactFlag || (!anyCliFormat && effective.defaultCompact);
  const statsOutput = statsFlag || (!anyCliFormat && effective.defaultStats);

  // Mutually exclusive format flags
  const chosenFormats = [
    mdOutput,
    htmlOutput,
    jsonOutput,
    sarifOutput,
    compactOutput,
    githubOutput,
    statsOutput,
    scoreOnly,
  ].filter(Boolean).length;
  if (chosenFormats > 1) {
    console.error(
      "Error: pass at most one output format (--md, --html, --json, --sarif, --compact, --github, --stats, --score).",
    );
    process.exit(2);
  }

  // ── Resolve input files ─────────────────────────────────────────
  let input: ResolvedInput;
  try {
    input = resolveInputs(args, cwd);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }

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
      const filtersMeta: Record<string, unknown> = {};
      if (onlyCats) filtersMeta.only = [...onlyCats];
      if (excludeCats) filtersMeta.exclude = [...excludeCats];
      if (baselineFp)
        filtersMeta.baseline = {
          path: baselinePathUsed,
          suppressed: stats.suppressedByBaseline,
        };
      if (Object.keys(filtersMeta).length) {
        (diffResult as unknown as Record<string, unknown>).filters = filtersMeta;
      }
      // Advertise policy/config provenance when it shaped the run
      if (effective.provenance.configPath || effective.provenance.policyName) {
        (diffResult as unknown as Record<string, unknown>).policy = {
          config: effective.provenance.configPath,
          name: effective.provenance.policyName,
          source: effective.provenance.policySource,
        };
      }
      emit(formatJsonOutput(diffResult));
      return finish(result, score);
    }

    if (sarifOutput) {
      const diffResult = buildDiffResult(result, {
        labelA: input.labelA,
        labelB: input.labelB,
        pathA: input.fileAPath || null,
        pathB: input.fileBPath || null,
        gitRef: input.gitSpec ? undefined : null,
      });
      emit(formatSarifOutput(diffResult, { baseDir: cwd }));
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
    void baselineWarnedMissing;

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
      if (watchMode) process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(content);
    }
  }

  const exitCode = runDiff();

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

function splitCats(spec: string): string[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    return { fileAPath: "", fileBPath, labelA, labelB, readA, readB, gitSpec };
  }

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-") && a !== "-") {
      if (VALUE_TAKING_FLAGS.has(a)) i++;
      continue;
    }
    positional.push(a);
  }

  if (positional.length < 2) {
    throw new Error("expected two file paths (or `-` for stdin).\n\n" + HELP);
  }
  const a = positional[0];
  const b = positional[1];
  if (a === "-" && b === "-") throw new Error("can't read both files from stdin.");

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

function shortPath(p: string): string {
  const cwd = process.cwd();
  if (p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  return p;
}

// ── Subcommand implementations (thin wrappers over subcommands.ts) ──

function runInitCommand(args: string[], cwd: string): void {
  const force = args.includes("--force") || args.includes("-f");
  try {
    const result = runInit({ cwd, force });
    if (!result.written) {
      console.error(result.reason ?? "Not written.");
      process.exit(1);
    }
    console.error(`Wrote ${shortPath(result.path)}`);
    console.error(`Next: samediff baseline <left> <right>   # to create a baseline`);
    console.error(`Then: samediff <left> <right>             # will use the adoption policy`);
    process.exit(0);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }
}

function runPoliciesCommand(args: string[], cwd: string): void {
  const configArg = getFlagValue(args, ["--config"]);
  try {
    const listing = runPolicies(cwd, configArg ? resolve(cwd, configArg) : null);
    process.stdout.write(formatPoliciesListing(listing));
    process.exit(0);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }
}

function runBaselineCommand(args: string[], cwd: string): void {
  const outArg = getFlagValue(args, ["-o", "--out"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (VALUE_TAKING_FLAGS.has(a)) i++;
      continue;
    }
    positional.push(a);
  }
  if (positional.length < 2) {
    console.error("Usage: samediff baseline <left> <right> [-o <path>]");
    process.exit(2);
  }

  const leftPath = resolve(cwd, positional[0]);
  const rightPath = resolve(cwd, positional[1]);
  const outPath = resolve(cwd, outArg ?? ".samediff-baseline.json");

  runBaseline({ leftPath, rightPath, outPath, cwd })
    .then((res) => {
      console.error(`Wrote baseline: ${shortPath(res.outPath)} (${formatSize(res.bytes)})`);
      console.error("Add this path to .samediff.json under `baseline` or policies.<name>.baseline");
      process.exit(0);
    })
    .catch((err: any) => {
      console.error(`Error: ${err?.message ?? err}`);
      process.exit(1);
    });
}

main();
