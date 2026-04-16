# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is now a dual-surface tool: a browser UI (React+Vite, deployed to GitHub Pages) and a CLI (`samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Working surfaces:**
- CLI: `npm run build:cli && npm run samediff -- fileA.md fileB.md`
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 14 engine tests + 9 CLI integration tests, all passing

**Detection passes (all heuristic, no ML):**
1. Commitment shifts — modal strength changes (may→must), narrowing, operational detail
2. Task drift — TODO/checklist additions and removals
3. Concept rename — high lexical overlap with changed key noun phrases
4. Contradiction hinting — same subject + opposite polarity/negation flip
5. Added/removed concepts — unique tokens in focused phrase windows

## Devlog

### 2026-04-16 — CLI proof object + repo coherency pass

**What we did:**
- Full archaeology sweep of existing repo (11 commits, 35 source files)
- Created CLI entry point (`src/cli/index.ts`) and formatted output (`src/cli/formatCli.ts`)
- CLI produces screenshot-worthy `Δ SameDiff Summary` output with colored sections
- Supports `--no-color`, `--md` (markdown report), and `--help` flags
- Created example fixture under `examples/hydra-doc-drift/` with before/after markdown files that exercise all 4 detection passes
- Wrote 9 CLI integration tests (`tools/cli.test.mjs`)
- Fixed plural bug ("guesss" → "guesses") in summary builder
- Updated README to lead with CLI usage, added repo shape docs
- Added `dist-cli/` to `.gitignore`, build script to `tools/build-cli.sh`
- Version bump to 0.2.0

**Key decisions:**
- Did NOT modify the existing analysis engine or browser UI — additive only
- Used CommonJS compilation target + `dist-cli/package.json` override to avoid import extension conflicts with the ESM root package.json
- Kept `bin/samediff.cjs` as the npm bin wrapper to sidestep module system issues
- Example fixture designed to hit all 4 detectors: commitment shifts (should→must), task drift (karatsuba→GMP), concept rename (service mesh bootstrap→convergence), contradictions (immutable state vs mutable cache)

**What we preserved:**
- Entire `src/analysis/` engine — untouched except the plural fix
- All UI components, golden examples, existing test suite
- Bazel targets, GitHub Pages deployment, screenshot tooling
- v0-contract.md, launch notes

**What we left alone (not stale, just not in scope):**
- LAUNCH_NOTES.md — empty feedback template, harmless
- Bazel wrappers — thin but functional
- Storyboard SVG/PNG — marketing artifacts

## Dragons We've Slain

### ESM/CJS Module System Conflict
The root `package.json` has `"type": "module"` for Vite/React, but the CLI needs CommonJS output from `tsc` (since the existing source uses extensionless imports that don't work with Node16 module resolution). Solved by compiling to CJS and injecting a `dist-cli/package.json` with `"type": "commonjs"` during the build step. The `bin/samediff.cjs` wrapper handles the entry point.

### Plural Bug in Summary
`buildSummary` used a generic `plural()` helper that appends "s" — but "rename guess" + "s" = "guesss". Fixed with an explicit "es" branch for the rename count.
