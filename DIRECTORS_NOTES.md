# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is a dual-surface semantic diff tool: a browser UI (React+Vite, deployed to GitHub Pages) and a feature-rich CLI (`./samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Working surfaces:**
- CLI: `./samediff left.md right.md` (auto-builds if stale)
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 14 engine tests + 29 CLI integration tests, all passing

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

**Test counts:** 14 engine tests + 55 CLI integration tests, all passing

## Devlog

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
