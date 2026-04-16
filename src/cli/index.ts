#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { formatCliOutput } from "./formatCli";
import { formatHtmlReport } from "./formatHtml";
import { formatAnalysisReport } from "../lib/report";
import { computeDriftScore, driftExitCode } from "./scoring";
import { parseGitArgs, resolveGitRef } from "./git";
import { watchFiles } from "./watch";

const HELP = `
samediff — semantic-ish diff for markdown and text documents

Usage:
  samediff <left> <right>                  Compare two files
  samediff --git <ref> -- <file>           Compare file against a git ref
  samediff --git <ref> -- <f1> <f2>        Compare two files at a git ref

Output:
  --md              Full Markdown report
  --html            Self-contained HTML report (writes to stdout or -o file)
  -o, --out <file>  Write output to file instead of stdout

Behavior:
  --no-color        Disable colored terminal output
  --watch, -w       Re-diff on file changes
  --exit-code       Exit 1 if drift detected (for CI)
  --score           Print only the numeric drift score (0-10)
  --help, -h        Show this help

Examples:
  samediff before.md after.md
  samediff --git HEAD~1 -- spec.md
  samediff left.md right.md --html -o report.html
  samediff left.md right.md --exit-code || echo "drift detected!"
  samediff left.md right.md --watch
`.trim();

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const flags = new Set(args.filter((a) => a.startsWith("-") && a !== "--" && !a.startsWith("-o")));
  const noColor = flags.has("--no-color") || process.env.NO_COLOR !== undefined;
  const mdOutput = flags.has("--md");
  const htmlOutput = flags.has("--html");
  const watchMode = flags.has("--watch") || flags.has("-w");
  const exitCodeMode = flags.has("--exit-code");
  const scoreOnly = flags.has("--score");

  // Parse -o / --out
  let outFile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-o" || args[i] === "--out") && args[i + 1]) {
      outFile = resolve(process.env.SAMEDIFF_ORIG_DIR ?? process.cwd(), args[i + 1]);
      break;
    }
  }

  // Resolve inputs: either --git mode or plain file mode
  const cwd = process.env.SAMEDIFF_ORIG_DIR ?? process.cwd();
  let fileAPath: string;
  let fileBPath: string;
  let labelA: string;
  let labelB: string;
  let readA: () => string;
  let readB: () => string;

  let gitSpec: ReturnType<typeof parseGitArgs>;
  try {
    gitSpec = parseGitArgs(args);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }
  if (gitSpec) {
    // Git mode
    const refA = resolveGitRef(gitSpec.specA, cwd);
    labelA = refA.label;
    readA = () => resolveGitRef(gitSpec.specA, cwd).text;
    fileAPath = ""; // not a real file for watch purposes

    if (gitSpec.specB.includes(":")) {
      const refB = resolveGitRef(gitSpec.specB, cwd);
      labelB = refB.label;
      readB = () => resolveGitRef(gitSpec.specB, cwd).text;
      fileBPath = "";
    } else {
      fileBPath = resolve(cwd, gitSpec.specB);
      labelB = gitSpec.specB;
      readB = () => readFileSync(fileBPath, "utf-8");
    }
  } else {
    // Plain file mode
    const positional = args.filter((a) => {
      if (a.startsWith("-")) return false;
      // Skip the value after -o/--out
      const idx = args.indexOf(a);
      if (idx > 0 && (args[idx - 1] === "-o" || args[idx - 1] === "--out")) return false;
      return true;
    });

    if (positional.length < 2) {
      console.error("Error: expected two file paths.\n");
      console.error(HELP);
      process.exit(1);
    }

    fileAPath = resolve(cwd, positional[0]);
    fileBPath = resolve(cwd, positional[1]);
    labelA = basename(fileAPath);
    labelB = basename(fileBPath);
    readA = () => readFileSync(fileAPath, "utf-8");
    readB = () => readFileSync(fileBPath, "utf-8");
  }

  // Verify we can read both inputs
  let textA: string;
  let textB: string;
  try {
    textA = readA();
  } catch (err: any) {
    console.error(`Error: cannot read ${labelA}${err?.message ? " — " + err.message : ""}`);
    process.exit(1);
  }
  try {
    textB = readB();
  } catch (err: any) {
    console.error(`Error: cannot read ${labelB}${err?.message ? " — " + err.message : ""}`);
    process.exit(1);
  }

  const runDiff = () => {
    try {
      textA = readA();
      textB = readB();
    } catch (err: any) {
      console.error(`Error re-reading files: ${err?.message ?? err}`);
      return;
    }

    const result = analyzeTextPair(textA, textB);
    const score = computeDriftScore(result);

    if (scoreOnly) {
      emit(`${score.toFixed(1)}\n`);
      return;
    }

    if (htmlOutput) {
      const html = formatHtmlReport(result, {
        fileA: labelA,
        fileB: labelB,
        generatedAt: new Date().toISOString(),
      });
      emit(html);
      return;
    }

    if (mdOutput) {
      const report = formatAnalysisReport({
        generatedAt: new Date().toISOString(),
        result,
        versionALabel: labelA,
        versionBLabel: labelB,
      });
      emit(report);
      return;
    }

    const output = formatCliOutput(result, {
      color: !noColor && !outFile,
      fileA: labelA,
      fileB: labelB,
      score,
    });
    emit(output);

    if (exitCodeMode && !watchMode) {
      process.exit(driftExitCode(score));
    }
  };

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
  runDiff();

  // Watch mode
  if (watchMode) {
    if (!fileAPath && !fileBPath) {
      console.error("Warning: --watch only works with local files, not git refs");
      process.exit(0);
    }

    const watchPaths = [fileAPath, fileBPath].filter(Boolean);
    if (watchPaths.length >= 2) {
      console.error(`\x1b[2mWatching ${labelA} and ${labelB} for changes… (Ctrl+C to stop)\x1b[0m\n`);
      watchFiles(watchPaths[0], watchPaths[1], () => {
        runDiff();
      });
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

main();
