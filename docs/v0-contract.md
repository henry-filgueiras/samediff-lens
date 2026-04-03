# SameDiff Lens v0 Contract

## Product goal

SameDiff Lens is a local-first browser proof-object for comparing two text versions and surfacing likely semantic drift that raw line diff underserves. The goal of v0 is not perfect understanding; it is to make contract-level change visible through simple, inspectable heuristics that people can read, challenge, and improve.

## Explicit inputs

- `Version A`: free-form text input representing the earlier or baseline version
- `Version B`: free-form text input representing the later or candidate version
- optional built-in example selection from the UI

## Explicit outputs

The analyzer returns a structured result with:

- `addedConcepts: string[]`
- `removedConcepts: string[]`
- `renamedIdeas: Array<{ from: string; to: string; confidence: "low" | "medium" | "high"; note?: string }>`
- `changedCommitments: string[]`
- `actionItemsAdded: string[]`
- `actionItemsRemoved: string[]`
- `possibleContradictions: string[]`
- `summary: string`

The UI renders these as readable category cards plus a compact summary.

## Non-goals

- backend services
- auth, accounts, or collaboration features
- persistence or database storage
- opaque AI behavior or hidden cloud inference
- perfect NLP, knowledge graphs, or deep semantic parsing
- polished production-grade design system work

## Success criteria

v0 is successful if it:

- runs entirely in the browser from a local React + TypeScript + Vite app
- produces understandable structured output for the three golden examples
- makes its heuristic nature obvious rather than overclaiming
- keeps the analysis code clearly factored and easy to inspect
- gives users a better "what changed in meaning?" signal than raw line diff alone

## UX sketch

Top bar:

- product title
- "local-only" and "heuristic / experimental" labels

Control row:

- example picker
- `Load Example`
- `Compare`
- `Reset`

Main layout:

- left pane: large `Version A` textarea
- right pane: large `Version B` textarea
- explainer banner describing detected categories
- results panel below with summary first, then category cards

Category cards:

- added concepts
- removed concepts
- renamed ideas
- changed commitments
- action items added
- action items removed
- possible contradictions

## Golden examples

### 1. Spec drift

Version A:

> The system should retry failed jobs.

Version B:

> The system retries only idempotent jobs up to 3 times with jitter.

Expected v0 spirit:

- narrowed commitment
- added operational constraints
- stronger specificity

### 2. Prompt/policy drift

Version A:

> Be helpful and concise.

Version B:

> Be concise, challenge weak assumptions, and separate facts from speculation.

Expected v0 spirit:

- added behavioral commitments
- changed assistant stance
- stronger epistemic contract

### 3. Architecture drift

Version A:

> The registry stores service membership.

Version B:

> Membership is gossiped among nodes; the registry is only used for bootstrap and observation.

Expected v0 spirit:

- responsibility moved
- centralization reduced
- system model changed

## Future directions

Future work is explicitly out of scope for v0. Likely next steps:

- better clause alignment instead of simple sentence similarity
- richer contradiction and scope-change heuristics
- inspectable phrase ranking and trace output for each finding
- side-by-side raw diff overlay for comparison with semantic findings
- exportable reports and more example packs
