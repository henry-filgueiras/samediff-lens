/**
 * Trajectory index page for `samediff history <file>`.
 *
 * Sections, top to bottom:
 *   1. Header with file path, commit count, generated timestamp
 *   2. Drift chart (inline SVG bars, severity-colored)
 *   3. Step list — one row per transition with score, severity, thesis,
 *      top issue, author, date, link to per-pair report
 *
 * Self-contained (no external CSS/JS), dark-with-light-fallback theme
 * matching the rest of the SameDiff outputs.
 */

import type { HistoryReport, HistoryStep } from "./history";
import type { TrailThesis } from "../analysis/narrative/trail";

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

function severityBadgeClass(sev: string): string {
  // Engine sometimes labels mid-tier as "medium" rather than "moderate"
  if (sev === "medium") return "moderate";
  return sev;
}

export function formatHistoryIndexHtml(report: HistoryReport): string {
  const fp = esc(report.filePath);
  const stepCount = report.steps.length;
  const ts = esc(report.generatedAt);
  const maxScore = report.steps.reduce((m, s) => Math.max(m, s.score), 0);
  const avgScore = stepCount === 0
    ? 0
    : Math.round(report.steps.reduce((a, s) => a + s.score, 0) / stepCount * 10) / 10;
  const composites = report.steps.filter((s) => s.thesis?.isComposite).length;
  const thesesCount = report.steps.filter((s) => s.thesis !== null).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SameDiff history \u2014 ${fp}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface2: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --orange: #f0883e; --blue: #58a6ff; --cyan: #39d353;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5;
    padding: 2rem; max-width: 1200px; margin: 0 auto;
  }

  .header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; font-weight: 600; }
  .header h1 span { color: var(--cyan); }
  .header .file-path {
    color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95rem; margin-bottom: 0.4rem;
  }
  .header .meta { color: var(--text2); font-size: 0.85rem; }

  .stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem; margin: 1.5rem 0;
  }
  .stat {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.65rem 0.85rem;
  }
  .stat-num { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-num.critical { color: var(--red); }
  .stat-num.high { color: var(--orange); }
  .stat-num.moderate { color: var(--yellow); }
  .stat-num.low { color: var(--green); }
  .stat-label {
    font-size: 0.72rem; color: var(--text2);
    text-transform: uppercase; letter-spacing: 0.05em;
  }

  .section-title {
    font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text2); font-weight: 600; margin: 1.5rem 0 0.6rem;
  }

  /* Drift chart */
  .chart-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 0.85rem 1rem;
  }
  .chart-svg { display: block; width: 100%; height: auto; }
  .chart-legend {
    display: flex; gap: 1rem; flex-wrap: wrap;
    margin-top: 0.5rem; font-size: 0.78rem; color: var(--text2);
  }
  .chart-legend .key {
    display: inline-flex; align-items: center; gap: 0.35rem;
  }
  .chart-legend .swatch {
    width: 0.75rem; height: 0.75rem; border-radius: 2px; display: inline-block;
  }
  .chart-legend .swatch.low      { background: var(--green); }
  .chart-legend .swatch.moderate { background: var(--yellow); }
  .chart-legend .swatch.high     { background: var(--orange); }
  .chart-legend .swatch.critical { background: var(--red); }

  /* Step list */
  .steps { display: flex; flex-direction: column; gap: 0.55rem; }
  .step {
    display: block; text-decoration: none; color: inherit;
    background: var(--surface); border: 1px solid var(--border);
    border-left: 3px solid var(--border); border-radius: 6px;
    padding: 0.7rem 1rem; transition: border-color 0.15s ease;
  }
  .step:hover { border-color: var(--blue); }
  .step.sev-critical { border-left-color: var(--red); }
  .step.sev-high     { border-left-color: var(--orange); }
  .step.sev-moderate { border-left-color: var(--yellow); }
  .step.sev-low      { border-left-color: var(--green); }
  .step-row1 {
    display: flex; gap: 0.75rem; align-items: center;
    margin-bottom: 0.3rem; flex-wrap: wrap;
  }
  .step-idx {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text2); font-size: 0.78rem; min-width: 2.4rem;
  }
  .step-shas {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--blue); font-size: 0.8rem;
  }
  .step-arrow { color: var(--text2); }
  .step-score {
    margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
  }
  .step-score.critical { color: var(--red); }
  .step-score.high { color: var(--orange); }
  .step-score.moderate { color: var(--yellow); }
  .step-score.low { color: var(--green); }
  .step-sev-tag {
    font-size: 0.68rem; padding: 0.05rem 0.45rem; border-radius: 8px;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
    background: var(--surface2);
  }
  .step-sev-tag.critical { background: rgba(248,81,73,0.18); color: var(--red); }
  .step-sev-tag.high     { background: rgba(240,136,62,0.18); color: var(--orange); }
  .step-sev-tag.moderate { background: rgba(210,153,34,0.18); color: var(--yellow); }
  .step-sev-tag.low      { background: rgba(63,185,80,0.18); color: var(--green); }
  .step-subject {
    font-size: 0.92rem; color: var(--text); margin-bottom: 0.25rem;
  }
  .step-thesis {
    font-size: 0.85rem; color: var(--text);
    background: var(--surface2); border-left: 2px solid var(--blue);
    padding: 0.3rem 0.55rem; border-radius: 3px;
    margin-top: 0.35rem; display: inline-block;
  }
  .step-thesis .tlabel {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text2); margin-right: 0.35rem;
  }
  .step-top-issue {
    font-size: 0.82rem; color: var(--text2);
    margin-top: 0.25rem;
  }
  .step-meta {
    font-size: 0.75rem; color: var(--text2); margin-top: 0.3rem;
  }
  .step-meta .author { color: var(--text); }

  /* Trail (history) thesis band */
  .trail-thesis {
    background: linear-gradient(180deg, var(--surface2) 0%, var(--surface) 100%);
    border: 1px solid var(--border);
    border-left: 4px solid var(--blue);
    border-radius: 6px;
    padding: 0.9rem 1.1rem;
    margin: 1rem 0 1.25rem;
  }
  .trail-thesis.sev-critical { border-left-color: var(--red); }
  .trail-thesis.sev-high     { border-left-color: var(--orange); }
  .trail-thesis.sev-moderate { border-left-color: var(--yellow); }
  .trail-thesis.sev-low      { border-left-color: var(--green); }
  .trail-thesis .tt-label {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text2); font-weight: 700;
  }
  .trail-thesis .tt-label .pill {
    background: var(--surface2); color: var(--text2);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 0.05rem 0.4rem; margin-left: 0.4rem;
    font-size: 0.6rem; font-weight: 700;
  }
  .trail-thesis .tt-headline {
    font-size: 1.05rem; font-weight: 600; color: var(--text);
    margin-top: 0.25rem;
  }
  .trail-thesis .tt-sub {
    font-size: 0.85rem; color: var(--text2);
    margin-top: 0.2rem;
  }
  .trail-thesis .tt-arc {
    display: grid; grid-template-columns: 1fr auto 1fr;
    gap: 0.6rem; align-items: center;
    margin-top: 0.55rem;
    font-size: 0.78rem;
  }
  .trail-thesis .tt-arc .cell {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 0.35rem 0.55rem;
  }
  .trail-thesis .tt-arc .arrow {
    color: var(--blue); font-weight: 700; font-size: 1rem;
  }
  .trail-thesis .tt-arc .label {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text2); margin-bottom: 0.1rem;
  }
  .trail-thesis .tt-cites {
    margin-top: 0.6rem; font-size: 0.78rem; color: var(--text2);
  }
  .trail-thesis .tt-cites .chip {
    display: inline-flex; align-items: center; gap: 0.25rem;
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 999px; padding: 0.1rem 0.55rem; margin: 0.15rem 0.25rem 0.15rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem;
    color: var(--text); text-decoration: none;
  }
  .trail-thesis .tt-cites .chip:hover { border-color: var(--blue); }
  .trail-thesis details.tt-expand {
    margin-top: 0.55rem; font-size: 0.8rem;
  }
  .trail-thesis details.tt-expand summary {
    cursor: pointer; color: var(--text2);
  }
  .trail-thesis details.tt-expand summary:hover { color: var(--text); }

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
      --orange: #b35900; --blue: #0969da; --cyan: #0550ae;
    }
  }
</style>
</head>
<body>
<div class="header">
  <h1><span>\u0394</span> SameDiff history</h1>
  <div class="file-path">${fp}</div>
  <div class="meta">${stepCount} transition${stepCount === 1 ? "" : "s"} \u00b7 generated ${ts}</div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-num">${stepCount}</div>
    <div class="stat-label">Transitions</div>
  </div>
  <div class="stat">
    <div class="stat-num ${esc(severityBadgeClass(severityFor(maxScore)))}">${maxScore.toFixed(1)}</div>
    <div class="stat-label">Worst score</div>
  </div>
  <div class="stat">
    <div class="stat-num">${avgScore.toFixed(1)}</div>
    <div class="stat-label">Avg score</div>
  </div>
  <div class="stat">
    <div class="stat-num">${thesesCount}</div>
    <div class="stat-label">Step theses</div>
  </div>
  <div class="stat">
    <div class="stat-num">${composites}</div>
    <div class="stat-label">Composites</div>
  </div>
  <div class="stat">
    <div class="stat-num" title="${report.trailThesis ? esc(report.trailThesis.headline) : "no trail-level pattern earned — doctrine stayed silent"}">${report.trailThesis ? "\u2713" : "\u2014"}</div>
    <div class="stat-label">Trail thesis</div>
  </div>
</div>

${renderTrailThesis(report.trailThesis, report.steps)}

<div class="section-title">Drift over time</div>
${renderChart(report.steps)}

${renderConsequentialSteps(report)}

<div class="section-title">Per-transition detail</div>
<div class="steps">
  ${report.steps.map(renderStep).join("")}
</div>

<div class="footer">
  Generated by <a href="https://github.com/henry-filgueiras/samediff-lens">SameDiff Lens</a>
  \u2014 deterministic heuristics, no LLM
</div>
</body>
</html>`;
}

// ── Trail thesis band (Tier 1: theory) ────────────────────────────

function renderTrailThesis(
  t: TrailThesis | null,
  steps: HistoryStep[],
): string {
  if (!t) return "";
  const sev = severityBadgeClass(t.severity);
  const conf = esc(t.confidence);
  const headline = esc(t.headline);
  const sub = esc(t.subheadline);

  const stepsByIndex = new Map(steps.map((s) => [s.index, s]));

  // Citation chips — each one links straight to the per-pair report.
  // We cap at 12 to keep the band readable; the full list is in the
  // <details> block below.
  const maxChips = 12;
  const chips = t.citedIssueRefs.slice(0, maxChips).map((c) => {
    const s = stepsByIndex.get(c.stepIndex);
    const href = s ? s.htmlFilename : "#";
    const label = `#${c.stepIndex} ${c.toShort}`;
    const title = `${c.authorDate.slice(0, 10)} — ${c.issueTitle}`;
    return `<a class="chip" href="${esc(href)}" title="${esc(title)}">${esc(label)}</a>`;
  }).join("");
  const overflow = t.citedIssueRefs.length > maxChips
    ? `<span class="chip" title="${t.citedIssueRefs.length - maxChips} more citations">+${t.citedIssueRefs.length - maxChips}</span>`
    : "";

  const arcBlock = t.arc
    ? `
      <div class="tt-arc">
        <div class="cell">
          <div class="label">${t.arc.kind === "reversal" ? "Earlier" : "Earlier cohort"}</div>
          <div>${renderArcCell(t.arc.earlierSteps, stepsByIndex)}</div>
        </div>
        <div class="arrow">${t.arc.kind === "reversal" ? "\u2194" : "\u2192"}</div>
        <div class="cell">
          <div class="label">${t.arc.kind === "reversal" ? "Later" : "Later cohort"}</div>
          <div>${renderArcCell(t.arc.laterSteps, stepsByIndex)}</div>
        </div>
      </div>` : "";

  // Full citation list (collapsed by default when there are many).
  const fullList = t.citedIssueRefs.map((c) => {
    const s = stepsByIndex.get(c.stepIndex);
    const href = s ? s.htmlFilename : "#";
    return `
      <li>
        <a href="${esc(href)}"><code>#${c.stepIndex} ${esc(c.toShort)}</code></a>
        <span style="color:var(--text2);">[${esc(c.issueKind)}]</span>
        ${esc(c.issueTitle)}
      </li>`;
  }).join("");

  return `
<div class="trail-thesis sev-${esc(sev)}">
  <div class="tt-label">History thesis <span class="pill">${conf} confidence</span></div>
  <div class="tt-headline">${headline}</div>
  <div class="tt-sub">${sub}</div>
  ${arcBlock}
  <div class="tt-cites">
    <span style="font-weight:600; color:var(--text);">Supporting:</span>
    ${chips}${overflow}
  </div>
  <details class="tt-expand">
    <summary>All ${t.citedIssueRefs.length} cited issue${t.citedIssueRefs.length === 1 ? "" : "s"}</summary>
    <ul style="margin-top:0.35rem; padding-left:1.1rem;">${fullList}</ul>
  </details>
</div>`;
}

function renderArcCell(
  stepIndices: number[],
  stepsByIndex: Map<number, HistoryStep>,
): string {
  if (stepIndices.length === 0) return "\u2014";
  return stepIndices.slice(0, 6).map((idx) => {
    const s = stepsByIndex.get(idx);
    if (!s) return `#${idx}`;
    return `<a href="${esc(s.htmlFilename)}" title="${esc(s.commitSubject)}"><code>#${idx} ${esc(s.toShort)}</code></a>`;
  }).join(", ") + (stepIndices.length > 6 ? `, +${stepIndices.length - 6} more` : "");
}

// ── Consequential steps (Tier 2: strongest accusations) ─────────────

/**
 * Short list of the handful of steps that carry the most weight. Pulls
 * from trail thesis citations first, then backfills by score. Keeps the
 * main body of the page focused — reviewers see theory → accusation →
 * proof, in that order, rather than scrolling straight into the flat
 * step list.
 */
function renderConsequentialSteps(report: HistoryReport): string {
  if (report.steps.length <= 3) return ""; // small trail: full list is enough

  const scored: Array<{ s: HistoryStep; w: number }> = [];
  const citedSet = new Set(
    (report.trailThesis?.citedStepIndices ?? []),
  );

  for (const s of report.steps) {
    let w = s.score;
    if (citedSet.has(s.index)) w += 5; // citations earn priority
    if (s.thesis) w += 2;
    scored.push({ s, w });
  }
  scored.sort((a, b) => b.w - a.w);
  const pick = scored.slice(0, Math.min(5, Math.max(3, Math.ceil(report.steps.length / 8))));
  if (pick.length === 0) return "";

  const rows = pick
    .map((p) => p.s)
    .sort((a, b) => a.index - b.index)
    .map(renderStep)
    .join("");

  return `
<div class="section-title">Most consequential steps</div>
<div class="steps">${rows}</div>`;
}

// ── Drift chart (inline SVG bars) ─────────────────────────────────

function renderChart(steps: HistoryStep[]): string {
  if (steps.length === 0) {
    return `<div class="chart-wrap"><span style="color:var(--text2); font-size:0.85rem;">(no steps to chart)</span></div>`;
  }

  // Compact, wide chart. Bars scale to fit horizontal width via SVG
  // viewBox; hover-targetable for native tooltips via <title>.
  const W = 1000;
  const H = 220;
  const padL = 36;
  const padR = 16;
  const padT = 10;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Bar geometry — at least 1px bar with a 1px gap.
  const slotW = plotW / steps.length;
  const barW = Math.max(2, slotW * 0.7);
  const barOffset = (slotW - barW) / 2;

  // Y axis: 0..10
  const yFor = (score: number) => padT + plotH - (score / 10) * plotH;

  // Reference grid lines at 2.5 / 5.0 / 7.5
  const grid = [2.5, 5, 7.5].map((v) => {
    const y = yFor(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2 3"/>`
       + `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text2)">${v}</text>`;
  }).join("");

  // Y axis 0 and 10 labels
  const axes = `
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--border)" stroke-width="1"/>
    <text x="${padL - 4}" y="${H - padB + 3}" text-anchor="end" font-size="9" fill="var(--text2)">0</text>
    <text x="${padL - 4}" y="${padT + 3}" text-anchor="end" font-size="9" fill="var(--text2)">10</text>
  `;

  // Bars + thesis-fired markers
  const bars = steps.map((s, i) => {
    const x = padL + i * slotW + barOffset;
    const top = yFor(s.score);
    const h = (H - padB) - top;
    const fill = severityFill(s.severity);
    const labelDate = s.authorDate.slice(0, 10);
    const tooltip = `step ${s.index} \u2014 score ${s.score.toFixed(1)} (${s.severity})`
      + ` \u2014 ${labelDate}`
      + (s.thesis ? `\nthesis: ${s.thesis.headline}` : "")
      + (s.topIssue ? `\ntop: ${s.topIssue.title}` : "");
    // Triangle marker above bars where a thesis fired (composite or atom)
    const marker = s.thesis
      ? `<polygon points="${x + barW / 2 - 4},${padT + 2} ${x + barW / 2 + 4},${padT + 2} ${x + barW / 2},${padT + 8}" fill="var(--blue)"><title>thesis fired: ${esc(s.thesis.headline)}</title></polygon>`
      : "";
    return `
      <g>
        <rect x="${x}" y="${top}" width="${barW}" height="${Math.max(0.5, h)}" fill="${fill}" rx="1"><title>${esc(tooltip)}</title></rect>
        ${marker}
      </g>`;
  }).join("");

  // X axis: index labels (skip if too dense)
  const labelEvery = steps.length <= 30 ? 1 : Math.ceil(steps.length / 30);
  const xLabels = steps.map((s, i) => {
    if (i % labelEvery !== 0 && i !== steps.length - 1) return "";
    const x = padL + i * slotW + slotW / 2;
    return `<text x="${x}" y="${H - padB + 12}" text-anchor="middle" font-size="9" fill="var(--text2)">${s.index}</text>`;
  }).join("");

  return `
  <div class="chart-wrap">
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      ${grid}
      ${bars}
      ${axes}
      ${xLabels}
    </svg>
    <div class="chart-legend">
      <span class="key"><span class="swatch low"></span>low</span>
      <span class="key"><span class="swatch moderate"></span>moderate</span>
      <span class="key"><span class="swatch high"></span>high</span>
      <span class="key"><span class="swatch critical"></span>critical</span>
      <span class="key"><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,0 5,8" fill="var(--blue)"/></svg> thesis fired</span>
    </div>
  </div>`;
}

function severityFill(sev: string): string {
  const cls = severityBadgeClass(sev);
  switch (cls) {
    case "critical": return "var(--red)";
    case "high":     return "var(--orange)";
    case "moderate": return "var(--yellow)";
    case "low":      return "var(--green)";
    default:         return "var(--text2)";
  }
}

function severityFor(score: number): string {
  if (score <= 2) return "low";
  if (score <= 5) return "moderate";
  if (score <= 7) return "high";
  return "critical";
}

// ── Step row ──────────────────────────────────────────────────────

function renderStep(step: HistoryStep): string {
  const sev = severityBadgeClass(step.severity);
  const fromShort = step.fromRef === "EMPTY" ? "EMPTY" : step.fromRef.slice(0, 8);
  const date = step.authorDate.slice(0, 10);
  const author = esc(step.authorName);
  const subject = esc(truncate(step.commitSubject, 130));

  const thesisHtml = step.thesis
    ? `<div class="step-thesis">
        <span class="tlabel">${step.thesis.isComposite ? "composite thesis" : "thesis"}</span>
        ${esc(step.thesis.headline)}
       </div>`
    : "";

  const topIssueHtml = step.topIssue
    ? `<div class="step-top-issue">
        <strong>top:</strong> ${esc(truncate(step.topIssue.title, 140))}
       </div>`
    : "";

  return `
    <a class="step sev-${esc(sev)}" href="${esc(step.htmlFilename)}">
      <div class="step-row1">
        <span class="step-idx">#${step.index}</span>
        <span class="step-shas">${esc(fromShort)}</span>
        <span class="step-arrow">\u2192</span>
        <span class="step-shas">${esc(step.toShort)}</span>
        <span class="step-sev-tag ${esc(sev)}">${esc(sev)}</span>
        <span class="step-score ${esc(sev)}">${step.score.toFixed(1)}</span>
      </div>
      <div class="step-subject">${subject}</div>
      ${thesisHtml}
      ${topIssueHtml}
      <div class="step-meta">
        <span class="author">${author}</span> \u00b7 ${esc(date)} \u00b7 ${step.totalFindings} finding${step.totalFindings === 1 ? "" : "s"}
      </div>
    </a>`;
}
