/**
 * Source anchoring / provenance.
 *
 * Turns raw evidence text (a line, clause, or action-item string that
 * the heuristics engine produces) into a structured pointer back into
 * the compared artifacts: which side it came from, which line range,
 * and how confident the match is.
 *
 * We deliberately stay out of the heuristics engine's head. Anchors are
 * post-processed from the existing evidence strings + original source
 * texts after analysis runs. The engine doesn't need to know this layer
 * exists.
 *
 * Precision policy (important — see DIRECTORS_NOTES):
 *   "exact"       — evidence found verbatim in source
 *   "approximate" — found only after whitespace/case normalization
 *   "derived"     — no textual match; anchor inferred from context
 *
 * Line numbers are 1-based. Column numbers are 1-based. Multi-line
 * matches get startLine/endLine spanning both ends.
 */

import type { FindingProvenance, LineIndex, SourceAnchor } from "./types";

// ── Line index ────────────────────────────────────────────────────────

/**
 * Build an offset→line lookup for a text. O(n) once, O(log n) per query.
 */
export function buildLineIndex(text: string): LineIndex {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  return { text, lineStarts };
}

export function offsetToLineCol(idx: LineIndex, offset: number): { line: number; column: number } {
  const starts = idx.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

// ── Anchor search ────────────────────────────────────────────────────

const MAX_SNIPPET = 120;

export function truncateSnippet(s: string, max = MAX_SNIPPET): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/**
 * Search `query` inside `text`, first exactly then with whitespace-normalized
 * fuzzy fallback. Returns a SourceAnchor or null if not locatable.
 *
 * side must be declared by the caller (we can't know which artifact text is).
 */
export function findAnchor(
  text: string,
  idx: LineIndex,
  query: string,
  side: "before" | "after",
  label?: string,
): SourceAnchor | null {
  if (!query) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  // 1) exact substring match
  let offset = text.indexOf(trimmed);
  let quality: "exact" | "approximate" = "exact";

  // 2) fuzzy (collapse whitespace, case-insensitive)
  if (offset === -1) {
    offset = fuzzyFindOffset(text, trimmed);
    if (offset === -1) return null;
    quality = "approximate";
  }

  const start = offsetToLineCol(idx, offset);
  // Cap the match length at what actually fits in `text` so we never point
  // past the end. For fuzzy matches we don't know the real end, so fall
  // back to the trimmed length; it's close enough for line-range purposes.
  const endOffset = Math.min(text.length, offset + trimmed.length);
  const end = offsetToLineCol(idx, endOffset);

  return {
    side,
    startLine: start.line,
    endLine: end.line,
    startColumn: start.column,
    endColumn: end.column,
    snippet: truncateSnippet(trimmed),
    label,
    quality,
  };
}

/**
 * Whitespace- and case-insensitive substring finder. Returns the offset
 * in `text` where the match begins, or -1. Match is approximate: it
 * collapses runs of whitespace in both text and query before comparing.
 */
function fuzzyFindOffset(text: string, query: string): number {
  // Build a map from "normalized character position" back to original offset.
  const lower = text.toLowerCase();
  const normChars: string[] = [];
  const origOffsets: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
    if (isSpace) {
      if (prevWasSpace) continue;
      normChars.push(" ");
      origOffsets.push(i);
      prevWasSpace = true;
    } else {
      normChars.push(ch);
      origOffsets.push(i);
      prevWasSpace = false;
    }
  }
  const normText = normChars.join("");

  const normQuery = query
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normQuery) return -1;

  const idx = normText.indexOf(normQuery);
  if (idx === -1) return -1;
  return origOffsets[idx] ?? -1;
}

// ── High-level provenance builder ────────────────────────────────────

export type ProvenanceContext = {
  before: { text: string; index: LineIndex };
  after: { text: string; index: LineIndex };
};

export function makeProvenanceContext(beforeText: string, afterText: string): ProvenanceContext {
  return {
    before: { text: beforeText, index: buildLineIndex(beforeText) },
    after: { text: afterText, index: buildLineIndex(afterText) },
  };
}

/**
 * Attempt to anchor a query on a specific side. Returns a FindingProvenance
 * with one anchor, or null if not locatable.
 */
export function anchorOnSide(
  ctx: ProvenanceContext,
  side: "before" | "after",
  query: string,
  label?: string,
): FindingProvenance | null {
  const s = ctx[side];
  const anchor = findAnchor(s.text, s.index, query, side, label);
  if (!anchor) return null;
  return {
    anchors: [anchor],
    quality: anchor.quality,
  };
}

/**
 * Attempt to anchor on both sides (for findings that span before + after).
 * Returns the combined provenance. If neither side matches, returns null.
 */
export function anchorBothSides(
  ctx: ProvenanceContext,
  beforeQuery: string,
  afterQuery: string,
  note?: string,
): FindingProvenance | null {
  const anchors: SourceAnchor[] = [];
  const beforeAnchor = findAnchor(
    ctx.before.text,
    ctx.before.index,
    beforeQuery,
    "before",
  );
  if (beforeAnchor) anchors.push(beforeAnchor);
  const afterAnchor = findAnchor(
    ctx.after.text,
    ctx.after.index,
    afterQuery,
    "after",
  );
  if (afterAnchor) anchors.push(afterAnchor);

  if (anchors.length === 0) return null;

  // Quality is the worst of the two (exact > approximate).
  const qualities = anchors.map((a) => a.quality ?? "approximate");
  const quality = qualities.includes("approximate") ? "approximate" : "exact";
  return { anchors, quality, note };
}

/**
 * Format an anchor for concise human output. Example:
 *   "before:12-14"   (single side)
 *   "after:33-36"
 *
 * If startLine===endLine, prints a single line number.
 */
export function formatAnchor(anchor: SourceAnchor): string {
  const lines =
    anchor.startLine === undefined
      ? ""
      : anchor.endLine === undefined || anchor.endLine === anchor.startLine
        ? `${anchor.startLine}`
        : `${anchor.startLine}-${anchor.endLine}`;
  return lines ? `${anchor.side}:${lines}` : anchor.side;
}

export function formatProvenance(prov: FindingProvenance | undefined | null): string {
  if (!prov || prov.anchors.length === 0) return "";
  return "@ " + prov.anchors.map(formatAnchor).join(" ");
}
