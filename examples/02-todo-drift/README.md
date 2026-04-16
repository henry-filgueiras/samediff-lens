# 02 — Todo Drift

**Difficulty:** Simple
**What to look for:** Task additions and removals

A launch checklist that evolved between reviews. One task got
completed, one got dropped ("load test the checkout flow"), and
three new ones appeared (geographic failover, canary deployment,
SRE notification).

SameDiff should surface the added and removed TODOs clearly,
making it easy to see how scope crept between versions.

```bash
./samediff examples/02-todo-drift/left.md examples/02-todo-drift/right.md
```
