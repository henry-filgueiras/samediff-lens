<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo.svg" alt="SameDiff Lens logo" width="160" height="160">
  </picture>
</p>

# SameDiff Lens

**Semantic drift is a governance problem, not a diff problem.**

SameDiff Lens is infrastructure for detecting, auditing, and preserving **semantic drift in technical intent over time**. Specs soften. Contracts weaken. `must` becomes `should`. Guarantees quietly move into "best effort." A line-level diff shows you where the text changed; SameDiff Lens shows you **where the contract changed** — and lets you hold a reviewable record of what was signal, what was noise, and which commit was the one that weakened the promise.

It is deterministic. No LLMs. No embeddings. No cloud. No hidden inference. Every finding points back to a line, every Issue cites its findings, every Thesis cites its Issues. The chain is inspectable end to end — because a governance primitive that can't show its work is just another opinion.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/infographic-overview-dark.svg">
    <img src="docs/infographic-overview.svg" alt="SameDiff Lens overview: compare two versions, detect semantic drift, report structured findings with a drift score." width="880">
  </picture>
</p>

## What it answers

Not "what changed?" — a diff already tells you that. SameDiff Lens is built to answer the next layer of questions:

- **Where did the contract weaken?** Which lines softened a `must` into a `should`, narrowed a guarantee, or deferred enforcement?
- **Which commit was it?** Walk the full git history of a spec and mark the exact transition where the promise moved.
- **Is this drift coordinated?** Did auth, encryption, and audit all weaken together across a rollout window — a pattern no single finding reveals?
- **Is this signal or noise?** And if a reviewer already judged this step last quarter, can we remember their verdict?
- **Did the engine evolve?** If we retune detection, which previously-accepted verdicts need another human look?

That last one is the point. A governance tool that forgets is just a loud diff. SameDiff Lens is built to **observe → judge → preserve judgment** — so every rerun adds evidence instead of re-asking the same questions.

## The three-tier doctrine

Every report stacks three layers, theory above accusation above proof:

| Tier | Layer | Role |
| --- | --- | --- |
| 1 | **Thesis** — macro pattern | Optional. Fires only when multiple Issues coordinate across themes (e.g. *"Compliance controls relaxed for beta rollout"*). Anti-hallucination: headlines are drawn from a fixed catalog, never synthesized. |
| 2 | **Issue** — strongest accusation | The forensic headline. *"Severity downgraded on write path: error → warning"*, *"Audit guarantee removed"*, *"Rate-limit constraint introduced."* Every Issue cites its supporting Findings. |
| 3 | **Finding** — raw evidence | Deterministic heuristic output with full provenance: side, line range, snippet, honest quality label. |

Every tier cites the one below it. Thesis → Issues → Findings → source lines. Delete any link and the chain visibly breaks — which is what you want a trust primitive to look like.

## Core capabilities

### Semantic drift detection (deterministic)

Five heuristic passes on normalized text — no ML, no embeddings, no external calls:

1. **Commitment shifts** — modal strength changes (may → must), narrowing, operational detail
2. **Contradiction hinting** — same subject + opposite polarity; cross-section guards + weak-anchor demotion against false positives
3. **Concept renames** — high lexical overlap with changed key noun phrases
4. **Added / removed concepts** — unique tokens in focused phrase windows
5. **Action item / task drift** — TODO additions, removals, and checkbox transitions

Detectors are intentionally honest about their failure modes. Weak-anchor contradictions demote themselves. Cross-section matches need stronger evidence. Extractor-artifact noise gets demoted rather than headlined.

### Narrative interpretation

The narrative layer (`src/analysis/narrative/`) is a pure transformation over the raw finding set. It classifies, clusters, titles, and ranks — turning `{ contradiction, anchors: ["error","warning"] }` into `"Severity downgraded on write path: error → warning"`.

Anti-hallucination contract: every Issue carries `supportingFindings[]`; every title slot is either filled from evidence verbatim or falls back to the raw finding summary. Nothing is invented.

### Macro thesis layer

Above Issues sits the macro thesis. It fires only when:

- A **composite** pattern is recognized: two atomic themes (e.g. `security-weakened` + `staging-deferral-pattern`) each cross their cited-Issue floor, AND the union clears a minimum coordination bar.
- Or an **atomic** pattern has salience ≥ 1.4× the strongest single Issue.

Theses that don't earn the right to speak stay silent. Examples 01–05 fire no thesis. Example 06 fires *"Compliance controls relaxed for beta rollout"* with 7 cited Issues. Example 07 (multi-file) fires *"Reliability traded for rollout speed"* with 9 cited Issues spanning three files.

### Git history & trajectory audit

One file. Every commit that touched it. One chart.

```bash
samediff history docs/policy.md
```

Walks the full git history of `docs/policy.md` in chronological order, re-runs the engine on every pairwise transition, and emits:

- per-pair HTML reports pinned to `<NNNN>-<from>-<to>.html`
- an `index.html` with an inline SVG drift chart (score bars colored by severity, thesis-fired markers)
- a clickable timeline of every transition with short SHA, severity, thesis, top Issue, author, date
- `trail.json` — the machine-readable shape downstream tools consume

Use this to find *the commit* that weakened the contract. Not the line. The commit. Then feed the trail to `samediff audit` and turn it into a reviewable record.

### Scan → history → audit workflow

The full governance loop, each step a first-class subcommand:

```bash
samediff scan docs/ --top 10          # 1. Rank files by churn
samediff history docs/policy.md       # 2. Walk its history, emit the trail
samediff audit diffs/policy/          # 3. Generate a per-step judgment record
```

`scan` finds the specs worth auditing. `history` builds the trajectory. `audit` produces a compact markdown record — one terse block per transition (header, thesis, top Issue, every finding as a one-liner, changed lines only, verdict slot) — built so a reviewer can triage 50 steps in one sitting without context-scrolling.

**Persistent verdicts.** Reruns of `samediff audit` preserve prior human judgments in a `verdicts.json` sidecar. New steps are marked `[NEW]`; previously-judged steps carry their prior verdict forward; removed or altered steps are visibly surfaced. Engine evolution is auditable *against* prior judgment instead of silently overwriting it. See [*Persistent judgment*](#persistent-judgment) below.

### PR semantic reviewer (GitHub Actions, dogfooded)

This repo ships [`.github/workflows/pr-semantic-review.yml`](.github/workflows/pr-semantic-review.yml) — a `pull_request` workflow that runs SameDiff Lens on every PR to itself. No server, no GitHub App, no secrets. Just `GITHUB_TOKEN`, the built-in CLI, and an allowlisted set of high-signal markdown paths.

What it does:

1. Narrows changed files to a checked-in allowlist ([`tools/pr-review/paths.mjs`](tools/pr-review/paths.mjs))
2. Runs `samediff --git <base> -- <path>` for each, capturing `--json` + `--sarif`
3. Merges the per-file SARIF into one log and uploads to GitHub Code Scanning (`category: samediff-lens`)
4. Upserts a **sticky PR comment** (marker: `<!-- samediff-lens:pr-review -->`) so reruns update in place instead of spamming
5. Fails the required check **only on contradictions**. All other findings inform without blocking.

Fork-safe by construction: uses `pull_request`, not `pull_request_target`. Fork PRs skip the sticky comment (read-only token) but still emit SARIF and a step summary.

### SARIF 2.1.0 export

```bash
samediff --git origin/main -- docs/spec.md --sarif -o samediff.sarif
```

Mechanical renderer over `DiffResult`: every result's `physicalLocation.region` comes from finding provenance; the tool never invents a region it doesn't have. Removed-on-before findings point at the before file, not a fabricated after-side region. Unanchored findings appear as results *without* `physicalLocation` rather than with fake coordinates.

| Finding | `ruleId` | Level | Primary | Related |
| --- | --- | --- | --- | --- |
| commitment shift | `commitment-shift` | warning | after | before |
| contradiction | `contradiction` | error | after | before |
| concept rename | `concept-renamed` | note | after | before |
| concept added | `concept-added` | note | after | — |
| concept removed | `concept-removed` | note | **before** | — |
| action item added | `action-item-added` | note | after | — |
| action item removed | `action-item-removed` | note | **before** | — |

### Provenance & inspectability

Every finding carries structured provenance — which side, which line range, optional snippet, and an honest quality label (`exact` / `approximate` / `derived`). Findings that can't be located carry `provenance: null` instead of inventing a line number.

```jsonc
{
  "type": "commitment-shift",
  "evidence": { "before": "…should…", "after": "…must…", "triggers": ["strengthens"] },
  "provenance": {
    "anchors": [
      { "side": "before", "startLine": 2, "endLine": 2, "snippet": "…should validate…", "quality": "exact" },
      { "side": "after",  "startLine": 2, "endLine": 2, "snippet": "…must validate…",   "quality": "exact" }
    ],
    "quality": "exact"
  }
}
```

Terminal output, `--compact`, `--github`, `--html`, `--json`, and `--sarif` all share the same provenance spine. Anchors are the contract, renderers are cosmetic.

### Policy-as-contract (`.samediff.json`)

A repo declares its drift contract once, in-tree, and the same config governs local runs and CI:

```json
{
  "default_policy": "adoption",
  "policies": {
    "adoption": {
      "baseline": ".samediff-baseline.json",
      "include": ["commitment-shifts", "contradictions"],
      "fail_on": "score:4"
    },
    "strict":   { "fail_on": "commitment-shifts,contradictions" },
    "advisory": { "fail_on": null }
  }
}
```

Built-in policies (always available, override-able): `adoption` (new drift only, score ≥ 4), `strict` (any commitment shift or contradiction fails), `docs-only` (prose-tuned), `advisory` (report-only). Precedence is explicit — CLI flags > selected policy > top-level config > built-ins — so effective options are always traceable.

## Persistent judgment

Running `samediff audit` used to generate `audit.md` with a `**verdict**` slot per step — and then forget everything the moment the trail was regenerated. That's amnesia, not governance.

Memory is an identity problem wearing a UX hat. Before persisting any verdict, the system has to answer *what counts as "the same thing"?* — and answer it at two grains.

### Identity is the foundation

**Step identity:** `stepKey = sha256(fromRef || toRef || filePath)`. Stable across trail regeneration. Rebase-aware — if a commit is rewritten with a new parent, the stepKey changes, which is correct: it's a different transition now.

**Finding fingerprint:** `sha256` over the **semantic core only** — kind + normalized evidence (trim, collapse whitespace, case-fold). Engine-labelled metadata (`triggers`, `reason`, `confidence`) is deliberately excluded. This is the "same meaning → same fingerprint" contract:

- Engine retunes a contradiction's confidence from `medium` to `high`? Fingerprint unchanged. Verdict persists.
- Engine's triggers for a commitment-shift change from `["strengthens"]` to `["narrows","obligates"]`? Fingerprint unchanged. Verdict persists.
- Underlying evidence text shifts? Fingerprint changes. The prior finding becomes orphaned-within-step with its verdict preserved; the new finding is marked `[NEW]`; the step is tagged `[DRIFTED]` and prior step-level verdicts are carried forward with a re-review prompt — not silently rubber-stamped.

### The sidecar

`verdicts.json` lives next to `audit.md`. Schema v2:

```jsonc
{
  "version": "2",
  "steps": [
    {
      "stepKey": "sha256:...", "fromRef": "...", "toRef": "...",
      "verdict": { "value": "signal|fp|noise|unclear", "note": "...",
                   "setAt": "...", "engineVersionAtJudgment": "..." } | null,
      "findings": [
        { "fingerprint": "sha256:...", "kind": "commitment-shift",
          "verdict": { ... } | null, "firstSeenAt": "...", "lastConfirmedAt": "..." }
      ],
      "orphanedFindings": [ ... /* findings gone from this step, verdicts preserved */ ]
    }
  ],
  "orphanedSteps": [ ... /* transitions no longer in trail, verdicts preserved */ ]
}
```

v1 stores migrate transparently on first read.

### The roundtrip

Markdown is the canvas. Each finding line in `audit.md` carries a `{f:<12-hex>}` tag that identifies it durably across reruns. Reviewers edit two slots per step:

```markdown
**verdict**: signal
**note**: real narrowing — confirmed with legal
**finding-verdicts**:
- `a1b2c3d4e5f6` fp — extractor artifact: mid-sentence fragment
- `9abc12345def` noise
```

Rerun `samediff audit`. The CLI harvests edits from `audit.md`, persists them into `verdicts.json`, and re-renders with:

- `[NEW]` on steps and findings observed for the first time
- `[DRIFTED]` on steps whose findings changed since last review
- `*(carried from YYYY-MM-DD)*` annotations inline on preserved verdicts
- A populated `finding-verdicts` list (reviewers edit from last-known state, not from a prompt)
- An **Orphaned verdicts** section at the bottom for transitions or findings no longer live

Human review first, automation second. The data model diffs cleanly in git — every verdict, every fingerprint, every status change is a visible edit.

This is the foundation for the next layer — trend dashboards, reviewer-assistance, engine-regression gates. But the foundation first. Trust, then scale.

## Proof objects

Six example spectra under `examples/`, each a real artifact, not a toy:

| Example | Shape | What it proves |
| --- | --- | --- |
| `01-modal-shift` | pair | `may → must` detection, the simplest case |
| `02-todo-drift` | pair | Checklist transitions and action-item drift |
| `03-api-contract` | pair | Spec narrowing: broader guarantees turning specific |
| `04-prompt-policy` | pair | Behavioral contract drift on an LLM prompt |
| `05-hydra-doc-drift` | pair | Full architecture rewrite — stress test for cross-section guards |
| `06-staging-compliance` | pair | Macro thesis fires: *"Compliance controls relaxed for beta rollout"* (7 cited Issues) |
| `07-multi-file` | dir-pair | Cross-file composite thesis: *"Reliability traded for rollout speed"* |
| `08-policy-drift` | history | 8 real commits on a privacy policy, worst-score 8.8 (critical), drift chart + per-step reports |

Each one is checked in, regenerated by `examples/generate.sh`, and published to GitHub Pages via the `deploy-pages.yml` workflow. They are regression tests with a narrative.

## CLI reference

```
samediff <left> <right>                  Compare two files
samediff check <left> <right>            Same, explicit form
samediff - <right> | samediff <left> -   Read one side from stdin
samediff --git <ref> -- <file>           Compare ref:file vs working copy
samediff --git <old> <new> -- <file>     Compare old:file vs new:file
                                         ref can be EMPTY (or 4b825dc6...)
                                         to diff "from nothing"

samediff dir <left-dir> <right-dir>      Multi-file aggregate report
samediff scan [<dir>] [--top N]          Rank files by commit churn
samediff history <file> [-o <dir>]       Walk every commit pair; emit
       [--no-empty]                        per-pair HTML + index + trail.json
samediff audit <history-dir>             Generate audit.md + verdicts.json
       [--max-diff-lines N]                (preserves prior human verdicts)
       [--include-quiet]

samediff init [--force]                  Write a starter .samediff.json
samediff policies                        List available policies
samediff baseline <left> <right>         Write a baseline snapshot
```

**Output formats:** `--md`, `--html`, `--json`, `--sarif`, `--compact`, `--github`, `--stats`, `--score`, `-o <file>`

**Focus / noise:** `--only`, `--exclude`, `--baseline`, `--no-baseline`, `--no-narrative`

**CI gating:** `--fail-on any|score:N|<cats>|none`, `--exit-code` (legacy)

**Config / policy:** `--config <path>`, `--no-config`, `--policy <name>`, `--no-policy`

### Pipe-friendly outputs

```bash
samediff a.md b.md --compact          # one finding per line (CATEGORY\tdetail)
samediff a.md b.md --stats            # one-line key=value counts
samediff a.md b.md --github           # GitHub Actions annotations
samediff a.md b.md --json             # canonical structured DiffResult
```

The `--json` output is the canonical intermediate representation every renderer consumes — schema `"1"`, stable, with `policy` and `filters` blocks when a config/policy shaped the run.

## What this is / what this is not

**Is:**
- a governance primitive for semantic drift in technical intent
- a deterministic, inspectable heuristic analyzer
- a trust layer: anti-hallucination contract, full provenance, cited chains
- a local-first CLI + browser UI + CI workflow, all from the same engine

**Is not:**
- an LLM wrapper, a hosted service, or a collaboration platform
- a claim of deep semantic understanding
- a tool that invents regions, authors, or verdicts it doesn't have

## Run locally

Requirements: Node.js 20+, npm 10+.

```bash
npm install
npm run build:cli
./samediff docs/spec.md docs/spec.md.new

# Or via the Bazel entrypoints:
bazel run //:devserver
bazel run //:build
bazel run //:test
```

Tests: `npm test` (engine), `npm run test:cli` (CLI integration), both run on every PR.

## Browser UI

- [Live demo](https://henry-filgueiras.github.io/samediff-lens/)
- Local: `npm install && npm run dev`

The browser UI is a full-featured proof-object in its own right — load a built-in example, drop in two local `.md` / `.txt` files, or export a shareable report. Same engine as the CLI.

## Deploy to GitHub Pages

`.github/workflows/deploy-pages.yml` publishes `https://<owner>.github.io/samediff-lens/` including the six regenerated example spectra. `actions/checkout@v5` is pinned to `fetch-depth: 0` so `samediff history` sees the full commit graph.

## Repo shape

```text
bin/samediff.cjs              # CLI wrapper
src/analysis/                 # deterministic engine (shared CLI + browser)
src/analysis/narrative/       # classify → cluster → title → rank
src/analysis/narrative/macro/ # fixed-catalog thesis layer
src/cli/                      # subcommands, renderers, DiffResult spine
src/components/               # browser UI
examples/                     # proof objects (01–08)
tools/                        # tests + PR-reviewer helpers
.github/workflows/            # pr-semantic-review + deploy-pages
```

## Status

v0.7 — runnable, inspectable, dogfooded on itself. The engine is deterministic and narrow by design. The narrative and macro layers are conservative by design (silence beats a false accusation). The audit workflow now remembers what humans judged, which is the precondition for everything that comes next.

Feedback on false positives, false negatives, and confusing outputs is welcome via GitHub issues.
