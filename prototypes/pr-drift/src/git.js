// Extract a structured view of files changed between two git refs.
// Only shells out to `git` — no libgit dependency.

const { execFileSync } = require('node:child_process');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function statusWord(code) {
  const c = code[0];
  if (c === 'A') return 'add';
  if (c === 'D') return 'delete';
  if (c === 'R') return 'rename';
  if (c === 'C') return 'copy';
  return 'modify';
}

// Returns [{ status, path, oldPath?, added, deleted }, ...]
function getDiff(base, head, cwd = process.cwd()) {
  const range = `${base}...${head}`;
  const nameStatus = git(['diff', '--name-status', '-M', range], cwd);
  const numstat = git(['diff', '--numstat', '-M', range], cwd);

  const files = [];
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push({
        status: statusWord(status),
        path: parts[2],
        oldPath: parts[1],
        added: 0,
        deleted: 0,
      });
    } else {
      files.push({
        status: statusWord(status),
        path: parts[1],
        added: 0,
        deleted: 0,
      });
    }
  }

  // Merge numstat (binary files show as "-\t-\tpath" — treat as 0)
  const stats = new Map();
  for (const line of numstat.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    // For renames, numstat may use "old => new" syntax; use the last path segment.
    const rawPath = parts.slice(2).join('\t');
    const cleaned = rawPath.replace(/^.*=> (.*)\}$/, '$1').replace(/\{.*=> /, '');
    stats.set(cleaned, { added, deleted });
    stats.set(rawPath, { added, deleted });
  }
  for (const f of files) {
    const s = stats.get(f.path);
    if (s) {
      f.added = s.added;
      f.deleted = s.deleted;
    }
  }

  return files;
}

module.exports = { getDiff };
