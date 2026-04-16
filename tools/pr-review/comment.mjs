/**
 * Render the sticky PR-review comment body from an aggregate index.
 *
 * Input shape (produced by analyze.mjs):
 *
 *   {
 *     base: "origin/main",
 *     files: [
 *       {
 *         path: "docs/spec.md",
 *         status: "analyzed" | "skipped-new" | "skipped-deleted" | "error",
 *         error?: string,
 *         counts?: FindingCounts,
 *         score?: { value, label },
 *         findings?: {
 *           commitmentShifts: [{ summary, anchor, triggers, anchored }],
 *           contradictions:   [{ summary, anchor, anchored }],
 *           ...
 *         }
 *       }
 *     ],
 *     sarifRelPath: ".pr-review-out/samediff.sarif" | null,
 *     toolVersion: "0.6.0"
 *   }
 *
 * Output: a Markdown string suitable for upsert as a PR comment.
 *
 * Design constraints:
 *   - Deterministic (stable ordering, no timestamps in the body)
 *   - Bounded length (top-N per category, total soft cap)
 *   - Single, recognizable marker so the workflow can idempotently update
 *   - Honest about unanchored findings (label them)
 *   - Graceful no-op messages for the four edge cases the spec calls out
 */

export const COMMENT_MARKER = "<!-- samediff-lens:pr-review -->";

// Soft caps keep the comment readable even on PRs that touch many docs.
const MAX_PER_CATEGORY = 5;

/** Top-level entry point. */
export function renderComment(index) {
  const lines = [];
  lines.push(COMMENT_MARKER);
  lines.push("## SameDiff Lens — semantic review");
  lines.push("");

  const analyzed = (index.files ?? []).filter((f) => f.status === "analyzed");
  const skipped = (index.files ?? []).filter((f) => f.status !== "analyzed");

  if (!index.files || index.files.length === 0) {
    lines.push(
      "_No high-signal files changed in this PR._ The reviewer watches " +
        "README/DIRECTORS_NOTES/LAUNCH_NOTES and `docs/**/*.md`.",
    );
    lines.push("");
    lines.push(footer(index));
    return lines.join("\n") + "\n";
  }

  const agg = aggregateCounts(analyzed);
  const contradictions = collect(analyzed, "contradictions");
  const blockingContradictions = contradictions.filter((c) => c.confidence !== "low");
  const advisoryContradictions = contradictions.filter((c) => c.confidence === "low");
  const commitmentShifts = collect(analyzed, "commitmentShifts");
  const actionAdded = collect(analyzed, "actionItemsAdded");
  const actionRemoved = collect(analyzed, "actionItemsRemoved");
  const renames = collect(analyzed, "conceptRenames");

  // Header: files analyzed + aggregate count breakdown + status line.
  lines.push(headerLine(analyzed.length, skipped.length));
  lines.push(countsLine(agg));
  lines.push(statusLine(blockingContradictions.length, advisoryContradictions.length));
  lines.push("");

  if (blockingContradictions.length > 0) {
    lines.push("### Contradictions (blocking)");
    lines.push("");
    renderContradictionList(lines, blockingContradictions);
    lines.push("");
  }

  if (advisoryContradictions.length > 0) {
    lines.push("### Advisory contradictions (non-blocking)");
    lines.push("");
    lines.push(
      "_Low-confidence matches (typically narrowing heuristics firing on " +
        "additive changes). Reported for context; do not fail the check._",
    );
    lines.push("");
    renderContradictionList(lines, advisoryContradictions);
    lines.push("");
  }

  if (commitmentShifts.length > 0) {
    lines.push("### Commitment shifts");
    lines.push("");
    for (const item of commitmentShifts.slice(0, MAX_PER_CATEGORY)) {
      const triggers = item.triggers?.length ? ` _(${item.triggers.join(", ")})_` : "";
      lines.push(
        `- ${fileTag(item.path)} — ${escape(item.summary)}${triggers} ${anchorTag(item)}`,
      );
    }
    if (commitmentShifts.length > MAX_PER_CATEGORY) {
      lines.push(`- _…and ${commitmentShifts.length - MAX_PER_CATEGORY} more_`);
    }
    lines.push("");
  }

  if (renames.length > 0) {
    lines.push("### Concept renames");
    lines.push("");
    for (const item of renames.slice(0, MAX_PER_CATEGORY)) {
      lines.push(`- ${fileTag(item.path)} — ${escape(item.summary)} ${anchorTag(item)}`);
    }
    if (renames.length > MAX_PER_CATEGORY) {
      lines.push(`- _…and ${renames.length - MAX_PER_CATEGORY} more_`);
    }
    lines.push("");
  }

  if (actionAdded.length > 0 || actionRemoved.length > 0) {
    lines.push("### Action-item drift");
    lines.push("");
    for (const item of actionAdded.slice(0, MAX_PER_CATEGORY)) {
      lines.push(`- ${fileTag(item.path)} — added: ${escape(item.summary)} ${anchorTag(item)}`);
    }
    for (const item of actionRemoved.slice(0, MAX_PER_CATEGORY)) {
      lines.push(
        `- ${fileTag(item.path)} — removed: ${escape(item.summary)} ${anchorTag(item)}`,
      );
    }
    lines.push("");
  }

  // Per-file concept drift rollup — just counts, not every phrase.
  const conceptFiles = analyzed.filter(
    (f) => (f.counts?.addedConcepts ?? 0) + (f.counts?.removedConcepts ?? 0) > 0,
  );
  if (conceptFiles.length > 0) {
    lines.push("### Concept drift (counts)");
    lines.push("");
    for (const f of conceptFiles) {
      const a = f.counts?.addedConcepts ?? 0;
      const r = f.counts?.removedConcepts ?? 0;
      lines.push(`- ${fileTag(f.path)} — ${a} added, ${r} removed`);
    }
    lines.push("");
  }

  // Graceful no-findings message when everything is zero.
  if (agg.total === 0) {
    lines.push(
      "_No semantic drift survived filtering on the analyzed files._ Line-diff " +
        "still applies; this section only reports SameDiff Lens findings.",
    );
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(renderSkipped(skipped));
    lines.push("");
  }

  lines.push(footer(index));
  return lines.join("\n") + "\n";
}

// ── Section helpers ─────────────────────────────────────────────────────

function headerLine(analyzedCount, skippedCount) {
  const a = `**${analyzedCount}** file${analyzedCount === 1 ? "" : "s"} analyzed`;
  if (skippedCount === 0) return a + ".";
  return `${a} (plus ${skippedCount} skipped — see below).`;
}

function countsLine(c) {
  const parts = [];
  if (c.contradictions) {
    parts.push(`**${c.contradictions} contradiction${pluralS(c.contradictions)}**`);
  }
  if (c.commitmentShifts) {
    parts.push(`${c.commitmentShifts} commitment shift${pluralS(c.commitmentShifts)}`);
  }
  if (c.conceptRenames) {
    parts.push(`${c.conceptRenames} concept rename${pluralS(c.conceptRenames)}`);
  }
  const notes = (c.addedConcepts ?? 0) + (c.removedConcepts ?? 0);
  if (notes) parts.push(`${notes} concept note${pluralS(notes)}`);
  const todos = (c.actionItemsAdded ?? 0) + (c.actionItemsRemoved ?? 0);
  if (todos) parts.push(`${todos} action-item change${pluralS(todos)}`);
  if (parts.length === 0) return "Findings: none.";
  return "Findings: " + parts.join(", ") + ".";
}

function statusLine(blockingCount, advisoryCount = 0) {
  if (blockingCount > 0) {
    const advisoryNote = advisoryCount > 0
      ? ` (+${advisoryCount} advisory — see below)`
      : "";
    return `Status: **Blocked** — ${blockingCount} contradiction${pluralS(
      blockingCount,
    )} must be resolved or explicitly accepted before this PR can merge${advisoryNote}.`;
  }
  if (advisoryCount > 0) {
    return `Status: **Advisory** — ${advisoryCount} low-confidence contradiction${pluralS(
      advisoryCount,
    )} surfaced; nothing blocks the merge.`;
  }
  return "Status: **Advisory** — no contradictions. Other findings inform but do not block merge.";
}

function renderContradictionList(lines, items) {
  for (const item of items.slice(0, MAX_PER_CATEGORY)) {
    const confTag = item.confidence ? ` _[${item.confidence}]_` : "";
    lines.push(
      `- ${fileTag(item.path)} — ${escape(item.summary)}${confTag} ${anchorTag(item)}`,
    );
    if (item.newLine) {
      lines.push(`    - **NEW LINE:** ${escape(item.newLine)}`);
    }
    if (item.priorLineFound === false && item.priorLineUnavailableText) {
      lines.push(`    - **PRIOR LINE:** _${escape(item.priorLineUnavailableText)}_`);
    } else if (item.priorLine) {
      lines.push(`    - **PRIOR LINE:** ${escape(item.priorLine)}`);
    }
    if (item.reason) {
      lines.push(`    - **REASON:** \`${escape(item.reason)}\``);
    }
  }
  if (items.length > MAX_PER_CATEGORY) {
    lines.push(`- _…and ${items.length - MAX_PER_CATEGORY} more — see SARIF_`);
  }
}

function renderSkipped(skipped) {
  const out = ["<details><summary>Skipped files</summary>", ""];
  for (const f of skipped) {
    const reason =
      f.status === "skipped-new"
        ? "new file — no base version to compare against"
        : f.status === "skipped-deleted"
        ? "deleted — no after version to compare against"
        : f.status === "error"
        ? `error — ${escape(f.error ?? "unknown")}`
        : f.status;
    out.push(`- \`${f.path}\` — ${reason}`);
  }
  out.push("", "</details>");
  return out.join("\n");
}

function footer(index) {
  const parts = [];
  parts.push(`SameDiff Lens v${index.toolVersion ?? "?"}`);
  if (index.base) parts.push(`base: \`${escape(index.base)}\``);
  if (index.sarifRelPath) {
    parts.push("SARIF uploaded to Code Scanning");
  } else {
    parts.push("no SARIF uploaded (no anchored findings)");
  }
  return `<sub>${parts.join(" · ")}</sub>`;
}

// ── Finding collection ──────────────────────────────────────────────────

function aggregateCounts(analyzed) {
  const agg = {
    commitmentShifts: 0,
    contradictions: 0,
    conceptRenames: 0,
    addedConcepts: 0,
    removedConcepts: 0,
    actionItemsAdded: 0,
    actionItemsRemoved: 0,
    total: 0,
  };
  for (const f of analyzed) {
    const c = f.counts ?? {};
    for (const k of Object.keys(agg)) {
      if (typeof c[k] === "number") agg[k] += c[k];
    }
  }
  return agg;
}

function collect(analyzed, bucket) {
  const out = [];
  for (const f of analyzed) {
    const items = f.findings?.[bucket] ?? [];
    for (const x of items) {
      out.push({ path: f.path, ...x });
    }
  }
  return out;
}

// ── Formatting primitives ───────────────────────────────────────────────

function fileTag(path) {
  return "`" + path + "`";
}

function anchorTag(item) {
  if (!item.anchor) return item.anchored === false ? "_(no anchor)_" : "";
  return `@ ${item.anchor}`;
}

function escape(s) {
  if (typeof s !== "string") return "";
  // Minimal escaping — avoid breaking markdown inside inline segments.
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function pluralS(n) {
  return n === 1 ? "" : "s";
}
