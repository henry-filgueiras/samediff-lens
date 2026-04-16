/**
 * SARIF 2.1.0 renderer.
 *
 * This is intentionally a *mechanical* mapping from the canonical DiffResult
 * onto SARIF. We do not re-run analysis here, we do not reinterpret findings,
 * and we do not invent locations that provenance doesn't already attest to.
 *
 * Design principles:
 *   - Consume DiffResult (the single semantic source of truth)
 *   - Use provenance to fill physicalLocation/region when available
 *   - Absent provenance → result with just a message. No fake regions.
 *   - Stable, comprehensible ruleIds: one per finding category
 *   - Levels derived once from category, overridable at runtime by consumers
 *     via the rule's defaultConfiguration
 *   - Shape consumable by GitHub code scanning without post-processing
 *
 * Spec reference:
 *   https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html
 */

import { basename, isAbsolute, relative } from "node:path";
import type { DiffResult } from "./resultModel";
import type { FindingProvenance, SourceAnchor } from "../analysis/types";

const SARIF_SCHEMA =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";
const SARIF_VERSION = "2.1.0";
const TOOL_INFO_URI = "https://github.com/henry-filgueiras/samediff-lens";

// ── Rule catalog ────────────────────────────────────────────────────
// One rule per finding category. IDs are stable across releases.
// Level mapping:
//   contradiction    → error     (directly dangerous)
//   commitment-shift → warning   (implied-contract change; this is the
//                                 canonical "should → must" type signal)
//   everything else  → note      (informational drift)

type SarifLevel = "none" | "note" | "warning" | "error";

type RuleDef = {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
  helpUri: string;
};

const RULES: RuleDef[] = [
  {
    id: "commitment-shift",
    name: "CommitmentShift",
    shortDescription: { text: "A modal commitment changed between versions." },
    fullDescription: {
      text:
        "SameDiff Lens flagged a change in modal strength (e.g. should → must), " +
        "added or removed epistemic qualifiers, or new behavioral directives that " +
        "narrow or broaden the implied contract between the two versions.",
    },
    defaultConfiguration: { level: "warning" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "contradiction",
    name: "Contradiction",
    shortDescription: {
      text: "Two versions appear to make conflicting claims about a shared subject.",
    },
    fullDescription: {
      text:
        "SameDiff Lens found two statements sharing the same anchor subject but " +
        "using opposite modality (required/optional), negation, or scope-narrowing " +
        "language. These are heuristic flags, not proofs.",
    },
    defaultConfiguration: { level: "error" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "concept-renamed",
    name: "ConceptRenamed",
    shortDescription: { text: "A concept may have been renamed between versions." },
    fullDescription: {
      text:
        "Two sentences share enough anchor tokens that the tool suspects one " +
        "concept was renamed rather than removed-and-added. Carries a confidence " +
        "label (low / medium / high).",
    },
    defaultConfiguration: { level: "note" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "concept-added",
    name: "ConceptAdded",
    shortDescription: { text: "A new concept appears in the after version." },
    fullDescription: {
      text:
        "A focused phrase in the after text has no close counterpart in the before " +
        "text. Useful for spotting silently introduced ideas.",
    },
    defaultConfiguration: { level: "note" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "concept-removed",
    name: "ConceptRemoved",
    shortDescription: { text: "A concept from the before version is gone." },
    fullDescription: {
      text:
        "A focused phrase in the before text has no close counterpart in the after " +
        "text. Useful for spotting dropped commitments.",
    },
    defaultConfiguration: { level: "note" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "action-item-added",
    name: "ActionItemAdded",
    shortDescription: { text: "A new action item / todo appeared." },
    fullDescription: {
      text: "An action-item-style bullet or line was added in the after version.",
    },
    defaultConfiguration: { level: "note" },
    helpUri: TOOL_INFO_URI,
  },
  {
    id: "action-item-removed",
    name: "ActionItemRemoved",
    shortDescription: { text: "An action item / todo was removed." },
    fullDescription: {
      text:
        "An action-item-style bullet or line present in the before version is " +
        "absent in the after version.",
    },
    defaultConfiguration: { level: "note" },
    helpUri: TOOL_INFO_URI,
  },
];

// ── Renderer ─────────────────────────────────────────────────────────

export type SarifOptions = {
  /**
   * Optional base directory. Absolute paths in DiffResult that fall under
   * this directory are emitted as repo-relative URIs (better for GitHub
   * code scanning). Paths outside get basename(). If omitted, all paths
   * become basename().
   */
  baseDir?: string;
};

type SarifLog = {
  $schema: string;
  version: string;
  runs: SarifRun[];
};

type SarifRun = {
  tool: { driver: { name: string; version: string; informationUri: string; rules: RuleDef[] } };
  invocations: Array<{ executionSuccessful: boolean }>;
  results: SarifResult[];
  properties?: Record<string, unknown>;
};

type SarifResult = {
  ruleId: string;
  level?: SarifLevel;
  message: { text: string };
  locations?: SarifLocation[];
  relatedLocations?: SarifLocation[];
  properties?: Record<string, unknown>;
};

type SarifLocation = {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: {
      startLine?: number;
      endLine?: number;
      startColumn?: number;
      endColumn?: number;
      snippet?: { text: string };
    };
  };
  message?: { text: string };
};

export function formatSarifOutput(result: DiffResult, options: SarifOptions = {}): string {
  const log = buildSarifLog(result, options);
  return JSON.stringify(log, null, 2) + "\n";
}

export function buildSarifLog(result: DiffResult, options: SarifOptions = {}): SarifLog {
  const beforeUri = toUri(result.input.left.path, result.input.left.label, options.baseDir);
  const afterUri = toUri(result.input.right.path, result.input.right.label, options.baseDir);

  const results: SarifResult[] = [];

  for (const f of result.findings.commitmentShifts) {
    const msg =
      `${trim(f.evidence.before)} → ${trim(f.evidence.after)}` +
      (f.evidence.triggers.length ? ` (${f.evidence.triggers.join(", ")})` : "");
    results.push(makeResult("commitment-shift", msg, f.provenance, beforeUri, afterUri, "after"));
  }

  for (const f of result.findings.contradictions) {
    results.push(
      makeResult("contradiction", f.summary, f.provenance, beforeUri, afterUri, "after"),
    );
  }

  for (const f of result.findings.conceptRenames) {
    const msg = `"${f.from}" → "${f.to}" [${f.confidence}]`;
    const r = makeResult("concept-renamed", msg, f.provenance, beforeUri, afterUri, "after");
    r.properties = { ...(r.properties ?? {}), confidence: f.confidence };
    results.push(r);
  }

  for (const f of result.findings.addedConcepts) {
    const msg = f.sourceClause ? `${f.phrase} — "${trim(f.sourceClause)}"` : f.phrase;
    results.push(makeResult("concept-added", msg, f.provenance, beforeUri, afterUri, "after"));
  }

  for (const f of result.findings.removedConcepts) {
    // Removed concepts live ONLY on the before side. Do not pin them to
    // the after file even if we have a secondary anchor there — we don't.
    const msg = f.sourceClause ? `${f.phrase} — "${trim(f.sourceClause)}"` : f.phrase;
    results.push(makeResult("concept-removed", msg, f.provenance, beforeUri, afterUri, "before"));
  }

  for (const f of result.findings.actionItemsAdded) {
    results.push(
      makeResult("action-item-added", f.description, f.provenance, beforeUri, afterUri, "after"),
    );
  }

  for (const f of result.findings.actionItemsRemoved) {
    results.push(
      makeResult("action-item-removed", f.description, f.provenance, beforeUri, afterUri, "before"),
    );
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "samediff-lens",
            version: result.meta.toolVersion,
            informationUri: TOOL_INFO_URI,
            rules: RULES,
          },
        },
        invocations: [{ executionSuccessful: true }],
        results,
        properties: {
          driftScore: result.score.value,
          driftLabel: result.score.label,
          exitCode: result.score.exitCode,
          counts: result.counts,
        },
      },
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeResult(
  ruleId: string,
  messageText: string,
  prov: FindingProvenance | null,
  beforeUri: string,
  afterUri: string,
  primarySide: "before" | "after",
): SarifResult {
  const out: SarifResult = {
    ruleId,
    message: { text: messageText },
  };

  if (prov && prov.anchors.length > 0) {
    const onPrimary = prov.anchors.find((a) => a.side === primarySide);
    const onOther = prov.anchors.find((a) => a.side !== primarySide);

    // Primary location: use primary-side anchor if available; else fall back
    // to whatever side we have. Never fabricate a side that wasn't anchored.
    const chosen = onPrimary ?? prov.anchors[0];
    out.locations = [toLocation(chosen, chosen.side === "before" ? beforeUri : afterUri)];

    // Dual-anchor findings keep the other side as relatedLocation. Single-
    // side findings (or cases where the primary anchor came from a
    // fallback) don't get a related location — we'd just be duplicating.
    if (onPrimary && onOther) {
      out.relatedLocations = [
        {
          ...toLocation(onOther, onOther.side === "before" ? beforeUri : afterUri),
          message: { text: `corresponding ${onOther.side} location` },
        },
      ];
    }

    if (prov.quality) {
      out.properties = { ...(out.properties ?? {}), anchorQuality: prov.quality };
    }
    if (prov.note) {
      out.properties = { ...(out.properties ?? {}), anchorNote: prov.note };
    }
  }

  return out;
}

function toLocation(a: SourceAnchor, uri: string): SarifLocation {
  const region: NonNullable<SarifLocation["physicalLocation"]["region"]> = {};
  if (a.startLine !== undefined) region.startLine = a.startLine;
  if (a.endLine !== undefined) region.endLine = a.endLine;
  if (a.startColumn !== undefined) region.startColumn = a.startColumn;
  if (a.endColumn !== undefined) region.endColumn = a.endColumn;
  if (a.snippet) region.snippet = { text: a.snippet };

  return {
    physicalLocation: {
      artifactLocation: { uri },
      region: Object.keys(region).length ? region : undefined,
    },
  };
}

/**
 * Turn a DiffResult input into a SARIF URI.
 *   - Absolute path under baseDir → repo-relative URI
 *   - Absolute path outside baseDir → basename (lossy but honest)
 *   - Relative path / label → pass-through
 *   - null → label fallback (git refs etc.)
 */
function toUri(
  path: string | null | undefined,
  label: string,
  baseDir: string | undefined,
): string {
  if (!path) return label; // e.g. "HEAD~1:spec.md" from --git mode
  if (!isAbsolute(path)) return path;
  if (baseDir) {
    const rel = relative(baseDir, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return basename(path);
}

function trim(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Exported for tests
export { RULES as __SARIF_RULES };
