# SameDiff Lens

SameDiff Lens is a local-first browser tool for comparing two text versions and surfacing the kinds of semantic changes that raw line diff often misses. Instead of focusing only on inserted and deleted lines, it highlights likely shifts in concepts, commitments, action items, renamed ideas, and possible contradictions.

## Try it

- Live demo: coming soon at `https://<owner>.github.io/samediff-lens/`
- Local run: `npm install && npm run dev`

## Example input/output

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

## Why raw diff is not enough

Traditional diff is excellent at showing where text changed, but it is weak at explaining what changed in meaning. A one-line edit can quietly narrow a policy, move a system responsibility, add a hidden constraint, or change an assistant's stance without looking dramatic in a line-by-line view.

SameDiff Lens is a proof-object for that gap. It asks: "What changed in the contract, not just the characters?"

The v0 contract lives in [docs/v0-contract.md](docs/v0-contract.md).

## What v0 does

This first pass runs entirely in the browser with no backend, no auth, no database, and no cloud calls. It uses simple deterministic heuristics to:

- extract likely added and removed concepts
- detect changed commitments and constraint shifts
- compare action-like bullets and TODO-style phrasing
- guess renamed ideas when surrounding context stays similar
- flag possible contradictions or responsibility moves
- summarize the overall drift in plain language

## What v0 does not do

v0 is intentionally narrow and honest. It does not:

- claim deep semantic understanding
- use embeddings, LLM calls, or hidden cloud services
- persist data between sessions
- support collaborative workflows or version history
- guarantee correct classification on arbitrary prose

## Run locally

Requirements:

- Node.js 20+
- npm 10+

Install and start:

```bash
npm install
npm run dev
```

Build for a production check:

```bash
npm run build
```

Run the smoke tests:

```bash
npm test
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

## Demo flow

1. Load one of the three built-in golden examples.
2. Inspect Version A and Version B side by side.
3. Click `Compare`.
4. Review the category cards in the results panel.

## Screenshots

![SameDiff Lens storyboard](docs/storyboard/samediff-lens-storyboard.png)

- Storyboard PNG: [docs/storyboard/samediff-lens-storyboard.png](docs/storyboard/samediff-lens-storyboard.png)
- Storyboard source: [docs/storyboard/samediff-lens-storyboard.svg](docs/storyboard/samediff-lens-storyboard.svg)

Regenerate the PNG on macOS with:

```bash
./tools/export-storyboard.sh
```

## Repo shape

```text
docs/
  v0-contract.md
src/
  analysis/
  components/
  examples/
```

## Status

This repository is a v0 proof-object: runnable, inspectable, and intentionally heuristic.
