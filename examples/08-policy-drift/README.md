# 08 — Policy Drift (git history)

**Difficulty:** Advanced
**What to look for:** How a single document degrades across many small,
locally-plausible commits — and what the history view surfaces that no
single pairwise diff can.

This example is different from the others: instead of a single
`left.md` → `right.md` pair, it ships a document (`policy.md`) with a
real **git history** of semantically-loaded edits. The Pages build
runs `samediff history` over that history and publishes the generated
trajectory report as `findings.html`.

The document is a fictional SaaS privacy policy for "Nimbus Notes".
Over the course of 8 versions, the policy quietly transitions from a
strong, specific set of user commitments to a vague, commercially
convenient one — without any single commit looking unreasonable on
its own.

```bash
./samediff history examples/08-policy-drift/policy.md \
  -o examples/08-policy-drift/ --no-empty
open examples/08-policy-drift/index.html
```

## The commit arc

| # | Commit | Pattern to watch for |
|---|--------|----------------------|
| 1 | growth: carve out analytics exception | Scope expansion of sharing, "minimum data" softens |
| 2 | legal: add GDPR data-subject-rights section | Mostly additive — a low-drift valley |
| 3 | ai: introduce prompt telemetry for AI summarization | New retention contradicts strict baseline |
| 4 | eng: rewrite encryption section "for accuracy" | Strong E2EE claim quietly narrows to primary DB only |
| 5 | bizdev: update data-sharing for partnerships | Direct reversal of "we will never sell your data" |
| 6 | security: add breach notification policy | Conditional commitment — "where legally required" |
| 7 | legal: simplify and modernize policy language | Final thesis-level gutting of specifics |

The macro point: **no single commit looks alarming in isolation.**
Step 2 in particular is a genuinely-helpful GDPR cleanup. But the
trajectory is unmistakable once you see all seven bars next to each
other, and the commitment reversal in step 5 is flagged the same way
a human reviewer would flag it — as a direct contradiction with a
load-bearing claim elsewhere in the document.

## Why a separate example shape

The other examples feed SameDiff two static snapshots. This one
exercises the full history pipeline: per-pair analysis across every
commit that touched a single file, plus the roll-up chart and
timeline. It's the shape you'd actually use against a real repo.
