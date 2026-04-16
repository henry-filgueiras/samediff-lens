# Examples

Each folder contains `left.md` and `right.md` — the "before" and "after"
of a document revision. Run any pair through the CLI to see what SameDiff
surfaces.

```bash
./samediff examples/01-modal-shift/left.md examples/01-modal-shift/right.md
```

## The spectrum

| # | Name | Difficulty | Primary signal |
|---|------|-----------|----------------|
| 01 | Modal Shift | Simple | may→must commitment escalation |
| 02 | Todo Drift | Simple | Task additions and removals |
| 03 | API Contract | Medium | Scope narrowing, new constraints, contradictions |
| 04 | Prompt Policy | Medium-Advanced | Behavioral contract tightening, data policy reversal |
| 05 | Hydra Doc Drift | Advanced | All detectors — architecture rewrite across sections |

## What each example demonstrates

**01-modal-shift** — Three sentences where the modal verbs quietly escalate.
The simplest possible case: pure commitment strength changes.

**02-todo-drift** — A launch checklist that evolved between reviews. Tasks
added, removed, and completed. Shows scope creep in action.

**03-api-contract** — An API spec that tightened: optional fields became
required, items got capped, mutability reversed, rate limits appeared.
The kind of change that breaks clients.

**04-prompt-policy** — A system prompt after policy review. Tone, scope,
opinion rules, and data handling all shifted from permissive to constrained.
Shows why semantic diff matters for prompt engineering.

**05-hydra-doc-drift** — A full design doc revision: central registry → gossip
protocol, narrowed retry policy, rewritten runbook, immutable state → mutable
CRDT. Exercises all detection passes simultaneously.
