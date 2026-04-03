# SameDiff Lens

SameDiff Lens is a local-first browser tool for comparing two text versions and surfacing the kinds of semantic changes that raw line diff often misses. Instead of focusing only on inserted and deleted lines, it highlights likely shifts in concepts, commitments, action items, renamed ideas, and possible contradictions.

## Why raw diff is not enough

Traditional diff is excellent at showing where text changed, but it is weak at explaining what changed in meaning. A one-line edit can quietly narrow a policy, move a system responsibility, add a hidden constraint, or change an assistant's stance without looking dramatic in a line-by-line view.

SameDiff Lens is a proof-object for that gap. It asks: "What changed in the contract, not just the characters?"

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

## Demo flow

1. Load one of the three built-in golden examples.
2. Inspect Version A and Version B side by side.
3. Click `Compare`.
4. Review the category cards in the results panel.

## Screenshots

To be added.

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
