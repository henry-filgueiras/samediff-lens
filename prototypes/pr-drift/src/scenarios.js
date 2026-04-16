// Hand-crafted scenarios to exercise each drift signal without needing a repo.
// Each scenario is what `git.getDiff` would return for a realistic PR.

module.exports = [
  {
    name: 'clean-bugfix',
    description: 'Focused bugfix that matches its title. Should score LOW.',
    title: 'fix(auth): handle expired JWT in refresh flow',
    body:
      'Refresh tokens were failing when the access token had already expired. ' +
      'This patch re-checks expiry before hitting /refresh.',
    files: [
      { status: 'modify', path: 'src/auth/jwt.js',                  added: 18, deleted: 9 },
      { status: 'modify', path: 'src/auth/__tests__/jwt.test.js',   added: 22, deleted: 0 },
    ],
  },

  {
    name: 'silent-dependency',
    description: '"Fix a typo" — but the PR also pulls in a new runtime dependency.',
    title: 'fix typo in welcome email copy',
    body: 'Small copy nit from design review.',
    files: [
      { status: 'modify', path: 'src/notifications/welcome.js', added: 2,   deleted: 2 },
      { status: 'modify', path: 'package.json',                 added: 3,   deleted: 0 },
      { status: 'modify', path: 'package-lock.json',            added: 412, deleted: 0 },
    ],
  },

  {
    name: 'hidden-refactor',
    description: '"Add dark mode" — but most of the diff is renames and moves.',
    title: 'feat: add dark mode toggle',
    body: 'Users have been asking for a dark theme. Adds a toggle in settings.',
    files: [
      { status: 'rename', path: 'src/theme/ThemeProvider.js', oldPath: 'src/theme/Provider.js', added: 2,  deleted: 2 },
      { status: 'rename', path: 'src/theme/useTheme.js',      oldPath: 'src/theme/hooks.js',    added: 0,  deleted: 0 },
      { status: 'rename', path: 'src/ui/Button.js',           oldPath: 'src/components/Button.js', added: 0, deleted: 0 },
      { status: 'rename', path: 'src/ui/Modal.js',            oldPath: 'src/components/Modal.js',  added: 0, deleted: 0 },
      { status: 'modify', path: 'src/theme/ThemeProvider.js', added: 14, deleted: 3 },
      { status: 'add',    path: 'src/theme/DarkToggle.js',    added: 24, deleted: 0 },
    ],
  },

  {
    name: 'typo-ships-a-feature',
    description:
      '"Fix typo in README" that quietly ships a whole new module and an unrelated CI tweak. ' +
      'Dogfood case — lifted from a real drifted commit on this repo.',
    title: 'fix: typo in README',
    body: 'Tiny README cleanup.',
    files: [
      { status: 'modify', path: 'README.md',                                added: 1,  deleted: 1 },
      { status: 'add',    path: 'src/lib/cache.ts',                         added: 51, deleted: 0 },
      { status: 'modify', path: '.github/workflows/pr-semantic-review.yml', added: 3,  deleted: 0 },
    ],
  },

  {
    name: 'bugfix-sprawl',
    description: 'A "small fix" that somehow touches four unrelated domains.',
    title: 'fix: dashboard crash on empty state',
    body: 'Null check was missing. Users with no activity would see a white screen.',
    files: [
      { status: 'modify', path: 'src/dashboard/Empty.js',         added: 6,  deleted: 1 },
      { status: 'modify', path: 'src/dashboard/index.js',         added: 3,  deleted: 1 },
      { status: 'modify', path: 'src/auth/session.js',            added: 12, deleted: 8 },
      { status: 'modify', path: 'src/auth/middleware.js',         added: 4,  deleted: 2 },
      { status: 'modify', path: 'src/payments/charge.js',         added: 18, deleted: 3 },
      { status: 'modify', path: 'src/payments/webhook.js',        added: 7,  deleted: 2 },
      { status: 'modify', path: 'src/users/profile.js',           added: 5,  deleted: 0 },
      { status: 'modify', path: 'src/users/avatar.js',            added: 11, deleted: 4 },
      { status: 'modify', path: 'src/notifications/email.js',     added: 3,  deleted: 0 },
    ],
  },
];
