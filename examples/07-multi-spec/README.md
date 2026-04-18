# 07 — Multi-Doc Spec Drift

**Difficulty:** Advanced (multi-file roll-up)
**What to look for:** Aggregate narrative across an entire docs directory

A fictional internal observability platform ("Aurora") whose v2 docs
quietly relax every guarantee made in v1: durability becomes
best-effort, retention shrinks, audit logging is deferred, encryption
key rotation slows from 90 days to annually, PII is allowed to leave
the production VPC.

This example exists to demonstrate the `samediff dir` subcommand: a
single roll-up report across multiple files, with one ranked top-issues
list and per-file detail panels.

```bash
./samediff dir examples/07-multi-spec/v1 examples/07-multi-spec/v2 --html -o findings.html
```
