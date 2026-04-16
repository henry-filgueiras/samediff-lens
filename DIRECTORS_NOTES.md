# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is a dual-surface semantic diff tool: a browser UI (React+Vite, deployed to GitHub Pages) and a feature-rich CLI (`./samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Identity shift (v0.4):** the CLI is no longer framed as "a diff tool with many flags" — it's **a primitive for a repo to declare and enforce its semantic-drift contract**. That contract lives in `.samediff.json` and is consumed identically by CI and local developers.

**Inspectability (v0.5):** every finding now carries structured **provenance** — which side, which line range, optional snippet, honest quality label. Findings are no longer locationless oracles; the tool can point back into the artifacts.

**Ecosystem portability (v0.6):** SARIF 2.1.0 export. Findings can now be emitted in the standard static-analysis interchange format, driven directly by DiffResult + provenance. GitHub code scanning and other SARIF consumers work without any bespoke glue.

**Dogfood loop (v0.6, session 8):** a `pull_request` GitHub Actions workflow runs SameDiff Lens on every PR to this repo. It narrows to high-signal markdown, uploads merged SARIF to Code Scanning, upserts one sticky PR comment, and fails the check on contradictions. No server, no GitHub App, no secrets — repo-native only.

**Working surfaces:**
- CLI: `./samediff left.md right.md` (auto-builds if stale)
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 20 engine tests + 100 CLI integration tests, all passing

**Repo-level configuration:**
- `.samediff.json` (walked up from cwd; stops at `$HOME` / filesystem root) declares a repo's drift contract
- Named policies: built-in (`adoption`, `strict`, `docs-only`, `advisory`) + user-defined
- `default_policy` auto-applies with no flags
- Precedence: explicit CLI flags > selected policy > top-level config > built-in defaults
- `--config <path>` / `--no-config` / `--policy <name>` / `--no-policy` escape hatches
- Subcommands: `init`, `policies`, `baseline`, `check`

**CLI capabilities:**
- Terminal output with colored drift cards and visual score bar
- `--html` — self-contained dark-theme HTML report (sharable, screenshot-worthy)
- `--md` — full Markdown report
- `--json` — structured machine-readable output (stable schema, canonical result contract)
- `--compact` — one finding per line, grep-friendly
- `--github` — GitHub Actions annotation workflow commands
- `--stats` — one-line key=value category counts
- `--score` — numeric drift severity (0–10)
- `--git HEAD~1 -- file.md` — diff against any git ref
- `--watch` / `-w` — live re-diff on file changes
- `-` as filename — read from stdin
- `--only` / `--exclude` — category focus filters
- `--baseline <json>` — subtract pre-existing findings; only NEW drift is shown & scored
- `--fail-on <spec>` — precise CI gating: `any`, `score:N`, or category list (combinable)
- `--exit-code` — legacy alias for `--fail-on score:1.1`
- `-o file` — write output to file

**Architecture:**
- Canonical `DiffResult` model in `src/cli/resultModel.ts` — the structured intermediate representation that JSON output renders directly, and that future renderers (CI bots, dashboards) can consume
- Engine → AnalysisResult → DiffResult → Renderer(s) pipeline

**Detection passes (all heuristic, no ML):**
1. Commitment shifts — modal strength changes (may→must), narrowing, operational detail
2. Task drift — TODO/checklist additions and removals
3. Concept rename — high lexical overlap with changed key noun phrases
4. Contradiction hinting — same subject + opposite polarity/negation flip
5. Added/removed concepts — unique tokens in focused phrase windows

**Example spectrum (examples/):**
01-modal-shift → 02-todo-drift → 03-api-contract → 04-prompt-policy → 05-hydra-doc-drift

**Test counts:** 20 engine tests + 100 CLI integration tests + 19 PR-reviewer tests, all passing

## Devlog

### 2026-04-16 (session 8) — PR semantic reviewer (dogfood loop)

The last several sessions built out ingredients — provenance, filters,
baselines, repo policy/config, SARIF — each useful on its own, none of
them closing a feedback loop on the repo itself. Session 8 closes that
loop: SameDiff Lens now reviews PRs in the repo that produces it.

This was the next quest for one concrete reason. Everything before
session 8 optimized for surface area (more renderers, more flags, more
export formats). Adding more of that without also using the tool on
real changes would have kept accreting feature breadth with zero signal
on whether any of it survives contact with real PRs. Dogfood first;
decide what to build next from what the dogfood exposes.

**What we built:**

- `.github/workflows/pr-semantic-review.yml` — `pull_request` trigger,
  conservative permissions, sticky-comment upsert, SARIF upload,
  contradiction gate. No secrets, no external services.
- `tools/pr-review/paths.mjs` — the allowlist predicate. README,
  DIRECTORS_NOTES, LAUNCH_NOTES, and `docs/**/*.md`. Deliberately
  narrow; expand when a path type proves out, not speculatively.
- `tools/pr-review/select-files.mjs` — stdin-to-stdout filter over the
  predicate. Consumed directly by the workflow.
- `tools/pr-review/analyze.mjs` — per-file orchestrator. Classifies
  each selected path as analyzed / skipped-new / skipped-deleted /
  error, runs the CLI in `--git`-diff mode, aggregates JSON, merges
  SARIF, writes an aggregate `index.json`.
- `tools/pr-review/sarif-merge.mjs` — single-run merger. Unions rule
  catalogs by id, concatenates results, re-derives aggregate counts
  and a max drift score.
- `tools/pr-review/comment.mjs` — pure, deterministic sticky-comment
  renderer. Produces the Markdown body from the aggregate index, with
  a stable `<!-- samediff-lens:pr-review -->` marker for upsert.
- `tools/pr-review/render-comment.mjs` — CLI wrapper around the
  renderer.
- `tools/pr-review/gate.mjs` — the contradiction gate. Reads the
  structured `index.json`, not the rendered comment — no grep theater.
- `tools/pr-review.test.mjs` — 19 tests covering allowlist behavior,
  stdin-CLI smoke, comment rendering determinism / blocking vs.
  advisory / no-op / skipped rollup / unanchored labeling / overflow
  caps, SARIF merge (concatenation, dedupe, empty-input tolerance),
  and gate.mjs exit codes.

**Key decisions & why:**

- **Narrow allowlist.** v1 targets markdown artifacts only — the
  shape of content where SameDiff Lens has a proven value (commitment
  shifts, contradictions, concept drift, todo drift read cleanly on
  prose). Extending to arbitrary source code or config would generate
  noise faster than signal and poison reviewer trust in the tool. The
  allowlist lives in one file so expansion is a single deliberate
  edit, not a sprawl of config knobs.

- **Contradictions gate, nothing else.** Contradictions are the
  highest-signal, lowest-false-positive category in the current
  heuristic catalog — and they are the only category whose default
  SARIF level is `error`. Making them the gate aligns the PR-review
  policy with the rule severities we already ship. Commitment shifts
  are load-bearing too, but they fire often enough that forcing them
  to block merges would turn the tool into a nag. Other categories
  inform but don't block. Repos that want stricter gating can point
  their required check at a stricter `samediff --fail-on` command.

- **One sticky comment, not line-by-line noise.** A recognizable
  HTML-comment marker lets the workflow find its prior comment and
  update it in place. Each push updates one comment instead of
  appending dozens. SARIF carries the per-line story for readers who
  want it; the comment stays a compact summary.

- **SARIF upload is the machine-readable path; the comment is the
  human path.** Reviewers on mobile or browsing quickly see the
  comment; reviewers inspecting specific lines see SARIF annotations
  inline. The two surfaces never contradict each other because both
  are derived from the same per-file JSON output.

- **`pull_request`, not `pull_request_target`.** The latter's implicit
  write-token access on untrusted PR code is a large blast radius for
  an advisory tool. `pull_request` means fork PRs get a read-only
  token — the comment upsert is skipped on forks (with a step notice)
  and `$GITHUB_STEP_SUMMARY` still carries the rendered content.
  Safer beats slicker.

- **Gate reads structured state, not rendered text.** `gate.mjs`
  consults `contradictionCount` in `index.json`. No grep over the
  comment body, no parsing of free-form output. If the sticky-comment
  renderer ever changes format, the gate keeps working.

- **Merged single-run SARIF.** Upload-SARIF accepts multi-run files,
  but a single merged run is easier for a human reading the Code
  Scanning alerts page. We union rule catalogs by id, concatenate
  results, and re-derive aggregate counts and max drift score.

- **Fork-safe degradation.** On same-repo PRs you get SARIF + sticky
  comment + gate. On fork PRs you get SARIF-upload-if-allowed + step
  summary + gate. The gate runs in both cases.

**What was validated (offline):**

- 19 new tests pass (`npm run test:pr-review`).
- `tools/pr-review/select-files.mjs` filters a stdin list correctly.
- `tools/pr-review/analyze.mjs --base HEAD~3 --files … --out-dir …`
  against real repo history produces a valid aggregate `index.json`,
  a merged SARIF with region-anchored results, and per-file JSON
  artifacts.
- `tools/pr-review/render-comment.mjs` reads that real index and
  produces the expected sticky-comment Markdown.
- `tools/pr-review/gate.mjs` exits 1 when `contradictionCount > 0`
  and 0 otherwise.

**What still needs a live PR run to confirm:**

- GitHub's `actions/github-script@v8` sticky-comment upsert: the logic
  is straightforward (paginate comments, find marker, update-or-
  create) but has not been exercised end-to-end against the real API.
- `github/codeql-action/upload-sarif@v3` acceptance of the merged
  SARIF artifact. Locally the SARIF validates against the 2.1.0
  schema; Code Scanning has additional constraints (relative URIs
  under the repo root, file existence at commit SHA) that only a real
  run can verify.
- Concurrency group cancellation behavior across rapid pushes.
- Whether GitHub honors the `paths:` trigger filter correctly when
  only tool files change (the filter lists both the allowlisted docs
  and the tool's own workflow / scripts to catch regressions, but
  live runs will show whether that intention carries through).

**Deferred, on purpose:**

- No support for arbitrary code file diffs — requires semantic value
  proven before expansion.
- No per-line "review comment" spray. SARIF carries per-line findings;
  the PR comment stays a summary.
- No baseline or repo-policy wiring from `.samediff.json` in the
  workflow. Each per-file run currently uses `--no-config` so results
  are predictable regardless of what gets added later. Wiring policy
  in is a one-flag change once we decide whether "advisory"/"strict"
  should be the workflow default.
- No separate severity thresholds for the gate (today: any
  contradiction blocks). Once we see real-PR volume we can decide if
  "score:N" gating is worth adding.
- No support for forked-PR sticky comments via a `workflow_run`
  relay. Possible to add later; the cost/benefit swung toward fork
  safety for v1.

**Test counts:** 20 engine + 100 CLI integration + 19 PR-reviewer =
139 tests, all passing.

Version remains 0.6.0 — the PR reviewer is infrastructure around the
existing CLI, not a new CLI surface.

### 2026-04-16 (session 7) — SARIF 2.1.0 export

SARIF was kept deliberately deferred until provenance existed, because
without source anchoring every SARIF result would either be locationless
or pinned to a fake region. Now that provenance is a first-class spine
feature, SARIF is what the last session promised it would be: a
mechanical renderer on top of DiffResult, not a second semantic universe.
Version 0.6.0.

**What we built:**
- `src/cli/formatSarif.ts` — a dedicated renderer consuming DiffResult.
  No re-analysis, no duplicate finding construction. DiffResult is the
  single source of truth; SARIF is a projection of it.
- `--sarif` CLI flag — first-class output format alongside `--json`,
  `--md`, `--html`, `--compact`, `--github`, `--stats`, `--score`.
  Composes with `-o`, `--policy`, `--baseline`, `--only`/`--exclude`,
  and `--fail-on`.
- Stable rule catalog with seven ruleIds, one per finding category:
  `commitment-shift`, `contradiction`, `concept-renamed`,
  `concept-added`, `concept-removed`, `action-item-added`,
  `action-item-removed`.
- Each rule has a default severity `level`:
    * `contradiction` → **error** (the dangerous signal)
    * `commitment-shift` → **warning** (implied-contract change)
    * everything else → **note** (informational drift)
  Consumers can override these per SARIF convention without touching
  our code.
- Artifact URIs are repo-relative when paths fall under `cwd` (ideal
  for GitHub code scanning upload), else `basename()`. Git-ref labels
  like `HEAD~1:spec.md` pass through unchanged.
- `run.properties` carries `driftScore`, `driftLabel`, `exitCode`,
  and `counts` — SameDiff-specific metadata that SARIF readers will
  ignore but that our own tooling and CI can consume.
- `result.properties.anchorQuality` carries `"exact"` / `"approximate"`
  / `"derived"` so consumers can tell how much to trust a region.

**Location mapping (the load-bearing decision):**

| Finding category | Primary location | Related location |
| --- | --- | --- |
| commitment-shift | after | before |
| contradiction | after | before |
| concept-renamed | after | before |
| concept-added | after | — |
| concept-removed | **before** | — |
| action-item-added | after | — |
| action-item-removed | **before** | — |

Before-only findings (removed concepts, removed action items) use
the *before* file as the primary `artifactLocation`. We intentionally
don't pin them to a line in the after file, which would be a lie —
the whole point of a "removed" finding is that it's not there anymore.

Unanchored findings still appear as SARIF results, but with no
`locations` array at all. Message + ruleId + level survive; the
region is omitted rather than invented. A SARIF viewer will show the
result without file attribution, which is the correct representation
of "we know this changed but we couldn't locate it."

When both sides are anchored (commitment shifts, contradictions,
dual-anchor renames), the primary location goes on the after side and
the before side is attached as a `relatedLocations` entry with a
descriptive message ("corresponding before location"). Single-sided
anchoring — or cases where the primary-side anchor wasn't found but
the other side was — does NOT emit a redundant relatedLocation; we
just use the anchor we have and don't pretend we have two.

**Key decisions & why:**

- **Consume DiffResult, not AnalysisResult.** DiffResult is already
  the canonical intermediate representation for the JSON contract.
  SARIF is another projection of the same thing. This keeps future
  schema changes propagating cleanly: evolve DiffResult once, every
  renderer follows.

- **One ruleId per category, stable across releases.** Not per
  heuristic, not per trigger. Finer-grained rules would be noisier,
  harder for consumers to configure (`rules.commitment-shift.level =
  "error"` is a single line in a SARIF config), and harder to evolve
  without breaking consumers. Trigger strings like "strengthens the
  commitment" ride along in the `message.text` where they belong.

- **No `ruleIndex` on results.** ruleId alone is sufficient for every
  SARIF consumer I can find; ruleIndex adds a fragile coupling between
  rule order and result fields for zero product benefit.

- **Repo-relative URIs, not `file://` absolute.** Absolute paths break
  GitHub code scanning upload (paths must match repo layout). Relative
  paths under cwd work out of the box. When files are outside cwd we
  fall back to `basename()` — honest and portable. Power users wanting
  a different base URI can post-process; we left a `SarifOptions.baseDir`
  hook on the renderer API for when we want to make this configurable.

- **Default severity once, in rule definitions.** SARIF lets you set
  `result.level` to override per-result. We don't, today. The rule-
  default approach makes the whole catalog reconfigurable from the
  outside (`tool.driver.rules[*].defaultConfiguration.level`) without
  any per-result noise.

- **`anchorQuality` in `result.properties`, not `result.rank` or
  anything schema-defined.** SARIF's rank field means "priority" not
  "confidence"; conflating the two would confuse consumers. `properties`
  is the SARIF-sanctioned extension point.

- **No SARIF schema validator in tests.** Pulling in `@sarif/sarif-nodejs`
  or similar just for tests would be heavy. Instead we assert shape
  specifics (version, required fields, rule catalog, location structure,
  level mapping). Matches the project's test philosophy: targeted and
  honest beats "we called a validator."

- **No auto-upload to code scanning.** The mission asked for shape
  compatibility, not a hosted integration. `--sarif -o foo.sarif` +
  a user's GitHub Action (3-line `github/codeql-action/upload-sarif@v3`
  snippet) is the right division of labor; we produce the file, they
  ship it.

**What SARIF preserves vs approximates vs omits:**

| Layer | Preserves exactly | Approximates | Omits |
| --- | --- | --- | --- |
| Tool metadata | name, version, informationUri | — | — |
| Rule catalog | id, name, short/full descriptions, default level | — | per-rule help beyond one URI |
| Result messages | full DiffResult message + triggers | long clauses truncated to 160 chars | markdown formatting (we emit plain `text`) |
| Locations | line/column from provenance when quality=exact | fuzzy-match line range when quality=approximate | locations entirely when provenance=null |
| Severity | per-category level | — | per-finding severity deltas |
| Evidence context | snippet (≤120 chars) | — | full before/after spans (stay in DiffResult JSON) |
| Score / counts | under `run.properties` | — | not mapped to SARIF's `rank` / `baselineState` (those mean different things) |

**Tests added (12 new, 100 total CLI):**
- Valid SARIF 2.1.0 shape + schema URI
- Full rule catalog present with correct IDs
- Rule default levels match the documented mapping
- Dual-anchor commitment shift: primary on right, related on left
- Removed concept: primary on **before** file; no fake after-file coords
- Added concept: primary on after file
- Unanchored case (identical files) → valid SARIF with empty results
- URIs are repo-relative (not absolute, not just basename)
- `anchorQuality` surfaces in `result.properties`
- `run.properties` carries drift score + counts
- `--sarif -o <file>` writes valid SARIF to disk
- `--sarif --json` → usage error (exit 2)

**Paths worth following next:**

1. **GitHub Action snippet** in docs/ showing how to upload
   `samediff.sarif` via `github/codeql-action/upload-sarif`. Tiny but
   high-leverage for users trying SARIF for the first time.

2. **`--sarif --append <file>`** to accumulate SARIF across multiple
   runs (multi-file directory mode will want this).

3. **`originalUriBaseIds`** with `%SRCROOT%` once directory mode lands —
   it's the canonical GitHub code scanning pattern for paths relative
   to repo root. Harmless to skip today since we already emit cwd-relative.

4. **Markdown messages** on SARIF results. We already populate `text`;
   adding a `markdown` variant would light up rich formatting in
   SARIF viewers that support it.

5. **Per-finding severity override** once the engine grows a sharper
   severity signal (e.g. "contradiction with high anchor overlap" vs
   "weak narrowing signal"). Today the score is per-run, not per-finding.

### 2026-04-16 (session 6) — Finding provenance / source anchoring

Findings now tell you *where* they came from. Before this session the
tool could say "commitment narrowed"; it couldn't say "on line 14 of
before.md and line 20 of after.md." That gap made the tool feel like
an oracle instead of an instrument, and blocked every downstream surface
(GitHub annotations, future SARIF, PR review UX) from pointing users at
the right lines. Version 0.5.0.

**What we built:**
- New `SourceAnchor` and `FindingProvenance` types in `src/analysis/types.ts`
- `src/analysis/provenance.ts` — a small pure module:
  - `buildLineIndex(text)` — offset→line lookup, O(n) once
  - `findAnchor(text, idx, query, side, label?)` — exact substring match
    with a whitespace/case-insensitive fallback
  - `anchorOnSide` / `anchorBothSides` — the high-level helpers
  - `formatAnchor` / `formatProvenance` — concise human formatters
    (`@ before:2 after:2`)
- Enrichment in `analyzeTextPair`: after the heuristics engine returns,
  the pipeline post-processes each finding by searching the evidence
  text inside the original sources and attaches a `provenance` field.
  The engine itself was not touched.
- DiffResult's finding types each gain a `provenance: FindingProvenance | null`
  field. The field is always present (null when unlocatable) so consumers
  don't have to key-check.
- Renderers updated:
  - Terminal: concise `@ before:L after:L` suffix on the metadata/trigger
    line under each finding. Drops gracefully to nothing when no anchors.
  - `--compact`: optional third tab field (`\t@before:L after:L`),
    preserving machine-parsability.
  - `--json`: full structured provenance on every finding.
  - `--github`: after-side line numbers become `line=`/`endLine=`/`col=`
    fields on the annotation command, so findings show up inline in PR
    checks at the right region instead of at file top.
- Filter pipeline extended to filter the action-item provenance sidecars
  alongside the action-item lists, so `--json` never surfaces stale
  provenance entries.
- Version bump 0.4 → 0.5.0 (in `package.json` + `resultModel.ts`).

**The provenance model (honest by design):**
```ts
type AnchorQuality = "exact" | "approximate" | "derived";

type SourceAnchor = {
  side: "before" | "after";
  startLine?: number; endLine?: number;
  startColumn?: number; endColumn?: number;
  snippet?: string; label?: string;
  quality?: AnchorQuality;
};

type FindingProvenance = {
  anchors: SourceAnchor[];
  quality?: AnchorQuality;
  note?: string;
};
```

- `exact` — evidence text found verbatim in the source
- `approximate` — found only after whitespace-collapse + case-fold
- `derived` — inferred (reserved; not emitted yet)
- Unlocatable → `provenance: null`. No invented numbers.

Lines and columns are 1-based. Multi-line matches get a proper
`startLine`/`endLine` span; `startColumn`/`endColumn` bracket the
literal match when available.

**Where provenance is populated:**
| Finding | Sides attempted | Source |
| --- | --- | --- |
| commitment shift | before + after | `versionA` → before, `versionB` → after |
| contradiction | before + after | same |
| concept rename | before + after (or one if the other is absent) | same |
| added concept | after only | `sourceClause` → after |
| removed concept | before only | `sourceClause` → before |
| action item added | after only | description string → after |
| action item removed | before only | description string → before |

**Key decisions & why:**

- **Post-process in `analyzeTextPair`, not inside the heuristics engine.**
  The engine is battle-tested and shared with the browser UI. Adding a
  second pass at the pipeline boundary keeps the invariant "heuristics
  are source-of-truth for what's a finding; provenance is enrichment."
  Also makes future provenance improvements (AST-based, token-window,
  etc.) a single-file change.

- **Text search via `indexOf` + whitespace-fuzzy fallback, not a
  parser.** We avoided a major parser rebuild. The existing evidence
  already contains the raw unit text; searching it in source is cheap
  and reliably lands on the right line. Approximate quality is labeled
  honestly.

- **Use the *original* (untrimmed) source text for line numbers.**
  `analyzeTextPair` trims internally for heuristics, but we index the
  pre-trim text so line numbers match what the user sees in their editor.
  Worth the extra pointer.

- **Action item provenance lives in a *sidecar* (`actionItemsAddedProvenance`),
  not on the strings themselves.** The existing `actionItemsAdded: string[]`
  shape is part of the public contract used by the browser UI and by the
  feedback issue body; changing it to an object array would break consumers.
  Sidecar maps keyed by description preserve the existing shape and let
  renderers opt in.

- **`provenance: null` on finding types, not `provenance?`.** Always-
  present, nullable. Means consumers can write `finding.provenance?.anchors`
  without a `"provenance" in f` check. Small ergonomic win.

- **GitHub annotations only use after-side anchors.** The `file=` field
  on annotations targets the right-hand file; pinning a removed-concept
  (which only exists in the before file) to a line in the after file
  would be misleading. We pin when we can and fall back to file-top when
  we can't.

- **Anchor length is snippet-truncated to 120 chars.** Longer snippets
  bloat JSON output; 120 chars is enough context for a human to
  recognize the region. Full text is still available under `evidence`.

- **No columns in human output.** `@ before:2 after:2` reads cleanly in
  a terminal; adding columns (`@ before:2:1-2:51`) would add noise for
  prose comparison where columns rarely matter. Columns are still in
  JSON for SARIF-ready consumers.

- **Fingerprints for baselines do NOT include provenance.** Line
  numbers drift as files evolve; if baseline fingerprints depended on
  them, a single edit above a finding would invalidate the whole
  baseline. Fingerprinting stays text-based.

**Why provenance before SARIF / directory mode / PR bot:**

Those follow-ons all *consume* provenance. SARIF needs `physicalLocation`
with line ranges. A PR-comment bot wants `line=` + snippet. Directory
mode wants to label cross-file findings. Building any of them without
anchors would have forced a rewrite later. This is the load-bearing
spine feature; everything downstream gets meaningfully more useful now.

**Tests added (17 total: 6 engine + 11 CLI, total now 108):**
- Commitment shifts carry dual before+after anchors
- Added concepts anchor only on after; removed concepts only on before
- Action item provenance sidecar has the right sides
- Missing-evidence case doesn't crash or invent anchors
- Anchor line numbers match actual source line content (end-to-end)
- `--json` provenance shape (sides, lines, columns, snippet, quality)
- `--compact` anchor tab field present when anchors exist, absent otherwise
- Terminal output shows `@ before:L after:L` suffix
- `--github` includes `line=` on after-anchored findings
- `--github` omits `line=` for before-only removed concepts

**Paths worth following next:**

1. **SARIF 2.1.0 export.** The provenance model maps almost 1:1 onto
   SARIF's `locations` / `physicalLocation` / `region` — it's now
   a mechanical renderer on top of DiffResult.

2. **Column-level snippet highlighting in `--github`.** Currently we
   set `line=`/`endLine=`/`col=`. Adding `endColumn=` would let GitHub
   highlight the exact drift region, not the whole line.

3. **Anchor-aware terminal UI.** A `--show-snippets` flag that prints
   the 1–3 lines around each anchor, with the matched span highlighted,
   would make the default output much more inspectable. The snippet
   field is already there.

4. **AST / markdown-structure anchoring.** For markdown specifically,
   anchors could point at header paths (`## API contracts > Retries`)
   instead of just line numbers — more robust against reflowing.
   Starts paying off when combined with directory mode.

5. **Anchor stability under whitespace edits.** Today, a trailing-
   whitespace edit doesn't break anchoring (fuzzy fallback), but
   paragraph reflows can cause "approximate" matches. A diff-aware
   anchor could use the pre-existing heuristic unit matcher as ground
   truth.

### 2026-04-16 (session 5) — Repo-level policy/config canonization

The prior session made the CLI CI-ready; this one makes it *repo-native*.
Before: every CI job hand-crafted a string of flags and hoped they stayed
consistent. After: the contract lives in one checked-in file, and a
developer's local run matches CI by construction. Version 0.4.0.

**The product-shape shift:**
SameDiff Lens stops being "a CLI with flags" and becomes "a primitive a
repo uses to declare what semantic drift means and enforce it over time."
That reframing is load-bearing. It changes the README, the subcommand
surface, the way CI snippets look in the docs, and the onboarding flow.

**What we built:**
- `.samediff.json` config file with walk-up discovery (stops at `$HOME`
  or filesystem root; capped at 10 levels)
- Built-in policies always available even without a config file:
  - `adoption` — baseline-aware; fails on NEW drift ≥ score:4 in commits
    / contradictions
  - `strict` — fails on any commit shift or contradiction
  - `docs-only` — commits + contradictions + concepts + todos; score:5
  - `advisory` — `fail_on: null`; reports only
- `default_policy` field in config → auto-applies without any CLI flag
- User-defined policies override same-named built-ins (`samediff policies`
  shows `(override)` next to these)
- New flags: `--config <path>`, `--no-config`, `--policy <name>`,
  `--no-policy`, `--no-baseline`, `--fail-on none`
- New subcommands: `samediff init`, `samediff policies`, `samediff baseline`,
  `samediff check` (explicit alias for bareword run)
- `--json` output gains an additive `policy` block when a policy shaped
  the run (name, source, config path)
- Gentle fallback when a policy-configured baseline path doesn't exist:
  prints a one-line note, continues without the baseline, doesn't crash.
  That preserves the `init → baseline → run` onboarding loop even if a
  user runs the middle step out of order.
- Provenance line on stderr (`SameDiff: config=..., policy=adoption
  (default)`) so users can always see which layers shaped the run

**Config shape:**
```json
{
  "baseline": ".samediff-baseline.json",
  "include": ["commitment-shifts", "contradictions"],
  "exclude": [],
  "fail_on": "score:5",
  "github": false,
  "compact": false,
  "stats": false,
  "default_policy": "adoption",
  "policies": {
    "adoption": { ... },
    "strict":   { ... },
    "advisory": { "fail_on": null }
  }
}
```

`$schema` at the top level is allowed and ignored, matching JSON-schema
conventions.

**Precedence (high to low):**
1. Explicit CLI flags
2. Selected policy block (via `--policy` or `default_policy`)
3. Top-level config block
4. Built-in defaults

Array fields (`include`, `exclude`) replace rather than union across layers.
Union would be confusing — "I said only concepts" shouldn't silently also
include whatever the policy had. Rationale encoded in resolveOptions.ts.

`fail_on: null`, `"none"`, `"never"`, `"off"` are all normalized to
"never fail." That covers what people actually type.

**Key decisions & why:**

- **Config file, not `.samediffrc` or `package.json#samediff`.** Keeping
  it `.samediff.json` makes it a first-class JSON artifact with its own
  `$schema` hook. Linters and editors can type-check it. `package.json`
  integration would conflate tool config with package metadata, and we
  want this file to feel as checked-in as `.eslintrc`.

- **Walk-up discovery, not just cwd.** Developers run the tool from
  subdirectories all the time. Stop at `$HOME` so we never cross into
  another repo or the user's dotfiles.

- **Built-in policies stay in code, not on disk.** Two reasons: (a) users
  get sensible defaults before they ever touch a config file, so
  `samediff --policy strict` works anywhere, and (b) the starter config
  from `samediff init` can be short and aspirational instead of dumping
  100 lines of defaults onto the repo.

- **No DSL.** I intentionally didn't build a rule engine. The config is a
  thin JSON veneer over the existing flag surface. If we later need
  per-file rules or regex matches, we can grow into it — starting with
  a richer config now would add complexity before we've seen real
  requirements.

- **Filters still operate on AnalysisResult.** The invariant from last
  session holds: every renderer sees the same filtered view, score and
  summary are recomputed, so `--policy adoption` + baseline yields
  "fail only on NEW drift ≥ score:4" without any special code paths.

- **`check` as an optional alias, not a required subcommand.** Bareword
  `samediff a.md b.md` still works. Forcing a subcommand would break
  everyone's muscle memory and every shell history. `check` is there
  for users who prefer explicit forms or for scripting clarity.

- **`init` writes an aspirational starter, not a lowest-common-denominator
  one.** It defaults to `adoption` because that's the mode that actually
  works for most repos on day one. "Strict" is right there as a policy
  for when they're ready.

- **Stderr provenance line is always on when a policy/config shaped the
  run.** Silent behavior is great when it matches expectations; it's
  actively harmful when it doesn't. One line on stderr costs nothing and
  lets developers see "oh, that's which policy fired" at a glance.

- **`baseline` subcommand takes `<left> <right>` instead of reading from
  config.** We thought about inferring from `--git` or config, but then
  the first-use flow becomes magic. Explicit paths are unambiguous and
  compose with `--git` cleanly (`samediff baseline a.md b.md -o ...`).

**Why policy/config before SARIF, line anchors, or directory mode:**

Those three are all valuable follow-ons, but they're **surface extensions**
— they add more ways to render or scope findings. The repo-as-policy-owner
reframing is a **product spine change**. Every adjacent feature gets more
valuable once a repo has a canonical contract:

- SARIF renders the output of a policy, not of an ad-hoc CLI run
- Line anchors make the findings inside a policy-shaped run more useful
- Directory mode is "apply the policy across N files"

So getting the spine right unlocks the follow-ons. Building SARIF first
would have produced a SARIF emitter tied to hand-crafted flag strings.
That's technical debt the moment a config file exists.

**JSON output additions (backwards-compatible):**
```jsonc
{
  // ... existing fields ...
  "filters": {
    "only": [...],
    "exclude": [...],
    "baseline": { "path": "...", "suppressed": 11 }
  },
  "policy": {
    "config": "/path/to/.samediff.json",
    "name": "adoption",
    "source": "default"  // or "cli"
  }
}
```

Both blocks are optional. Schema version stays at `"1"` — the contract is
additive.

**Tests added (22 new, 77 total CLI):**
- `policies` subcommand lists built-ins with no config
- `init` writes starter config; refuses to overwrite without `--force`
- `--policy strict` fails on commitment shifts; `--policy advisory` never fails
- Unknown policy / unknown category / invalid JSON / missing default_policy
  all exit 2 with clear messages
- Full adoption flow: `init → baseline → run` yields score 0.0
- Adoption policy without baseline: helpful note, still runs
- Precedence: CLI `--fail-on` / `--only` / `--no-baseline` override policy
- `--no-config` and `--no-policy` escape hatches
- Explicit `--config <path>` uses custom file
- Config can redefine a built-in policy by same name
- `policy` block appears in `--json` output
- `baseline` subcommand writes valid JSON, honors `-o`
- `check` subcommand is byte-identical to bareword invocation

**Paths worth following next:**

1. **Line/source anchoring** — the engine doesn't yet track where a finding
   originated. Adding a `location` field (`{ line, column, range }`) to
   findings would light up the `--github` annotations (currently pinned
   to file top) and enable proper inline PR review. This is the biggest
   UX unlock.

2. **SARIF 2.1.0 output** — now that the result model + policy story is
   settled, SARIF becomes a mechanical renderer. Plugs directly into
   GitHub code scanning and VS Code problems panel.

3. **Directory / glob mode** — `samediff --dir docs/` applies the current
   policy across N files, aggregates findings into one report. Config can
   declare `targets: ["docs/**/*.md"]`.

4. **PR-comment bot** — consume the JSON output, post a single collapsible
   PR comment with the findings. Tiny GitHub Action on top of `--json`
   + `--policy`.

5. **`samediff baseline --update`** — detect when the baseline is older
   than the files it covers and prompt to regenerate.

6. **Config schema publishing** — the `$schema` URL in the starter config
   is a placeholder. Host a real JSON Schema so editors get completion
   and validation on `.samediff.json`.

### 2026-04-16 (session 4) — CI-native developer surface

The CLI already did solid single-run diffing, but for anyone actually adopting it
on a shared repo, single-run isn't enough. Teams need noise control, gradual
adoption, and precise gating. That's what this session builds. Version bumped
to 0.3.0.

**What we built:**
- `--fail-on <spec>` — replaces the crude `--exit-code` threshold. Spec is
  comma-separated: `any`, `score:N`, or category names (with aliases like
  `commits`, `concepts`, `todos`, `all`). Combinable in one flag.
  `--exit-code` still works, aliased to `--fail-on score:1.1`.
- `--baseline <file.json>` — the gradual-adoption feature. Load a prior
  `--json` run, fingerprint every finding, and subtract matches from the
  current run. Score is recomputed from the filtered view, so pre-existing
  drift doesn't inflate the score or trip `--fail-on`. Baseline provenance
  (path + suppressed count) surfaces in `--json` output under `filters.baseline`.
- `--only <cats>` / `--exclude <cats>` — category filter, comma-separated,
  with aliases. Works with every output format. Score is recomputed.
- `--github` — emits GitHub Actions workflow commands (`::error::`,
  `::warning::`, `::notice::`). Commitment shifts and contradictions are
  errors; renames are warnings; the rest are notices. Messages are escaped
  per the workflow-commands spec.
- `--compact` — one finding per line, tab-separated: `CATEGORY\tdetail`.
  Grep-, awk-, `wc -l`-friendly.
- `--stats` — one-line key=value counts (`score=5.8 commitment-shifts=2 …`).
- stdin support — pass `-` as either filename to read from stdin
  (`cat draft.md | samediff - reference.md`).
- Format mutual exclusion — pass two format flags and the CLI errors out
  cleanly with exit code 2 instead of picking one silently.

**Key decisions:**
- **Filter pipeline operates on `AnalysisResult`, not `DiffResult`.** This
  means every existing renderer (terminal, md, html, json) sees the same
  filtered view without code changes. The alternative — pushing all
  renderers onto `DiffResult` — would have been a bigger refactor with
  regression risk. The current design delivers the feature immediately.
- **Score is recomputed from the filtered result, not the raw one.** This is
  what lets `--baseline` + `--fail-on score:5` behave the way a developer
  expects: "fail if NEW drift alone is ≥5". If we kept the raw score, the
  baseline feature would be half-useful — you'd see the filtered findings
  but still fail on pre-existing drift.
- **Summary is also rebuilt from the filtered result** (only when filters
  actually suppressed something, to avoid unnecessary work). Without this,
  the footer would still say "found 2 commitment shifts" after `--only
  contradictions` zeroed them out.
- **Fingerprints are normalized** (lowercased, whitespace-collapsed) so
  trivial edits don't break baseline matching. Contradiction anchors are
  sorted so anchor reordering doesn't break matching either. Fingerprints
  are intentionally opaque internal identifiers — not part of the public
  JSON schema.
- **Baseline JSON loader is lenient** — unknown top-level fields are ignored,
  missing categories are treated as empty arrays. Future schema evolution
  won't break old baselines.
- **`--github` uses `file=` on every annotation** (set to the right-hand
  file). We don't have line numbers for findings yet (the engine doesn't
  track source offsets), so GitHub will annotate at file top. That's still
  useful — it puts the finding in the PR Files tab. Adding real line
  numbers is a good next step, but needs engine changes.
- **Exit code 2 for usage errors** (bad --fail-on spec, unknown category,
  two format flags). Kept exit 1 reserved for "drift detected" so CI scripts
  can distinguish misconfiguration from real findings.
- **`--fail-on score:N` is `>=`, not strict `>`.** A developer reading
  "fail on score 5" naturally expects "5.0 fails." The legacy `--exit-code`
  (strict `> 1`) is preserved via the `score:1.1` alias.
- **No config file yet.** Tempting but out of scope for this session —
  the flag surface is the important thing to get right first. A `.samediffrc`
  layer on top is easy once the flags are stable.

**Why this matters:**
Before this session, the CLI could produce a report. Now it's a CI tool:
- "Gate PRs on contradictions but allow rename churn" → one flag
- "Start using this on a 5-year-old docs repo without bankruptcy" → baseline
- "Pipe findings into my existing tooling" → compact + stdin
- "Light up PR annotations without writing a GitHub Action" → `--github`

The underlying JSON schema didn't need to change; everything composes over
the existing `DiffResult` contract. The new `filters` field on JSON output
is additive and optional.

**Tests added (26 new, 55 total CLI):**
- `--only` / `--exclude` with single, comma-separated, and alias categories
- Filter recomputes score and respects `--json` output
- Unknown category exits with code 2
- `--fail-on any` / `score:N` / category / bad-spec paths
- `--fail-on contradictions` passes when contradictions are excluded
- `--baseline` suppresses findings, zeroes score, passes `--fail-on any`
- `--baseline` with non-JSON file errors cleanly
- `--compact` format shape, ANSI-free, composes with `--only`
- `--github` annotation shape and single-line invariant
- `--stats` one-line format
- stdin on left, stdin on right, both-stdin error
- Two-format-flag conflict errors with exit 2

**Paths worth following:**
- Push existing renderers (terminal, html, md) onto `DiffResult` so they can
  carry baseline provenance, finding-type discriminators, and schema-versioned
  guarantees. The groundwork is in place.
- `--sarif` for code scanning integrations (SARIF 2.1.0 is the lingua franca
  for security/lint tools on GitHub).
- Source line tracking through the engine so `--github` can annotate the
  exact line that changed. This is the biggest unlock for inline PR review UX.
- Config file (`.samediffrc`) for default flags + per-project ignore lists.
- Directory-mode: `samediff --dir docs/` to aggregate drift across many files.

### 2026-04-16 (session 3) — Structured JSON output + canonical result model

**What we built:**
- `--json` CLI flag: emits clean, stable, machine-readable JSON to stdout with no banners or ANSI
- Canonical `DiffResult` type (`src/cli/resultModel.ts`): the structured intermediate representation that bridges the analysis engine and output renderers
- `formatJson.ts` renderer: thin serialization layer over the result model
- Schema version field (`"version": "1"`) for forward compatibility
- Full provenance tracking: tool metadata, input labels/paths/gitRefs, timestamps
- Score with semantic label (`"low"` / `"moderate"` / `"high"` / `"critical"`) and exit code
- Category counts with a `total` field
- Per-finding type discriminators (e.g., `"type": "commitment-shift"`) for downstream consumers
- Evidence attached to every finding (before/after text, triggers, anchors, confidence)
- Works with all existing modes: `--json -o file`, `--json --git`, `--json --exit-code`

**Key decisions:**
- Introduced a `DiffResult` as an explicit intermediate model rather than just JSON.stringify-ing `AnalysisResult`. This keeps the JSON contract decoupled from internal engine types, meaning we can evolve either side independently
- Used `null` instead of `undefined` for optional fields (JSON has no `undefined`)
- Schema version `"1"` — bumping to `"2"` would signal breaking changes to consumers
- Did NOT refactor existing renderers (--html, --md, terminal) to use `DiffResult` yet. That's the natural follow-on but wasn't required for this task, and touching working renderers adds risk. The model is ready for them when we want it
- Findings carry a `type` discriminator to enable `switch(finding.type)` in consumers without guessing from context
- `counts.total` is a convenience field so consumers don't have to sum categories themselves

**What this unlocks:**
- GitHub Actions / CI integrations (parse JSON, gate on score or specific findings)
- PR comment bots (render findings as inline comments)
- Editor integrations (consume JSON, display inline diagnostics)
- Policy/gating logic beyond just exit codes (e.g., "fail if any contradiction found")
- Future dashboards and UIs that consume the same substrate
- Eventually: `--html` and `--md` can be rebuilt as renderers of `DiffResult`, completing the engine → model → renderer(s) layering

**Trade-off called out:** I built `DiffResult` as a new model that the JSON renderer uses, while leaving the HTML/md/terminal renderers on their current code paths consuming `AnalysisResult` directly. This is a deliberate short-term choice: it adds one more type to the codebase, but avoids risking regressions in working output modes. The path to full unification is clear and incremental.

**Tests added (10 new, 29 total CLI):**
- Valid JSON parsing
- Required top-level field presence
- Score range and label validation
- Counts ↔ findings array length consistency
- Type discriminator correctness
- Clean stdout (no ANSI, no banners)
- Identical files → zero drift
- Git mode + JSON combo
- File output (-o) + JSON combo
- Schema shape stability (exact key sets)

### 2026-04-16 (session 2) — Feature expansion: HTML reports, git integration, scoring, watch

**What we built:**
- `--html` output: self-contained HTML report with GitHub-dark theme, expandable cards, drift score meter, light/dark mode support via `prefers-color-scheme`. Single file, no external dependencies, screenshot-ready
- `--git` integration: `samediff --git HEAD~1 -- spec.md` compares working copy against any git ref. Supports `REF:path` syntax for comparing two refs
- Drift severity scoring: 0–10 scale using weighted formula (commitment shifts and contradictions weighted 1.5×, action items 0.5×, concepts 0.3×) with soft ceiling via exponential curve. Visual bar in terminal output
- `--exit-code` for CI: exits 1 if drift score > 1, enabling `samediff --git main -- spec.md --exit-code || alert`
- `--watch` mode: re-diffs on file changes using fs.watch with debounce, clears terminal between runs
- `-o` / `--out`: write any output format to file
- `--score`: print just the numeric score (pipe-friendly)
- Fixed `./samediff` wrapper to resolve relative paths from caller's cwd
- 5 example pairs spanning simple→advanced, standardized on left.md/right.md naming
- Expanded CLI test suite from 9 to 19 tests

**Key decisions:**
- Scoring uses exponential soft ceiling (`10 × (1 - e^(-raw/8))`) so the scale stays meaningful — a document can't just pile up findings to hit 10.0
- HTML report is fully self-contained: inline CSS, inline JS, no CDN dependencies. Works offline, can be emailed or dropped in PRs
- Git integration resolves `REF:path` specs via `git show`, keeping it simple and composable
- Watch mode watches directories (not just files) to handle editor save patterns (write-temp → rename)

### 2026-04-16 (session 1) — CLI proof object + repo coherency pass

**What we did:**
- Full archaeology sweep of existing repo (11 commits, 35 source files)
- Created CLI entry point (`src/cli/index.ts`) and formatted output (`src/cli/formatCli.ts`)
- CLI produces screenshot-worthy `Δ SameDiff Summary` output with colored sections
- Created example fixture under `examples/hydra-doc-drift/` with before/after markdown files that exercise all 4 detection passes
- Wrote initial CLI integration tests
- Fixed plural bug ("guesss" → "guesses") in summary builder
- Updated README to lead with CLI usage, added repo shape docs
- Version bump to 0.2.0

**Key decisions:**
- Did NOT modify the existing analysis engine or browser UI — additive only
- Used CommonJS compilation target + `dist-cli/package.json` override to avoid import extension conflicts with the ESM root package.json
- Kept `bin/samediff.cjs` as the npm bin wrapper to sidestep module system issues

**What we preserved:**
- Entire `src/analysis/` engine — untouched except the plural fix
- All UI components, golden examples, existing test suite
- Bazel targets, GitHub Pages deployment, screenshot tooling

## Dragons We've Slain

### ESM/CJS Module System Conflict
The root `package.json` has `"type": "module"` for Vite/React, but the CLI needs CommonJS output from `tsc` (since the existing source uses extensionless imports that don't work with Node16 module resolution). Solved by compiling to CJS and injecting a `dist-cli/package.json` with `"type": "commonjs"` during the build step. The `bin/samediff.cjs` wrapper handles the entry point.

### Relative Path Resolution in Shell Wrapper
The `./samediff` wrapper `cd`s into the repo root to find build artifacts, which broke relative file paths. Fixed by capturing the original `pwd` before `cd` and resolving non-flag arguments against it. Also passes `SAMEDIFF_ORIG_DIR` env var so the Node process can resolve `-o` output paths correctly.

### Plural Bug in Summary
`buildSummary` used a generic `plural()` helper that appends "s" — but "rename guess" + "s" = "guesss". Fixed with an explicit "es" branch for the rename count.
