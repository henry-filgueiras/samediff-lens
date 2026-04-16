# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is a dual-surface semantic diff tool: a browser UI (React+Vite, deployed to GitHub Pages) and a feature-rich CLI (`./samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Identity shift (v0.4):** the CLI is no longer framed as "a diff tool with many flags" — it's **a primitive for a repo to declare and enforce its semantic-drift contract**. That contract lives in `.samediff.json` and is consumed identically by CI and local developers.

**Working surfaces:**
- CLI: `./samediff left.md right.md` (auto-builds if stale)
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 14 engine tests + 77 CLI integration tests, all passing

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

**Test counts:** 14 engine tests + 77 CLI integration tests, all passing

## Devlog

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
