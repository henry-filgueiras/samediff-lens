import type { AnalysisResult } from "../analysis/types";
import { computeDriftScore } from "./scoring";
import { describeContradiction, NO_PRIOR_LINE_TEXT } from "../analysis/heuristics";

type HtmlOptions = {
  fileA?: string;
  fileB?: string;
  generatedAt?: string;
};

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trim() + "\u2026" : text;
}

function severityClass(score: number): string {
  if (score <= 2) return "low";
  if (score <= 5) return "medium";
  if (score <= 7) return "high";
  return "critical";
}

function severityLabel(score: number): string {
  if (score <= 2) return "Low drift";
  if (score <= 5) return "Moderate drift";
  if (score <= 7) return "High drift";
  return "Critical drift";
}

export function formatHtmlReport(
  result: AnalysisResult,
  options: HtmlOptions = {},
): string {
  const fileA = esc(options.fileA ?? "Version A");
  const fileB = esc(options.fileB ?? "Version B");
  const ts = options.generatedAt ?? new Date().toISOString();
  const score = computeDriftScore(result);
  const sev = severityClass(score);
  const sevLabel = severityLabel(score);

  const sections: string[] = [];

  // Commitment shifts
  if (result.changedCommitmentsEvidence.length > 0) {
    const items = result.changedCommitmentsEvidence.map((ev) => `
      <div class="evidence-card">
        <div class="ev-before">${esc(truncate(ev.versionA, 120))}</div>
        <div class="ev-after">${esc(truncate(ev.versionB, 120))}</div>
        <div class="ev-tags">${ev.triggers.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>`).join("");
    sections.push(card("Commitment Shifts", "commitment", result.changedCommitmentsEvidence.length, items));
  }

  // Task drift
  if (result.actionItemsAdded.length > 0 || result.actionItemsRemoved.length > 0) {
    const items = [
      ...result.actionItemsAdded.map((i) => `<div class="ev-added">+ ${esc(truncate(i, 90))}</div>`),
      ...result.actionItemsRemoved.map((i) => `<div class="ev-removed">- ${esc(truncate(i, 90))}</div>`),
    ].join("");
    sections.push(card("Task Drift", "task", result.actionItemsAdded.length + result.actionItemsRemoved.length, items));
  }

  // Concept renames
  if (result.renamedIdeas.length > 0) {
    const items = result.renamedIdeas.map((r) => `
      <div class="rename-row">
        <span class="rename-from">${esc(r.from)}</span>
        <span class="rename-arrow">\u2192</span>
        <span class="rename-to">${esc(r.to)}</span>
        <span class="tag tag-${r.confidence}">${r.confidence}</span>
      </div>`).join("");
    sections.push(card("Concept Renames", "rename", result.renamedIdeas.length, items));
  }

  // Contradictions
  if (result.possibleContradictionsEvidence.length > 0) {
    const items = result.possibleContradictionsEvidence.map((ev) => {
      const meta = describeContradiction(ev);
      const priorLine = meta.priorLineFound
        ? `<div class="ev-field"><span class="ev-field-label">PRIOR LINE</span><span class="ev-field-value">${esc(truncate(ev.versionA, 200))}</span></div>`
        : `<div class="ev-field"><span class="ev-field-label">PRIOR LINE</span><span class="ev-field-value ev-additive">${esc(NO_PRIOR_LINE_TEXT)}</span></div>
           <div class="ev-field ev-field-dim"><span class="ev-field-label">matched against</span><span class="ev-field-value">${esc(truncate(ev.versionA, 200))}</span></div>`;
      return `
      <div class="evidence-card contradiction">
        <div class="ev-summary">${esc(ev.summary)}</div>
        <div class="ev-field"><span class="ev-field-label">NEW LINE</span><span class="ev-field-value">${esc(truncate(ev.versionB, 200))}</span></div>
        ${priorLine}
        <div class="ev-field"><span class="ev-field-label">REASON</span><span class="ev-field-value"><code>${esc(meta.reason)}</code> — ${esc(meta.reasonDetail)}</span></div>
        <div class="ev-field"><span class="ev-field-label">CONFIDENCE</span><span class="tag tag-${meta.confidence}">${meta.confidence}</span></div>
        ${ev.anchors.length > 0 ? `<div class="ev-tags">${ev.anchors.map((a) => `<span class="tag">${esc(a)}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
    sections.push(card("Possible Contradictions", "contradiction", result.possibleContradictionsEvidence.length, items));
  }

  // Added concepts
  if (result.addedConcepts.length > 0) {
    const items = result.addedConcepts.map((c) => `<div class="ev-added">+ ${esc(c)}</div>`).join("");
    sections.push(card("Added Concepts", "added", result.addedConcepts.length, items));
  }

  // Removed concepts
  if (result.removedConcepts.length > 0) {
    const items = result.removedConcepts.map((c) => `<div class="ev-removed">- ${esc(c)}</div>`).join("");
    sections.push(card("Removed Concepts", "removed", result.removedConcepts.length, items));
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SameDiff \u2014 ${fileA} \u2192 ${fileB}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface2: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --blue: #58a6ff; --purple: #bc8cff; --cyan: #39d353;
    --green-bg: rgba(63,185,80,0.1); --red-bg: rgba(248,81,73,0.1);
    --yellow-bg: rgba(210,153,34,0.1);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    padding: 2rem; max-width: 900px; margin: 0 auto;
  }
  .header { margin-bottom: 2rem; }
  .header h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  .header h1 span { color: var(--cyan); }
  .meta { color: var(--text2); font-size: 0.85rem; }
  .files { color: var(--text2); font-size: 0.95rem; margin-top: 0.5rem; }
  .files .fname { color: var(--blue); }

  .score-bar {
    margin: 1.5rem 0; padding: 1rem 1.25rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px;
    display: flex; align-items: center; gap: 1rem;
  }
  .score-meter {
    flex: 1; height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden;
  }
  .score-fill {
    height: 100%; border-radius: 4px;
    transition: width 0.6s ease;
  }
  .score-fill.low { background: var(--green); }
  .score-fill.medium { background: var(--yellow); }
  .score-fill.high { background: var(--red); }
  .score-fill.critical { background: var(--red); box-shadow: 0 0 8px var(--red); }
  .score-label { font-size: 0.9rem; white-space: nowrap; }
  .score-num { font-weight: 700; font-size: 1.4rem; font-variant-numeric: tabular-nums; }
  .score-num.low { color: var(--green); }
  .score-num.medium { color: var(--yellow); }
  .score-num.high { color: var(--red); }
  .score-num.critical { color: var(--red); }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 1rem; overflow: hidden;
  }
  .card-header {
    padding: 0.75rem 1rem; display: flex; align-items: center;
    justify-content: space-between; cursor: pointer; user-select: none;
  }
  .card-header:hover { background: var(--surface2); }
  .card-title { font-weight: 600; font-size: 0.95rem; }
  .card-count {
    font-size: 0.8rem; background: var(--surface2); padding: 0.15rem 0.5rem;
    border-radius: 10px; color: var(--text2);
  }
  .card-body { padding: 0 1rem 0.75rem 1rem; }
  .card.commitment .card-title { color: var(--yellow); }
  .card.task .card-title { color: var(--green); }
  .card.rename .card-title { color: var(--purple); }
  .card.contradiction .card-title { color: var(--red); }
  .card.added .card-title { color: var(--green); }
  .card.removed .card-title { color: var(--red); }

  .evidence-card {
    padding: 0.5rem 0; border-bottom: 1px solid var(--border);
  }
  .evidence-card:last-child { border-bottom: none; }
  .ev-before { color: var(--red); font-size: 0.9rem; }
  .ev-before::before { content: "- "; font-weight: 700; }
  .ev-after { color: var(--green); font-size: 0.9rem; }
  .ev-after::before { content: "+ "; font-weight: 700; }
  .ev-summary { font-size: 0.9rem; color: var(--yellow); }
  .ev-added { color: var(--green); font-size: 0.9rem; padding: 0.15rem 0; }
  .ev-removed { color: var(--red); font-size: 0.9rem; padding: 0.15rem 0; }
  .ev-tags { margin-top: 0.3rem; display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .ev-field {
    display: flex; gap: 0.6rem; font-size: 0.85rem;
    padding: 0.2rem 0; align-items: baseline;
  }
  .ev-field-label {
    flex: 0 0 7.5rem; text-transform: uppercase; font-size: 0.7rem;
    letter-spacing: 0.05em; color: var(--text2); font-weight: 600;
  }
  .ev-field-value { flex: 1; color: var(--text); word-break: break-word; }
  .ev-field-value code {
    background: var(--surface2); padding: 0.05rem 0.35rem;
    border-radius: 3px; font-size: 0.8rem;
  }
  .ev-field-dim .ev-field-value { color: var(--text2); }
  .ev-additive { color: var(--text2); font-style: italic; }

  .tag {
    font-size: 0.75rem; padding: 0.1rem 0.45rem; border-radius: 4px;
    background: var(--surface2); color: var(--text2);
  }
  .tag-high { background: rgba(63,185,80,0.15); color: var(--green); }
  .tag-medium { background: var(--yellow-bg); color: var(--yellow); }
  .tag-low { background: var(--surface2); color: var(--text2); }

  .rename-row {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.35rem 0; font-size: 0.9rem;
  }
  .rename-from { color: var(--purple); }
  .rename-arrow { color: var(--text2); }
  .rename-to { color: var(--cyan); }

  .summary {
    margin-top: 1.5rem; padding: 1rem; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px;
    color: var(--text2); font-size: 0.85rem;
  }
  .footer {
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);
    color: var(--text2); font-size: 0.8rem; text-align: center;
  }
  .footer a { color: var(--blue); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fff; --surface: #f6f8fa; --surface2: #eaeef2;
      --border: #d0d7de; --text: #1f2328; --text2: #656d76;
      --green: #1a7f37; --red: #cf222e; --yellow: #9a6700;
      --blue: #0969da; --purple: #8250df; --cyan: #0550ae;
      --green-bg: rgba(26,127,55,0.08); --red-bg: rgba(207,34,46,0.08);
      --yellow-bg: rgba(154,103,0,0.08);
    }
  }
</style>
</head>
<body>
  <div class="header">
    <h1><span>\u0394</span> SameDiff Report</h1>
    <div class="files"><span class="fname">${fileA}</span> \u2192 <span class="fname">${fileB}</span></div>
    <div class="meta">${esc(ts)}</div>
  </div>

  <div class="score-bar">
    <div class="score-num ${sev}">${score.toFixed(1)}</div>
    <div>
      <div class="score-label">${sevLabel}</div>
      <div class="score-meter">
        <div class="score-fill ${sev}" style="width: ${score * 10}%"></div>
      </div>
    </div>
  </div>

  ${sections.join("\n")}

  <div class="summary">${esc(result.summary)}</div>

  <div class="footer">
    Generated by <a href="https://github.com/henry-filgueiras/samediff-lens">SameDiff Lens</a>
    \u2014 deterministic heuristics, no LLM
  </div>

<script>
document.querySelectorAll('.card-header').forEach(h => {
  h.addEventListener('click', () => {
    const body = h.nextElementSibling;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
  });
});
</script>
</body>
</html>`;
}

function card(title: string, type: string, count: number, content: string): string {
  return `
  <div class="card ${type}">
    <div class="card-header">
      <span class="card-title">${esc(title)}</span>
      <span class="card-count">${count}</span>
    </div>
    <div class="card-body">${content}</div>
  </div>`;
}
