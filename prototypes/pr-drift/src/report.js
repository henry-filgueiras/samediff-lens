// Format a drift result as an ANSI-coloured terminal report.
// Honours NO_COLOR and non-TTY environments.

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW= '\x1b[33m';
const CYAN  = '\x1b[36m';
const MAGENTA = '\x1b[35m';

const useColor =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR);

function c(text, code) {
  return useColor ? `${code}${text}${RESET}` : text;
}

function bar(score, width = 24) {
  const fill = Math.round(score * width);
  const color = score >= 0.6 ? RED : score >= 0.3 ? YELLOW : GREEN;
  return c('█'.repeat(fill), color) + c('·'.repeat(width - fill), DIM);
}

function severityColor(sev) {
  const s = sev.toLowerCase();
  if (s === 'high') return RED;
  if (s === 'med') return YELLOW;
  return GREEN;
}

function render(result) {
  const { title, intent, drift, suggestedTitle } = result;
  const lines = [];

  lines.push(c('SameDiff Lens — drift report', BOLD));
  lines.push(c('─'.repeat(52), DIM));
  lines.push(`${c('Title: ', DIM)}${title}`);
  lines.push(`${c('Intent:', DIM)} ${intent.type}` +
    (intent.confidence === 'low' ? c('  (low confidence)', DIM) : ''));
  lines.push('');

  lines.push(
    `${c('Drift', BOLD)}  ${bar(drift.score)}  ` +
    `${c(drift.score.toFixed(2), BOLD)}  ` +
    c(`[${drift.severity}]`, severityColor(drift.severity) + BOLD)
  );
  lines.push('');

  const s = drift.stats;
  lines.push(c('Change shape', DIM));
  lines.push(`  files=${s.totalFiles}  +${s.adds}/~${s.modifies}/-${s.deletes}  renames=${s.renames}  Δ+${s.linesAdded}/-${s.linesDeleted}`);
  const domains = Object.entries(drift.pathDomains)
    .map(([d, n]) => `${d}(${n})`)
    .join('  ');
  if (domains) lines.push(`  domains: ${domains}`);
  lines.push('');

  if (drift.signals.length === 0) {
    lines.push(c('✓ no drift signals', GREEN));
  } else {
    lines.push(c('Signals', DIM));
    for (const sig of drift.signals) {
      const tag = c(`[${sig.severity.toUpperCase()}]`, severityColor(sig.severity));
      const kind = c(sig.kind, CYAN);
      lines.push(`  ${tag} ${kind}`);
      lines.push(`        ${sig.detail}`);
    }
  }
  lines.push('');

  if (suggestedTitle && suggestedTitle !== title) {
    lines.push(c('Suggested title', DIM));
    lines.push(`  ${c(suggestedTitle, MAGENTA)}`);
  }

  return lines.join('\n');
}

module.exports = { render };
