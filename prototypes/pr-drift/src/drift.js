// Compute a drift score from (intent, files). Each signal is a small,
// explainable rule. The score is a weighted sum clamped to [0, 1].

const path = require('node:path');
const { canonicalDomain } = require('./intent');

const DEP_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'pyproject.toml',
  'Gemfile', 'Gemfile.lock',
  'go.mod', 'go.sum',
  'Cargo.toml', 'Cargo.lock',
  'composer.json', 'composer.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
]);

const SOURCE_EXT = /\.(jsx?|tsx?|mjs|cjs|py|go|rb|rs|java|kt|c|cc|cpp|cs|php|swift|scala)$/i;

const INFRA_PATTERNS = [
  /^\.github\//,
  /^\.circleci\//,
  /^\.gitlab-ci\.yml$/,
  /(^|\/)Dockerfile(\..+)?$/,
  /(^|\/)docker-compose(\..+)?\.ya?ml$/,
  /^k8s\//, /^kubernetes\//, /^helm\//, /^terraform\//, /^ansible\//,
  /(^|\/)Jenkinsfile$/,
];

const SKIP_SEGMENTS = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'pkg', 'internal', 'cmd',
]);

const TEST_SEGMENTS = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress',
]);

function isTestPath(p) {
  if (/\.(test|spec)\.[jt]sx?$/.test(p)) return true;
  return p.split('/').some(seg => TEST_SEGMENTS.has(seg));
}

// Pick the most meaningful directory segment from a file path.
// `src/auth/jwt.js` -> `auth`, `package.json` -> null, `tests/foo.js` -> `tests`.
// When every directory segment is skip-listed (e.g. `src/lib/cache.ts`),
// fall back to the filename stem so the file still claims a domain — otherwise
// a whole new source module slips through with no attributed domain at all.
function pathDomain(filePath) {
  const parts = filePath.split('/');
  if (parts.some(p => TEST_SEGMENTS.has(p)) || /\.(test|spec)\.[jt]sx?$/.test(parts[parts.length - 1])) {
    return 'tests';
  }
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (SKIP_SEGMENTS.has(p)) continue;
    return canonicalDomain(p.toLowerCase().replace(/[^\w-]/g, ''));
  }
  if (parts.length > 1) {
    const stem = parts[parts.length - 1]
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^\w-]/g, '');
    if (stem) return canonicalDomain(stem);
  }
  return null;
}

function inferPathDomains(files) {
  const counts = {};
  for (const f of files) {
    const d = pathDomain(f.path);
    if (!d) continue;
    counts[d] = (counts[d] || 0) + 1;
  }
  return counts;
}

function detectDependencyFiles(files) {
  return files.filter(f => DEP_FILES.has(path.basename(f.path)));
}

function computeDrift({ intent, files, title, body }) {
  const text = `${title}\n${body || ''}`.toLowerCase();
  const pathDomains = inferPathDomains(files);
  const touchedDomains = Object.keys(pathDomains).filter(d => d !== 'tests');
  const depFiles = detectDependencyFiles(files);
  const renameCount = files.filter(f => f.status === 'rename').length;
  const nonTestCount = files.filter(f => !isTestPath(f.path)).length;
  const addCount = files.filter(f => f.status === 'add').length;
  const totalAdded = files.reduce((s, f) => s + (f.added || 0), 0);
  const totalDeleted = files.reduce((s, f) => s + (f.deleted || 0), 0);

  const mentioned = new Set(intent.textDomains || []);
  const mentionsInfra = /\b(ci|cd|pipeline|workflow|workflows|infra|infrastructure|deploy|deployment|docker|kubernetes|k8s|terraform|helm|ansible|jenkins|github actions)\b/i.test(text);
  const isMentioned = (domain) =>
    mentioned.has(domain) || text.includes(domain.toLowerCase());

  // A domain counts as "infra-covered" when every file that contributed
  // to it is an infra file AND the PR text mentions CI/infra. This stops
  // unmentioned-domain from firing on `github` when the PR title already
  // says "ci:".
  const isInfraCoveredDomain = (domain) => {
    if (!mentionsInfra) return false;
    const domainFiles = files.filter(f => pathDomain(f.path) === domain);
    return domainFiles.length > 0 && domainFiles.every(f =>
      INFRA_PATTERNS.some(p => p.test(f.path)),
    );
  };

  const signals = [];
  let score = 0;

  // 1. Paths touch a domain the PR text never mentions. Fires even on a
  // single-domain mismatch — a "fix typo" PR that touches `src/payments/**`
  // without saying "payments" anywhere is already worth flagging.
  const unmentionedDomains = touchedDomains.filter(
    d => !isMentioned(d) && !isInfraCoveredDomain(d),
  );
  if (unmentionedDomains.length > 0) {
    const weight = Math.min(0.4, 0.15 + 0.12 * (unmentionedDomains.length - 1));
    score += weight;
    signals.push({
      kind: 'unmentioned-domain',
      severity: weight >= 0.27 ? 'high' : 'med',
      detail: `Touches ${quote(unmentionedDomains)} but the PR text never mentions ${unmentionedDomains.length > 1 ? 'them' : 'it'}.`,
    });
  }

  // 2. Bugfix fanout: one "fix" touching many non-test files.
  if (intent.type === 'bugfix' && nonTestCount > 8) {
    const weight = Math.min(0.35, 0.15 + 0.03 * (nonTestCount - 8));
    score += weight;
    signals.push({
      kind: 'bugfix-fanout',
      severity: nonTestCount > 15 ? 'high' : 'med',
      detail: `Labelled "bugfix" but modifies ${nonTestCount} non-test files. Bugfixes usually concentrate.`,
    });
  }

  // 3. Bugfix crossing several unrelated domains.
  if (intent.type === 'bugfix' && touchedDomains.length >= 3) {
    score += 0.15;
    signals.push({
      kind: 'bugfix-wide-surface',
      severity: 'med',
      detail: `Bugfix spans ${touchedDomains.length} domains (${touchedDomains.join(', ')}). Is this actually several changes bundled together?`,
    });
  }

  // 4. Dependency manifest changed but never mentioned.
  const mentionsDeps = /\b(dep|deps|dependenc|package|bump|upgrade|install|lockfile|lock file)\b/i.test(text);
  if (depFiles.length && !mentionsDeps) {
    const weight = 0.15 + 0.15 * Math.min(2, depFiles.length);
    score += weight;
    signals.push({
      kind: 'silent-deps',
      severity: depFiles.length > 1 ? 'high' : 'med',
      detail: `Dependency manifest changed (${depFiles.map(f => f.path).join(', ')}) but the PR text says nothing about dependencies.`,
    });
  }

  // 5. Refactor-shaped diff hiding inside a non-refactor PR.
  const refactorShape = renameCount >= 3 ||
    (totalDeleted > 100 && totalDeleted > totalAdded * 1.5);
  const mentionsRefactor = /\b(refactor|rename|renamed|move|moved|restructure|cleanup|reorganize|extract)\b/i.test(text);
  if (refactorShape && intent.type !== 'refactor' && !mentionsRefactor) {
    score += 0.2;
    signals.push({
      kind: 'hidden-refactor',
      severity: 'med',
      detail: `${renameCount} rename(s) plus ${totalDeleted} deletions — the diff shape looks like a refactor, but the PR is framed as "${intent.type}".`,
    });
  }

  // 6. "Feature" that adds no new files.
  if (intent.type === 'feature' && addCount === 0 && files.length > 0) {
    score += 0.15;
    signals.push({
      kind: 'feature-no-new-files',
      severity: 'med',
      detail: 'Labelled "feature" but no new files were added. Might be a tweak to an existing surface — verify the framing.',
    });
  }

  // 6b. Bugfix / chore / docs / typo-style PR that nonetheless ships new
  // source modules. Real fixes usually edit existing code.
  if (['bugfix', 'chore', 'docs'].includes(intent.type)) {
    const sourceAdds = files.filter(f =>
      f.status === 'add' && !isTestPath(f.path) && SOURCE_EXT.test(f.path),
    );
    if (sourceAdds.length > 0) {
      const weight = Math.min(0.3, 0.15 + 0.05 * (sourceAdds.length - 1));
      score += weight;
      signals.push({
        kind: 'bugfix-adds-source-file',
        severity: sourceAdds.length > 2 ? 'high' : 'med',
        detail: `Labelled "${intent.type}" but adds ${sourceAdds.length} new source file(s): ${sourceAdds.map(f => f.path).join(', ')}. Fixes usually modify existing code.`,
      });
    }
  }

  // 6c. CI/infra files touched without any mention in the PR text.
  const infraFiles = files.filter(f => INFRA_PATTERNS.some(p => p.test(f.path)));
  if (infraFiles.length > 0 && !mentionsInfra) {
    score += 0.15;
    signals.push({
      kind: 'silent-infra',
      severity: 'med',
      detail: `CI/infra file(s) changed (${infraFiles.map(f => f.path).join(', ')}) but the PR text says nothing about CI, deploy, or infra.`,
    });
  }

  // 7. Intent couldn't be classified at all.
  if (intent.type === 'unknown') {
    score += 0.15;
    signals.push({
      kind: 'unclear-intent',
      severity: 'low',
      detail: "Couldn't classify the PR from its title/body. A clearer verb (fix/add/refactor) would help reviewers.",
    });
  }

  // 8. Very large PR — drift hides in big diffs regardless of framing.
  if (files.length > 30) {
    score += 0.1;
    signals.push({
      kind: 'oversized',
      severity: 'med',
      detail: `${files.length} files changed. Consider splitting — large PRs hide drift well.`,
    });
  }

  score = Math.min(1, Math.round(score * 100) / 100);
  const severity = score >= 0.6 ? 'HIGH' : score >= 0.3 ? 'MED' : 'LOW';

  return {
    score,
    severity,
    signals,
    pathDomains,
    touchedDomains,
    depFiles,
    stats: {
      totalFiles: files.length,
      nonTestFiles: nonTestCount,
      adds: addCount,
      deletes: files.filter(f => f.status === 'delete').length,
      modifies: files.filter(f => f.status === 'modify').length,
      renames: renameCount,
      linesAdded: totalAdded,
      linesDeleted: totalDeleted,
    },
  };
}

function quote(list) {
  return list.map(x => '`' + x + '`').join(', ');
}

// Produce a conventional-commit-style rewrite of the title that hints at the drift.
function suggestTitle({ intent, drift, title }) {
  const prefixFor = {
    bugfix: 'fix', feature: 'feat', refactor: 'refactor',
    chore: 'chore', docs: 'docs', test: 'test', unknown: 'chore',
  };
  const prefix = prefixFor[intent.type] || 'chore';

  const scopeDomains = drift.touchedDomains
    .filter(d => d !== 'tests')
    .slice(0, 2);
  const scope = scopeDomains.length ? `(${scopeDomains.join(',')})` : '';

  // If the title already looks conventional AND drift is low, leave it alone.
  if (/^(\w+)(\([^)]+\))?!?:/.test(title) && drift.score < 0.3) return title;

  const cleaned = title.replace(/^(\w+)(\([^)]+\))?!?:\s*/, '').trim();
  let summary = cleaned;

  if (drift.signals.some(s => s.kind === 'hidden-refactor')) {
    summary = `${cleaned} — split out the rename/move from this change`;
  } else if (drift.signals.some(s => s.kind === 'bugfix-fanout' || s.kind === 'bugfix-wide-surface')) {
    summary = `${cleaned} (spans ${scopeDomains.join(' + ')}; consider splitting)`;
  } else if (drift.signals.some(s => s.kind === 'silent-deps')) {
    summary = `${cleaned} + dep bump`;
  }

  return `${prefix}${scope}: ${summary}`;
}

module.exports = {
  computeDrift, suggestTitle, inferPathDomains, detectDependencyFiles,
  pathDomain, isTestPath,
};
