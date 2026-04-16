/**
 * Precedence merging for SameDiff configuration.
 *
 * Takes the config file (if any), the selected policy name (if any),
 * and explicit CLI overrides, and returns a single EffectiveOptions.
 *
 * Precedence (highest wins):
 *   1. Explicit CLI flags
 *   2. Selected policy block (from --policy or default_policy)
 *   3. Top-level config block
 *   4. Built-in defaults (effectively empty)
 *
 * Array fields (include/exclude) replace rather than merge across layers.
 * That is: if a policy sets `include: ["commits"]` and CLI sets
 * `--only concepts`, the effective include is `["concepts"]`. Union would
 * be confusing because it would silently broaden what the user asked for.
 */

import type { Config, LoadedConfig, PolicyBlock } from "./config";
import {
  isFailOnNever,
  resolvePolicy,
  resolveConfigPath,
} from "./config";

export type EffectiveOptions = {
  /** Absolute path to baseline JSON, or null for no baseline */
  baselinePath: string | null;
  /** Category include list (lexemes, not parsed Categories yet) */
  include: string[] | null;
  /** Category exclude list */
  exclude: string[] | null;
  /** Raw fail-on spec string to parse, or null for "never fail" */
  failOn: string | null;
  /** Default to GitHub annotations output if no other format flag was used */
  defaultGithub: boolean;
  /** Default to compact output */
  defaultCompact: boolean;
  /** Default to stats output */
  defaultStats: boolean;
  /** Tracing info for diagnostic messages */
  provenance: Provenance;
};

export type Provenance = {
  configPath: string | null;
  policyName: string | null;
  policySource: "cli" | "default" | null;
  appliedLayers: string[];
};

export type CliOverrides = {
  baseline?: string | null; // null means --no-baseline
  only?: string[] | null;
  exclude?: string[] | null;
  failOn?: string | null; // null here means --fail-on wasn't specified
  noFail?: boolean; // true if --fail-on "none"/"never"/"off"
  policy?: string | null; // null means --no-policy / not specified
  noPolicy?: boolean;
};

export function resolveOptions(
  loaded: LoadedConfig | null,
  cli: CliOverrides,
): EffectiveOptions {
  const topLevel: PolicyBlock = loaded?.config ? extractPolicyBlock(loaded.config) : {};

  // Pick the policy (if any)
  let policyBlock: PolicyBlock | null = null;
  let policyName: string | null = null;
  let policySource: "cli" | "default" | null = null;

  if (cli.noPolicy) {
    policyBlock = null;
  } else if (cli.policy) {
    policyBlock = resolvePolicy(loaded, cli.policy);
    policyName = cli.policy;
    policySource = "cli";
  } else if (loaded?.config.default_policy) {
    policyBlock = resolvePolicy(loaded, loaded.config.default_policy);
    policyName = loaded.config.default_policy;
    policySource = "default";
  }

  // Merge policy block over top-level. Arrays replace; atomics use last-defined.
  const merged: PolicyBlock = mergeBlocks(topLevel, policyBlock ?? {});

  // Apply CLI overrides last
  const baselinePath = (() => {
    if (cli.baseline === null) return null; // --no-baseline
    if (typeof cli.baseline === "string") {
      return resolveOnce(cli.baseline, loaded);
    }
    if (merged.baseline === null) return null;
    if (typeof merged.baseline === "string") {
      return resolveOnce(merged.baseline, loaded);
    }
    return null;
  })();

  const include = cli.only !== undefined && cli.only !== null
    ? cli.only
    : merged.include ?? null;

  const exclude = cli.exclude !== undefined && cli.exclude !== null
    ? cli.exclude
    : merged.exclude ?? null;

  const failOn = (() => {
    if (cli.noFail) return null;
    if (typeof cli.failOn === "string") return cli.failOn;
    if (isFailOnNever(merged.fail_on)) return null;
    return merged.fail_on ?? null;
  })();

  const defaultGithub = merged.github === true;
  const defaultCompact = merged.compact === true;
  const defaultStats = merged.stats === true;

  const appliedLayers: string[] = [];
  if (loaded) appliedLayers.push("config");
  if (policyBlock) appliedLayers.push(`policy:${policyName}`);
  // CLI layer only listed if it contributed overrides
  if (
    cli.baseline !== undefined ||
    cli.only !== undefined ||
    cli.exclude !== undefined ||
    cli.failOn !== undefined ||
    cli.noFail
  ) {
    appliedLayers.push("cli");
  }

  return {
    baselinePath,
    include,
    exclude,
    failOn,
    defaultGithub,
    defaultCompact,
    defaultStats,
    provenance: {
      configPath: loaded?.path ?? null,
      policyName,
      policySource,
      appliedLayers,
    },
  };
}

function extractPolicyBlock(c: Config): PolicyBlock {
  const { baseline, include, exclude, fail_on, github, compact, stats } = c;
  return { baseline, include, exclude, fail_on, github, compact, stats };
}

function mergeBlocks(base: PolicyBlock, over: PolicyBlock): PolicyBlock {
  const result: PolicyBlock = { ...base };
  for (const key of Object.keys(over) as (keyof PolicyBlock)[]) {
    const v = over[key];
    if (v !== undefined) {
      // @ts-expect-error — heterogeneous key-value copy
      result[key] = v;
    }
  }
  return result;
}

function resolveOnce(p: string, loaded: LoadedConfig | null): string {
  if (!loaded) return p; // resolver in index.ts will use cwd
  return resolveConfigPath(loaded, p);
}

/**
 * One-line provenance message for stderr.
 */
export function formatProvenance(opts: EffectiveOptions): string | null {
  const p = opts.provenance;
  if (!p.configPath && !p.policyName) return null;
  const bits: string[] = [];
  if (p.configPath) bits.push(`config=${condensedPath(p.configPath)}`);
  if (p.policyName) {
    const src = p.policySource === "default" ? " (default)" : "";
    bits.push(`policy=${p.policyName}${src}`);
  }
  return `SameDiff: ${bits.join(", ")}`;
}

function condensedPath(p: string): string {
  const cwd = process.cwd();
  if (p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  const home = process.env.HOME;
  if (home && p.startsWith(home + "/")) return "~/" + p.slice(home.length + 1);
  return p;
}
