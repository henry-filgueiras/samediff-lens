/**
 * Allowlist logic for the PR semantic reviewer.
 *
 * SameDiff Lens is most valuable on narrative / contract-shaped files
 * (readmes, design docs, director's notes, ADRs). Arbitrary code files
 * produce lots of noise today, so v1 of the PR reviewer targets a small
 * set of high-signal markdown artifacts only.
 *
 * Keep this list narrow on purpose. Expand when a new path has a clear,
 * tested semantic value — not speculatively.
 */

// Exact top-level files.
export const ALLOWLIST_FILES = new Set([
  "README.md",
  "DIRECTORS_NOTES.md",
  "LAUNCH_NOTES.md",
]);

// Prefixes (directory roots) whose markdown content is in scope.
export const ALLOWLIST_PREFIXES = ["docs/"];

// Extensions considered in scope under an allowed prefix.
const ALLOWED_EXTS = new Set([".md", ".markdown"]);

/**
 * True when a path should be analyzed by the PR reviewer.
 *
 * The test is purely structural: it only looks at the path shape, not
 * whether the file exists or has changed. Callers handle those concerns.
 */
export function isAllowlistedPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  // Normalize: strip leading ./, reject absolute paths (not repo-relative).
  if (path.startsWith("/")) return false;
  const p = path.startsWith("./") ? path.slice(2) : path;
  if (p.includes("..")) return false;

  if (ALLOWLIST_FILES.has(p)) return true;

  for (const prefix of ALLOWLIST_PREFIXES) {
    if (p.startsWith(prefix)) {
      const dot = p.lastIndexOf(".");
      if (dot === -1) return false;
      const ext = p.slice(dot).toLowerCase();
      if (ALLOWED_EXTS.has(ext)) return true;
    }
  }
  return false;
}

/**
 * Filter and de-duplicate a raw list of changed paths.
 *
 * Input lines may be empty / commented / whitespace-padded; we tolerate
 * all of that and emit a sorted, unique list of analyzable paths.
 */
export function selectChangedFiles(rawLines) {
  const out = new Set();
  for (const line of rawLines) {
    const trimmed = (line ?? "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (!isAllowlistedPath(trimmed)) continue;
    out.add(trimmed);
  }
  return [...out].sort();
}

/**
 * Human-readable summary of what is in scope. Shown in the no-op case
 * of the PR comment so reviewers understand why nothing ran.
 */
export function describeAllowlist() {
  const files = [...ALLOWLIST_FILES].sort().map((f) => "`" + f + "`").join(", ");
  const prefixes = ALLOWLIST_PREFIXES.map((p) => "`" + p + "**/*.md`").join(", ");
  return `${files}, and ${prefixes}`;
}
