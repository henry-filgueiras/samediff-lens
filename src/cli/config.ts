/**
 * .samediff.json config file: loading, validation, policy resolution.
 *
 * A config file lets a repo canonize its semantic-drift contract once
 * and share it between CI and local runs. It supports:
 *
 *   - top-level defaults (baseline path, include/exclude, fail_on, github…)
 *   - named policies that override those defaults
 *   - a default_policy to auto-apply when no --policy flag is given
 *
 * Discovery: walk up from cwd looking for .samediff.json. Stop at the
 * git root or $HOME. Developers can override with --config <path> or
 * disable with --no-config.
 *
 * Validation errors are thrown with clear, user-readable messages.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { BUILTIN_POLICIES } from "./builtinPolicies";
import { parseCategorySpec, CATEGORIES } from "./filter";
import { parseFailOn } from "./failSpec";

export const CONFIG_FILENAME = ".samediff.json";

export type PolicyBlock = {
  /** Path (relative to config file, or absolute) to a baseline JSON */
  baseline?: string | null;
  /** Category names/aliases to include (mutually exclusive with exclude at same layer) */
  include?: string[];
  /** Category names/aliases to hide */
  exclude?: string[];
  /**
   * fail-on spec. Special values:
   *   null / "none" / "never"  → never fail (advisory mode)
   *   otherwise parsed like the --fail-on flag
   */
  fail_on?: string | null;
  /** Default to emitting GitHub Actions annotations */
  github?: boolean;
  /** Default to compact output */
  compact?: boolean;
  /** Default to stats-only output */
  stats?: boolean;
};

export type Config = PolicyBlock & {
  default_policy?: string | null;
  policies?: Record<string, PolicyBlock>;
};

export type LoadedConfig = {
  /** Parsed and validated config */
  config: Config;
  /** Absolute path to the config file that was loaded */
  path: string;
  /** Directory containing the config (used to resolve relative baseline paths) */
  dir: string;
};

// ── Discovery ────────────────────────────────────────────────────────

/**
 * Walk up from startDir looking for .samediff.json.
 * Stops at filesystem root, $HOME (not inclusive), or after 10 levels.
 */
export function discoverConfigPath(startDir: string): string | null {
  const home = homedir();
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate) && isFile(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null; // hit filesystem root
    if (dir === home) return null; // don't cross into $HOME
    dir = parent;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── Loading + validation ─────────────────────────────────────────────

/**
 * Load and validate a config from an explicit path.
 * Throws with a readable error on parse or shape failure.
 */
export function loadConfigFile(path: string): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err: any) {
    throw new Error(
      `Cannot read config file ${path}: ${err?.message ?? err}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Invalid JSON in ${path}: ${err?.message ?? err}`);
  }

  const config = validateConfig(parsed, path);
  return { config, path, dir: dirname(path) };
}

function validateConfig(raw: unknown, path: string): Config {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: expected a JSON object at the top level`);
  }
  const obj = raw as Record<string, unknown>;

  validatePolicyBlock(obj, `${path} (top level)`);

  if ("default_policy" in obj) {
    const dp = obj.default_policy;
    if (dp !== null && typeof dp !== "string") {
      throw new Error(`${path}: default_policy must be a string or null`);
    }
  }

  if ("policies" in obj) {
    const policies = obj.policies;
    if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
      throw new Error(`${path}: policies must be an object`);
    }
    for (const [name, block] of Object.entries(policies)) {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        throw new Error(`${path}: policies.${name} must be an object`);
      }
      validatePolicyBlock(block as Record<string, unknown>, `${path} policies.${name}`);
    }
  }

  // Cross-check: default_policy, if set, must resolve to a known policy
  // (either built-in or defined in `policies`)
  if (typeof obj.default_policy === "string") {
    const configured = new Set(Object.keys((obj.policies as any) ?? {}));
    const builtin = new Set(Object.keys(BUILTIN_POLICIES));
    if (!configured.has(obj.default_policy) && !builtin.has(obj.default_policy)) {
      throw new Error(
        `${path}: default_policy "${obj.default_policy}" not found. Known: ` +
          [...configured, ...builtin].join(", "),
      );
    }
  }

  return obj as Config;
}

function validatePolicyBlock(obj: Record<string, unknown>, where: string): void {
  const allowed = new Set([
    "baseline",
    "include",
    "exclude",
    "fail_on",
    "github",
    "compact",
    "stats",
    // top-level-only keys are allowed to appear here and are simply ignored
    "default_policy",
    "policies",
    // common JSON-schema convention; ignored
    "$schema",
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${where}: unknown key "${key}". Allowed: baseline, include, exclude, fail_on, github, compact, stats, default_policy, policies.`,
      );
    }
  }

  if ("baseline" in obj) {
    const b = obj.baseline;
    if (b !== null && typeof b !== "string") {
      throw new Error(`${where}: baseline must be a string path or null`);
    }
  }

  for (const key of ["include", "exclude"] as const) {
    if (key in obj) {
      const v = obj[key];
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new Error(`${where}: ${key} must be an array of strings`);
      }
      // Validate each category name/alias by running it through the parser.
      try {
        parseCategorySpec((v as string[]).join(","));
      } catch (err: any) {
        throw new Error(`${where}: ${key}: ${err?.message ?? err}`);
      }
    }
  }

  if ("fail_on" in obj) {
    const f = obj.fail_on;
    if (f === null) {
      /* ok — advisory */
    } else if (typeof f === "string") {
      const lower = f.toLowerCase();
      if (lower !== "none" && lower !== "never" && lower !== "off") {
        try {
          parseFailOn(f);
        } catch (err: any) {
          throw new Error(`${where}: fail_on: ${err?.message ?? err}`);
        }
      }
    } else {
      throw new Error(
        `${where}: fail_on must be a string (e.g. "score:5", "any", "none") or null`,
      );
    }
  }

  for (const key of ["github", "compact", "stats"] as const) {
    if (key in obj && typeof obj[key] !== "boolean") {
      throw new Error(`${where}: ${key} must be a boolean`);
    }
  }

  // Sanity hint: category names at this layer must be valid
  void CATEGORIES;
}

// ── Policy resolution ────────────────────────────────────────────────

/**
 * Resolve a policy by name from a loaded config. Config-defined policies
 * override built-ins of the same name. Throws if name is not found.
 */
export function resolvePolicy(
  loaded: LoadedConfig | null,
  name: string,
): PolicyBlock {
  const configured = loaded?.config.policies?.[name];
  if (configured) return configured;
  const builtin = BUILTIN_POLICIES[name];
  if (builtin) return builtin;

  const known = availablePolicyNames(loaded);
  throw new Error(
    `Unknown policy "${name}". Known: ${known.join(", ")}`,
  );
}

export function availablePolicyNames(loaded: LoadedConfig | null): string[] {
  const names = new Set<string>(Object.keys(BUILTIN_POLICIES));
  if (loaded?.config.policies) {
    for (const n of Object.keys(loaded.config.policies)) names.add(n);
  }
  return [...names].sort();
}

/**
 * Resolve a config-relative path to an absolute one.
 */
export function resolveConfigPath(loaded: LoadedConfig, p: string): string {
  return isAbsolute(p) ? p : resolve(loaded.dir, p);
}

/**
 * Is this fail_on value a "never-fail" sentinel?
 */
export function isFailOnNever(value: string | null | undefined): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return lower === "none" || lower === "never" || lower === "off";
}
