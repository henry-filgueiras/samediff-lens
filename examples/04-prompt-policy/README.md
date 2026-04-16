# 04 — Prompt / Policy Drift

**Difficulty:** Medium-Advanced
**What to look for:** Behavioral commitments, epistemic guardrails, scope narrowing, contradiction

A system prompt that went through a policy review. The tone
tightened (friendly → professional), scope was narrowed ("all
topics" → "approved categories only"), opinions went from allowed
to forbidden, and the data handling policy reversed entirely
(conversations used for training → ephemeral only).

This example shows why semantic diff matters for prompt engineering:
the line diff shows *what* changed, but SameDiff shows *how the
behavioral contract shifted* — from open and permissive to
guarded and constrained.

```bash
./samediff examples/04-prompt-policy/left.md examples/04-prompt-policy/right.md
```
