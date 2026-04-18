import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Git's well-known empty-tree SHA. Used by convention to mean "nothing"
 * — diffing against it shows what was *added* in the very first commit
 * for a path. Hard-coded on the git side too:
 *   git hash-object -t tree /dev/null  → 4b825dc642cb6eb9a060e54bf8d69288fbee4904
 */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Friendly aliases for the empty tree. Case-insensitive.
 * `samediff --git EMPTY HEAD -- file.md` is more readable than typing
 * the full 40-char SHA.
 */
const EMPTY_TREE_ALIASES = new Set([
  "empty",
  "empty-tree",
  "emptytree",
]);

function isEmptyTreeRef(ref: string): boolean {
  if (ref === EMPTY_TREE_SHA) return true;
  if (EMPTY_TREE_ALIASES.has(ref.toLowerCase())) return true;
  return false;
}

/**
 * Resolve a git ref:path spec to file contents.
 *
 * Supports:
 *   "HEAD~1:path/to/file.md"  → git show HEAD~1:path/to/file.md
 *   "main:file.md"            → git show main:file.md
 *   "abc123:file.md"          → git show abc123:file.md
 *   "EMPTY:file.md"           → empty content (the git empty-tree SHA)
 *
 * If no colon is present, treats it as a plain file path.
 */
export function resolveGitRef(spec: string, cwd: string): { text: string; label: string } {
  const colonIndex = spec.indexOf(":");
  if (colonIndex === -1) {
    // Plain file path
    const filePath = resolve(cwd, spec);
    return {
      text: readFileSync(filePath, "utf-8"),
      label: spec,
    };
  }

  const ref = spec.slice(0, colonIndex);
  const path = spec.slice(colonIndex + 1);

  if (!ref || !path) {
    throw new Error(`Invalid git ref spec: "${spec}". Expected format: REF:path/to/file`);
  }

  // Empty-tree short-circuit: any path in the empty tree resolves to
  // empty content. Saves an exec + makes "diff against nothing" a
  // first-class case (useful for showing the delta of the very first
  // commit for a file).
  if (isEmptyTreeRef(ref)) {
    return { text: "", label: `${EMPTY_TREE_SHA.slice(0, 7)}:${path}` };
  }

  try {
    const text = execFileSync("git", ["show", `${ref}:${path}`], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return { text, label: `${ref}:${path}` };
  } catch (err: any) {
    const msg = err?.stderr?.toString() ?? err?.message ?? "unknown error";
    throw new Error(`Failed to read ${ref}:${path} from git: ${msg.trim()}`);
  }
}

/**
 * Parse the special --git syntax:
 *
 *   samediff --git <ref> -- <file> [<file2>]
 *     1 ref:  compare ref:file vs working copy (or ref:file1 vs working copy of file2)
 *
 *   samediff --git <ref-old> <ref-new> -- <file> [<file2>]
 *     2 refs: compare ref-old:file vs ref-new:file
 *             (or ref-old:file1 vs ref-new:file2 for rename tracking)
 *
 * The 2-ref form lets you script "compare these N files between two
 * commits" without checking out either revision into the working tree.
 *
 * Returns the two specs to feed into resolveGitRef.
 */
export function parseGitArgs(args: string[]): { specA: string; specB: string } | null {
  const gitIdx = args.indexOf("--git");
  if (gitIdx === -1) return null;

  const dashIdx = args.indexOf("--", gitIdx + 1);
  if (dashIdx === -1) {
    throw new Error("--git requires -- separator. Usage: samediff --git <ref> [<ref2>] -- <file> [<file2>]");
  }

  const refs = args.slice(gitIdx + 1, dashIdx).filter((a) => !a.startsWith("-"));
  if (refs.length === 0) {
    throw new Error("--git requires a ref (e.g., HEAD~1, main, abc123)");
  }
  if (refs.length > 2) {
    throw new Error(
      `--git takes 1 or 2 refs, got ${refs.length}: ${refs.join(", ")}. ` +
      "Usage: samediff --git <ref> [<ref2>] -- <file> [<file2>]",
    );
  }

  const files = args.slice(dashIdx + 1).filter((a) => !a.startsWith("-"));
  if (files.length === 0) {
    throw new Error("No file specified after --. Usage: samediff --git <ref> [<ref2>] -- <file>");
  }

  if (refs.length === 1) {
    const ref = refs[0];
    if (files.length === 1) {
      // Compare ref:file against working copy
      return { specA: `${ref}:${files[0]}`, specB: files[0] };
    }
    // Two files: compare ref:file1 against working copy of file2
    return { specA: `${ref}:${files[0]}`, specB: files[1] };
  }

  // Two refs: compare ref-old:file against ref-new:file (no working tree
  // involved). Useful for scripting bulk comparisons between commits.
  const [oldRef, newRef] = refs;
  if (files.length === 1) {
    return { specA: `${oldRef}:${files[0]}`, specB: `${newRef}:${files[0]}` };
  }
  // Rename tracking: file path differs between the two refs.
  return { specA: `${oldRef}:${files[0]}`, specB: `${newRef}:${files[1]}` };
}
