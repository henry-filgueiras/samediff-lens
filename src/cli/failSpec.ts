/**
 * --fail-on spec parser.
 *
 * Grammar (comma-separated tokens):
 *   any                           fail if there are any findings at all
 *   score:N                       fail if drift score >= N (N is a number, e.g. 4, 5.5)
 *   <category>                    fail if any findings in that category
 *
 * Categories use the same names + aliases as --only/--exclude.
 *
 * Examples:
 *   --fail-on any
 *   --fail-on contradictions
 *   --fail-on commitment-shifts,contradictions
 *   --fail-on score:5
 *   --fail-on score:5,contradictions
 */

import type { AnalysisResult } from "../analysis/types";
import { parseCategorySpec, type Category } from "./filter";

export type FailSpec = {
  any: boolean;
  minScore: number | null;
  categories: Category[];
};

export function parseFailOn(spec: string): FailSpec {
  const out: FailSpec = { any: false, minScore: null, categories: [] };
  const tokens = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const categoryTokens: string[] = [];

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === "any") {
      out.any = true;
      continue;
    }
    if (lower.startsWith("score:")) {
      const n = Number(lower.slice("score:".length));
      if (!Number.isFinite(n)) {
        throw new Error(`--fail-on score:N requires a number; got "${tok}"`);
      }
      out.minScore = n;
      continue;
    }
    categoryTokens.push(tok);
  }

  if (categoryTokens.length) {
    out.categories = parseCategorySpec(categoryTokens.join(","));
  }
  return out;
}

export type FailReason = { kind: "any" } | { kind: "score"; value: number; threshold: number } | { kind: "category"; category: Category; count: number };

/**
 * Evaluate a fail spec against a (post-filter) analysis result and score.
 * Returns null if nothing triggers failure, or the first reason that does.
 */
export function evaluateFailSpec(
  spec: FailSpec,
  result: AnalysisResult,
  score: number,
): FailReason | null {
  const catCounts: Record<Category, number> = {
    "commitment-shifts": result.changedCommitmentsEvidence.length,
    contradictions: result.possibleContradictionsEvidence.length,
    "concept-renames": result.renamedIdeas.length,
    "added-concepts": result.addedConcepts.length,
    "removed-concepts": result.removedConcepts.length,
    "action-items-added": result.actionItemsAdded.length,
    "action-items-removed": result.actionItemsRemoved.length,
  };
  const total = Object.values(catCounts).reduce((a, b) => a + b, 0);

  if (spec.minScore !== null && score >= spec.minScore) {
    return { kind: "score", value: score, threshold: spec.minScore };
  }
  for (const cat of spec.categories) {
    if (catCounts[cat] > 0) {
      return { kind: "category", category: cat, count: catCounts[cat] };
    }
  }
  if (spec.any && total > 0) {
    return { kind: "any" };
  }
  return null;
}

export function describeFailReason(reason: FailReason): string {
  switch (reason.kind) {
    case "any":
      return "--fail-on any: findings detected.";
    case "score":
      return `--fail-on score:${reason.threshold}: drift score ${reason.value.toFixed(1)} ≥ ${reason.threshold}.`;
    case "category":
      return `--fail-on ${reason.category}: ${reason.count} finding${reason.count === 1 ? "" : "s"} in this category.`;
  }
}
