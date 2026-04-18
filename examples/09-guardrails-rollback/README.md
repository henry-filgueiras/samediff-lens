# 09 — Guardrails Rollback (trail thesis)

**Difficulty:** Advanced
**What to look for:** How the trail-level thesis layer synthesises meaning
across an entire document's lifetime — the "what actually happened?" band
that sits above the per-commit drift chart.

This example is the sibling of 08-policy-drift: both ship a single document
with real git history and are driven by `samediff history`. Where 08 shows
a *monotone* decay (each commit locally reasonable, the trajectory
unmistakable), this one shows a **reversal arc** — guarantees explicitly
weakened for beta rollout and then explicitly restored before GA. That
shape is what the trail layer is built to catch.

```bash
./samediff history examples/09-guardrails-rollback/guardrails.md \
  -o examples/09-guardrails-rollback/ --no-empty
open examples/09-guardrails-rollback/index.html
```

## The commit arc

| # | commit | direction | what moved |
|---|--------|-----------|------------|
| 0 | relax authentication for beta rollout | weakening | auth required → recommended; `X-Aurora-Beta-Client` bypass added |
| 1 | reduce encryption overhead during beta | weakening | TLS 1.3 → TLS 1.2+; AES-256 dropped; key rotation 90d → annual |
| 2 | defer full audit logging to phase 2 | weakening | full per-request → sampling; retention 365d → 30d |
| 3 | post-beta: reinstate authentication requirement | tightening | bypass removed; required + HTTP 401 restored |
| 4 | production: restore strict TLS 1.3 + AES-256 + 90d rotation | tightening | original encryption contract restored |
| 5 | compliance: restore full audit logging + 365d retention | tightening | original audit contract restored |

## What the trail layer fires

The history index opens with a **Tier 1 trail thesis band** reading:

> **Guarantees weakened and later restored**
> _Across 6 steps spanning 2026-03-04 → 2026-04-07 — driven by auth, TLS,
> encryption, audit, logging_

The band shows the reversal arc as two columns (earlier / later) with the
six commits split down the middle by net direction, and citation chips
that link to the per-pair report for each transition.

This is the `guarantees-restored-after-relaxation` pattern from the trail
doctrine catalog firing in its union form — a cross-family arc where
security, compliance, and reliability all weakened in the first half and
all restored in the second. The per-family arc (e.g. security-only)
would also fire, but the cross-family union has stronger evidence (more
cited issues, coordinated direction change) so it wins the salience tie.

## Why this example matters

Most drift examples are asymmetric — things get worse. But in a well-run
rollout, they also get *un*-worse, and a pairwise diff between the
first and last commits of this trail would miss the story entirely:

```bash
./samediff \
  --git $(git log --format=%h -- examples/09-guardrails-rollback/guardrails.md | tail -1) \
  --git $(git log --format=%h -- examples/09-guardrails-rollback/guardrails.md | head -1) \
  -- examples/09-guardrails-rollback/guardrails.md
```

That's a near-identical document: the net change from baseline to HEAD
is tiny (a couple of clarifying words). The diff says "nothing happened."
The reality is "a lot happened and then was un-happened" — and the trail
thesis is what exposes it.

The same doctrine also fires on, for example, an RFC that tried out a
syntax contract and reverted after review — same shape, different family.
This is the "sequence as story" read the trail layer exists to deliver.
