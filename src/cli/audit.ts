/**
 * `samediff audit <history-dir>` — produce a compact, scan-friendly
 * markdown report of every transition in a history trail, optimized
 * for "is this signal or noise?" judgment.
 *
 * Per-step output is intentionally dense (~15–30 lines): subject,
 * narrative summary, every finding in one-line form, and just the
 * changed source lines. Easy to scroll through 50 steps and spot
 * patterns without each section pushing context off the screen.
 *
 * Re-runs the engine per step rather than reading per-pair JSON;
 * the engine is fast enough that 100 steps complete in a few
 * seconds on docs-sized files.
 *
 * Persistent verdict memory
 * -------------------------
 * Reviewer judgments are preserved across reruns in a `verdicts.json`
 * sidecar living next to `audit.md`. The identity of a step is the
 * tuple (fromRef, toRef, filePath) hashed to a stable stepKey — this
 * is what survives trail regeneration. A separate findings fingerprint
 * records whether the engine's view of the step has changed since the
 * last time a human confirmed it; when it has, the verdict is carried
 * forward but the step is flagged `engine-changed` for re-review
 * rather than silently rubber-stamping the old verdict.
 *
 * Flow on every `samediff audit` run:
 *   1. Harvest inline `**verdict**: <value>` slots from any existing
 *      audit.md (this is how humans record decisions; the roundtrip
 *      keeps the data model diff-friendly in git).
 *   2. Merge harvested verdicts into verdicts.json (preserving prior
 *      provenance: firstSeenAt, verdictSetAt).
 *   3. For each trail step, compute status vs. the stored entry:
 *        new          — no prior entry for this stepKey
 *        persisted    — prior entry, same findings fingerprint
 *        engine-changed — prior entry, different findings fingerprint
 *      Entries in verdicts.json whose stepKey is no longer in the trail
 *      are retained in an `orphaned[]` bucket so a spec rewrite can't
 *      silently drop last quarter's FP judgments.
 *   4. Render audit.md with prior verdicts shown inline and status
 *      badges on step headings; write verdicts.json.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { buildNarrative } from "../analysis/narrative";
import { buildDiffResult, type DiffResult } from "./resultModel";
import { diffLinesWithHunks } from "./sourceDiff";
import type { HistoryReport, HistoryStep } from "./history";

const VERDICTS_SCHEMA_VERSION = "1";
const AUDIT_ENGINE_VERSION = "0.7.0";

export type Verdict = "signal" | "fp" | "noise" | "unclear";

export type VerdictEntry = {
  /** Stable identity across reruns: hash of (fromRef, toRef, filePath). */
  stepKey: string;
  /** Tuple that produced the stepKey — preserved for human readability. */
  fromRef: string;
  toRef: string;
  toShort: string;
  filePath: string;
  /** Truncated commit subject captured at last audit run (for ergonomics). */
  commitSubject: string;
  /** Reviewer judgment, or null if none recorded yet. */
  verdict: Verdict | null;
  /** Optional free-form reviewer note. */
  note: string | null;
  /** ISO timestamp — first time this step was observed by audit. */
  firstSeenAt: string;
  /** ISO timestamp — most recent audit run that observed this step. */
  lastConfirmedAt: string;
  /** ISO timestamp — when the current verdict value was recorded, or null. */
  verdictSetAt: string | null;
  /** Engine version at the time the verdict was recorded, or null. */
  engineVersionAtJudgment: string | null;
  /** Hash of the engine's structural finding set for this step. */
  findingsFingerprint: string;
};

export type VerdictStore = {
  version: string;
  filePath: string;
  generatedAt: string;
  engineVersion: string;
  /** Live entries — one per step present in the current trail. */
  entries: VerdictEntry[];
  /**
   * Entries no longer backed by a step in the current trail. Retained
   * so a spec rewrite can't silently drop prior human judgment.
   */
  orphaned: VerdictEntry[];
};

export type StepStatus = "new" | "persisted" | "engine-changed";

export type AuditOptions = {
  /** Directory containing trail.json (typically a `samediff history` outDir). */
  historyDir: string;
  /** Working directory — must be inside the git repo whose refs the trail uses. */
  cwd: string;
  /** Cap on changed lines per step's diff section. Default 60. */
  maxDiffLines?: number;
  /** Include below-the-fold (quiet) issues. Default false to keep dense. */
  includeQuiet?: boolean;
  /**
   * Override "now" for deterministic tests. Defaults to `new Date().toISOString()`.
   */
  nowIso?: string;
};

export type AuditSummary = {
  steps: number;
  withThesis: number;
  withComposite: number;
  highOrCritical: number;
  totalFindings: number;
  newSteps: number;
  persistedSteps: number;
  engineChangedSteps: number;
  orphanedEntries: number;
  outPath: string;
  verdictsPath: string;
};

export function runAudit(opts: AuditOptions): AuditSummary {
  const trailPath = join(opts.historyDir, "trail.json");
  const trail: HistoryReport = JSON.parse(readFileSync(trailPath, "utf-8"));

  const maxDiff = opts.maxDiffLines ?? 60;
  const includeQuiet = !!opts.includeQuiet;
  const nowIso = opts.nowIso ?? new Date().toISOString();

  // Use the git root recorded in trail.json so audit works from any
  // directory (the user might run `samediff audit /tmp/...` from a
  // completely different repo than the one history was run in).
  // Fall back to cwd for trails generated before gitRoot was added.
  const gitCwd = trail.gitRoot ?? opts.cwd;

  const verdictsPath = join(opts.historyDir, "verdicts.json");
  const auditPath = join(opts.historyDir, "audit.md");

  // ── Load prior state ──────────────────────────────────────────────
  const priorStore = loadVerdictStore(verdictsPath, trail.filePath);
  const harvested = existsSync(auditPath)
    ? harvestVerdictsFromMarkdown(readFileSync(auditPath, "utf-8"))
    : new Map<string, HarvestedVerdict>();

  // Prior entries indexed by stepKey, then overlaid with any human
  // edits found in audit.md.
  const priorByKey = new Map<string, VerdictEntry>();
  for (const e of priorStore.entries) priorByKey.set(e.stepKey, e);
  for (const e of priorStore.orphaned) priorByKey.set(e.stepKey, e);

  // ── Compute this run's per-step state ─────────────────────────────
  type RenderedStep = {
    step: HistoryStep;
    block: StepBlock;
    stepKey: string;
    findingsFingerprint: string;
    status: StepStatus;
    entry: VerdictEntry;
  };
  const rendered: RenderedStep[] = [];

  const liveKeys = new Set<string>();
  let newSteps = 0;
  let persistedSteps = 0;
  let engineChangedSteps = 0;
  let withThesis = 0;
  let withComposite = 0;
  let highOrCrit = 0;
  let totalFindings = 0;

  for (const step of trail.steps) {
    const stepKey = computeStepKey(step.fromRef, step.toRef, trail.filePath);
    liveKeys.add(stepKey);

    const result = analyzeStep(step, gitCwd, trail.filePath);
    const findingsFingerprint = computeFindingsFingerprint(result.diff);
    const prior = priorByKey.get(stepKey) ?? null;
    const harvestHit = harvested.get(stepKey) ?? null;

    // Resolve authoritative verdict state for this step. An edit in
    // audit.md wins over the prior stored state — that's how humans
    // record a judgment. An absent slot falls through to prior.
    let verdict: Verdict | null = prior?.verdict ?? null;
    let note: string | null = prior?.note ?? null;
    let verdictSetAt = prior?.verdictSetAt ?? null;
    let engineVersionAtJudgment = prior?.engineVersionAtJudgment ?? null;

    if (harvestHit) {
      const harvestedVerdict = harvestHit.verdict;
      const harvestedNote = harvestHit.note;
      const changed =
        harvestedVerdict !== (prior?.verdict ?? null) ||
        (harvestedNote ?? null) !== (prior?.note ?? null);
      if (changed) {
        verdict = harvestedVerdict;
        note = harvestedNote;
        verdictSetAt = nowIso;
        engineVersionAtJudgment = AUDIT_ENGINE_VERSION;
      }
    }

    // Status resolution.
    let status: StepStatus;
    if (!prior) {
      status = "new";
      newSteps++;
    } else if (prior.findingsFingerprint !== findingsFingerprint) {
      status = "engine-changed";
      engineChangedSteps++;
    } else {
      status = "persisted";
      persistedSteps++;
    }

    const entry: VerdictEntry = {
      stepKey,
      fromRef: step.fromRef,
      toRef: step.toRef,
      toShort: step.toShort,
      filePath: trail.filePath,
      commitSubject: truncate(step.commitSubject, 200),
      verdict,
      note,
      firstSeenAt: prior?.firstSeenAt ?? nowIso,
      lastConfirmedAt: nowIso,
      verdictSetAt,
      engineVersionAtJudgment,
      findingsFingerprint,
    };

    const block = renderStep(step, result, maxDiff, includeQuiet, status, entry);

    if (block.hasThesis) withThesis++;
    if (block.hasComposite) withComposite++;
    if (block.severity === "high" || block.severity === "critical") highOrCrit++;
    totalFindings += block.findingCount;

    rendered.push({ step, block, stepKey, findingsFingerprint, status, entry });
  }

  // Any prior entries that aren't in the live trail become orphaned.
  // These carry their original verdict forward so the reviewer can see
  // what was previously judged on transitions that no longer exist.
  const orphaned: VerdictEntry[] = [];
  for (const [key, entry] of priorByKey) {
    if (!liveKeys.has(key)) {
      orphaned.push({
        ...entry,
        // lastConfirmedAt stays as-is — we did NOT see this step this run.
      });
    }
  }

  // ── Assemble audit.md ─────────────────────────────────────────────
  const sections: string[] = [];
  sections.push(`# Audit — ${trail.filePath}\n`);
  sections.push(
    `${trail.steps.length} transition${trail.steps.length === 1 ? "" : "s"} ` +
    `· generated ${trail.generatedAt}\n`,
  );
  sections.push(renderStateSummary({
    newSteps,
    persistedSteps,
    engineChangedSteps,
    orphanedCount: orphaned.length,
  }));
  sections.push(
    "Scan each step's findings + diff and decide if the narrative " +
    "is genuine signal, false positive, or noise. Edit the `**verdict**` " +
    "slot on any step (one of: `signal`, `fp`, `noise`, `unclear`) and " +
    "rerun `samediff audit` to persist the judgment into `verdicts.json`. " +
    "Prior verdicts carry forward automatically; steps whose findings " +
    "have changed since last review are flagged `[ENGINE-CHANGED]` for " +
    "re-review.\n",
  );

  for (const r of rendered) sections.push(r.block.markdown);

  if (orphaned.length > 0) {
    sections.push(renderOrphanedSection(orphaned));
  }

  writeFileSync(auditPath, sections.join("\n"), "utf-8");

  // ── Assemble verdicts.json ────────────────────────────────────────
  const store: VerdictStore = {
    version: VERDICTS_SCHEMA_VERSION,
    filePath: trail.filePath,
    generatedAt: nowIso,
    engineVersion: AUDIT_ENGINE_VERSION,
    entries: rendered.map((r) => r.entry),
    orphaned,
  };
  writeFileSync(verdictsPath, JSON.stringify(store, null, 2) + "\n", "utf-8");

  return {
    steps: trail.steps.length,
    withThesis,
    withComposite,
    highOrCritical: highOrCrit,
    totalFindings,
    newSteps,
    persistedSteps,
    engineChangedSteps,
    orphanedEntries: orphaned.length,
    outPath: auditPath,
    verdictsPath,
  };
}

// ── Identity and fingerprinting ──────────────────────────────────

function computeStepKey(fromRef: string, toRef: string, filePath: string): string {
  const h = createHash("sha256");
  h.update(fromRef);
  h.update("\n");
  h.update(toRef);
  h.update("\n");
  h.update(filePath);
  return "sha256:" + h.digest("hex").slice(0, 32);
}

/**
 * A structural hash of the engine's finding set for this step. Changes
 * when the engine retunes, when source text changes such that findings
 * shift, or when the narrative layer reshapes what counts as a top
 * issue. Stable across cosmetic changes that don't affect the finding
 * set (whitespace, scoring tweaks that don't move findings in/out).
 */
function computeFindingsFingerprint(diff: DiffResult): string {
  const parts: string[] = [];
  for (const f of diff.findings.commitmentShifts) {
    parts.push(`cs|${norm(f.evidence.before)}|${norm(f.evidence.after)}|${f.evidence.triggers.slice().sort().join(",")}`);
  }
  for (const f of diff.findings.contradictions) {
    parts.push(`ct|${f.reason}|${f.confidence}|${norm(f.evidence.before)}|${norm(f.evidence.after)}`);
  }
  for (const f of diff.findings.conceptRenames) {
    parts.push(`cr|${norm(f.from)}|${norm(f.to)}|${f.confidence}`);
  }
  for (const f of diff.findings.addedConcepts) {
    parts.push(`+c|${norm(f.phrase)}`);
  }
  for (const f of diff.findings.removedConcepts) {
    parts.push(`-c|${norm(f.phrase)}`);
  }
  for (const f of diff.findings.actionItemsStatusChanges) {
    parts.push(`ts|${f.transition}|${norm(f.subject)}`);
  }
  for (const f of diff.findings.actionItemsAdded) {
    parts.push(`+t|${norm(f.description)}`);
  }
  for (const f of diff.findings.actionItemsRemoved) {
    parts.push(`-t|${norm(f.description)}`);
  }
  parts.sort();
  const h = createHash("sha256");
  h.update(parts.join("\n"));
  return "sha256:" + h.digest("hex").slice(0, 32);
}

function norm(s: string | null): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ");
}

// ── Verdict store persistence ────────────────────────────────────

function loadVerdictStore(path: string, filePath: string): VerdictStore {
  if (!existsSync(path)) {
    return emptyStore(filePath);
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) {
      return emptyStore(filePath);
    }
    return {
      version: raw.version ?? VERDICTS_SCHEMA_VERSION,
      filePath: raw.filePath ?? filePath,
      generatedAt: raw.generatedAt ?? "",
      engineVersion: raw.engineVersion ?? "",
      entries: raw.entries.map(coerceEntry).filter(Boolean) as VerdictEntry[],
      orphaned: Array.isArray(raw.orphaned)
        ? (raw.orphaned.map(coerceEntry).filter(Boolean) as VerdictEntry[])
        : [],
    };
  } catch {
    return emptyStore(filePath);
  }
}

function emptyStore(filePath: string): VerdictStore {
  return {
    version: VERDICTS_SCHEMA_VERSION,
    filePath,
    generatedAt: "",
    engineVersion: "",
    entries: [],
    orphaned: [],
  };
}

function coerceEntry(raw: any): VerdictEntry | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.stepKey !== "string") return null;
  return {
    stepKey: raw.stepKey,
    fromRef: raw.fromRef ?? "",
    toRef: raw.toRef ?? "",
    toShort: raw.toShort ?? "",
    filePath: raw.filePath ?? "",
    commitSubject: raw.commitSubject ?? "",
    verdict: validVerdict(raw.verdict) ? raw.verdict : null,
    note: typeof raw.note === "string" && raw.note.length > 0 ? raw.note : null,
    firstSeenAt: raw.firstSeenAt ?? "",
    lastConfirmedAt: raw.lastConfirmedAt ?? "",
    verdictSetAt: raw.verdictSetAt ?? null,
    engineVersionAtJudgment: raw.engineVersionAtJudgment ?? null,
    findingsFingerprint: raw.findingsFingerprint ?? "",
  };
}

function validVerdict(v: any): v is Verdict {
  return v === "signal" || v === "fp" || v === "noise" || v === "unclear";
}

// ── Harvest verdicts from audit.md ───────────────────────────────

type HarvestedVerdict = {
  verdict: Verdict | null;
  note: string | null;
};

/**
 * Parse `**verdict**: <value>` slots out of an existing audit.md. The
 * marker line below each step is our only mandatory anchor; step keys
 * are collected from the adjacent machine-readable `<!-- step: ... -->`
 * HTML comment that the renderer emits. Returns a map keyed by
 * stepKey. Unknown / empty slots are ignored.
 */
export function harvestVerdictsFromMarkdown(
  markdown: string,
): Map<string, HarvestedVerdict> {
  const out = new Map<string, HarvestedVerdict>();
  // Split by step markers. Each block starts with "<!-- step: <key> -->"
  // on its own line; the same block ends either at the next step
  // marker or at the orphaned-section header.
  const blockRe = /<!--\s*step:\s*(sha256:[a-f0-9]+)\s*-->/g;
  const positions: Array<{ key: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(markdown)) !== null) {
    positions.push({ key: m[1], start: m.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i + 1 < positions.length ? positions[i + 1].start : markdown.length;
    const block = markdown.slice(start, end);

    const verdict = extractVerdictValue(block);
    const note = extractNoteValue(block);
    if (verdict === null && note === null) continue;
    out.set(positions[i].key, { verdict, note });
  }
  return out;
}

function extractVerdictValue(block: string): Verdict | null {
  // Match `**verdict**` optionally followed by `*(carried…)*` metadata,
  // then a colon, then the value up to end of line.
  const re = /\*\*verdict\*\*(?:\s*\*\([^)]*\)\*)?\s*:\s*([^\n]*)/i;
  const m = block.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  // Default placeholder template is ignored.
  if (!raw || raw.startsWith("_(") || raw.startsWith("_—") || raw === "—" || raw === "-") {
    return null;
  }
  const lower = raw.toLowerCase().replace(/[`*_]/g, "").trim();
  // Accept common synonyms and short forms.
  if (lower === "signal" || lower === "s") return "signal";
  if (lower === "fp" || lower === "false positive" || lower === "false-positive") return "fp";
  if (lower === "noise" || lower === "n") return "noise";
  if (lower === "unclear" || lower === "u" || lower === "?") return "unclear";
  return null;
}

function extractNoteValue(block: string): string | null {
  const re = /\*\*note\*\*\s*:\s*([^\n]*)/i;
  const m = block.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw.startsWith("_(")) return null;
  return raw;
}

// ── Per-step analysis and render ─────────────────────────────────

type StepBlock = {
  markdown: string;
  hasThesis: boolean;
  hasComposite: boolean;
  severity: string;
  findingCount: number;
};

type StepAnalysis = {
  diff: DiffResult;
  narrative: ReturnType<typeof buildNarrative>;
  fromText: string;
  toText: string;
};

function analyzeStep(step: HistoryStep, cwd: string, filePath: string): StepAnalysis {
  const fromText = step.fromRef === "EMPTY" ? "" : readAtRef(step.fromRef, filePath, cwd);
  const toText = readAtRef(step.toRef, filePath, cwd);
  const analysis = analyzeTextPair(fromText, toText);
  const diff = buildDiffResult(analysis, {
    labelA: step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8),
    labelB: step.toRef.slice(0, 8),
  });
  const narrative = buildNarrative(diff);
  return { diff, narrative, fromText, toText };
}

function renderStep(
  step: HistoryStep,
  result: StepAnalysis,
  maxDiff: number,
  includeQuiet: boolean,
  status: StepStatus,
  entry: VerdictEntry,
): StepBlock {
  const { diff, narrative, fromText, toText } = result;

  const fromShort = step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8);
  const date = step.authorDate.slice(0, 10);
  const findingsTotal = diff.counts.total;

  const lines: string[] = [];

  // Machine-readable step marker — consumed by harvestVerdictsFromMarkdown.
  lines.push(`<!-- step: ${entry.stepKey} -->`);

  // Heading with status badge when noteworthy.
  const badge =
    status === "new"
      ? " `[NEW]`"
      : status === "engine-changed"
        ? " `[ENGINE-CHANGED]`"
        : "";
  lines.push(
    `## Step ${step.index}${badge} — \`${fromShort}\` → \`${step.toShort}\` · ` +
    `score **${step.score.toFixed(1)}** · ${step.severity}`,
  );
  lines.push(
    `**[${date}]** ${step.authorName} · ${truncate(step.commitSubject, 100)}`,
  );
  lines.push("");

  // Narrative summary.
  if (narrative.thesis) {
    const compTag = narrative.thesis.isComposite ? " *(composite)*" : "";
    lines.push(`**thesis**${compTag}: ${narrative.thesis.headline}`);
    lines.push(`  *${narrative.thesis.subheadline}*`);
  } else {
    lines.push(`**thesis**: —`);
  }
  if (narrative.issues.length > 0) {
    const top = narrative.issues[0];
    lines.push(`**top issue**: \`[${top.kind}]\` ${truncate(top.title, 130)}`);
  } else {
    lines.push(`**top issue**: —`);
  }
  lines.push("");

  // Every finding as a one-liner.
  const findingLines: string[] = [];
  for (const f of diff.findings.commitmentShifts) {
    const before = truncate(f.evidence.before, 60);
    const after = truncate(f.evidence.after, 60);
    const triggers = f.evidence.triggers.join(", ");
    findingLines.push(`- \`[commit-shift]\` ${quote(before)} → ${quote(after)} *(${triggers})*`);
  }
  for (const f of diff.findings.contradictions) {
    const before = truncate(f.evidence.before, 60);
    const after = truncate(f.evidence.after, 60);
    findingLines.push(
      `- \`[contradiction · ${f.reason} · ${f.confidence}]\` ` +
      `BEFORE: ${quote(before)} / AFTER: ${quote(after)}`,
    );
  }
  for (const f of diff.findings.conceptRenames) {
    findingLines.push(
      `- \`[rename · ${f.confidence}]\` ` +
      `${quote(f.from)} → ${quote(f.to)}` +
      (f.note ? ` *(${f.note})*` : ""),
    );
  }
  for (const f of diff.findings.addedConcepts) {
    findingLines.push(
      `- \`[+concept]\` ${quote(f.phrase)}` +
      (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    );
  }
  for (const f of diff.findings.removedConcepts) {
    findingLines.push(
      `- \`[-concept]\` ${quote(f.phrase)}` +
      (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    );
  }
  for (const f of diff.findings.actionItemsStatusChanges) {
    findingLines.push(`- \`[task · ${f.transition}]\` ${quote(f.subject)}`);
  }

  if (findingLines.length === 0) {
    lines.push(`**findings**: _(none)_`);
  } else {
    lines.push(`**findings** (${findingLines.length}):`);
    for (const fl of findingLines) lines.push(fl);
  }

  if (includeQuiet && narrative.quiet.length > 0) {
    lines.push("");
    lines.push(`**quiet** (${narrative.quiet.length}):`);
    for (const i of narrative.quiet.slice(0, 8)) {
      lines.push(`- \`[${i.kind}]\` ${truncate(i.title, 130)}`);
    }
  }

  // Source diff — only changed lines, capped.
  lines.push("");
  lines.push("**diff** (changed lines only):");
  lines.push("```diff");
  const dh = diffLinesWithHunks(fromText, toText);
  if (!dh) {
    lines.push("(file too large to diff)");
  } else if (dh.changedLines === 0) {
    lines.push("(no line-level changes — engine fired on token-level patterns)");
  } else {
    let shown = 0;
    let truncated = false;
    outer: for (const hunk of dh.hunks) {
      for (const row of hunk.rows) {
        if (row.op === "equal") continue;
        if (shown >= maxDiff) {
          truncated = true;
          break outer;
        }
        const prefix = row.op === "add" ? "+" : "-";
        lines.push(`${prefix} ${truncateForDiff(row.text, 200)}`);
        shown++;
      }
    }
    if (truncated) {
      lines.push(`... (${dh.changedLines - maxDiff} more changed line${dh.changedLines - maxDiff === 1 ? "" : "s"} elided)`);
    }
  }
  lines.push("```");

  // Verdict slot — show prior judgment if one exists, else the prompt
  // template. Engine-changed steps show the prior verdict but flag it.
  lines.push("");
  if (entry.verdict) {
    const carriedDate = (entry.verdictSetAt ?? entry.firstSeenAt).slice(0, 10);
    const engineTag = status === "engine-changed" ? " · **re-review needed**" : "";
    lines.push(
      `**verdict** *(carried from ${carriedDate}${engineTag})*: ${entry.verdict}`,
    );
    if (entry.note) {
      lines.push(`**note**: ${entry.note}`);
    } else {
      lines.push(`**note**: _(optional reviewer note)_`);
    }
  } else {
    lines.push("**verdict**: _( signal | fp | noise | unclear — annotate here )_");
    lines.push("**note**: _(optional reviewer note)_");
  }
  lines.push("");
  lines.push("---");

  return {
    markdown: lines.join("\n"),
    hasThesis: narrative.thesis !== null,
    hasComposite: !!narrative.thesis?.isComposite,
    severity: step.severity,
    findingCount: findingsTotal,
  };
}

function renderStateSummary(counts: {
  newSteps: number;
  persistedSteps: number;
  engineChangedSteps: number;
  orphanedCount: number;
}): string {
  const lines: string[] = [];
  lines.push("**state**:");
  lines.push(`- ${counts.newSteps} new`);
  lines.push(`- ${counts.persistedSteps} persisted (prior verdicts carried forward)`);
  lines.push(`- ${counts.engineChangedSteps} engine-changed (re-review recommended)`);
  lines.push(`- ${counts.orphanedCount} orphaned (prior verdict but step no longer in trail)`);
  lines.push("");
  return lines.join("\n");
}

function renderOrphanedSection(orphaned: VerdictEntry[]): string {
  const lines: string[] = [];
  lines.push("## Orphaned verdicts");
  lines.push("");
  lines.push(
    "These steps were present in a prior trail but no longer appear in " +
    "the current one (commits rewritten, file renamed, or history truncated). " +
    "Their prior verdicts are retained in `verdicts.json` under `orphaned[]`.",
  );
  lines.push("");
  for (const o of orphaned) {
    const fromShort = o.fromRef === "EMPTY" ? "EMPTY" : o.fromRef.slice(0, 8);
    const verdictLabel = o.verdict ?? "(no verdict)";
    lines.push(
      `- \`${fromShort}\` → \`${o.toShort}\` · **${verdictLabel}** · ` +
      `${truncate(o.commitSubject, 80)}`,
    );
  }
  lines.push("");
  lines.push("---");
  return lines.join("\n");
}

export function renderAuditSummary(summary: AuditSummary): string {
  return [
    `samediff audit:`,
    `  ${summary.steps} step${summary.steps === 1 ? "" : "s"}, ` +
      `${summary.totalFindings} total findings`,
    `  ${summary.withThesis} thesis-firing (${summary.withComposite} composite)`,
    `  ${summary.highOrCritical} high or critical severity`,
    `  verdicts: ${summary.newSteps} new · ${summary.persistedSteps} persisted · ` +
      `${summary.engineChangedSteps} engine-changed · ${summary.orphanedEntries} orphaned`,
    `  wrote ${summary.outPath}`,
    `  wrote ${summary.verdictsPath}`,
  ].join("\n") + "\n";
}

// ── Helpers ──────────────────────────────────────────────────────

function readAtRef(ref: string, filePath: string, cwd: string): string {
  return execFileSync("git", ["show", `${ref}:${filePath}`], {
    cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  });
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "\u2026" : s;
}

function truncateForDiff(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

function quote(s: string | null): string {
  if (!s) return '""';
  const esc = s.replace(/`/g, "\u02CB");
  return `"${esc}"`;
}
