/**
 * Finding filters: category selection + baseline subtraction.
 *
 * Operates on AnalysisResult so every downstream renderer
 * (terminal, markdown, html, json) sees the same filtered view.
 */

import type { AnalysisResult } from "../analysis/types";
import { buildSummary } from "../analysis/heuristics";

export const CATEGORIES = [
  "commitment-shifts",
  "contradictions",
  "concept-renames",
  "added-concepts",
  "removed-concepts",
  "action-items-added",
  "action-items-removed",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(CATEGORIES);

const ALIASES: Record<string, Category[]> = {
  commits: ["commitment-shifts"],
  commitments: ["commitment-shifts"],
  shifts: ["commitment-shifts"],
  contradictions: ["contradictions"],
  renames: ["concept-renames"],
  "concept-rename": ["concept-renames"],
  concepts: ["added-concepts", "removed-concepts"],
  added: ["added-concepts"],
  removed: ["removed-concepts"],
  todos: ["action-items-added", "action-items-removed"],
  "action-items": ["action-items-added", "action-items-removed"],
  tasks: ["action-items-added", "action-items-removed"],
  all: [...CATEGORIES],
};

export function parseCategorySpec(spec: string): Category[] {
  const out = new Set<Category>();
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const key = raw.toLowerCase();
    if (CATEGORY_SET.has(key)) {
      out.add(key as Category);
      continue;
    }
    const mapped = ALIASES[key];
    if (mapped) {
      for (const c of mapped) out.add(c);
      continue;
    }
    throw new Error(
      `Unknown category "${raw}". Known: ${CATEGORIES.join(", ")}` +
        `, or aliases: ${Object.keys(ALIASES).join(", ")}.`,
    );
  }
  return [...out];
}

export type CategoryFilter = {
  only?: Set<Category>;
  exclude?: Set<Category>;
};

function allowed(cat: Category, f: CategoryFilter): boolean {
  if (f.only && !f.only.has(cat)) return false;
  if (f.exclude && f.exclude.has(cat)) return false;
  return true;
}

// ── Fingerprints: stable, opaque identifiers for each finding ─────────
// Used for baseline subtraction. Keep the format tight and order-insensitive
// inside a single finding so minor text reshuffling doesn't break matching.

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function fingerprintCommitmentShift(before: string, after: string): string {
  return `cs:${norm(before)}→${norm(after)}`;
}

export function fingerprintContradiction(summary: string, anchors: string[]): string {
  const a = [...anchors].map(norm).sort().join(",");
  return `ct:${norm(summary)}|${a}`;
}

export function fingerprintRename(from: string, to: string): string {
  return `cr:${norm(from)}→${norm(to)}`;
}

export function fingerprintAdded(phrase: string): string {
  return `ac:${norm(phrase)}`;
}

export function fingerprintRemoved(phrase: string): string {
  return `rc:${norm(phrase)}`;
}

export function fingerprintActionItemAdded(desc: string): string {
  return `ai+:${norm(desc)}`;
}

export function fingerprintActionItemRemoved(desc: string): string {
  return `ai-:${norm(desc)}`;
}

// ── Baseline loading ─────────────────────────────────────────────────

/**
 * Load a baseline JSON (the output of a prior `--json` run) and return
 * the set of finding fingerprints it contains.
 *
 * Tolerant of schema drift: unknown fields are ignored, missing categories
 * are treated as empty. Throws on parse errors or clearly wrong shape.
 */
export function loadBaselineFingerprints(json: string): Set<string> {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (err: any) {
    throw new Error(`Baseline is not valid JSON: ${err?.message ?? err}`);
  }
  const f = parsed?.findings;
  if (!f || typeof f !== "object") {
    throw new Error(
      "Baseline JSON has no `findings` object. Was this produced by `samediff --json`?",
    );
  }

  const fp = new Set<string>();

  for (const x of f.commitmentShifts ?? []) {
    if (x?.evidence?.before && x?.evidence?.after) {
      fp.add(fingerprintCommitmentShift(x.evidence.before, x.evidence.after));
    }
  }
  for (const x of f.contradictions ?? []) {
    if (x?.summary) {
      fp.add(fingerprintContradiction(x.summary, x?.evidence?.anchors ?? []));
    }
  }
  for (const x of f.conceptRenames ?? []) {
    if (x?.from && x?.to) fp.add(fingerprintRename(x.from, x.to));
  }
  for (const x of f.addedConcepts ?? []) {
    if (x?.phrase) fp.add(fingerprintAdded(x.phrase));
  }
  for (const x of f.removedConcepts ?? []) {
    if (x?.phrase) fp.add(fingerprintRemoved(x.phrase));
  }
  for (const x of f.actionItemsAdded ?? []) {
    if (x?.description) fp.add(fingerprintActionItemAdded(x.description));
  }
  for (const x of f.actionItemsRemoved ?? []) {
    if (x?.description) fp.add(fingerprintActionItemRemoved(x.description));
  }

  return fp;
}

// ── The main filter pipeline ─────────────────────────────────────────

export type FilterOptions = {
  categories?: CategoryFilter;
  /** Fingerprints to suppress (from baseline) */
  baseline?: Set<string>;
};

export type FilterStats = {
  suppressedByCategory: number;
  suppressedByBaseline: number;
};

export function applyFilters(
  result: AnalysisResult,
  opts: FilterOptions,
): { result: AnalysisResult; stats: FilterStats } {
  const cat = opts.categories ?? {};
  const base = opts.baseline ?? new Set<string>();

  let suppressedByCategory = 0;
  let suppressedByBaseline = 0;

  const keep = <T>(
    category: Category,
    items: T[],
    fp: (x: T) => string,
  ): T[] => {
    const out: T[] = [];
    for (const item of items) {
      if (!allowed(category, cat)) {
        suppressedByCategory++;
        continue;
      }
      if (base.has(fp(item))) {
        suppressedByBaseline++;
        continue;
      }
      out.push(item);
    }
    return out;
  };

  const changedCommitmentsEvidence = keep(
    "commitment-shifts",
    result.changedCommitmentsEvidence,
    (ev) => fingerprintCommitmentShift(ev.versionA, ev.versionB),
  );
  const possibleContradictionsEvidence = keep(
    "contradictions",
    result.possibleContradictionsEvidence,
    (ev) => fingerprintContradiction(ev.summary, ev.anchors),
  );
  const renamedIdeas = keep("concept-renames", result.renamedIdeas, (r) =>
    fingerprintRename(r.from, r.to),
  );
  const addedConceptsEvidence = keep(
    "added-concepts",
    result.addedConceptsEvidence,
    (ev) => fingerprintAdded(ev.phrase),
  );
  const removedConceptsEvidence = keep(
    "removed-concepts",
    result.removedConceptsEvidence,
    (ev) => fingerprintRemoved(ev.phrase),
  );
  const actionItemsAdded = keep(
    "action-items-added",
    result.actionItemsAdded,
    (desc) => fingerprintActionItemAdded(desc),
  );
  const actionItemsRemoved = keep(
    "action-items-removed",
    result.actionItemsRemoved,
    (desc) => fingerprintActionItemRemoved(desc),
  );

  const addedPhraseSet = new Set(addedConceptsEvidence.map((e) => e.phrase));
  const removedPhraseSet = new Set(removedConceptsEvidence.map((e) => e.phrase));

  const filterPhrase = (phrases: string[], kept: Set<string>, cat: Category, fp: (p: string) => string) => {
    const out: string[] = [];
    for (const p of phrases) {
      if (!allowed(cat, opts.categories ?? {})) {
        suppressedByCategory++;
        continue;
      }
      if (base.has(fp(p))) {
        suppressedByBaseline++;
        continue;
      }
      // String-only concepts: only keep if either the evidence version kept it
      // or there was no evidence for this phrase at all (keep as-is)
      if (kept.has(p) || !result.addedConceptsEvidence.some((e) => e.phrase === p)) {
        out.push(p);
      }
    }
    return out;
  };

  const addedConcepts = (() => {
    const out: string[] = [];
    for (const p of result.addedConcepts) {
      const hadEvidence = result.addedConceptsEvidence.some((e) => e.phrase === p);
      if (hadEvidence) {
        if (addedPhraseSet.has(p)) out.push(p);
        continue;
      }
      if (!allowed("added-concepts", opts.categories ?? {})) {
        suppressedByCategory++;
        continue;
      }
      if (base.has(fingerprintAdded(p))) {
        suppressedByBaseline++;
        continue;
      }
      out.push(p);
    }
    return out;
  })();

  const removedConcepts = (() => {
    const out: string[] = [];
    for (const p of result.removedConcepts) {
      const hadEvidence = result.removedConceptsEvidence.some((e) => e.phrase === p);
      if (hadEvidence) {
        if (removedPhraseSet.has(p)) out.push(p);
        continue;
      }
      if (!allowed("removed-concepts", opts.categories ?? {})) {
        suppressedByCategory++;
        continue;
      }
      if (base.has(fingerprintRemoved(p))) {
        suppressedByBaseline++;
        continue;
      }
      out.push(p);
    }
    return out;
  })();

  const changedCommitments = changedCommitmentsEvidence.map((ev) => ev.summary);
  const possibleContradictions = possibleContradictionsEvidence.map((ev) => ev.summary);

  // Rebuild summary so it reflects the filtered view (important when
  // --baseline or --only/--exclude suppressed findings from the raw result).
  const anyFiltered = suppressedByCategory + suppressedByBaseline > 0;
  const summary = anyFiltered
    ? buildSummary({
        addedConcepts,
        removedConcepts,
        renamedIdeas,
        changedCommitments,
        actionItemsAdded,
        actionItemsRemoved,
        possibleContradictions,
      })
    : result.summary;

  const filtered: AnalysisResult = {
    ...result,
    changedCommitmentsEvidence,
    possibleContradictionsEvidence,
    renamedIdeas,
    addedConceptsEvidence,
    removedConceptsEvidence,
    actionItemsAdded,
    actionItemsRemoved,
    addedConcepts,
    removedConcepts,
    changedCommitments,
    possibleContradictions,
    summary,
  };

  return {
    result: filtered,
    stats: { suppressedByCategory, suppressedByBaseline },
  };
}
