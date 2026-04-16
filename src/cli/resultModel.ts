/**
 * Canonical structured result model for SameDiff analysis.
 *
 * This is the intermediate representation that all output renderers consume.
 * It captures the full analysis result plus context metadata (provenance,
 * scoring, timestamps) in a stable, serializable shape.
 *
 * Design principles:
 *   - No ANSI codes, no HTML, no formatting concerns
 *   - Every field has a clear name and predictable type
 *   - Nullable fields use `null`, not `undefined` (for JSON fidelity)
 *   - Evidence arrays may be empty but are always present
 *   - This type is the source of truth for --json output and can be
 *     adopted by --html and --md renderers over time
 */

import type {
  AnalysisResult,
  Confidence,
  FindingProvenance,
} from "../analysis/types";
import { computeDriftScore, driftExitCode } from "./scoring";

export type { FindingProvenance, SourceAnchor, AnchorQuality } from "../analysis/types";

// ── Public types ──────────────────────────────────────────────

export type DiffResult = {
  /** Schema version for forward compatibility */
  version: string;

  /** Tool metadata */
  meta: {
    tool: string;
    toolVersion: string;
    analysisEngine: string;
    generatedAt: string;
  };

  /** Where the inputs came from */
  input: {
    left: InputSource;
    right: InputSource;
  };

  /** Overall severity assessment */
  score: {
    /** 0–10, one decimal place */
    value: number;
    /** "low" | "moderate" | "high" | "critical" */
    label: string;
    /** Process exit code: 0 = no meaningful drift, 1 = drift detected */
    exitCode: number;
  };

  /** Count of findings per category */
  counts: FindingCounts;

  /** Detailed findings by category */
  findings: Findings;

  /** Human-readable summary from the analysis engine */
  summary: string;
};

export type InputSource = {
  label: string;
  path: string | null;
  gitRef: string | null;
};

export type FindingCounts = {
  commitmentShifts: number;
  contradictions: number;
  conceptRenames: number;
  addedConcepts: number;
  removedConcepts: number;
  actionItemsAdded: number;
  actionItemsRemoved: number;
  total: number;
};

export type Findings = {
  commitmentShifts: CommitmentShiftFinding[];
  contradictions: ContradictionFinding[];
  conceptRenames: ConceptRenameFinding[];
  addedConcepts: ConceptFinding[];
  removedConcepts: ConceptFinding[];
  actionItemsAdded: ActionItemFinding[];
  actionItemsRemoved: ActionItemFinding[];
};

export type CommitmentShiftFinding = {
  type: "commitment-shift";
  summary: string;
  evidence: {
    before: string;
    after: string;
    triggers: string[];
  };
  provenance: FindingProvenance | null;
};

export type ContradictionFinding = {
  type: "contradiction";
  summary: string;
  evidence: {
    anchors: string[];
    before: string;
    after: string;
  };
  provenance: FindingProvenance | null;
};

export type ConceptRenameFinding = {
  type: "concept-rename";
  from: string;
  to: string;
  confidence: Confidence;
  note: string | null;
  evidence: {
    sharedContext: string[];
    before: string | null;
    after: string | null;
  };
  provenance: FindingProvenance | null;
};

export type ConceptFinding = {
  type: "added-concept" | "removed-concept";
  phrase: string;
  sourceClause: string | null;
  provenance: FindingProvenance | null;
};

export type ActionItemFinding = {
  type: "action-item-added" | "action-item-removed";
  description: string;
  provenance: FindingProvenance | null;
};

// ── Builder ───────────────────────────────────────────────────

export type BuildResultOptions = {
  labelA: string;
  labelB: string;
  pathA?: string | null;
  pathB?: string | null;
  gitRef?: string | null;
  toolVersion?: string;
};

const TOOL_VERSION = "0.6.0";

export function buildDiffResult(
  analysis: AnalysisResult,
  options: BuildResultOptions,
): DiffResult {
  const score = computeDriftScore(analysis);

  const commitmentShifts: CommitmentShiftFinding[] =
    analysis.changedCommitmentsEvidence.map((ev) => ({
      type: "commitment-shift" as const,
      summary: ev.summary,
      evidence: {
        before: ev.versionA,
        after: ev.versionB,
        triggers: ev.triggers,
      },
      provenance: ev.provenance ?? null,
    }));

  const contradictions: ContradictionFinding[] =
    analysis.possibleContradictionsEvidence.map((ev) => ({
      type: "contradiction" as const,
      summary: ev.summary,
      evidence: {
        anchors: ev.anchors,
        before: ev.versionA,
        after: ev.versionB,
      },
      provenance: ev.provenance ?? null,
    }));

  const conceptRenames: ConceptRenameFinding[] =
    analysis.renamedIdeas.map((r) => ({
      type: "concept-rename" as const,
      from: r.from,
      to: r.to,
      confidence: r.confidence,
      note: r.note ?? null,
      evidence: {
        sharedContext: r.sharedContext ?? [],
        before: r.versionA ?? null,
        after: r.versionB ?? null,
      },
      provenance: r.provenance ?? null,
    }));

  const addedConcepts: ConceptFinding[] =
    analysis.addedConceptsEvidence.map((ev) => ({
      type: "added-concept" as const,
      phrase: ev.phrase,
      sourceClause: ev.sourceClause || null,
      provenance: ev.provenance ?? null,
    }));

  // Supplement with string-only concepts that didn't get evidence
  const addedEvidencePhrases = new Set(addedConcepts.map((c) => c.phrase));
  for (const phrase of analysis.addedConcepts) {
    if (!addedEvidencePhrases.has(phrase)) {
      addedConcepts.push({
        type: "added-concept" as const,
        phrase,
        sourceClause: null,
        provenance: null,
      });
    }
  }

  const removedConcepts: ConceptFinding[] =
    analysis.removedConceptsEvidence.map((ev) => ({
      type: "removed-concept" as const,
      phrase: ev.phrase,
      sourceClause: ev.sourceClause || null,
      provenance: ev.provenance ?? null,
    }));

  const removedEvidencePhrases = new Set(removedConcepts.map((c) => c.phrase));
  for (const phrase of analysis.removedConcepts) {
    if (!removedEvidencePhrases.has(phrase)) {
      removedConcepts.push({
        type: "removed-concept" as const,
        phrase,
        sourceClause: null,
        provenance: null,
      });
    }
  }

  const addedActionProv = indexProvenance(analysis.actionItemsAddedProvenance);
  const removedActionProv = indexProvenance(analysis.actionItemsRemovedProvenance);

  const actionItemsAdded: ActionItemFinding[] =
    analysis.actionItemsAdded.map((desc) => ({
      type: "action-item-added" as const,
      description: desc,
      provenance: addedActionProv.get(desc) ?? null,
    }));

  const actionItemsRemoved: ActionItemFinding[] =
    analysis.actionItemsRemoved.map((desc) => ({
      type: "action-item-removed" as const,
      description: desc,
      provenance: removedActionProv.get(desc) ?? null,
    }));

  const total =
    commitmentShifts.length +
    contradictions.length +
    conceptRenames.length +
    addedConcepts.length +
    removedConcepts.length +
    actionItemsAdded.length +
    actionItemsRemoved.length;

  // Parse gitRef from labels if present (e.g., "HEAD~1:file.md")
  const parseGitInfo = (label: string) => {
    const colonIdx = label.indexOf(":");
    if (colonIdx > 0 && !label.includes("/") || (colonIdx > 0 && label.indexOf("/") > colonIdx)) {
      return { ref: label.slice(0, colonIdx), path: label.slice(colonIdx + 1) };
    }
    return null;
  };

  const gitInfoA = parseGitInfo(options.labelA);
  const gitInfoB = parseGitInfo(options.labelB);

  return {
    version: "1",
    meta: {
      tool: "samediff-lens",
      toolVersion: options.toolVersion ?? TOOL_VERSION,
      analysisEngine: "heuristic-v0",
      generatedAt: new Date().toISOString(),
    },
    input: {
      left: {
        label: options.labelA,
        path: options.pathA ?? (gitInfoA ? gitInfoA.path : options.labelA),
        gitRef: options.gitRef ?? gitInfoA?.ref ?? null,
      },
      right: {
        label: options.labelB,
        path: options.pathB ?? (gitInfoB ? gitInfoB.path : options.labelB),
        gitRef: gitInfoB?.ref ?? null,
      },
    },
    score: {
      value: score,
      label: severityLabel(score),
      exitCode: driftExitCode(score),
    },
    counts: {
      commitmentShifts: commitmentShifts.length,
      contradictions: contradictions.length,
      conceptRenames: conceptRenames.length,
      addedConcepts: addedConcepts.length,
      removedConcepts: removedConcepts.length,
      actionItemsAdded: actionItemsAdded.length,
      actionItemsRemoved: actionItemsRemoved.length,
      total,
    },
    findings: {
      commitmentShifts,
      contradictions,
      conceptRenames,
      addedConcepts,
      removedConcepts,
      actionItemsAdded,
      actionItemsRemoved,
    },
    summary: analysis.summary,
  };
}

function severityLabel(score: number): string {
  if (score <= 2) return "low";
  if (score <= 5) return "moderate";
  if (score <= 7) return "high";
  return "critical";
}

function indexProvenance(
  entries: AnalysisResult["actionItemsAddedProvenance"],
): Map<string, FindingProvenance> {
  const m = new Map<string, FindingProvenance>();
  for (const e of entries ?? []) {
    if (e.provenance) m.set(e.description, e.provenance);
  }
  return m;
}
