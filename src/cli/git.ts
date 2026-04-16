import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a git ref:path spec to file contents.
 *
 * Supports:
 *   "HEAD~1:path/to/file.md"  → git show HEAD~1:path/to/file.md
 *   "main:file.md"            → git show main:file.md
 *   "abc123:file.md"          → git show abc123:file.md
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
 *   samediff --git <ref> -- <file> [<file2>]
 *
 * If one file is given:  compare ref:file against working copy of file
 * If two files are given: compare ref:file1 against ref:file2
 *
 * Returns the two specs to resolve.
 */
export function parseGitArgs(args: string[]): { specA: string; specB: string } | null {
  const gitIdx = args.indexOf("--git");
  if (gitIdx === -1) return null;

  const dashIdx = args.indexOf("--", gitIdx + 1);
  if (dashIdx === -1) {
    throw new Error("--git requires -- separator. Usage: samediff --git <ref> -- <file> [<file2>]");
  }

  const ref = args.slice(gitIdx + 1, dashIdx).filter((a) => !a.startsWith("-"))[0];
  if (!ref) {
    throw new Error("--git requires a ref (e.g., HEAD~1, main, abc123)");
  }

  const files = args.slice(dashIdx + 1).filter((a) => !a.startsWith("-"));
  if (files.length === 0) {
    throw new Error("No file specified after --. Usage: samediff --git <ref> -- <file>");
  }

  if (files.length === 1) {
    // Compare ref:file against working copy
    return { specA: `${ref}:${files[0]}`, specB: files[0] };
  }

  // Compare ref:file1 against ref:file2 (or working copies)
  return { specA: `${ref}:${files[0]}`, specB: files[1] };
}
