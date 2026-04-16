#!/usr/bin/env node
/**
 * Read a newline-separated list of changed paths from stdin (or a file via
 * --in), emit the filtered allowlisted subset to stdout, one per line.
 *
 * Invoked from the PR workflow after `git diff --name-only BASE...HEAD`.
 */

import { readFileSync } from "node:fs";
import { selectChangedFiles } from "./paths.mjs";

function readInput() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf("--in");
  if (inIdx !== -1 && args[inIdx + 1]) {
    return readFileSync(args[inIdx + 1], "utf-8");
  }
  return readFileSync(0, "utf-8"); // stdin
}

const text = readInput();
const lines = text.split(/\r?\n/);
const selected = selectChangedFiles(lines);
if (selected.length) {
  process.stdout.write(selected.join("\n") + "\n");
}
