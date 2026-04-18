/**
 * Multi-file roll-up HTML report.
 *
 * Top of page: aggregate headline, severity badge, fleet stats.
 * Then: ranked top issues across all files (each linked to its per-file
 * detail section below). Then: per-file collapsible sections, each
 * containing the existing single-file Top Issues + raw findings tree.
 *
 * Self-contained, no external assets, dark/light theme.
 */

import type { MultiFileReport, AttributedIssue } from "./multiFile";
import type { Thesis } from "../analysis/narrative";
import type { DiffResult } from "./resultModel";
import { formatHtmlReport } from "./formatHtml";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trim() + "\u2026" : s;
}

function severityClass(sev: string): string {
  return sev;
}

export function formatMultiHtmlReport(report: MultiFileReport): string {
  const sev = report.aggregate.severity;
  const sevTitle =
    sev === "critical" ? "Critical drift" :
    sev === "high" ? "High drift" :
    sev === "moderate" ? "Moderate drift" :
    "Low drift";

  const filesById = new Map<string, string>();
  report.files.forEach((f, idx) => filesById.set(f.path, `file-${idx}`));

  const topIssuesHtml = report.aggregate.topIssues
    .slice(0, 12)
    .map((i) => renderIssueRow(i, filesById.get(i.file)))
    .join("");

  const noticesHtml = report.notices.length > 0
    ? `
  <div class="notices">
    <div class="kicker">Structural drift</div>
    ${report.notices.map((n) => `
      <div class="notice notice-${n.kind}">
        <span class="notice-tag">${esc(n.kind === "added-file" ? "added file" : "removed file")}</span>
        <span class="notice-path">${esc(n.path)}</span>
      </div>`).join("")}
  </div>`
    : "";

  const filesHtml = report.files.map((f, idx) => {
    const id = `file-${idx}`;
    const score = f.diff.score;
    const sevCls = severityClass(score.label);
    const headline = f.narrative.headline ?? "(no notable drift)";
    const issueCount = f.narrative.issues.length;
    const inner = formatHtmlReport(
      // The narrative is already attached to the diff in runMultiFile,
      // but formatHtmlReport rebuilds from the raw analysis. To keep
      // this self-contained and avoid that double-build, we reach into
      // the raw analysis embedded in the diff via a per-file readback.
      // Simpler: use the AnalysisResult-shaped data already present.
      reconstructAnalysisFromDiff(f.diff),
      {
        fileA: f.path,
        fileB: f.path,
        narrative: true,
        // Pass the original source texts so each leaf iframe shows its
        // own source-diff section. The top-level multi-file aggregate
        // page itself does NOT show a diff — it's not a single-file
        // comparison.
        leftText: f.leftText,
        rightText: f.rightText,
      },
    );
    // We embed the inner HTML's <body> contents only by extracting the
    // body; the overall page already has its own chrome. Pulling out
    // the body content is brittle, so instead we use a noframes-style
    // <iframe srcdoc> for safety. Cleaner than string-splitting and
    // still self-contained.
    const srcdoc = inner.replace(/"/g, "&quot;");
    return `
  <details class="file-section" id="${esc(id)}" ${idx === 0 || issueCount > 0 ? "open" : ""}>
    <summary>
      <span class="file-path">${esc(f.path)}</span>
      <span class="file-headline">${esc(truncate(headline, 140))}</span>
      <span class="file-meta">
        <span class="file-score score-num ${sevCls}">${score.value.toFixed(1)}</span>
        <span class="file-issues">${issueCount} top issue${issueCount === 1 ? "" : "s"}</span>
      </span>
    </summary>
    <iframe class="file-frame" srcdoc="${srcdoc}" loading="lazy"></iframe>
  </details>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SameDiff \u2014 ${esc(report.meta.leftRoot)} \u2192 ${esc(report.meta.rightRoot)}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface2: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --blue: #58a6ff; --cyan: #39d353;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.55;
    max-width: 1200px; margin: 0 auto;
  }
  .header h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 0.25rem; }
  .header h1 span { color: var(--cyan); }
  .roots { color: var(--text2); font-size: 0.9rem; margin-bottom: 1rem; }
  .roots code {
    background: var(--surface); padding: 0.1rem 0.4rem; border-radius: 3px;
    font-size: 0.8rem;
  }

  .agg-bar {
    margin: 1.25rem 0; padding: 1.1rem 1.25rem; background: var(--surface);
    border: 1px solid var(--border); border-left: 4px solid var(--yellow);
    border-radius: 8px;
  }
  .agg-bar.critical { border-left-color: var(--red); }
  .agg-bar.high { border-left-color: var(--red); }
  .agg-bar.moderate { border-left-color: var(--yellow); }
  .agg-bar.low { border-left-color: var(--green); }
  .agg-kicker {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text2); font-weight: 600; margin-bottom: 0.4rem;
  }
  .agg-headline {
    font-size: 1.1rem; font-weight: 600; line-height: 1.4;
  }

  /* Aggregate thesis band — Tier 1 above the issue-level headline */
  .agg-thesis {
    margin: 1.25rem 0 0.5rem;
    padding: 1.1rem 1.3rem;
    background: linear-gradient(180deg, var(--surface2) 0%, var(--surface) 100%);
    border: 1px solid var(--border);
    border-left: 4px solid var(--blue);
    border-radius: 8px;
  }
  .agg-thesis.sev-critical { border-left-color: var(--red); }
  .agg-thesis.sev-high { border-left-color: var(--red); }
  .agg-thesis.sev-moderate { border-left-color: var(--yellow); }
  .agg-thesis.sev-low { border-left-color: var(--green); }
  .agg-thesis-kicker {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text2); font-weight: 700; margin-bottom: 0.4rem;
    display: flex; gap: 0.5rem; align-items: center;
  }
  .agg-thesis-kicker .composite-tag {
    font-size: 0.62rem; padding: 0.05rem 0.4rem; border-radius: 8px;
    background: var(--blue); color: var(--bg); letter-spacing: 0.05em;
  }
  .agg-thesis-headline {
    font-size: 1.3rem; font-weight: 700; line-height: 1.35;
    color: var(--text); margin-bottom: 0.4rem;
  }
  .agg-thesis-sub {
    font-size: 0.9rem; color: var(--text2); margin-bottom: 0.7rem;
  }
  .agg-thesis-citations {
    display: flex; flex-wrap: wrap; gap: 0.35rem;
    margin-top: 0.65rem; padding-top: 0.65rem;
    border-top: 1px solid var(--border);
  }
  .agg-thesis-citation {
    font-size: 0.72rem; padding: 0.18rem 0.55rem; border-radius: 4px;
    background: var(--surface2); color: var(--text2);
    border: 1px solid var(--border);
    max-width: 32rem; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agg-thesis-citation .ck { color: var(--text2); margin-right: 0.3rem; opacity: 0.6; }

  .stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem; margin: 1rem 0 1.5rem;
  }
  .stat {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.65rem 0.85rem;
  }
  .stat-num { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-num.critical { color: var(--red); }
  .stat-num.high { color: var(--red); }
  .stat-num.moderate { color: var(--yellow); }
  .stat-num.low { color: var(--green); }
  .stat-label {
    font-size: 0.75rem; color: var(--text2);
    text-transform: uppercase; letter-spacing: 0.05em;
  }

  .section-title {
    font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text2); font-weight: 600; margin: 1.5rem 0 0.6rem;
  }

  .top-issues { display: flex; flex-direction: column; gap: 0.5rem; }
  .top-issue {
    display: block; text-decoration: none; color: inherit;
    background: var(--surface); border: 1px solid var(--border);
    border-left: 3px solid var(--border); border-radius: 6px;
    padding: 0.7rem 0.95rem; transition: border-color 0.15s ease;
  }
  .top-issue:hover { border-color: var(--blue); }
  .top-issue.sev-critical { border-left-color: var(--red); }
  .top-issue.sev-high { border-left-color: var(--red); }
  .top-issue.sev-moderate { border-left-color: var(--yellow); }
  .top-issue.sev-low { border-left-color: var(--green); }
  .ti-meta {
    display: flex; gap: 0.5rem; align-items: center;
    font-size: 0.75rem; color: var(--text2); margin-bottom: 0.25rem;
  }
  .ti-file {
    color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
  }
  .ti-sev {
    text-transform: uppercase; letter-spacing: 0.05em;
    padding: 0.05rem 0.4rem; border-radius: 8px; background: var(--surface2);
  }
  .ti-sev.sev-critical, .ti-sev.sev-high { color: var(--red); }
  .ti-sev.sev-moderate { color: var(--yellow); }
  .ti-sev.sev-low { color: var(--green); }
  .ti-title { font-weight: 600; line-height: 1.4; }

  .notices { margin: 1.25rem 0; }
  .notices .kicker {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text2); font-weight: 600; margin-bottom: 0.5rem;
  }
  .notice {
    display: flex; gap: 0.75rem; align-items: center;
    padding: 0.4rem 0.75rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: 6px;
    margin-bottom: 0.4rem;
  }
  .notice-added-file .notice-tag { color: var(--green); }
  .notice-removed-file .notice-tag { color: var(--red); }
  .notice-tag {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
    font-weight: 600; min-width: 6.5rem;
  }
  .notice-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .file-section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden;
  }
  .file-section > summary {
    cursor: pointer; user-select: none; padding: 0.85rem 1.15rem;
    display: grid;
    grid-template-columns: minmax(8rem, auto) 1fr auto;
    gap: 0.85rem; align-items: center; list-style: none;
  }
  .file-section > summary::-webkit-details-marker { display: none; }
  .file-section > summary::before {
    content: "\u25B8"; color: var(--text2); margin-right: 0.25rem;
  }
  .file-section[open] > summary::before { content: "\u25BE"; }
  .file-path {
    color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .file-headline {
    font-size: 0.9rem; color: var(--text); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .file-meta { display: flex; gap: 0.75rem; align-items: center; }
  .file-score {
    font-weight: 700; font-variant-numeric: tabular-nums; font-size: 1.05rem;
  }
  .file-score.low { color: var(--green); }
  .file-score.moderate { color: var(--yellow); }
  .file-score.high { color: var(--red); }
  .file-score.critical { color: var(--red); }
  .file-issues { color: var(--text2); font-size: 0.75rem; }

  .file-frame {
    width: 100%; border: none; background: transparent;
    height: 1500px; display: block; border-top: 1px solid var(--border);
  }

  .footer {
    margin-top: 2rem; padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text2); font-size: 0.8rem; text-align: center;
  }
  .footer a { color: var(--blue); }

  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fff; --surface: #f6f8fa; --surface2: #eaeef2;
      --border: #d0d7de; --text: #1f2328; --text2: #656d76;
      --green: #1a7f37; --red: #cf222e; --yellow: #9a6700;
      --blue: #0969da; --cyan: #0550ae;
    }
  }
</style>
</head>
<body>
<div class="header">
  <h1><span>\u0394</span> SameDiff \u2014 directory roll-up</h1>
  <div class="roots">
    <code>${esc(report.meta.leftRoot)}</code> \u2192
    <code>${esc(report.meta.rightRoot)}</code>
  </div>
</div>

${renderAggThesis(report.aggregate.thesis)}

<div class="agg-bar ${sev}">
  <div class="agg-kicker">${esc(sevTitle)} \u00b7 top finding across ${report.aggregate.fileCount} file${report.aggregate.fileCount === 1 ? "" : "s"}</div>
  <div class="agg-headline">${esc(report.aggregate.headline ?? "(no notable drift detected)")}</div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-num ${sev}">${report.aggregate.maxScore.toFixed(1)}</div>
    <div class="stat-label">Worst score</div>
  </div>
  <div class="stat">
    <div class="stat-num">${report.aggregate.avgScore.toFixed(1)}</div>
    <div class="stat-label">Avg score</div>
  </div>
  <div class="stat">
    <div class="stat-num">${report.aggregate.filesWithDrift}/${report.aggregate.fileCount}</div>
    <div class="stat-label">Files with drift</div>
  </div>
  <div class="stat">
    <div class="stat-num">${report.aggregate.totalFindings}</div>
    <div class="stat-label">Total findings</div>
  </div>
  <div class="stat">
    <div class="stat-num">${report.aggregate.topIssues.length}</div>
    <div class="stat-label">Top issues</div>
  </div>
</div>

${noticesHtml}

${report.aggregate.topIssues.length > 0 ? `
<div class="section-title">Top issues across all files</div>
<div class="top-issues">${topIssuesHtml}</div>
` : ""}

<div class="section-title">Per-file detail \u2014 ${report.files.length} file${report.files.length === 1 ? "" : "s"}</div>
${filesHtml || "<p style=\"color:var(--text2); font-size:0.9rem;\">No comparable files found under both roots.</p>"}

<div class="footer">
  Generated by <a href="https://github.com/henry-filgueiras/samediff-lens">SameDiff Lens</a>
  \u2014 deterministic heuristics, no LLM
</div>
</body>
</html>`;
}

function renderAggThesis(thesis: Thesis | null): string {
  if (!thesis) return "";

  const sev = thesis.severity;
  const compositeTag = thesis.isComposite
    ? `<span class="composite-tag">composite</span>`
    : "";

  // Cited issue ids in aggregate are namespaced as "<file>#<issue-id>".
  // The chip label is informative on its own; we don't try to deep-link
  // into the per-file iframe (cross-frame anchor would be brittle).
  const visible = thesis.citedIssueIds.slice(0, 6);
  const overflow = thesis.citedIssueIds.length - visible.length;
  const citationsHtml = visible
    .map((id, idx) => {
      const num = idx + 1;
      return `<span class="agg-thesis-citation"><span class="ck">cite ${num}</span>${esc(id)}</span>`;
    })
    .join("");
  const overflowChip = overflow > 0
    ? `<span class="agg-thesis-citation"><span class="ck">+${overflow}</span>more</span>`
    : "";

  return `
<div class="agg-thesis sev-${esc(sev)}">
  <div class="agg-thesis-kicker">
    <span>Thesis</span>
    ${compositeTag}
    <span style="opacity:0.6">\u00b7 ${esc(thesis.confidence)} confidence</span>
  </div>
  <div class="agg-thesis-headline">${esc(thesis.headline)}</div>
  <div class="agg-thesis-sub">${esc(thesis.subheadline)}</div>
  <div class="agg-thesis-citations">
    ${citationsHtml}
    ${overflowChip}
  </div>
</div>`;
}

function renderIssueRow(issue: AttributedIssue, fileAnchor: string | undefined): string {
  const sev = issue.severity;
  return `
    <a class="top-issue sev-${esc(sev)}" href="#${esc(fileAnchor ?? "")}">
      <div class="ti-meta">
        <span class="ti-sev sev-${esc(sev)}">${esc(sev)}</span>
        <span class="ti-file">${esc(issue.file)}</span>
      </div>
      <div class="ti-title">${esc(issue.title)}</div>
    </a>`;
}

/**
 * Reconstruct an AnalysisResult-shaped object from a DiffResult so the
 * existing single-file HTML renderer can be reused as the per-file
 * inner content. Lossy in detail (we keep what the renderer reads),
 * which is fine — the inner HTML is purely visual.
 */
function reconstructAnalysisFromDiff(diff: DiffResult): import("../analysis/types").AnalysisResult {
  return {
    addedConcepts: diff.findings.addedConcepts.map((c) => c.phrase),
    removedConcepts: diff.findings.removedConcepts.map((c) => c.phrase),
    renamedIdeas: diff.findings.conceptRenames.map((r) => ({
      from: r.from, to: r.to, confidence: r.confidence,
      note: r.note ?? undefined,
      sharedContext: r.evidence.sharedContext,
      versionA: r.evidence.before ?? undefined,
      versionB: r.evidence.after ?? undefined,
      provenance: r.provenance ?? undefined,
    })),
    changedCommitments: diff.findings.commitmentShifts.map((c) => c.summary),
    actionItemsAdded: diff.findings.actionItemsAdded.map((a) => a.description),
    actionItemsRemoved: diff.findings.actionItemsRemoved.map((a) => a.description),
    actionItemsStatusChanges: diff.findings.actionItemsStatusChanges.map((c) => ({
      subject: c.subject,
      transition: c.transition,
      beforeState: c.beforeState,
      afterState: c.afterState,
      beforeRaw: c.evidence.before,
      afterRaw: c.evidence.after,
      provenance: c.provenance ?? undefined,
    })),
    possibleContradictions: diff.findings.contradictions.map((c) => c.summary),
    addedConceptsEvidence: diff.findings.addedConcepts.map((c) => ({
      phrase: c.phrase,
      sourceClause: c.sourceClause ?? "",
      provenance: c.provenance ?? undefined,
    })),
    removedConceptsEvidence: diff.findings.removedConcepts.map((c) => ({
      phrase: c.phrase,
      sourceClause: c.sourceClause ?? "",
      provenance: c.provenance ?? undefined,
    })),
    changedCommitmentsEvidence: diff.findings.commitmentShifts.map((c) => ({
      summary: c.summary,
      versionA: c.evidence.before,
      versionB: c.evidence.after,
      triggers: c.evidence.triggers,
      provenance: c.provenance ?? undefined,
    })),
    possibleContradictionsEvidence: diff.findings.contradictions.map((c) => ({
      summary: c.summary,
      anchors: c.evidence.anchors,
      versionA: c.evidence.before,
      versionB: c.evidence.after,
      provenance: c.provenance ?? undefined,
    })),
    summary: diff.summary,
  };
}
