/**
 * Subcommand implementations: init, policies, baseline.
 *
 * The main CLI dispatches into these when args[0] is recognized.
 * They are intentionally small and composable with the main `check`
 * flow — not a parallel universe of their own.
 */

import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { CONFIG_FILENAME, availablePolicyNames, resolvePolicy, loadConfigFile, discoverConfigPath } from "./config";
import { BUILTIN_POLICIES, describeBuiltin } from "./builtinPolicies";

// ── init: write a starter .samediff.json ─────────────────────────────

const STARTER_CONFIG = {
  $schema: "https://example.com/samediff-config.schema.json",
  default_policy: "adoption",
  policies: {
    adoption: {
      baseline: ".samediff-baseline.json",
      include: ["commitment-shifts", "contradictions"],
      fail_on: "score:4",
    },
    strict: {
      fail_on: "commitment-shifts,contradictions",
    },
    advisory: {
      fail_on: null,
    },
  },
};

export type InitOptions = {
  cwd: string;
  force: boolean;
};

export function runInit(opts: InitOptions): { path: string; written: boolean; reason?: string } {
  const target = resolve(opts.cwd, CONFIG_FILENAME);
  if (existsSync(target) && !opts.force) {
    return {
      path: target,
      written: false,
      reason: `${CONFIG_FILENAME} already exists. Pass --force to overwrite.`,
    };
  }
  const text = JSON.stringify(STARTER_CONFIG, null, 2) + "\n";
  writeFileSync(target, text, "utf-8");
  return { path: target, written: true };
}

// ── policies: list what's available in the current context ──────────

export type PoliciesListing = {
  configPath: string | null;
  policies: Array<{
    name: string;
    source: "builtin" | "config" | "override";
    description: string;
  }>;
  defaultPolicy: string | null;
};

export function runPolicies(cwd: string, explicitConfigPath?: string | null): PoliciesListing {
  let loaded: ReturnType<typeof loadConfigFile> | null = null;
  if (explicitConfigPath) {
    loaded = loadConfigFile(explicitConfigPath);
  } else {
    const discovered = discoverConfigPath(cwd);
    if (discovered) loaded = loadConfigFile(discovered);
  }

  const names = availablePolicyNames(loaded);
  const configured = new Set(Object.keys(loaded?.config.policies ?? {}));
  const builtin = new Set(Object.keys(BUILTIN_POLICIES));

  const policies = names.map((name) => {
    let source: "builtin" | "config" | "override";
    if (configured.has(name) && builtin.has(name)) source = "override";
    else if (configured.has(name)) source = "config";
    else source = "builtin";

    return {
      name,
      source,
      description: describePolicy(name, loaded, source),
    };
  });

  return {
    configPath: loaded?.path ?? null,
    policies,
    defaultPolicy: loaded?.config.default_policy ?? null,
  };
}

function describePolicy(
  name: string,
  loaded: ReturnType<typeof loadConfigFile> | null,
  source: "builtin" | "config" | "override",
): string {
  if (source === "config") {
    const block = loaded!.config.policies![name];
    return summarizeBlock(block);
  }
  const builtinDesc = describeBuiltin(name);
  if (source === "override") {
    const block = loaded!.config.policies![name];
    return `[overrides built-in] ${summarizeBlock(block)}`;
  }
  return builtinDesc || summarizeBlock(BUILTIN_POLICIES[name]);
}

function summarizeBlock(b: { baseline?: string | null; include?: string[]; exclude?: string[]; fail_on?: string | null; github?: boolean }): string {
  const parts: string[] = [];
  if (b.fail_on === null) parts.push("fail_on=never");
  else if (b.fail_on) parts.push(`fail_on=${b.fail_on}`);
  if (b.baseline) parts.push(`baseline=${b.baseline}`);
  if (b.include?.length) parts.push(`include=[${b.include.join(", ")}]`);
  if (b.exclude?.length) parts.push(`exclude=[${b.exclude.join(", ")}]`);
  if (b.github) parts.push("github=true");
  return parts.join("; ") || "(no overrides)";
}

export function formatPoliciesListing(listing: PoliciesListing): string {
  const lines: string[] = [];
  if (listing.configPath) {
    lines.push(`Config: ${listing.configPath}`);
    if (listing.defaultPolicy) lines.push(`Default policy: ${listing.defaultPolicy}`);
  } else {
    lines.push("No config file found (built-in policies only).");
  }
  lines.push("");
  lines.push("Available policies:");
  const width = Math.max(...listing.policies.map((p) => p.name.length));
  for (const p of listing.policies) {
    const tag = p.source === "config" ? "(config)" : p.source === "override" ? "(override)" : "(built-in)";
    lines.push(`  ${p.name.padEnd(width + 2)}${tag.padEnd(11)} ${p.description}`);
  }
  return lines.join("\n") + "\n";
}

// ── baseline: shortcut for writing a baseline snapshot ──────────────

export type BaselineOptions = {
  leftPath: string;
  rightPath: string;
  outPath: string;
  cwd: string;
};

/**
 * Produce a baseline JSON for the given file pair and write it to outPath.
 * This is a thin wrapper — it imports the analysis pipeline and renderer
 * lazily to avoid a cycle with index.ts.
 */
export async function runBaseline(opts: BaselineOptions): Promise<{ outPath: string; bytes: number }> {
  const { analyzeTextPair } = await import("../analysis/analyzeTextPair");
  const { buildDiffResult } = await import("./resultModel");
  const { formatJsonOutput } = await import("./formatJson");

  const textA = readFileSync(opts.leftPath, "utf-8");
  const textB = readFileSync(opts.rightPath, "utf-8");
  const result = analyzeTextPair(textA, textB);
  const diff = buildDiffResult(result, {
    labelA: basename(opts.leftPath),
    labelB: basename(opts.rightPath),
    pathA: opts.leftPath,
    pathB: opts.rightPath,
  });
  const json = formatJsonOutput(diff);
  writeFileSync(opts.outPath, json, "utf-8");
  return { outPath: opts.outPath, bytes: Buffer.byteLength(json) };
}

// ── dispatch helper ─────────────────────────────────────────────────

export const KNOWN_SUBCOMMANDS = new Set(["init", "policies", "baseline", "check"]);

export function isSubcommand(arg: string | undefined): boolean {
  return !!arg && KNOWN_SUBCOMMANDS.has(arg);
}
