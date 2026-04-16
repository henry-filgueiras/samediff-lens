// Compose the pipeline: git diff -> intent -> drift -> result object.

const { getDiff } = require('./git');
const { classifyIntent, extractTextDomains } = require('./intent');
const { computeDrift, suggestTitle } = require('./drift');

function runCheck({ base, head, title, body = '', repo = process.cwd(), files }) {
  const diffFiles = files || getDiff(base, head, repo);
  const intent = classifyIntent(title, body);
  intent.textDomains = extractTextDomains(`${title}\n${body}`);
  const drift = computeDrift({ intent, files: diffFiles, title, body });
  const suggestedTitle = suggestTitle({ intent, drift, title });

  return {
    title,
    body,
    intent,
    drift,
    suggestedTitle,
    files: diffFiles,
  };
}

module.exports = { runCheck };
