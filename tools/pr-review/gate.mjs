#!/usr/bin/env node
/**
 * Contradiction gate. Exits 0 on clean, 1 on blocking contradictions found.
 *
 * Reads the aggregate index.json emitted by analyze.mjs — no grep theater
 * against free-form text. Structured in; structured out.
 *
 * Gate semantics:
 *   - Only medium/high-confidence contradictions block (and unknown ones,
 *     conservatively — a metadata gap shouldn't silently unblock a real
 *     issue). Low-confidence contradictions are typically the narrowing
 *     heuristic firing on additive changes; they're surfaced in the sticky
 *     comment but do not fail the check.
 *   - Falls back to the legacy `contradictionCount` if the index predates
 *     the split. That keeps the gate safe against older analyze.mjs output.
 */

import { readFileSync } from "node:fs";

const i = process.argv.indexOf("--in");
const path = i === -1 ? null : process.argv[i + 1] ?? null;
if (!path) {
  console.error("Usage: gate.mjs --in <index.json>");
  process.exit(2);
}

const index = JSON.parse(readFileSync(path, "utf-8"));

// Prefer the new split when present; fall back to the aggregate total.
const blocking = Number(
  index.blockingContradictionCount ?? index.contradictionCount ?? 0,
);
const advisory = Number(index.advisoryContradictionCount ?? 0);

if (blocking > 0) {
  const advisoryNote = advisory > 0
    ? ` (${advisory} additional low-confidence contradiction${advisory === 1 ? "" : "s"} reported as advisory)`
    : "";
  console.error(
    `samediff-lens: blocking — ${blocking} contradiction${
      blocking === 1 ? "" : "s"
    } detected on high-signal files${advisoryNote}.`,
  );
  process.exit(1);
}

if (advisory > 0) {
  console.error(
    `samediff-lens: check passes. ${advisory} low-confidence contradiction${
      advisory === 1 ? "" : "s"
    } surfaced as advisory — see the PR comment.`,
  );
} else {
  console.error("samediff-lens: no contradictions; check passes.");
}
process.exit(0);
