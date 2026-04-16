# 05 — Hydra Doc Drift

**Difficulty:** Advanced (multi-section, all detectors)
**What to look for:** Everything — commitment shifts, task drift, concept renames, contradictions, added/removed concepts

A multi-section design doc for a fictional cluster protocol that
went through a major architectural revision. The central registry
was replaced by gossip protocol, heartbeat intervals halved,
retry policy narrowed to idempotent-only, the incident runbook
was rewritten, and the state model flipped from immutable epochs
to mutable CRDT convergence.

This is the kitchen-sink example — it exercises all four detection
passes simultaneously and shows how SameDiff handles a realistic
document-length revision with interleaved changes.

```bash
./samediff examples/05-hydra-doc-drift/left.md examples/05-hydra-doc-drift/right.md
```
