// Classify what a PR *claims* to be, and extract the domains its prose mentions.
// Keyword-driven. No model, no tokenizer — just readable rules.

const TYPE_KEYWORDS = {
  bugfix:   ['fix', 'fixes', 'fixed', 'bug', 'bugfix', 'hotfix', 'patch',
             'resolve', 'resolves', 'broken', 'regression', 'crash', 'error'],
  feature:  ['add', 'adds', 'added', 'feat', 'feature', 'new', 'introduce',
             'implement', 'support', 'enable'],
  refactor: ['refactor', 'refactors', 'cleanup', 'restructure', 'rename',
             'renames', 'extract', 'reorganize', 'simplify', 'migrate', 'port'],
  chore:    ['chore', 'bump', 'upgrade', 'upgrades', 'dependency', 'dependencies'],
  docs:     ['docs', 'readme', 'documentation'],
  test:     ['test', 'tests', 'testing', 'spec', 'specs'],
};

const CONVENTIONAL_PREFIX = {
  fix: 'bugfix', bugfix: 'bugfix',
  feat: 'feature', feature: 'feature',
  refactor: 'refactor',
  chore: 'chore',
  ci: 'chore', build: 'chore', perf: 'chore', style: 'chore',
  docs: 'docs',
  test: 'test', tests: 'test',
};

function classifyIntent(title, body = '') {
  const text = `${title}\n${body}`.toLowerCase();

  const prefix = title.match(/^(\w+)(\([^)]+\))?!?:\s/);
  if (prefix) {
    const type = CONVENTIONAL_PREFIX[prefix[1].toLowerCase()];
    if (type) return { type, confidence: 'high', matched: [prefix[1].toLowerCase()] };
  }

  const matches = {};
  const scores = {};
  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    const hits = words.filter(w => new RegExp(`\\b${w}\\b`).test(text));
    if (hits.length) {
      matches[type] = hits;
      scores[type] = hits.length;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { type: 'unknown', confidence: 'low', matched: [] };
  const [topType, topScore] = sorted[0];
  const secondScore = sorted[1] ? sorted[1][1] : 0;
  const confidence =
    topScore >= 2 && topScore > secondScore ? 'high' :
    topScore > secondScore ? 'med' : 'low';
  return { type: topType, confidence, matched: matches[topType] };
}

// Rough domain vocabulary. This is deliberately small and opinionated:
// heuristics work better with a tight list than a big fuzzy one.
const DOMAIN_VOCAB = [
  'auth', 'authentication', 'authorization', 'login', 'signup', 'oauth', 'jwt', 'session',
  'payment', 'payments', 'billing', 'checkout', 'invoice', 'subscription', 'stripe',
  'api', 'rest', 'graphql', 'rpc', 'endpoint', 'webhook',
  'ui', 'frontend', 'component', 'button', 'form', 'modal', 'layout', 'theme',
  'database', 'db', 'sql', 'migration', 'schema', 'postgres', 'mysql',
  'cache', 'caching', 'redis',
  'email', 'mail', 'notification', 'notifications',
  'search', 'index', 'query',
  'analytics', 'tracking', 'metrics', 'telemetry',
  'onboarding', 'settings', 'profile', 'admin',
  'upload', 'download', 'storage',
  'logging', 'logger', 'logs',
  'config', 'configuration',
  'queue', 'worker', 'scheduler', 'cron',
  'security', 'permission', 'permissions', 'role', 'roles',
  'user', 'users', 'account', 'accounts',
  'cart', 'order', 'orders', 'product', 'products', 'catalog',
  'dashboard',
];

// Collapse synonyms down to a single domain name.
const DOMAIN_ALIAS = {
  authentication: 'auth', authorization: 'auth', login: 'auth', signup: 'auth',
  oauth: 'auth', jwt: 'auth', session: 'auth',
  payment: 'payments', billing: 'payments', checkout: 'payments',
  invoice: 'payments', subscription: 'payments', stripe: 'payments',
  notification: 'notifications', email: 'notifications', mail: 'notifications',
  db: 'database', sql: 'database', migration: 'database', schema: 'database',
  postgres: 'database', mysql: 'database',
  user: 'users', account: 'users', accounts: 'users', profile: 'users',
  logger: 'logging', logs: 'logging',
  order: 'orders', cart: 'orders',
  product: 'catalog', products: 'catalog',
  permission: 'security', permissions: 'security',
  role: 'security', roles: 'security',
};

function canonicalDomain(word) {
  const w = word.toLowerCase();
  return DOMAIN_ALIAS[w] || w;
}

function extractTextDomains(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const word of DOMAIN_VOCAB) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      found.add(canonicalDomain(word));
    }
  }
  return [...found];
}

module.exports = { classifyIntent, extractTextDomains, canonicalDomain };
