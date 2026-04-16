#!/usr/bin/env node
/**
 * CLI wrapper around comment.mjs. Reads an aggregate index JSON from --in,
 * writes the rendered Markdown to --out (or stdout if omitted).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { renderComment } from "./comment.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const inPath = arg("--in");
const outPath = arg("--out");
if (!inPath) {
  console.error("Usage: render-comment.mjs --in <index.json> [--out <comment.md>]");
  process.exit(2);
}

const index = JSON.parse(readFileSync(inPath, "utf-8"));
const body = renderComment(index);
if (outPath) writeFileSync(outPath, body, "utf-8");
else process.stdout.write(body);
