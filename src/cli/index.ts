#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { formatCliOutput } from "./formatCli";
import { formatAnalysisReport } from "../lib/report";

const HELP = `
samediff — semantic-ish diff for markdown and text documents

Usage:
  samediff <before> <after>         Compare two files
  samediff <before> <after> --md    Output as Markdown report
  samediff --help                   Show this help

Options:
  --no-color    Disable colored output
  --md          Output full Markdown report instead of summary
  --help, -h    Show this help

Example:
  samediff before.md after.md
`.trim();

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const positional = args.filter((a) => !a.startsWith("-"));

  if (positional.length < 2) {
    console.error("Error: expected two file paths.\n");
    console.error(HELP);
    process.exit(1);
  }

  const [fileA, fileB] = positional.map((p) => resolve(p));
  const noColor = flags.has("--no-color") || process.env.NO_COLOR !== undefined;
  const mdOutput = flags.has("--md");

  let textA: string;
  let textB: string;

  try {
    textA = readFileSync(fileA, "utf-8");
  } catch {
    console.error(`Error: cannot read ${fileA}`);
    process.exit(1);
  }

  try {
    textB = readFileSync(fileB, "utf-8");
  } catch {
    console.error(`Error: cannot read ${fileB}`);
    process.exit(1);
  }

  const result = analyzeTextPair(textA, textB);

  if (mdOutput) {
    const report = formatAnalysisReport({
      generatedAt: new Date().toISOString(),
      result,
      versionALabel: basename(fileA),
      versionBLabel: basename(fileB),
    });
    process.stdout.write(report);
  } else {
    const output = formatCliOutput(result, {
      color: !noColor,
      fileA: basename(fileA),
      fileB: basename(fileB),
    });
    process.stdout.write(output);
  }
}

main();
