# 01 — Modal Shift

**Difficulty:** Simple
**What to look for:** Commitment strength changes

Three short sentences where the modal verbs quietly escalate:
may → must, should → must, optional → required.

This is the kind of drift that line diff shows as "changed" but
doesn't explain *how* the commitment moved. SameDiff should surface
these as commitment shifts with clear before/after.

```bash
./samediff examples/01-modal-shift/left.md examples/01-modal-shift/right.md
```
