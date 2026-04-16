# 03 — API Contract Drift

**Difficulty:** Medium
**What to look for:** Narrowed scope, new constraints, contradiction hints

An API spec that tightened significantly between versions:
shipping_address went from optional to required, items got a cap,
orders became immutable (contradicting the earlier PATCH claim),
"should send email" became "must send email + webhook", and rate
limits appeared where there were none.

This is the kind of spec change that breaks clients if you only
skim the diff. SameDiff should surface the narrowing, the
commitment strengthening, the new concepts (idempotency_key,
webhook, rate limit), and the mutability contradiction.

```bash
./samediff examples/03-api-contract/left.md examples/03-api-contract/right.md
```
