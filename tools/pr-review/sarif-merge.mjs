/**
 * Combine multiple per-file SARIF logs emitted by `samediff --sarif` into a
 * single SARIF log with a single run. GitHub code scanning accepts a single
 * SARIF file per upload, and we want one categorized entry per PR.
 *
 * Rules:
 *   - Merge `runs[0].results` across inputs; keep order stable.
 *   - Union the tool rule catalog by ruleId (rules are identical across
 *     runs, but we defensively de-dupe by id).
 *   - Re-derive aggregate `properties.counts` and sum `driftScore` into a
 *     max across files (scores are per-pair; a max is the honest summary).
 *   - `driftLabel` follows the same "low/moderate/high/critical" bands as
 *     src/cli/resultModel.ts so consumers see familiar labels.
 */

/** @typedef {ReturnType<typeof buildMergedSarif>} MergedSarif */

export function buildMergedSarif(logs, { toolVersion = "0.6.0" } = {}) {
  const results = [];
  const rulesById = new Map();
  let maxScore = 0;
  const counts = {
    commitmentShifts: 0,
    contradictions: 0,
    conceptRenames: 0,
    addedConcepts: 0,
    removedConcepts: 0,
    actionItemsAdded: 0,
    actionItemsRemoved: 0,
    total: 0,
  };

  for (const log of logs) {
    const run = log?.runs?.[0];
    if (!run) continue;

    const runRules = run.tool?.driver?.rules ?? [];
    for (const r of runRules) {
      if (r?.id && !rulesById.has(r.id)) rulesById.set(r.id, r);
    }

    for (const res of run.results ?? []) {
      if (res) results.push(res);
    }

    const runCounts = run.properties?.counts;
    if (runCounts) {
      for (const k of Object.keys(counts)) {
        if (typeof runCounts[k] === "number") counts[k] += runCounts[k];
      }
    }
    const runScore = run.properties?.driftScore;
    if (typeof runScore === "number" && runScore > maxScore) maxScore = runScore;
  }

  return {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "samediff-lens",
            version: toolVersion,
            informationUri: "https://github.com/henry-filgueiras/samediff-lens",
            rules: [...rulesById.values()],
          },
        },
        invocations: [{ executionSuccessful: true }],
        results,
        properties: {
          driftScore: Number(maxScore.toFixed(1)),
          driftLabel: severityLabel(maxScore),
          counts,
        },
      },
    ],
  };
}

function severityLabel(score) {
  if (score <= 2) return "low";
  if (score <= 5) return "moderate";
  if (score <= 7) return "high";
  return "critical";
}
