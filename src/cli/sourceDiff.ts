/**
 * Pure-TS line diff with unified-diff-style hunks.
 *
 * Used by formatHtml to embed the source diff inside a leaf-file
 * findings report so a reader can see SameDiff's accusations in the
 * context of the underlying line churn.
 *
 * Algorithm: classic Hunt–McIlroy via LCS (dynamic programming),
 * O(N*M) time and memory. For documentation-sized files (a few
 * hundred lines) this is fine. We cap at MAX_LINES per side; over
 * the cap we return null and the renderer skips the section.
 */

const MAX_LINES = 4000;
const DEFAULT_CONTEXT = 3;

export type DiffOp = "equal" | "add" | "remove";

export type DiffRow = {
  op: DiffOp;
  text: string;
  /** 1-based line number in the before file, present for equal/remove. */
  beforeLine?: number;
  /** 1-based line number in the after file, present for equal/add. */
  afterLine?: number;
};

export type Hunk = {
  /** Inclusive start line on the before side (1-based). */
  beforeStart: number;
  beforeLength: number;
  /** Inclusive start line on the after side (1-based). */
  afterStart: number;
  afterLength: number;
  rows: DiffRow[];
};

export type DiffResult = {
  hunks: Hunk[];
  /** Total number of rows, including unchanged lines that got collapsed. */
  totalLines: number;
  /** Total number of changed (add/remove) rows. */
  changedLines: number;
};

/**
 * Compute a line-level unified-style diff with hunks.
 *
 * Returns null when either side exceeds MAX_LINES — the LCS table
 * would chew through too much memory and the result wouldn't be
 * useful in a single HTML report anyway.
 */
export function diffLinesWithHunks(
  before: string,
  after: string,
  context: number = DEFAULT_CONTEXT,
): DiffResult | null {
  const aLines = splitLines(before);
  const bLines = splitLines(after);
  if (aLines.length > MAX_LINES || bLines.length > MAX_LINES) return null;

  const rows = lcsDiff(aLines, bLines);
  const hunks = buildHunks(rows, context);
  const changedLines = rows.reduce((acc, r) => acc + (r.op === "equal" ? 0 : 1), 0);

  return { hunks, totalLines: rows.length, changedLines };
}

// ── LCS-based row diff ────────────────────────────────────────

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Split on \n; \r\n is normalised by stripping trailing \r per line.
  return text.split("\n").map((line) => line.replace(/\r$/, ""));
}

function lcsDiff(aLines: string[], bLines: string[]): DiffRow[] {
  const m = aLines.length;
  const n = bLines.length;

  // dp[i][j] = LCS length of aLines[i..] and bLines[j..]
  // Allocated as Int32Array of size (m+1)*(n+1) for compactness.
  const dp = new Int32Array((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[idx(i, j)] = dp[idx(i + 1, j + 1)] + 1;
      } else {
        dp[idx(i, j)] = Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
      }
    }
  }

  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ op: "equal", text: aLines[i], beforeLine: i + 1, afterLine: j + 1 });
      i++; j++;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      out.push({ op: "remove", text: aLines[i], beforeLine: i + 1 });
      i++;
    } else {
      out.push({ op: "add", text: bLines[j], afterLine: j + 1 });
      j++;
    }
  }
  while (i < m) { out.push({ op: "remove", text: aLines[i], beforeLine: i + 1 }); i++; }
  while (j < n) { out.push({ op: "add", text: bLines[j], afterLine: j + 1 }); j++; }
  return out;
}

// ── Hunk grouping (collapse long unchanged stretches) ─────────

function buildHunks(rows: DiffRow[], context: number): Hunk[] {
  // First pass: which rows are "interesting" (changed) or within
  // `context` of an interesting row.
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let k = 0; k < rows.length; k++) {
    if (rows[k].op !== "equal") {
      const lo = Math.max(0, k - context);
      const hi = Math.min(rows.length - 1, k + context);
      for (let q = lo; q <= hi; q++) keep[q] = true;
    }
  }

  // Walk through, accumulating contiguous kept rows into hunks.
  const hunks: Hunk[] = [];
  let buf: DiffRow[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    hunks.push(rowsToHunk(buf));
    buf = [];
  };

  for (let k = 0; k < rows.length; k++) {
    if (keep[k]) buf.push(rows[k]);
    else flush();
  }
  flush();

  return hunks;
}

function rowsToHunk(rows: DiffRow[]): Hunk {
  let beforeStart: number | undefined;
  let afterStart: number | undefined;
  let beforeLength = 0;
  let afterLength = 0;

  for (const row of rows) {
    if (row.beforeLine !== undefined) {
      if (beforeStart === undefined) beforeStart = row.beforeLine;
      beforeLength++;
    }
    if (row.afterLine !== undefined) {
      if (afterStart === undefined) afterStart = row.afterLine;
      afterLength++;
    }
  }

  return {
    beforeStart: beforeStart ?? 0,
    beforeLength,
    afterStart: afterStart ?? 0,
    afterLength,
    rows,
  };
}
