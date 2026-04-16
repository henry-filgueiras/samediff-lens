/**
 * Built-in policies. Always available, even without a config file.
 *
 * These are named presets that capture common semantic-drift contracts
 * a repo might want. A repo's .samediff.json can override any of them
 * by redefining the same name, or define new policies on top.
 *
 * Precedence when computing effective options:
 *   CLI flags > selected policy > top-level config > built-in defaults
 *
 * Each policy block is additive over the (possibly empty) top-level
 * config block — not a full replacement. This matches how most linters
 * layer "base + preset + local tweaks".
 */

import type { PolicyBlock } from "./config";

export const BUILTIN_POLICIES: Record<string, PolicyBlock> = {
  /**
   * adoption — for messy or newly onboarded repos.
   *
   *   Use baseline subtraction so only NEW drift is reported & scored.
   *   Fail on moderate NEW drift (score:4) — forgiving of churn.
   *   Focus on the dangerous categories: commitment shifts + contradictions.
   *   Other categories still surface in output, just don't fail the build.
   */
  adoption: {
    baseline: ".samediff-baseline.json",
    include: ["commitment-shifts", "contradictions"],
    fail_on: "score:4",
  },

  /**
   * strict — for mature repos that have already paid down drift debt.
   *
   *   Fail on ANY commitment shift or contradiction.
   *   No baseline; every finding matters.
   */
  strict: {
    fail_on: "commitment-shifts,contradictions",
  },

  /**
   * docs-only — for design docs / essays / prose-heavy repos.
   *
   *   Commitment shifts + concepts + todos.
   *   Skip concept-rename noise that plagues prose edits.
   */
  "docs-only": {
    include: [
      "commitment-shifts",
      "contradictions",
      "added-concepts",
      "removed-concepts",
      "action-items-added",
      "action-items-removed",
    ],
    fail_on: "score:5",
  },

  /**
   * advisory — report only; never fail the build.
   *
   *   For teams running SameDiff as a PR comment / annotation bot
   *   without blocking merges.
   */
  advisory: {
    fail_on: null,
    github: true,
  },
};

export function listBuiltinPolicyNames(): string[] {
  return Object.keys(BUILTIN_POLICIES);
}

export function describeBuiltin(name: string): string {
  switch (name) {
    case "adoption":
      return "Baseline-aware; fails only on NEW drift (score ≥ 4) in commitment shifts / contradictions.";
    case "strict":
      return "Fails on any commitment shift or contradiction. No baseline.";
    case "docs-only":
      return "Focuses on commitment shifts, contradictions, concepts, and todos; fails at score ≥ 5.";
    case "advisory":
      return "Reports and annotates (--github) but never fails the build.";
    default:
      return "";
  }
}
