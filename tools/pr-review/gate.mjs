#!/usr/bin/env node
/**
 * Contradiction gate. Exits 0 on clean, 1 on contradictions found.
 *
 * Reads the aggregate index.json emitted by analyze.mjs — no grep theater
 * against free-form text. Structured in; structured out.
 */

import { readFileSync } from "node:fs";

const i = process.argv.indexOf("--in");
const path = i === -1 ? null : process.argv[i + 1] ?? null;
if (!path) {
  console.error("Usage: gate.mjs --in <index.json>");
  process.exit(2);
}

const index = JSON.parse(readFileSync(path, "utf-8"));
const contradictions = Number(index.contradictionCount ?? 0);
if (contradictions > 0) {
  console.error(
    `samediff-lens: blocking — ${contradictions} contradiction${
      contradictions === 1 ? "" : "s"
    } detected on high-signal files.`,
  );
  process.exit(1);
}
console.error("samediff-lens: no contradictions; check passes.");
process.exit(0);
