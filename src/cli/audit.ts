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
 * Persistent verdict memory (schema v2)
 * -------------------------------------
 * Identity is the foundation. A reviewer's judgment is anchored to a
 * stable fingerprint so it survives reruns — at two levels:
 *
 *   1. Step identity:  sha256(fromRef || toRef || filePath).
 *      Stable across trail regeneration; rebase-aware (a different
 *      parent is correctly treated as a different transition).
 *
 *   2. Finding fingerprint: sha256 of the *semantic core* only —
 *      kind + normalized evidence. Ancillary engine labels
 *      (triggers, reason tag, confidence) are deliberately excluded,
 *      so same-meaning-different-labels keeps its prior verdict.
 *      If the evidence itself shifts, the fingerprint shifts, and
 *      the prior verdict stays attached to the orphaned finding
 *      rather than silently transferring to a different thing.
 *
 * Roundtrip: markdown-first. Humans edit `**verdict**` slots and the
 * optional `**finding-verdicts**` block in `audit.md`. The next
 * `samediff audit` run harvests those edits, persists them into
 * `verdicts.json`, and re-renders with carried verdicts inline and
 * `[NEW]` / `[DRIFTED]` badges where the finding set has changed.
 * Prior verdicts on transitions that no longer exist in the live
 * trail, and on findings no longer present within a persisted step,
 * are preserved in the `orphanedSteps` / `orphanedFindings` buckets
 * so a spec rewrite can't silently drop prior human judgment.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTextPair } from "../analysis/analyzeTextPair";
import { buildNarrative } from "../analysis/narrative";
import {
  buildTrailThesis,
  type TrailThesis,
  type StepNarrativeInput,
} from "../analysis/narrative/trail";
import { buildDiffResult, type DiffResult } from "./resultModel";
import { diffLinesWithHunks } from "./sourceDiff";
import type { HistoryReport, HistoryStep } from "./history";

const VERDICTS_SCHEMA_VERSION = "2";
const AUDIT_ENGINE_VERSION = "0.7.0";
const DISPLAY_ID_LEN = 12;

// ── Public types ─────────────────────────────────────────────────

export type Verdict = "signal" | "fp" | "noise" | "unclear";

export type VerdictRecord = {
  value: Verdict;
  note: string | null;
  setAt: string;
  engineVersionAtJudgment: string;
};

export type FindingRecord = {
  fingerprint: string;
  kind: FindingKind;
  summary: string;
  firstSeenAt: string;
  lastConfirmedAt: string;
  verdict: VerdictRecord | null;
};

export type StepRecord = {
  stepKey: string;
  fromRef: string;
  toRef: string;
  toShort: string;
  filePath: string;
  commitSubject: string;
  firstSeenAt: string;
  lastConfirmedAt: string;
  verdict: VerdictRecord | null;
  findings: FindingRecord[];
  orphanedFindings: FindingRecord[];
};

export type VerdictStore = {
  version: string;
  filePath: string;
  generatedAt: string;
  engineVersion: string;
  steps: StepRecord[];
  orphanedSteps: StepRecord[];
};

export type FindingKind =
  | "commit-shift"
  | "contradiction"
  | "rename"
  | "+concept"
  | "-concept"
  | "task-status"
  | "+task"
  | "-task";

export type StepStatus = "new" | "persisted" | "drifted";
export type FindingStatus = "new" | "persisted";

export type AuditOptions = {
  historyDir: string;
  cwd: string;
  maxDiffLines?: number;
  includeQuiet?: boolean;
  /** Override "now" for deterministic tests. */
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
  driftedSteps: number;
  newFindings: number;
  persistedFindings: number;
  orphanedFindings: number;
  orphanedSteps: number;
  outPath: string;
  verdictsPath: string;
};

// ── Canonical per-finding representation ─────────────────────────

/**
 * Stable, engine-label-tolerant representation of one finding. The
 * fingerprint is computed from the semantic core (kind + normalized
 * evidence) only — deliberately excluding triggers / reason /
 * confidence so retuning those doesn't invalidate prior verdicts.
 */
type CanonicalFinding = {
  kind: FindingKind;
  fingerprint: string;
  /** Short human-readable preview for orphaned-display and logs. */
  summary: string;
  /** The ready-to-render one-liner (without the {f:id} tag). */
  renderBody: string;
};

function canonicalFindingsForStep(diff: DiffResult): CanonicalFinding[] {
  const out: CanonicalFinding[] = [];

  for (const f of diff.findings.commitmentShifts) {
    const before = norm(f.evidence.before);
    const after = norm(f.evidence.after);
    const triggers = f.evidence.triggers.join(", ");
    out.push({
      kind: "commit-shift",
      fingerprint: finger("commit-shift", { before, after }),
      summary: `${truncate(before, 40)} → ${truncate(after, 40)}`,
      renderBody:
        `\`[commit-shift]\` ${quote(truncate(f.evidence.before, 60))} → ` +
        `${quote(truncate(f.evidence.after, 60))} *(${triggers})*`,
    });
  }

  for (const f of diff.findings.contradictions) {
    const before = norm(f.evidence.before);
    const after = norm(f.evidence.after);
    out.push({
      kind: "contradiction",
      fingerprint: finger("contradiction", { before, after }),
      summary: `BEFORE ${truncate(before, 30)} / AFTER ${truncate(after, 30)}`,
      renderBody:
        `\`[contradiction · ${f.reason} · ${f.confidence}]\` ` +
        `BEFORE: ${quote(truncate(f.evidence.before, 60))} / ` +
        `AFTER: ${quote(truncate(f.evidence.after, 60))}`,
    });
  }

  for (const f of diff.findings.conceptRenames) {
    const from = norm(f.from);
    const to = norm(f.to);
    out.push({
      kind: "rename",
      fingerprint: finger("rename", { from, to }),
      summary: `${from} → ${to}`,
      renderBody:
        `\`[rename · ${f.confidence}]\` ${quote(f.from)} → ${quote(f.to)}` +
        (f.note ? ` *(${f.note})*` : ""),
    });
  }

  for (const f of diff.findings.addedConcepts) {
    const phrase = norm(f.phrase);
    out.push({
      kind: "+concept",
      fingerprint: finger("+concept", { phrase }),
      summary: `+${phrase}`,
      renderBody:
        `\`[+concept]\` ${quote(f.phrase)}` +
        (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    });
  }

  for (const f of diff.findings.removedConcepts) {
    const phrase = norm(f.phrase);
    out.push({
      kind: "-concept",
      fingerprint: finger("-concept", { phrase }),
      summary: `-${phrase}`,
      renderBody:
        `\`[-concept]\` ${quote(f.phrase)}` +
        (f.sourceClause ? ` — from: ${quote(truncate(f.sourceClause, 80))}` : ""),
    });
  }

  for (const f of diff.findings.actionItemsStatusChanges) {
    const subject = norm(f.subject);
    out.push({
      kind: "task-status",
      fingerprint: finger("task-status", { subject, transition: f.transition }),
      summary: `${f.transition}: ${truncate(subject, 50)}`,
      renderBody: `\`[task · ${f.transition}]\` ${quote(f.subject)}`,
    });
  }

  for (const f of diff.findings.actionItemsAdded) {
    const description = norm(f.description);
    out.push({
      kind: "+task",
      fingerprint: finger("+task", { description }),
      summary: `+task: ${truncate(description, 50)}`,
      renderBody: `\`[+task]\` ${quote(f.description)}`,
    });
  }

  for (const f of diff.findings.actionItemsRemoved) {
    const description = norm(f.description);
    out.push({
      kind: "-task",
      fingerprint: finger("-task", { description }),
      summary: `-task: ${truncate(description, 50)}`,
      renderBody: `\`[-task]\` ${quote(f.description)}`,
    });
  }

  return out;
}

function finger(kind: FindingKind, parts: Record<string, string>): string {
  const h = createHash("sha256");
  h.update(kind);
  h.update("\0");
  const keys = Object.keys(parts).sort();
  for (const k of keys) {
    h.update(k);
    h.update("=");
    h.update(parts[k]);
    h.update("\0");
  }
  return "sha256:" + h.digest("hex").slice(0, 32);
}

function norm(s: string | null): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayId(fingerprint: string): string {
  // Strip the "sha256:" prefix if present, take first DISPLAY_ID_LEN hex chars.
  const h = fingerprint.startsWith("sha256:") ? fingerprint.slice(7) : fingerprint;
  return h.slice(0, DISPLAY_ID_LEN);
}

// ── Identity: step key ───────────────────────────────────────────

function computeStepKey(fromRef: string, toRef: string, filePath: string): string {
  const h = createHash("sha256");
  h.update(fromRef);
  h.update("\n");
  h.update(toRef);
  h.update("\n");
  h.update(filePath);
  return "sha256:" + h.digest("hex").slice(0, 32);
}

// ── Store persistence + migration ────────────────────────────────

function loadVerdictStore(path: string, filePath: string): VerdictStore {
  if (!existsSync(path)) {
    return emptyStore(filePath);
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw !== "object") return emptyStore(filePath);

    // v2 — native.
    if (raw.version === "2" && Array.isArray(raw.steps)) {
      return {
        version: "2",
        filePath: raw.filePath ?? filePath,
        generatedAt: raw.generatedAt ?? "",
        engineVersion: raw.engineVersion ?? "",
        steps: raw.steps.map(coerceStep).filter(Boolean) as StepRecord[],
        orphanedSteps: Array.isArray(raw.orphanedSteps)
          ? (raw.orphanedSteps.map(coerceStep).filter(Boolean) as StepRecord[])
          : [],
      };
    }

    // v1 — migrate. v1 had `entries: [{stepKey, verdict, note, findingsFingerprint, ...}]`
    // plus an `orphaned: []` bucket. Carry step-level verdicts forward;
    // findings start empty (v1 had no per-finding memory).
    if (raw.version === "1" && Array.isArray(raw.entries)) {
      const migrate = (e: any): StepRecord | null => {
        if (!e || typeof e.stepKey !== "string") return null;
        const verdict = validVerdict(e.verdict)
          ? {
              value: e.verdict as Verdict,
              note: typeof e.note === "string" && e.note.length > 0 ? e.note : null,
              setAt: e.verdictSetAt ?? e.firstSeenAt ?? "",
              engineVersionAtJudgment: e.engineVersionAtJudgment ?? "",
            }
          : null;
        return {
          stepKey: e.stepKey,
          fromRef: e.fromRef ?? "",
          toRef: e.toRef ?? "",
          toShort: e.toShort ?? "",
          filePath: e.filePath ?? filePath,
          commitSubject: e.commitSubject ?? "",
          firstSeenAt: e.firstSeenAt ?? "",
          lastConfirmedAt: e.lastConfirmedAt ?? "",
          verdict,
          findings: [],
          orphanedFindings: [],
        };
      };
      return {
        version: "2",
        filePath: raw.filePath ?? filePath,
        generatedAt: raw.generatedAt ?? "",
        engineVersion: raw.engineVersion ?? "",
        steps: raw.entries.map(migrate).filter(Boolean) as StepRecord[],
        orphanedSteps: Array.isArray(raw.orphaned)
          ? (raw.orphaned.map(migrate).filter(Boolean) as StepRecord[])
          : [],
      };
    }

    return emptyStore(filePath);
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
    steps: [],
    orphanedSteps: [],
  };
}

function coerceStep(raw: any): StepRecord | null {
  if (!raw || typeof raw !== "object" || typeof raw.stepKey !== "string") return null;
  return {
    stepKey: raw.stepKey,
    fromRef: raw.fromRef ?? "",
    toRef: raw.toRef ?? "",
    toShort: raw.toShort ?? "",
    filePath: raw.filePath ?? "",
    commitSubject: raw.commitSubject ?? "",
    firstSeenAt: raw.firstSeenAt ?? "",
    lastConfirmedAt: raw.lastConfirmedAt ?? "",
    verdict: coerceVerdict(raw.verdict),
    findings: Array.isArray(raw.findings)
      ? (raw.findings.map(coerceFinding).filter(Boolean) as FindingRecord[])
      : [],
    orphanedFindings: Array.isArray(raw.orphanedFindings)
      ? (raw.orphanedFindings.map(coerceFinding).filter(Boolean) as FindingRecord[])
      : [],
  };
}

function coerceFinding(raw: any): FindingRecord | null {
  if (!raw || typeof raw !== "object" || typeof raw.fingerprint !== "string") return null;
  return {
    fingerprint: raw.fingerprint,
    kind: (raw.kind ?? "+concept") as FindingKind,
    summary: raw.summary ?? "",
    firstSeenAt: raw.firstSeenAt ?? "",
    lastConfirmedAt: raw.lastConfirmedAt ?? "",
    verdict: coerceVerdict(raw.verdict),
  };
}

function coerceVerdict(raw: any): VerdictRecord | null {
  if (!raw || typeof raw !== "object") return null;
  if (!validVerdict(raw.value)) return null;
  return {
    value: raw.value,
    note: typeof raw.note === "string" && raw.note.length > 0 ? raw.note : null,
    setAt: raw.setAt ?? "",
    engineVersionAtJudgment: raw.engineVersionAtJudgment ?? "",
  };
}

function validVerdict(v: any): v is Verdict {
  return v === "signal" || v === "fp" || v === "noise" || v === "unclear";
}

// ── Markdown harvest ─────────────────────────────────────────────

type HarvestedStep = {
  stepKey: string;
  stepVerdict: Verdict | null;
  stepNote: string | null;
  /** Keyed by display id (12-hex prefix). */
  findingVerdicts: Map<string, { verdict: Verdict; note: string | null }>;
};

/**
 * Parse the per-step blocks of an audit.md into structured harvest
 * records. Each block is anchored by a `<!-- step: <key> -->` marker
 * emitted by the renderer. The reviewer-editable fields are
 * `**verdict**`, `**note**`, and lines inside a `**finding-verdicts**`
 * list.
 */
export function harvestVerdictsFromMarkdown(markdown: string): HarvestedStep[] {
  const out: HarvestedStep[] = [];
  const markerRe = /<!--\s*step:\s*(sha256:[a-f0-9]+)\s*-->/g;
  const positions: Array<{ key: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(markdown)) !== null) {
    positions.push({ key: m[1], start: m.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i + 1 < positions.length ? positions[i + 1].start : markdown.length;
    const block = markdown.slice(start, end);

    out.push({
      stepKey: positions[i].key,
      stepVerdict: extractVerdictValue(block),
      stepNote: extractNoteValue(block),
      findingVerdicts: extractFindingVerdicts(block),
    });
  }
  return out;
}

function extractVerdictValue(block: string): Verdict | null {
  // Match the step-level **verdict** line — not inside a fenced block
  // and not a finding-verdicts header.
  const re = /^[ \t]*\*\*verdict\*\*(?:\s*\*\([^)]*\)\*)?\s*:\s*([^\n]*)/im;
  const m = block.match(re);
  if (!m) return null;
  return parseVerdictToken(m[1]);
}

function extractNoteValue(block: string): string | null {
  const re = /^[ \t]*\*\*note\*\*\s*:\s*([^\n]*)/im;
  const m = block.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw.startsWith("_(")) return null;
  return raw;
}

function extractFindingVerdicts(block: string): Map<string, { verdict: Verdict; note: string | null }> {
  const out = new Map<string, { verdict: Verdict; note: string | null }>();
  // Find the finding-verdicts section; everything until the next
  // **bold-header** or horizontal rule.
  const sectionRe = /\*\*finding-verdicts\*\*\s*:[^\n]*\n([\s\S]*?)(?:\n---|\n\*\*[a-zA-Z]|$)/;
  const sec = block.match(sectionRe);
  if (!sec) return out;
  const body = sec[1];
  // Each entry looks like: - `abc123def456` fp — optional note
  const lineRe = /^[ \t]*[-*][ \t]+`?([0-9a-f]{6,32})`?[ \t]+([a-zA-Z?]+)(?:[ \t]*[—-][ \t]*([^\n]+))?/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    const id = m[1].toLowerCase();
    const v = parseVerdictToken(m[2]);
    if (!v) continue;
    const note = m[3]?.trim() || null;
    out.set(id, { verdict: v, note });
  }
  return out;
}

function parseVerdictToken(raw: string): Verdict | null {
  const t = raw.trim();
  if (!t || t.startsWith("_(") || t.startsWith("_—") || t === "—" || t === "-") return null;
  const lower = t.toLowerCase().replace(/[`*_]/g, "").trim();
  if (lower === "signal" || lower === "s") return "signal";
  if (lower === "fp" || lower === "false positive" || lower === "false-positive") return "fp";
  if (lower === "noise" || lower === "n") return "noise";
  if (lower === "unclear" || lower === "u" || lower === "?") return "unclear";
  return null;
}

// ── Audit run ────────────────────────────────────────────────────

export function runAudit(opts: AuditOptions): AuditSummary {
  const trailPath = join(opts.historyDir, "trail.json");
  const trail: HistoryReport = JSON.parse(readFileSync(trailPath, "utf-8"));

  const maxDiff = opts.maxDiffLines ?? 60;
  const includeQuiet = !!opts.includeQuiet;
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const gitCwd = trail.gitRoot ?? opts.cwd;

  const verdictsPath = join(opts.historyDir, "verdicts.json");
  const auditPath = join(opts.historyDir, "audit.md");

  // Load prior state (auto-migrates v1 to v2 in memory).
  const priorStore = loadVerdictStore(verdictsPath, trail.filePath);
  const priorStepsByKey = new Map<string, StepRecord>();
  for (const s of priorStore.steps) priorStepsByKey.set(s.stepKey, s);
  for (const s of priorStore.orphanedSteps) priorStepsByKey.set(s.stepKey, s);

  // Harvest inline edits from the existing audit.md.
  const harvested = existsSync(auditPath)
    ? harvestVerdictsFromMarkdown(readFileSync(auditPath, "utf-8"))
    : [];
  const harvestByKey = new Map<string, HarvestedStep>();
  for (const h of harvested) harvestByKey.set(h.stepKey, h);

  // ── Per-step processing ─────────────────────────────────────────
  type RenderedStep = {
    step: HistoryStep;
    record: StepRecord;
    status: StepStatus;
    findingStatus: Map<string, FindingStatus>;
    analysis: StepAnalysis;
    block: StepBlock;
  };
  const rendered: RenderedStep[] = [];

  const liveStepKeys = new Set<string>();
  let newSteps = 0;
  let persistedSteps = 0;
  let driftedSteps = 0;
  let newFindingsCount = 0;
  let persistedFindingsCount = 0;
  let orphanedFindingsCount = 0;
  let withThesis = 0;
  let withComposite = 0;
  let highOrCrit = 0;
  let totalFindings = 0;

  for (const step of trail.steps) {
    const stepKey = computeStepKey(step.fromRef, step.toRef, trail.filePath);
    liveStepKeys.add(stepKey);

    const analysis = analyzeStep(step, gitCwd, trail.filePath);
    const canon = canonicalFindingsForStep(analysis.diff);
    const prior = priorStepsByKey.get(stepKey) ?? null;
    const harvestHit = harvestByKey.get(stepKey);

    // ── Merge findings at the fingerprint level ────────────────
    const priorFindingByFp = new Map<string, FindingRecord>();
    if (prior) {
      for (const f of prior.findings) priorFindingByFp.set(f.fingerprint, f);
      for (const f of prior.orphanedFindings) priorFindingByFp.set(f.fingerprint, f);
    }

    const liveFindings: FindingRecord[] = [];
    const findingStatus = new Map<string, FindingStatus>();
    const currentFps = new Set<string>();
    const liveFpToDisplay = new Map<string, string>(); // display-id → full fp

    for (const c of canon) {
      const priorF = priorFindingByFp.get(c.fingerprint) ?? null;
      currentFps.add(c.fingerprint);
      liveFpToDisplay.set(displayId(c.fingerprint), c.fingerprint);

      if (priorF) {
        findingStatus.set(c.fingerprint, "persisted");
        persistedFindingsCount++;
        liveFindings.push({
          fingerprint: c.fingerprint,
          kind: c.kind,
          summary: c.summary,
          firstSeenAt: priorF.firstSeenAt || nowIso,
          lastConfirmedAt: nowIso,
          verdict: priorF.verdict,
        });
      } else {
        findingStatus.set(c.fingerprint, "new");
        newFindingsCount++;
        liveFindings.push({
          fingerprint: c.fingerprint,
          kind: c.kind,
          summary: c.summary,
          firstSeenAt: nowIso,
          lastConfirmedAt: nowIso,
          verdict: null,
        });
      }
    }

    // Apply inline finding-verdict edits from audit.md.
    if (harvestHit) {
      for (const [id, hv] of harvestHit.findingVerdicts) {
        const fullFp = liveFpToDisplay.get(id);
        if (!fullFp) continue; // ignore unknown ids silently (could be orphaned)
        const target = liveFindings.find((f) => f.fingerprint === fullFp);
        if (!target) continue;
        const existing = target.verdict;
        const changed =
          !existing ||
          existing.value !== hv.verdict ||
          (existing.note ?? null) !== (hv.note ?? null);
        if (changed) {
          target.verdict = {
            value: hv.verdict,
            note: hv.note,
            setAt: nowIso,
            engineVersionAtJudgment: AUDIT_ENGINE_VERSION,
          };
        }
      }
    }

    // Prior findings that are no longer in the live set become orphans
    // (within this step). Their verdicts are preserved.
    const orphanedFindings: FindingRecord[] = [];
    if (prior) {
      for (const f of [...prior.findings, ...prior.orphanedFindings]) {
        if (currentFps.has(f.fingerprint)) continue;
        orphanedFindings.push({ ...f }); // carry forward as-is; do NOT bump lastConfirmedAt
        orphanedFindingsCount++;
      }
    }

    // ── Step-level verdict resolution ─────────────────────────
    let stepVerdict: VerdictRecord | null = prior?.verdict ?? null;
    if (harvestHit) {
      const harvestedValue = harvestHit.stepVerdict;
      const harvestedNote = harvestHit.stepNote;
      const priorValue = prior?.verdict?.value ?? null;
      const priorNote = prior?.verdict?.note ?? null;
      if (harvestedValue !== null) {
        const changed =
          harvestedValue !== priorValue ||
          (harvestedNote ?? null) !== (priorNote ?? null);
        if (changed) {
          stepVerdict = {
            value: harvestedValue,
            note: harvestedNote,
            setAt: nowIso,
            engineVersionAtJudgment: AUDIT_ENGINE_VERSION,
          };
        }
      }
    }

    // ── Step status ───────────────────────────────────────────
    let status: StepStatus;
    if (!prior) {
      status = "new";
      newSteps++;
    } else {
      // Drifted = any finding new or any prior finding gone.
      const driftNew = liveFindings.some((f) => findingStatus.get(f.fingerprint) === "new");
      const driftGone = orphanedFindings.length > 0;
      if (driftNew || driftGone) {
        status = "drifted";
        driftedSteps++;
      } else {
        status = "persisted";
        persistedSteps++;
      }
    }

    const record: StepRecord = {
      stepKey,
      fromRef: step.fromRef,
      toRef: step.toRef,
      toShort: step.toShort,
      filePath: trail.filePath,
      commitSubject: truncate(step.commitSubject, 200),
      firstSeenAt: prior?.firstSeenAt || nowIso,
      lastConfirmedAt: nowIso,
      verdict: stepVerdict,
      findings: liveFindings,
      orphanedFindings,
    };

    const block = renderStepBlock({
      step,
      record,
      status,
      analysis,
      canon,
      findingStatus,
      maxDiff,
      includeQuiet,
    });

    if (block.hasThesis) withThesis++;
    if (block.hasComposite) withComposite++;
    if (block.severity === "high" || block.severity === "critical") highOrCrit++;
    totalFindings += block.findingCount;

    rendered.push({ step, record, status, findingStatus, analysis, block });
  }

  // ── Orphaned steps ────────────────────────────────────────────
  const orphanedSteps: StepRecord[] = [];
  for (const [key, step] of priorStepsByKey) {
    if (liveStepKeys.has(key)) continue;
    orphanedSteps.push({ ...step });
  }

  // ── Trail (history) thesis ────────────────────────────────────
  // Runs over the per-step narratives we already computed above.
  // Preserves the finding → issue → thesis hierarchy: trail cites
  // real Issues from real steps, never skipping to raw findings.
  const trailInputs: StepNarrativeInput[] = rendered.map((r) => ({
    stepIndex: r.step.index,
    fromRef: r.step.fromRef,
    toRef: r.step.toRef,
    toShort: r.step.toShort,
    authorName: r.step.authorName,
    authorDate: r.step.authorDate,
    commitSubject: r.step.commitSubject,
    severity: r.step.severity,
    score: r.step.score,
    issues: [...r.analysis.narrative.issues, ...r.analysis.narrative.quiet],
  }));
  const trailThesis = buildTrailThesis(trailInputs);

  // ── Write audit.md ────────────────────────────────────────────
  const sections: string[] = [];
  sections.push(`# Audit — ${trail.filePath}\n`);
  sections.push(
    `${trail.steps.length} transition${trail.steps.length === 1 ? "" : "s"} ` +
    `· generated ${trail.generatedAt}\n`,
  );
  if (trailThesis) {
    sections.push(renderTrailThesisSection(trailThesis, trail.steps));
  }
  sections.push(renderStateSummary({
    newSteps,
    persistedSteps,
    driftedSteps,
    newFindings: newFindingsCount,
    persistedFindings: persistedFindingsCount,
    orphanedFindings: orphanedFindingsCount,
    orphanedSteps: orphanedSteps.length,
  }));
  sections.push(
    "Scan each step's findings + diff and decide if the narrative " +
    "is genuine signal, false positive, or noise. Edit the `**verdict**` " +
    "slot on any step (`signal` / `fp` / `noise` / `unclear`) and rerun " +
    "`samediff audit` to persist. Use `**finding-verdicts**` to override " +
    "individual findings by their `{f:<id>}` tag.\n",
  );

  for (const r of rendered) sections.push(r.block.markdown);

  if (orphanedSteps.length > 0) {
    sections.push(renderOrphanedStepsSection(orphanedSteps));
  }

  writeFileSync(auditPath, sections.join("\n"), "utf-8");

  // ── Write verdicts.json ───────────────────────────────────────
  const store: VerdictStore = {
    version: VERDICTS_SCHEMA_VERSION,
    filePath: trail.filePath,
    generatedAt: nowIso,
    engineVersion: AUDIT_ENGINE_VERSION,
    steps: rendered.map((r) => r.record),
    orphanedSteps,
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
    driftedSteps,
    newFindings: newFindingsCount,
    persistedFindings: persistedFindingsCount,
    orphanedFindings: orphanedFindingsCount,
    orphanedSteps: orphanedSteps.length,
    outPath: auditPath,
    verdictsPath,
  };
}

// ── Per-step analysis and rendering ──────────────────────────────

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

function renderStepBlock(args: {
  step: HistoryStep;
  record: StepRecord;
  status: StepStatus;
  analysis: StepAnalysis;
  canon: CanonicalFinding[];
  findingStatus: Map<string, FindingStatus>;
  maxDiff: number;
  includeQuiet: boolean;
}): StepBlock {
  const { step, record, status, analysis, canon, findingStatus, maxDiff, includeQuiet } = args;
  const { diff, narrative, fromText, toText } = analysis;

  const fromShort = step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8);
  const date = step.authorDate.slice(0, 10);
  const findingsTotal = diff.counts.total;

  const lines: string[] = [];

  // Machine-readable step marker — consumed by harvestVerdictsFromMarkdown.
  lines.push(`<!-- step: ${record.stepKey} -->`);

  // Heading badge.
  const badge =
    status === "new"
      ? " `[NEW]`"
      : status === "drifted"
        ? " `[DRIFTED]`"
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

  // Finding list with per-line fp tags, [NEW] flags, carried verdicts.
  const fpRecordByFp = new Map<string, FindingRecord>();
  for (const f of record.findings) fpRecordByFp.set(f.fingerprint, f);

  if (canon.length === 0) {
    lines.push(`**findings**: _(none)_`);
  } else {
    lines.push(`**findings** (${canon.length}):`);
    for (const c of canon) {
      const id = displayId(c.fingerprint);
      const st = findingStatus.get(c.fingerprint);
      const rec = fpRecordByFp.get(c.fingerprint);
      const newTag = st === "new" ? " `[NEW]`" : "";
      const verdictTag = rec?.verdict ? ` *(carried: ${rec.verdict.value})*` : "";
      lines.push(`- ${c.renderBody} \`{f:${id}}\`${newTag}${verdictTag}`);
    }
  }

  // Orphaned findings within this step — preserves prior verdicts
  // attached to findings that no longer fire.
  if (record.orphanedFindings.length > 0) {
    lines.push("");
    lines.push(`**findings no longer present** (${record.orphanedFindings.length}):`);
    for (const o of record.orphanedFindings) {
      const id = displayId(o.fingerprint);
      const v = o.verdict ? ` — prior verdict: \`${o.verdict.value}\`` : "";
      lines.push(`- \`[${o.kind}]\` ${truncate(o.summary, 100)} \`{f:${id}}\`${v}`);
    }
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

  // Step verdict slot.
  lines.push("");
  if (record.verdict) {
    const carriedDate = (record.verdict.setAt || record.firstSeenAt).slice(0, 10);
    const driftTag = status === "drifted" ? " · **re-review recommended**" : "";
    lines.push(
      `**verdict** *(carried from ${carriedDate}${driftTag})*: ${record.verdict.value}`,
    );
    lines.push(
      `**note**: ${record.verdict.note ?? "_(optional reviewer note)_"}`,
    );
  } else {
    lines.push("**verdict**: _( signal | fp | noise | unclear — annotate here )_");
    lines.push("**note**: _(optional reviewer note)_");
  }

  // Finding-verdicts override block. Show it populated when any
  // finding has a recorded verdict, so reviewers can edit in place;
  // otherwise a short prompt.
  const recordedFindings = record.findings.filter((f) => f.verdict !== null);
  if (recordedFindings.length > 0) {
    lines.push("**finding-verdicts**:");
    for (const f of recordedFindings) {
      const id = displayId(f.fingerprint);
      const v = f.verdict!;
      const noteSuffix = v.note ? ` — ${v.note}` : "";
      lines.push(`- \`${id}\` ${v.value}${noteSuffix}`);
    }
  } else {
    lines.push(
      "**finding-verdicts**: _(optional — per-finding overrides; " +
      "one per line: `` `<id>` <verdict> — <note>`` )_",
    );
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
  driftedSteps: number;
  newFindings: number;
  persistedFindings: number;
  orphanedFindings: number;
  orphanedSteps: number;
}): string {
  const lines: string[] = [];
  lines.push("**state**:");
  lines.push(
    `- steps: ${counts.newSteps} new · ${counts.persistedSteps} persisted · ` +
    `${counts.driftedSteps} drifted (findings changed, verdict kept)`,
  );
  lines.push(
    `- findings: ${counts.newFindings} new · ${counts.persistedFindings} persisted · ` +
    `${counts.orphanedFindings} no longer present (verdicts retained)`,
  );
  lines.push(
    `- orphaned steps: ${counts.orphanedSteps} ` +
    `(prior verdict but step no longer in trail)`,
  );
  lines.push("");
  return lines.join("\n");
}

function renderTrailThesisSection(
  t: TrailThesis,
  steps: HistoryStep[],
): string {
  const stepsByIndex = new Map(steps.map((s) => [s.index, s]));
  const lines: string[] = [];
  lines.push("## History thesis");
  lines.push("");
  lines.push(`**${t.headline}**`);
  lines.push("");
  lines.push(`_${t.subheadline}_`);
  lines.push("");
  lines.push(
    `- **pattern**: \`${t.patternId}\` · ` +
    `**confidence**: ${t.confidence} · ` +
    `**severity**: ${t.severity} · ` +
    `**cites**: ${t.citedIssueRefs.length} issue${t.citedIssueRefs.length === 1 ? "" : "s"} across ${t.citedStepIndices.length} step${t.citedStepIndices.length === 1 ? "" : "s"}`,
  );
  if (t.evidenceTopics.length > 0) {
    lines.push(`- **topics**: ${t.evidenceTopics.slice(0, 8).join(", ")}${t.evidenceTopics.length > 8 ? ` (+${t.evidenceTopics.length - 8} more)` : ""}`);
  }
  if (t.arc) {
    const early = t.arc.earlierSteps.map((i) => `#${i}`).join(", ") || "\u2014";
    const late = t.arc.laterSteps.map((i) => `#${i}`).join(", ") || "\u2014";
    const label = t.arc.kind === "reversal" ? "reversal" : "escalation";
    const family = t.arc.family && t.arc.family !== "mixed" ? ` (${t.arc.family})` : "";
    lines.push(`- **arc**: ${label}${family} · earlier: ${early} · later: ${late}`);
  }
  lines.push("");
  lines.push("**Supporting citations**:");
  for (const c of t.citedIssueRefs) {
    const s = stepsByIndex.get(c.stepIndex);
    const fromShort = s?.fromRef === "EMPTY" ? "EMPTY" : s?.fromRef.slice(0, 8) ?? "";
    const date = c.authorDate.slice(0, 10);
    lines.push(
      `- Step ${c.stepIndex} (\`${fromShort}\` → \`${c.toShort}\`, ${date}) · ` +
      `\`[${c.issueKind}]\` ${truncate(c.issueTitle, 130)}`,
    );
  }
  lines.push("");
  lines.push("---");
  return lines.join("\n");
}

function renderOrphanedStepsSection(orphaned: StepRecord[]): string {
  const lines: string[] = [];
  lines.push("## Orphaned verdicts");
  lines.push("");
  lines.push(
    "These steps were present in a prior trail but no longer appear in " +
    "the current one (commits rewritten, file renamed, or history truncated). " +
    "Their prior verdicts are retained in `verdicts.json#orphanedSteps` " +
    "rather than being dropped.",
  );
  lines.push("");
  for (const o of orphaned) {
    const fromShort = o.fromRef === "EMPTY" ? "EMPTY" : o.fromRef.slice(0, 8);
    const v = o.verdict ? o.verdict.value : "(no step verdict)";
    const findingVerdicts = o.findings.filter((f) => f.verdict !== null).length;
    const findingsTag = findingVerdicts > 0 ? ` · ${findingVerdicts} finding verdict${findingVerdicts === 1 ? "" : "s"}` : "";
    lines.push(
      `- \`${fromShort}\` → \`${o.toShort}\` · **${v}**${findingsTag} · ` +
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
    `  steps: ${summary.newSteps} new · ${summary.persistedSteps} persisted · ${summary.driftedSteps} drifted`,
    `  findings: ${summary.newFindings} new · ${summary.persistedFindings} persisted · ${summary.orphanedFindings} orphaned`,
    `  orphaned steps: ${summary.orphanedSteps}`,
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
