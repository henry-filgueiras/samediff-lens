# SameDiff Lens

SameDiff Lens surfaces the kinds of semantic changes that raw line diff misses: commitment shifts, task drift, concept renames, and possible contradictions. No LLM, no cloud, no embeddings — just deterministic heuristics you can inspect.

Feedback on false positives, false negatives, and confusing outputs is welcome via GitHub issues.

## CLI — try it in 10 seconds

```bash
npm install && npm run build:cli
npm run samediff -- examples/01-modal-shift/left.md examples/01-modal-shift/right.md
```

Options at a glance: `--md`, `--html`, `--json`, `--compact`, `--github`, `--stats`, `--score`. Use `--help` for the full usage.

There are five example pairs in `examples/`, from simple to advanced — see [examples/README.md](examples/README.md).

### Structured JSON output

```bash
npm run samediff -- fileA.md fileB.md --json
npm run samediff -- --git main -- spec.md --json
npm run samediff -- fileA.md fileB.md --json -o result.json
```

The `--json` flag emits a stable, machine-readable representation of the analysis — the canonical result contract that CI integrations, PR comment bots, and future UIs can build on. Only valid JSON is written to stdout; diagnostics go to stderr.

### CI gating: `--fail-on`

Precise exit-code control — no more fighting a fixed threshold:

```bash
samediff a.md b.md --fail-on score:5               # fail if drift ≥ 5/10
samediff a.md b.md --fail-on contradictions        # fail on any contradiction
samediff a.md b.md --fail-on commitment-shifts,contradictions
samediff a.md b.md --fail-on any                   # fail on any finding
```

### Gradual adoption: `--baseline`

Snapshot today's drift and only fail on NEW drift from then on:

```bash
# Record current state once
samediff --git main -- spec.md --json -o .samediff-baseline.json

# In CI, ignore pre-existing findings — only flag what's new
samediff --git main -- spec.md \
  --baseline .samediff-baseline.json \
  --fail-on any
```

The baseline is subtracted from both the findings list **and** the drift score, so CI won't yell at you about drift that was already there.

### Focus mode: `--only` / `--exclude`

Filter categories; score and output are recomputed from the filtered view.

```bash
samediff a.md b.md --only contradictions
samediff a.md b.md --exclude concepts --compact
```

Category names: `commitment-shifts`, `contradictions`, `concept-renames`, `added-concepts`, `removed-concepts`, `action-items-added`, `action-items-removed`. Handy aliases: `commits`, `concepts`, `todos`, `all`.

### Pipe-friendly formats

```bash
samediff a.md b.md --compact          # one finding per line (grep/awk friendly)
samediff a.md b.md --stats            # one-line key=value counts
samediff a.md b.md --github           # ::error/warning/notice:: workflow commands
echo "draft text" | samediff - ref.md # stdin support via '-'
```

`--github` emits GitHub Actions workflow commands so findings show up inline in PR checks with zero extra tooling.

## Browser UI

- [Live demo](https://henry-filgueiras.github.io/samediff-lens/)
- Local run: `npm install && npm run dev`

### Try the browser UI in 20 seconds

1. Load one of the built-in examples.
2. Click `Compare`.
3. Inspect the category cards and the compact evidence blocks.
4. Or open two local `.txt` / `.md` files and export a report.

## What this is / what this is not

This is:

- a browser-only proof-object for semantic drift
- a deterministic heuristic analyzer you can inspect
- a faster way to spot contract changes that raw diff under-explains
- a local-only tool that can open plain text or Markdown files and export a compact report
- a lightweight way to report weird results without sending your full source text by default

This is not:

- a backend service or collaboration platform
- a claim of deep semantic understanding
- an LLM wrapper or hidden AI workflow

## Why this exists

- Raw diff shows where text changed, not necessarily what changed in meaning.
- Small edits can quietly narrow commitments or move responsibilities.
- Spec, prompt, and architecture drift often matter more than line count.
- v0 aims for honest, inspectable signals over opaque sophistication.

## Concrete example

```text
Version A
The system should retry failed jobs.

Version B
The system retries only idempotent jobs up to 3 times with jitter.
```

Expected v0 output, in spirit:

- changed commitment: the retry policy got narrower
- added concepts: `idempotent jobs`, `up to 3 times`, `jitter`
- possible contradiction: the broader earlier claim is now limited

The v0 contract lives in [docs/v0-contract.md](docs/v0-contract.md).

## What v0 does

SameDiff runs as a CLI tool or in the browser, with no backend, no auth, no database, and no cloud calls. It uses simple deterministic heuristics to:

- extract likely added and removed concepts
- detect changed commitments and constraint shifts
- compare action-like bullets and TODO-style phrasing
- guess renamed ideas when surrounding context stays similar
- flag possible contradictions or responsibility moves
- load local `.txt` / `.md` files into either side of the comparison
- export the current result as a lightweight Markdown report
- summarize the overall drift in plain language

## What v0 does not do

v0 is intentionally narrow and honest. It does not:

- claim deep semantic understanding
- use embeddings, LLM calls, or hidden cloud services
- persist data between sessions
- support collaborative workflows or version history
- guarantee correct classification on arbitrary prose

## Good use cases

- comparing two versions of a design note before review
- comparing prompt revisions for policy or stance drift
- comparing spec, incident runbook, or ops checklist edits

## Run locally

Requirements:

- Node.js 20+
- npm 10+

Install:

```bash
npm install
```

Build and run the CLI:

```bash
npm run build:cli
npm run samediff -- fileA.md fileB.md
```

Start the browser UI:

```bash
npm run dev
```

Build the browser UI for production:

```bash
npm run build
```

Run the smoke tests:

```bash
npm test          # analysis engine tests
npm run test:cli  # CLI integration tests
```

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow for GitHub Pages deployment from a repository subpath.

Expected project-pages URL pattern:

```text
https://<owner>.github.io/samediff-lens/
```

Enable it:

1. Push this repo, including `.github/workflows/deploy-pages.yml`, to the default branch.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Let the `Deploy GitHub Pages` workflow run on the default branch.
5. Open the deployed site at `https://<owner>.github.io/samediff-lens/`.

Notes:

- If the repository name changes, the Pages URL and Vite base path change with it.
- If you deploy from a repository named `<owner>.github.io` or use a custom domain, update the Pages base-path handling in `vite.config.ts` and the workflow env accordingly.

## Bazel entrypoints

This repo now includes lightweight Bazel wrappers around the existing local Vite workflow. They are intentionally simple: Bazel gives us stable entrypoints, while `npm install` still provisions the frontend toolchain.

One-time setup:

```bash
npm install
```

Useful targets:

```bash
bazel run //:devserver
bazel run //:build
bazel run //:test
```

You can pass extra Vite flags to the dev server:

```bash
bazel run //:devserver -- --host 0.0.0.0 --port 5173
```

## Screenshots

![SameDiff Lens app screenshot](docs/screenshots/app-home.png)

![SameDiff Lens storyboard](docs/storyboard/samediff-lens-storyboard.png)

- App screenshot: [docs/screenshots/app-home.png](docs/screenshots/app-home.png)
- Storyboard PNG: [docs/storyboard/samediff-lens-storyboard.png](docs/storyboard/samediff-lens-storyboard.png)
- Storyboard source: [docs/storyboard/samediff-lens-storyboard.svg](docs/storyboard/samediff-lens-storyboard.svg)

Capture a fresh app screenshot locally with:

```bash
npx playwright install chromium
npm run screenshot
```

Storyboard export on macOS:

```bash
./tools/export-storyboard.sh
```

Animated GIF walkthrough: to be added.

## Repo shape

```text
bin/
  samediff.cjs          # CLI entry point wrapper
docs/
  v0-contract.md
examples/
  01-modal-shift/       # simple: may→must
  02-todo-drift/        # simple: checklist changes
  03-api-contract/      # medium: spec narrowing
  04-prompt-policy/     # medium: behavioral contract
  05-hydra-doc-drift/   # advanced: full architecture rewrite
src/
  analysis/             # heuristic detection engine (shared)
  cli/                  # CLI-specific code
  components/           # browser UI components
  examples/             # golden examples for UI + tests
  lib/                  # shared utilities (report formatter, etc.)
tools/
  analysis.test.mjs     # engine smoke tests
  cli.test.mjs          # CLI integration tests
  build-cli.sh          # CLI build script
```

## Status

This repository is a v0 proof-object: runnable, inspectable, and intentionally heuristic.
