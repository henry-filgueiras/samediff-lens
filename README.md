# SameDiff Lens

SameDiff Lens surfaces the kinds of semantic changes that raw line diff misses: commitment shifts, task drift, concept renames, and possible contradictions. No LLM, no cloud, no embeddings — just deterministic heuristics you can inspect.

Feedback on false positives, false negatives, and confusing outputs is welcome via GitHub issues.

## CLI — try it in 10 seconds

```bash
npm install && npm run build:cli
npm run samediff -- examples/hydra-doc-drift/before.md examples/hydra-doc-drift/after.md
```

Output:

```text
Δ SameDiff Summary

  before.md → after.md

COMMITMENT SHIFTS
  - Nodes should register on boot and may deregister on grace...
  + Nodes must register on boot and must deregister on gracef...
    strengthens the commitment
  - The system should retry failed jobs
  + The system retries only idempotent jobs, up to 3 times wi...
    narrows scope

TASK DRIFT
  + TODO added: benchmark against GMP for large cluster sizes
  - TODO removed: validate karatsuba threshold for batch sizes

CONCEPT RENAME (heuristic)
  nodes should register → nodes must register  [high]

POSSIBLE CONTRADICTIONS
  ! B narrows protocol with limiting language that may contradict A's broader claim.

ADDED CONCEPTS
  + crdt based convergence healing
  + suspected down event via gossip

REMOVED CONCEPTS
  - karatsuba threshold for batch
  - applied atomically at epoch boundaries
```

Options: `--no-color` for plain text, `--md` for a full Markdown report, `--help` for usage.

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
  hydra-doc-drift/      # example fixture for CLI demo
    before.md
    after.md
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
