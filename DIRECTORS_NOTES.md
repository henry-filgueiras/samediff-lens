# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is a dual-surface semantic diff tool: a browser UI (React+Vite, deployed to GitHub Pages) and a feature-rich CLI (`./samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Working surfaces:**
- CLI: `./samediff left.md right.md` (auto-builds if stale)
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 14 engine tests + 19 CLI integration tests, all passing

**CLI capabilities:**
- Terminal output with colored drift cards and visual score bar
- `--html` — self-contained dark-theme HTML report (sharable, screenshot-worthy)
- `--md` — full Markdown report
- `--git HEAD~1 -- file.md` — diff against any git ref
- `--watch` / `-w` — live re-diff on file changes
- `--exit-code` — exit 1 if drift detected (CI-ready)
- `--score` — numeric drift severity (0–10)
- `-o file` — write output to file

**Detection passes (all heuristic, no ML):**
1. Commitment shifts — modal strength changes (may→must), narrowing, operational detail
2. Task drift — TODO/checklist additions and removals
3. Concept rename — high lexical overlap with changed key noun phrases
4. Contradiction hinting — same subject + opposite polarity/negation flip
5. Added/removed concepts — unique tokens in focused phrase windows

**Example spectrum (examples/):**
01-modal-shift → 02-todo-drift → 03-api-contract → 04-prompt-policy → 05-hydra-doc-drift

## Devlog

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
