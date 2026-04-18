# SameDiff Lens — Director's Notes

## Current State

SameDiff Lens is a dual-surface semantic diff tool: a browser UI (React+Vite, deployed to GitHub Pages) and a feature-rich CLI (`./samediff`) that runs the same heuristic analysis engine on local markdown/text files.

The core analysis engine in `src/analysis/` is shared between both surfaces. It performs deterministic, heuristic-based semantic diffing with no LLM or embedding dependencies.

**Identity shift (v0.4):** the CLI is no longer framed as "a diff tool with many flags" — it's **a primitive for a repo to declare and enforce its semantic-drift contract**. That contract lives in `.samediff.json` and is consumed identically by CI and local developers.

**Inspectability (v0.5):** every finding now carries structured **provenance** — which side, which line range, optional snippet, honest quality label. Findings are no longer locationless oracles; the tool can point back into the artifacts.

**Ecosystem portability (v0.6):** SARIF 2.1.0 export. Findings can now be emitted in the standard static-analysis interchange format, driven directly by DiffResult + provenance. GitHub code scanning and other SARIF consumers work without any bespoke glue.

**Dogfood loop (v0.6, session 8):** a `pull_request` GitHub Actions workflow runs SameDiff Lens on every PR to this repo. It narrows to high-signal markdown, uploads merged SARIF to Code Scanning, upserts one sticky PR comment, and fails the check on contradictions. No server, no GitHub App, no secrets — repo-native only.

**Narrative interpretation (v0.7):** `src/analysis/narrative/` is a pure transformation layer over `DiffResult` that promotes raw heuristic findings into ranked **Issues** with forensic-report framing ("Requirement reversed on logging", "Rate limit constraint introduced", "Audit guarantee removed"). The layer doesn't touch the engine — it classifies → clusters → titles → ranks, citing every underlying finding. Default-on in `--html` and `--json`; `--no-narrative` opts out. Anti-hallucination contract: every Issue carries `supportingFindings[]` back-pointers; every title slot is filled from evidence verbatim or falls back to the raw summary.

**Working surfaces:**
- CLI: `./samediff left.md right.md` (auto-builds if stale)
- CLI multi-file: `./samediff dir <left-dir> <right-dir>` (one aggregated report across many files)
- Browser: `npm run dev` or live at GitHub Pages
- Tests: 28 engine + 100 CLI + 24 PR-reviewer + 19 narrative + 11 multi-file = 182, all passing

**Repo-level configuration:**
- `.samediff.json` (walked up from cwd; stops at `$HOME` / filesystem root) declares a repo's drift contract
- Named policies: built-in (`adoption`, `strict`, `docs-only`, `advisory`) + user-defined
- `default_policy` auto-applies with no flags
- Precedence: explicit CLI flags > selected policy > top-level config > built-in defaults
- `--config <path>` / `--no-config` / `--policy <name>` / `--no-policy` escape hatches
- Subcommands: `init`, `policies`, `baseline`, `check`

**CLI capabilities:**
- Terminal output with colored drift cards and visual score bar
- `--html` — self-contained dark-theme HTML report (sharable, screenshot-worthy)
- `--md` — full Markdown report
- `--json` — structured machine-readable output (stable schema, canonical result contract)
- `--compact` — one finding per line, grep-friendly
- `--github` — GitHub Actions annotation workflow commands
- `--stats` — one-line key=value category counts
- `--score` — numeric drift severity (0–10)
- `--git HEAD~1 -- file.md` — diff against any git ref
- `--watch` / `-w` — live re-diff on file changes
- `-` as filename — read from stdin
- `--only` / `--exclude` — category focus filters
- `--baseline <json>` — subtract pre-existing findings; only NEW drift is shown & scored
- `--fail-on <spec>` — precise CI gating: `any`, `score:N`, or category list (combinable)
- `--exit-code` — legacy alias for `--fail-on score:1.1`
- `-o file` — write output to file

**Architecture:**
- Canonical `DiffResult` model in `src/cli/resultModel.ts` — the structured intermediate representation that JSON output renders directly, and that future renderers (CI bots, dashboards) can consume
- Engine → AnalysisResult → DiffResult → Renderer(s) pipeline

**Detection passes (all heuristic, no ML):**
1. Commitment shifts — modal strength changes (may→must), narrowing, operational detail
2. Task drift — TODO/checklist additions and removals
3. Concept rename — high lexical overlap with changed key noun phrases
4. Contradiction hinting — same subject + opposite polarity/negation flip
5. Added/removed concepts — unique tokens in focused phrase windows

**Example spectrum (examples/):**
01-modal-shift → 02-todo-drift → 03-api-contract → 04-prompt-policy → 05-hydra-doc-drift

**Test counts:** 28 engine tests + 105 CLI integration tests + 24 PR-reviewer tests + 19 narrative tests + 11 multi-file tests + 13 source-diff tests + 11 macro-thesis tests, all passing (211 total)

## Devlog

### 2026-04-17 — Claude Opus 4.7 — Two-ref --git form (no working tree needed)

`--git <ref> -- <file>` only compared `ref:file` against the working
copy, which forces a checkout dance when scripting bulk comparisons
across commits. New form:

```
samediff --git <old> <new> -- <file> [<file2>]
```

Compares `old:file` vs `new:file` directly via `git show`. Two-file
variant supports rename tracking: `old:file1` vs `new:file2`. The
working tree is never read.

Use case: loop over a list of files between two commits.
```bash
for f in docs/*.md; do
  ./samediff --git HEAD~5 HEAD -- "$f" --json -o "reports/$(basename "$f").json"
done
```

**Plumbing.** `parseGitArgs` now collects all non-flag tokens between
`--git` and `--`, accepting 1 or 2 refs (rejects 3+ with a clear
error). `resolveInputs` already had a both-sides-as-ref code path —
the 2-ref form falls into it naturally.

**Wrapper bug fixed alongside.** The bash `samediff` wrapper was
unconditionally path-resolving everything that didn't start with `-`
or `/`. For `--git`, that meant the ref AND the file got
`$ORIG_DIR/`-prefixed, which broke `git show` (refs aren't paths;
file paths must be repo-relative). The wrapper now tracks a
`git_mode` state machine: `refs` between `--git` and `--`, `files`
after `--`. Both pass through verbatim. Other flags after the file
list (e.g. `-o /tmp/out.html`) still go through normal flag handling.

The wrapper bug was latent — the existing test suite invokes `node
dist-cli/cli/index.js` directly, bypassing the wrapper. Anyone
running `./samediff --git HEAD -- file.md` from inside the repo with
a relative path would have hit it. Both forms work end-to-end now.

**Tests.** 5 new in `tools/cli.test.mjs`:
- two-ref form succeeds and produces the right labels
- `--json + two-ref` populates `gitRef` on both sides
- rename-tracking variant (`<old> <new> -- file1 file2`) works
- 3+ refs returns a clear "takes 1 or 2 refs" error
- missing newer ref errors cleanly

### 2026-04-17 — Claude Opus 4.7 — Macro thesis layer (doctrine above accusation)

Example 06 was producing precise per-issue accusations ("Policy reversed
on latency") that under-sold the *coordinated* drift across the doc:
auth weakened + encryption weakened + audit deferred + SLA softened —
all riding on "during the beta period" / "Phase 2" deferral language.
A single-issue headline can't carry that read. Added a macro layer that
synthesises a Thesis above the existing Issue layer.

**Three-tier doctrine** (theory → accusation → proof):
- Tier 1: **Thesis** — macro pattern, optional, only when earned
- Tier 2: **Issue** — strongest single accusation, always present
- Tier 3: **Finding** — raw evidence with provenance, always present

**Anti-hallucination via fixed catalog.** Macro headlines come from a
hand-tuned table in `src/analysis/narrative/macro/`:

- `atoms.ts` — 5 atomic themes (security-weakened,
  compliance-protections-relaxed, reliability-guarantees-removed,
  performance-commitments-softened, staging-deferral-pattern). Each
  has a fixed headline string and a deterministic `matches(issue)`
  predicate. Atoms need ≥3 cited Issues to fire.
- `composites.ts` — 6 composite themes that fire when two atoms both
  reach ≥2 cited Issues each AND the union is ≥3. Composite
  headlines are also fixed strings, e.g. "Compliance controls
  relaxed for beta rollout", "Reliability traded for rollout
  speed", "Production guarantees broadly weakened".
- `topicCategories.ts` — topic noun → family mapping (security /
  compliance / reliability / performance) plus the staging-deferral
  regex. Topics deliberately overlap (audit ∈ {reliability,
  compliance}; encryption ∈ {security, compliance}) so cross-family
  composites can pick up the natural cross.
- `directions.ts` — issue → "weakening" | "tightening" | "neutral"
  derived from kind, with required↔optional and modal-strength flips
  read off the evidence text verbatim.

**Earned threshold.** Macro never appears unless it's clearly stronger
than the best single issue:
- Composites get a free pass — their per-atom + union floors already
  encode coordination across themes
- Atom-only candidates must have salience ≥ 1.4× the top single
  issue, else the macro layer stays silent and Tier 2 carries the
  report

The result: examples 01–05 don't fire any thesis (their drift is
strong but not coordinated across themes), so the punchy per-issue
headlines stay in place. Example 06 fires "Compliance controls
relaxed for beta rollout" with 7 cited issues spanning audit +
encryption. Example 07 (multi-file) fires "Reliability traded for
rollout speed" with 9 cited issues spanning all three files.

**Citations are issue-id-only.** Thesis stores `citedIssueIds:
string[]` referring to `Issue.id` values, not finding refs. The chain
stays explicit — thesis cites issues, issues cite findings. Visible
provenance, no skipping levels. Issue cards in the HTML now carry
`id="issue-N"` anchors so citation chips on the thesis band link
straight to the supporting accusation below.

**Subheadline templating.** The only synthesised text is the
"Driven by N issues across {topic, topic, topic}" line, where N is
the cited count and the topic list is pulled verbatim from cited
issues' subjects. Test enforces that every word in `evidenceTopics`
appears in some cited issue.

**Multi-file aggregate.** `runMultiFile` runs the macro pipeline over
the union of every per-file `top + quiet` issues, with ids namespaced
to `<file>#<issue-id>` so they remain unique. Cross-file coordination
is often the strongest signal — the 07 demo fires a high-confidence
composite from issues spread across api.md / runbook.md / policy.md.

**Renderers.** `formatHtml.ts` adds a thesis-band block (gradient
background, severity-tinted left border, citation chips) above the
existing narrative-headline block. `formatMultiHtml.ts` mirrors it
on the aggregate page. The terminal `samediff dir` summary prints
a `THESIS:` line above the existing `HEADLINE:` line. Splash card
extractor (`examples/generate.sh`) prefers the thesis headline over
the per-issue headline when one exists.

**Two intentional gaps** documented in `atoms.ts`:
- Ownership-shift theme — needs ownership/role detection that
  doesn't exist in the engine yet (no `subject = team-name`)
- Tightening composites (mirror of weakening side) — easy to add
  later but the user-facing examples were all weakening cases

**Tests** — 11 in `tools/macro-thesis.test.mjs`:
- Anti-hallucination: every cited id resolves to a real Issue;
  every word in the macro headline appears in the fixed catalog;
  every evidence topic appears verbatim in some cited issue
- Conservative thresholds: single weakenings don't fire; scattered
  drift doesn't fire
- 06-secure-gateway end-to-end: composite fires, severity high or
  critical, single-issue headline preserved underneath
- Multi-file: aggregate composite fires, file-namespaced ids
  resolve, atom-only paths conform to catalog

### 2026-04-17 — Claude Opus 4.7 — Embedded source diff with finding cross-tags

Reading "Commitment weakened on logging" without seeing the actual line
churn forced the reader to context-switch to a separate diff tool. The
narrative now ships the diff alongside it.

**Algorithm.** New pure-TS `src/cli/sourceDiff.ts` — Hunt–McIlroy line
diff via LCS dynamic programming, then a hunk grouper that keeps
3 lines of context around each change and collapses long unchanged
stretches. `Int32Array` for the LCS table to keep the memory tight.
Caps at 4000 lines per side; over the cap returns null and the
renderer skips the section gracefully.

**HTML embedding.** `formatHtml.ts` gained a `leftText` / `rightText`
option pair; when both are provided, a "Source diff" `<details>`
section renders between the narrative and the raw category cards.
Default open if ≤80 changed lines, collapsed otherwise. Per-row layout
mirrors a unified diff: before-line + after-line gutters, +/- marker,
text. Skipped entirely for identical files (no-op section).

**Cross-tagging — the killer detail.** Each diff line whose 1-based
line number falls inside any finding's anchor range gets a
`has-finding` highlight (yellow inset border on the gutter) plus a
small `diff-finding-tag` chip naming the kind of finding ("commitment
shift", "contradiction", "added concept", "removed concept", "rename",
"task change"). Built by `collectAnchorMap` which walks every
evidence type and indexes anchors by side+line. Reader can scroll
through the diff and immediately see *which lines triggered which
accusations* — closing the loop between the narrative layer and the
underlying source.

**Multi-file plumbing.** `FileNarrative` now carries `leftText` /
`rightText`; `formatMultiHtml` passes them through to the per-leaf
`formatHtmlReport` call so each file iframe renders its own diff. The
top-level multi-file aggregate page does NOT render a diff — it's
not a single-file comparison, and the aggregate already cross-links
to per-file detail panels. JSON output of `samediff dir --json`
strips `leftText` / `rightText` from the per-file entries before
serialisation (large, only useful to the HTML renderer; JSON
consumers can re-read from `meta.leftRoot` + path).

**Tests** — 13 in `tools/source-diff.test.mjs`:
- LCS correctness: identity, pure insertion, pure deletion,
  modification, line-number tracking through interleaved changes.
- Hunk grouping: long unchanged stretches collapse, distant changes
  produce separate hunks.
- Memory cap: 5000-line input returns null instead of OOMing.
- HTML integration: diff section appears, hunks render, +/- rows
  exist, identical files produce no diff section.
- Cross-tagging: finding tags appear on changed lines that overlap
  finding anchors.
- Multi-file: leaf iframes embed diffs, top-level page does NOT.
- JSON strip: `leftText` / `rightText` are absent from `--json`
  output.

### 2026-04-17 — Claude Opus 4.7 — Pages publishes the example reports

Until now, the generated `findings.html` files lived only on a
contributor's local checkout. Anyone wanting to see them had to clone
the repo, install Node, and run the tool. The GitHub UI doesn't
render `.html` source files, so even committing them would have shown
up as raw markup in the file browser.

Folded report generation into the existing `deploy-pages.yml`
workflow instead. New steps after the existing `npm run build`:

1. `npm run build:cli` — compile the CLI used by `examples/generate.sh`
2. `bash examples/generate.sh` — produce every `findings.html`
3. Stage step — mirror every `examples/**/*.html` into `dist/examples/`
   and copy the source `*.md` alongside so a curious reader can compare
   the rendered report against the input that produced it

The existing `actions/upload-pages-artifact@v4` step already uploads
`dist/`, so no new permissions or secrets needed. After the next push
to `main`, the live URLs become:

- `<pages>/examples/findings.html` — the splash with all 7 example cards
- `<pages>/examples/<slug>/findings.html` — each per-example forensic report
- `<pages>/examples/07-multi-spec/findings.html` — the multi-file roll-up
- `<pages>/examples/<slug>/{left,right}.md` — the source files

Deliberately did NOT add a pre-commit hook for this:
- `examples/.gitignore` excludes `*.html` for a reason — checking
  them into git would bloat every commit by 100KB+
- The Pages action runs on every push to main, so the live reports
  stay in sync without contributor friction
- Pre-commit hooks can be skipped with `--no-verify`, the CI gate
  cannot

**Discoverability.** Two small bidirectional links so a visitor can
navigate between the live React app and the generated examples:
- App footer (`src/App.tsx`) gains a "Browse generated example reports"
  link pointing to `./examples/findings.html`
- Splash page footer (`examples/generate.sh`) gains a "← Back to
  SameDiff Lens" link pointing to `../`

Both are relative URLs that resolve correctly under the deployed
Pages base path (`/samediff-lens/`).

### 2026-04-17 — Claude Opus 4.7 — Multi-file roll-up (`samediff dir`)

Real docs live in directories, not file pairs. Added `samediff dir
<left> <right>` — walks both roots, runs the existing single-file
pipeline (analyze → DiffResult → narrative) on every matching `.md` /
`.markdown` / `.txt` file, and produces one aggregated `MultiFileReport`
with cross-file ranking.

**Roll-up shape (`MultiFileReport`).**
- `headline` — highest-salience top issue across all files, prefixed
  with its file path (`api.md — Requirement reversed on idempotency: …`)
- `severity` — max per-file severity
- `topIssues` / `quietIssues` — `AttributedIssue[]` (an `Issue` with a
  `file` field). Ranked by the same salience math used inside
  buildNarrative — kind-weight × confidence × severity boost.
- `files` — per-file `{ path, diff, narrative }`. The single-file
  narrative inside each entry is preserved verbatim, so inspectability
  is unchanged.
- `notices` — files present on only one side (`added-file` /
  `removed-file`). Surfaces structural drift that the per-file pipeline
  can't see.
- Stats roll-up: `fileCount`, `filesWithDrift`, `totalFindings`,
  `maxScore`, `avgScore`.

**HTML renderer (`formatMultiHtml.ts`).** Roll-up page with aggregate
headline band, fleet stats grid (worst score / avg score / files-with-
drift / total findings / top-issues count), structural-drift notices,
ranked top-issues list (each card linked to the file's detail panel),
and per-file collapsible `<details>` sections that embed the existing
single-file HTML report in an `<iframe srcdoc>`. Same dark/light
palette as the per-file report so the two surfaces feel like one
artifact.

**CLI surface.** New subcommand wired into `KNOWN_SUBCOMMANDS` and the
shell wrapper's pass-through list:
```
samediff dir <left-dir> <right-dir>          # forensic-style summary on stdout
samediff dir <left-dir> <right-dir> --html   # full roll-up HTML
samediff dir <left-dir> <right-dir> --json   # complete report
samediff dir <left-dir> <right-dir> -o file  # write to disk
```
The default summary is the terminal-friendly view (one-line stats +
ranked top issues + structural drift) — no flag needed for a quick
look. `--html` / `--json` opt into the full reports.

**Demo.** New `examples/07-multi-spec/` — a fictional Aurora
observability platform whose v2 docs (`api.md`, `runbook.md`,
`policy.md`) quietly relax every guarantee made in v1: required fields
become optional, SLAs replaced with aspirations, audit logging
deferred, encryption key rotation slowed from 90 days to annual, PII
allowed to leave the production VPC. The aggregate headline reads:
`api.md — Requirement reversed on idempotency: \`idempotency_key\`
(string, required) — must… vs … (string, optional) — recom…` — exactly
the kind of accusation a reviewer needs to see in one glance.

**Splash integration.** `examples/generate.sh` detects the v1/v2
shape and routes to `samediff dir` when present. The splash card
extractor gained fallback grep patterns (`stat-num` for score,
`agg-headline` for headline) so multi-file reports render correctly on
the splash alongside single-file ones.

**Bug surfaced and fixed along the way.** Large `--json` output (282
KB for 07-multi-spec) was being truncated to 64 KB on stdout because
`process.exit(0)` raced the unflushed pipe buffer. Switched the dir
command to `process.stdout.write(content, () => process.exit(0))` so
exit waits for drain. Latent in single-file code too but never hit in
practice because single-file JSON stays well under 64 KB.

**Tests.** New `tools/multi-file.test.mjs` (11 tests):
- Output shape (aggregate / files / notices / meta).
- Walker: recurses, includes `.md`, skips dotfiles + `node_modules` /
  `.git`.
- Aggregation: headline pulls from highest-salience file (not
  alphabetical); top issues ranked across files; severity = max
  per-file severity.
- Structural drift: files on only one side appear in `notices`; pure-
  structural-drift case synthesises a "Structural drift: N added, M
  removed" headline.
- Per-file integrity: each entry carries its own `diff` + `narrative`;
  every `AttributedIssue.file` resolves to a real per-file path.
- End-to-end: `examples/07-multi-spec` produces 3 files with drift,
  high/critical aggregate severity, and top issues spanning multiple
  files.

### 2026-04-17 — Claude Opus 4.7 — Checklist semantics: status changes, not add+remove

Markdown checklists (`- [ ]` / `- [x]`) are a structured mini-language.
The engine had been treating them as opaque strings, so `[ ] Foo` →
`[x] Foo` read at the diff level as "task removed + different task
added". A human reads it as "task completed". This was a semantic bug,
not a presentation bug — and the user explicitly wanted it fixed
upstream in the engine, not patched in narrative rendering.

**Engine change.** `compareActionItems` now first builds a
normalised-body index (`taskKey`) per side that strips checkbox
markers (`[ ]` / `[x]` / `[X]`), the `TODO:` prefix, and leading list
bullets. State (`open` / `completed`) is read separately by
`detectTaskState`. With body as identity and checkbox as state, the
six possible transitions become first-class:

```
[ ] → [x]         completed
[x] → [ ]         reopened
absent → [ ]      added-open
absent → [x]      added-completed
[ ] → absent      removed-open
[x] → absent      removed-completed
```

These are emitted as `actionItemsStatusChanges: TaskStatusChange[]` —
the new primary signal for checklist drift. The existing
`actionItemsAdded` / `actionItemsRemoved` string buckets are **still
populated for backward-compat**, but only with the simple add/remove
cases. **Toggle cases never appear there** — that's the whole point:
a checkbox flip is one event, not an add+remove pair.

Bare `TODO: foo` (no checkbox) is treated as open, so `TODO: Wire up
the dashboard` → `[x] Wire up the dashboard` correctly emits a
`completed` transition.

**DiffResult / scoring.** `findings.actionItemsStatusChanges` is a new
finding category with `transition`, `beforeState`, `afterState`,
`subject` (marker-stripped), and dual-side anchors. `counts` gains the
new field; `total` includes it. Scoring switches the action-item
contribution to use the status-change count when present (1 toggle = 1
event) and falls back to add+remove for legacy callers — avoids
double-counting the simple cases that appear in both places.

**Narrative.** Two new IssueKinds — `task-completed` and
`task-reopened` (weight 4 each, above the rename/churn baseline). The
narrative classifier now consumes only `actionItemsStatusChanges` for
task signals (skipping the legacy add/remove findings to avoid
duplicate issues). New `titleTaskTransition` template emits the
human-readable accusation per transition: "Task completed: …",
"Task reopened: …", "Task added (already completed): …",
"Completed task removed: …". The pure add/remove case still routes to
`task-scope-shift` so the existing churn-bucket behaviour is unchanged.

**Headline picker.** `synthesizeTaskHeadline` (the meta "Checklist
churn: N added, M removed" fallback) now reads transition tags from
trigger annotations and counts completed/reopened as well. Fallback
only fires when top consists of pure add/remove churn — a single
`task-completed` issue uses its own punchy title as the headline.

**HTML renderer.** Task Drift card prefers the rich status-change view
when available, with verb-tagged labels ("completed — Write integration
tests for auth flow"). Falls back to the legacy add/remove rendering
otherwise.

**Anti-hallucination contract.** The `subject` field on
`TaskStatusChange` is the original task body verbatim with marker
stripped — no synthesis. Templates fill the `{subject}` slot from this
field; if the engine couldn't extract a subject, the template falls
back to the raw form. Every narrative Issue still cites at least one
finding (now potentially a `task-status-change` ref), enforced by the
existing anti-hallucination test.

**Regression coverage.** Eight new tests in `tools/narrative.test.mjs`
cover all six transitions independently, the no-op same-state case,
and the bare-TODO matching case. The flagship test asserts that
`[ ] → [x]` produces exactly one `completed` status change, that
`actionItemsAdded` and `actionItemsRemoved` are both empty (the toggle
must not leak into legacy buckets), and that the narrative headline
reads "Task completed: Write integration tests for auth flow"
verbatim.

**Splash impact.** Example 02's splash card now reads "Task completed:
Write integration tests for auth flow" instead of the previous
"Checklist churn: 4 added, 2 removed". The latter is still synthesised
as a fallback when no completion is present.

### 2026-04-17 — Claude Opus 4.7 — Cross-section contradiction guard

The narrative layer's first headline on `06-secure-gateway-doc-drift`
was wrong: "Policy reversed on auth: **Performance**: Latency overhead
should not... → **Authentication**: Incoming requests should be...".
The narrative renderer was faithful — the bug was that
`detectPossibleContradictions` had emitted a `negation-flip` between
old line 10 (Performance) and new line 7 (Authentication), supported
only by `should` + `request` token overlap. Those are generic modal /
structural words, not subject continuity.

Two-layer fix:

**Engine guard (heuristics.ts).**
- New `STRUCTURAL_ANCHOR_TOKENS` set, broader than the existing
  `ANCHOR_GENERIC_TERMS`. Adds modal verbs (should/must/may/can/will/
  shall/would/could) and high-frequency agentless nouns (request,
  policy, service, data, value, default, case). Stripped from the
  shared-anchor set; an empty residual now rejects the pair.
- `Unit.section` field, populated by an extended `extractUnits` that
  walks lines tracking the most recent markdown heading and recognising
  inline `**Topic**:` (or `__Topic__:`) prefixes — the latter handles
  bullet-level sub-sections like `1. **Performance**: ...` that aren't
  real headings but *are* topic boundaries. `normalizeSectionLabel`
  strips markdown punctuation and lowercases.
- New cross-section guard inside `detectPossibleContradictions`: when
  both units carry sections and they disagree, require ≥2 strong shared
  anchors AND jaccard ≥ 0.18. Same-section pairs keep the original
  threshold so the existing legitimate detections all survive.

**Narrative defense-in-depth (buildNarrative.ts).** Added
`isWeakContradiction` quarantine: if an Issue traces to a contradiction
finding (carried via the `contradiction:<reason>` trigger tag set in
classify.ts), and `extractSubject` returns different non-empty subjects
for before vs after, and confidence isn't `high`, the issue is
relegated to the quiet bucket. Headline / top issues never see it.

**Anti-hallucination contract preserved.** No template was loosened.
Issues still cite raw findings; titles still fill slots only from
evidence verbatim. The fix narrows what gets *promoted*, not how it
gets *worded*.

**Regression coverage.** Two new tests in `tools/narrative.test.mjs`:
1. `06-secure-gateway: Performance line never pairs with Authentication
   line as a contradiction` — direct assertion that the original FP
   pair (in either direction) is absent from `findings.contradictions`,
   AND the legitimate same-section Performance reversal still fires,
   AND the headline isn't a Performance/Authentication mix.
2. `narrative quarantines weak contradictions whose before/after
   subjects disagree` — generic check across all examples that
   contradiction-derived top issues never mix `**Topic A**` on one side
   with `**Topic B**` on the other (unless confidence is high).

**Resulting headlines after the fix.**
- 06: now reads "Policy reversed on latency: **Performance**: Latency
  overhead should not exceed 50ms... → **Performance**: Latency
  overhead should be minimized" — the *real* hard-threshold-to-soft-
  aspiration reversal.
- 03: bonus improvement — the narrative now leads with "Requirement
  reversed on shipping_address" (same-section required↔optional flip
  surfaced through the cleaner anchor set).

### 2026-04-17 — Claude Opus 4.7 — Narrative interpretation layer

Raw heuristic findings were reading like compiler diagnostics
("negation markers changed around performance/latency", "must → should",
"centralized logging deferred") — technically accurate, but they left
the reader to *infer* why they mattered. The product goal has shifted:
surface narrative risk, not list findings. Think incident report, not
parser dump.

**The layer.** `src/analysis/narrative/` wraps `DiffResult` with a
`NarrativeReport { headline, severity, issues[], quiet[] }`. Four pure
stages, no engine changes:

1. **classify** — table-driven promotion from raw structured fields:
   `commitment-shift.evidence.triggers` → commitment-strengthening /
   weakening / scope-narrowed; `contradiction.reason` → commitment-reversal
   / policy-reversal / guarantee-removed / scope-narrowed; added/removed
   concept substantiveness gated by a topic lexicon + numeric/capacity
   language check.
2. **cluster** — conservative same-kind + same-subject merge (preferring
   topic nouns then backtick identifiers as the subject). Fallback exact-
   text dedup handles the case where the engine extracts three phrases
   from the same clause. Contradictions and renames never cluster.
3. **template** — per-kind title constructors that only fill slots from
   evidence verbatim. "Requirement reversed on logging: Logging is
   optional but recommended... vs Logging is required...". No synthesis
   of unseen content.
4. **rank** — `salience = kindWeight × confidenceMult × topicBoost ×
   clusterSizeBoost`. Topic lexicon *affects order only*, never the
   text of a claim — that's the guardrail against editorialising.

**Anti-hallucination contract.** Every Issue carries
`supportingFindings: FindingRef[]` pointers into `DiffResult.findings`.
`tools/narrative.test.mjs` enforces that pointers are real and in range
for every generated issue across all six examples. If a template can't
fill its slots from evidence, it falls back to the raw `summary`
string rather than inventing.

**Rendering.** `formatHtml.ts` gains a "Top finding" headline band, a
Top Issues section with severity-tinted left borders, a collapsible
"Quiet diff" bucket, and wraps the existing category cards in a
`<details>` labeled "Supporting details · raw findings by category".
Inspectability is preserved — the parser-dump view is one click away,
not replaced. `formatJson.ts` gains a top-level `narrative` field
(additive, non-breaking). Default-on in both; `--no-narrative` disables.

**Task-only fallback.** A pure-checklist diff (example 02) would
otherwise produce a blank Top Issues list — every finding is
`task-scope-shift`, which is normally quiet-bucketed. When nothing
else surfaces, up to 5 task changes are hoisted into Top and the
headline becomes "Checklist churn: N added, M removed".

**Evidence of the shift.**
- 01 modal shift: "Requirement reversed on logging: Logging is optional
  but recommended for debugging vs Logging is required for all
  production deployments"
- 03 API contract: "Rate limit constraint introduced: This endpoint is
  rate-limited to 100 requests per minute per customer"
- 04 prompt policy: "Policy reversed: You may offer opinions when asked
  → You must not offer personal opinions..."
- 06 secure gateway: "Audit guarantee removed: Every access attempt
  must be logged to the centralized audit-log..."

These read like accusations an engineer would stop scrolling for —
which was the whole point.

**Splash integration.** `examples/generate.sh` now extracts the
narrative headline from each generated report and shows it on the
splash card, so the stop-scrolling moment fires at the index level too.

**Minor shell-wrapper fix.** The `samediff` wrapper's staleness check
globbed `src/cli/*.ts src/analysis/*.ts` non-recursively, so edits
inside `src/analysis/narrative/` wouldn't trigger a rebuild. Switched
to a `find` so nested dirs are picked up.

### 2026-04-17 — Claude Opus 4.7 — Examples splash page

`examples/generate.sh` now emits a top-level `examples/findings.html`
splash in addition to the per-example reports. The splash is a grid of
cards, one per subdirectory, each linking to that example's
`findings.html`. Cards show the README title (first `# ` heading), the
difficulty line (`**Difficulty:** ...`), and the drift score + level
parsed directly out of the generated per-example HTML — so the splash
stays consistent with whatever the engine actually produced. Missing
README or unparseable score degrades to just slug + whichever pieces
are available. Same dark palette and `score-num` color classes as the
per-example report so the two surfaces feel like one artifact.

### 2026-04-16 (session 8b) — Contradiction false-positive filters

The very first live-ish run of the PR reviewer (session 8, dogfood branch
against main) exposed a class of false positives the contradiction heuristic
had been quietly producing all along: `docs/v0-contract.md` compared against
itself produced three contradictions. A file is not supposed to contradict
itself. That is the whole point of a diff tool.

Three stacked filters, each addressing a different FP class:

1. **Identity-invariance guard.** If both sentences of a candidate
   contradiction pair also appear verbatim on the opposite side, the
   "contradiction" is an artifact of intra-file structure (a title
   anchoring a prose negation; a narrowing bullet label elsewhere in
   the same doc) — not drift between versions. `samediff file.md
   file.md` now returns zero contradictions by construction. Lives in
   `detectPossibleContradictions` via per-side raw-unit sets; runs
   before the top-3 cap so it doesn't hide legit findings.

2. **Claim-shape guard.** Markdown headings (`raw.startsWith("#")`),
   HTML-only lines (`raw.startsWith("<")`), and short label fragments
   (< 4 content tokens, no commitment/action/directive signal) are
   excluded from contradiction cross-matching. A heading is a topic
   pointer, not a proposition; pairing `# SameDiff Lens v0 Contract`
   with a later clause about "v0" was generating the loudest FPs.

3. **Topical-overlap guard.** A contradiction requires the two
   sentences to be about the same topic, measured by Jaccard on
   content tokens. Threshold is 0.10 (slightly below matchUnits'
   0.12) — legit `required`↔`optional` flips often live in short
   sentences that share exactly one anchor (jaccard ≈ 0.11), and we
   want to keep those. The FP pair "big prose paragraph vs. five-token
   bullet label" scores ~0.04 and is suppressed.

**Tests added (6, all passing):**

- `multi-section identity self-compare produces no contradictions` —
  regression guard reproducing the exact dogfood pattern that broke.
- `drift-invariance suppression keeps real contradictions` — prose
  pair with a required↔optional flip must survive suppression.
- `drift-invariance suppression only fires when BOTH sides share the
  pair` — one-sided removal of a conflicting claim still fires.
- `markdown headings do not anchor contradictions against prose`.
- `HTML-only lines do not anchor contradictions`.
- `low-overlap pairs do not fire contradictions on coincidental
  buzzwords` — the "local" in "local storage" vs "local bug" case.

**Dogfood measurement (the reason for this session):**

Same PR, same files, before vs. after the filters:

| File | Contradictions before | Contradictions after |
| --- | --- | --- |
| `docs/v0-contract.md` | 3 | **0** |
| `README.md` | 3 | 3 |
| `DIRECTORS_NOTES.md` | 3 | 3 |
| **Total** | **9** | **6** |

`v0-contract.md` drops to zero. `README.md` and `DIRECTORS_NOTES.md`
stay at three each — but that's the slice(0, 3) cap talking; underlying
pair quality improved (headings no longer anchor findings, coincidental
buzzwords no longer anchor findings, identity-compare cases are gone).

**What the residual FPs look like (deferred work):**

The three-per-file residual on README/DIRECTORS_NOTES is a *different*
class of false positive: negation-flip asymmetry on topically-related
but compatible sentences. Example:

- A: "SameDiff Lens surfaces commitment shifts, task drift, concept
  renames, and possible contradictions."
- B: "Commitment shifts, concept renames, action-item drift are
  reported but do not block."

Both sentences are about the drift categories (topical overlap ~0.19).
A has no negation marker; B has "not" (in "do not block"). The
NEGATION-FLIP rule fires — but the two sentences don't actually
contradict. "Surfaces" and "reported" are compatible. The "do not
block" is gating behavior, not a flip of A's claim.

Closing this class requires the negation check to know whether the
negation is *attached to the shared anchor*, not merely present
anywhere in the sentence. That is NLP-adjacent work (dependency-ish
reasoning over sentence structure) and sits in its own session. In
the meantime the `advisory` / `strict` / `adoption` policies can all
be used to tune how aggressively this fires in CI.

**Key decisions & why:**

- **Ship narrow, well-tested filters; defer the deeper rule rewrite.**
  Each filter targets a specific, reproducible FP class with a
  visible test. The negation-flip rule rewrite is a bigger quest and
  doesn't belong in a calibration session.

- **Filter inside `detectPossibleContradictions`, not post-hoc.** The
  heuristic caps output at 3; post-hoc suppression would risk hiding
  legit contradictions behind FPs. Filtering during the cross-product
  respects the cap.

- **Jaccard threshold 0.10, not 0.12.** Slightly below matchUnits on
  purpose: legit `required`↔`optional` flips often share exactly one
  anchor in short sentences (jaccard ≈ 0.11). Breaking the
  01-modal-shift golden example would've been a worse regression than
  leaving a small gap below the matchUnits threshold.

- **Claim-shape treats markdown + HTML as structural.** Both are
  present in every README in this repo; both generated real FPs in
  the live dogfood run. The heuristic remains pure prose-first but
  now declines to cross-match against obviously non-prose units.

### 2026-04-16 (session 8) — PR semantic reviewer (dogfood loop)

The last several sessions built out ingredients — provenance, filters,
baselines, repo policy/config, SARIF — each useful on its own, none of
them closing a feedback loop on the repo itself. Session 8 closes that
loop: SameDiff Lens now reviews PRs in the repo that produces it.

This was the next quest for one concrete reason. Everything before
session 8 optimized for surface area (more renderers, more flags, more
export formats). Adding more of that without also using the tool on
real changes would have kept accreting feature breadth with zero signal
on whether any of it survives contact with real PRs. Dogfood first;
decide what to build next from what the dogfood exposes.

**What we built:**

- `.github/workflows/pr-semantic-review.yml` — `pull_request` trigger,
  conservative permissions, sticky-comment upsert, SARIF upload,
  contradiction gate. No secrets, no external services.
- `tools/pr-review/paths.mjs` — the allowlist predicate. README,
  DIRECTORS_NOTES, LAUNCH_NOTES, and `docs/**/*.md`. Deliberately
  narrow; expand when a path type proves out, not speculatively.
- `tools/pr-review/select-files.mjs` — stdin-to-stdout filter over the
  predicate. Consumed directly by the workflow.
- `tools/pr-review/analyze.mjs` — per-file orchestrator. Classifies
  each selected path as analyzed / skipped-new / skipped-deleted /
  error, runs the CLI in `--git`-diff mode, aggregates JSON, merges
  SARIF, writes an aggregate `index.json`.
- `tools/pr-review/sarif-merge.mjs` — single-run merger. Unions rule
  catalogs by id, concatenates results, re-derives aggregate counts
  and a max drift score.
- `tools/pr-review/comment.mjs` — pure, deterministic sticky-comment
  renderer. Produces the Markdown body from the aggregate index, with
  a stable `<!-- samediff-lens:pr-review -->` marker for upsert.
- `tools/pr-review/render-comment.mjs` — CLI wrapper around the
  renderer.
- `tools/pr-review/gate.mjs` — the contradiction gate. Reads the
  structured `index.json`, not the rendered comment — no grep theater.
- `tools/pr-review.test.mjs` — 19 tests covering allowlist behavior,
  stdin-CLI smoke, comment rendering determinism / blocking vs.
  advisory / no-op / skipped rollup / unanchored labeling / overflow
  caps, SARIF merge (concatenation, dedupe, empty-input tolerance),
  and gate.mjs exit codes.

**Key decisions & why:**

- **Narrow allowlist.** v1 targets markdown artifacts only — the
  shape of content where SameDiff Lens has a proven value (commitment
  shifts, contradictions, concept drift, todo drift read cleanly on
  prose). Extending to arbitrary source code or config would generate
  noise faster than signal and poison reviewer trust in the tool. The
  allowlist lives in one file so expansion is a single deliberate
  edit, not a sprawl of config knobs.

- **Contradictions gate, nothing else.** Contradictions are the
  highest-signal, lowest-false-positive category in the current
  heuristic catalog — and they are the only category whose default
  SARIF level is `error`. Making them the gate aligns the PR-review
  policy with the rule severities we already ship. Commitment shifts
  are load-bearing too, but they fire often enough that forcing them
  to block merges would turn the tool into a nag. Other categories
  inform but don't block. Repos that want stricter gating can point
  their required check at a stricter `samediff --fail-on` command.

- **One sticky comment, not line-by-line noise.** A recognizable
  HTML-comment marker lets the workflow find its prior comment and
  update it in place. Each push updates one comment instead of
  appending dozens. SARIF carries the per-line story for readers who
  want it; the comment stays a compact summary.

- **SARIF upload is the machine-readable path; the comment is the
  human path.** Reviewers on mobile or browsing quickly see the
  comment; reviewers inspecting specific lines see SARIF annotations
  inline. The two surfaces never contradict each other because both
  are derived from the same per-file JSON output.

- **`pull_request`, not `pull_request_target`.** The latter's implicit
  write-token access on untrusted PR code is a large blast radius for
  an advisory tool. `pull_request` means fork PRs get a read-only
  token — the comment upsert is skipped on forks (with a step notice)
  and `$GITHUB_STEP_SUMMARY` still carries the rendered content.
  Safer beats slicker.

- **Gate reads structured state, not rendered text.** `gate.mjs`
  consults `contradictionCount` in `index.json`. No grep over the
  comment body, no parsing of free-form output. If the sticky-comment
  renderer ever changes format, the gate keeps working.

- **Merged single-run SARIF.** Upload-SARIF accepts multi-run files,
  but a single merged run is easier for a human reading the Code
  Scanning alerts page. We union rule catalogs by id, concatenate
  results, and re-derive aggregate counts and max drift score.

- **Fork-safe degradation.** On same-repo PRs you get SARIF + sticky
  comment + gate. On fork PRs you get SARIF-upload-if-allowed + step
  summary + gate. The gate runs in both cases.

**What was validated (offline):**

- 19 new tests pass (`npm run test:pr-review`).
- `tools/pr-review/select-files.mjs` filters a stdin list correctly.
- `tools/pr-review/analyze.mjs --base HEAD~3 --files … --out-dir …`
  against real repo history produces a valid aggregate `index.json`,
  a merged SARIF with region-anchored results, and per-file JSON
  artifacts.
- `tools/pr-review/render-comment.mjs` reads that real index and
  produces the expected sticky-comment Markdown.
- `tools/pr-review/gate.mjs` exits 1 when `contradictionCount > 0`
  and 0 otherwise.

**What still needs a live PR run to confirm:**

- GitHub's `actions/github-script@v8` sticky-comment upsert: the logic
  is straightforward (paginate comments, find marker, update-or-
  create) but has not been exercised end-to-end against the real API.
- `github/codeql-action/upload-sarif@v3` acceptance of the merged
  SARIF artifact. Locally the SARIF validates against the 2.1.0
  schema; Code Scanning has additional constraints (relative URIs
  under the repo root, file existence at commit SHA) that only a real
  run can verify.
- Concurrency group cancellation behavior across rapid pushes.
- Whether GitHub honors the `paths:` trigger filter correctly when
  only tool files change (the filter lists both the allowlisted docs
  and the tool's own workflow / scripts to catch regressions, but
  live runs will show whether that intention carries through).

**Deferred, on purpose:**

- No support for arbitrary code file diffs — requires semantic value
  proven before expansion.
- No per-line "review comment" spray. SARIF carries per-line findings;
  the PR comment stays a summary.
- No baseline or repo-policy wiring from `.samediff.json` in the
  workflow. Each per-file run currently uses `--no-config` so results
  are predictable regardless of what gets added later. Wiring policy
  in is a one-flag change once we decide whether "advisory"/"strict"
  should be the workflow default.
- No separate severity thresholds for the gate (today: any
  contradiction blocks). Once we see real-PR volume we can decide if
  "score:N" gating is worth adding.
- No support for forked-PR sticky comments via a `workflow_run`
  relay. Possible to add later; the cost/benefit swung toward fork
  safety for v1.

**Test counts:** 20 engine + 100 CLI integration + 19 PR-reviewer =
139 tests, all passing.

Version remains 0.6.0 — the PR reviewer is infrastructure around the
existing CLI, not a new CLI surface.

### 2026-04-16 (session 7) — SARIF 2.1.0 export

SARIF was kept deliberately deferred until provenance existed, because
without source anchoring every SARIF result would either be locationless
or pinned to a fake region. Now that provenance is a first-class spine
feature, SARIF is what the last session promised it would be: a
mechanical renderer on top of DiffResult, not a second semantic universe.
Version 0.6.0.

**What we built:**
- `src/cli/formatSarif.ts` — a dedicated renderer consuming DiffResult.
  No re-analysis, no duplicate finding construction. DiffResult is the
  single source of truth; SARIF is a projection of it.
- `--sarif` CLI flag — first-class output format alongside `--json`,
  `--md`, `--html`, `--compact`, `--github`, `--stats`, `--score`.
  Composes with `-o`, `--policy`, `--baseline`, `--only`/`--exclude`,
  and `--fail-on`.
- Stable rule catalog with seven ruleIds, one per finding category:
  `commitment-shift`, `contradiction`, `concept-renamed`,
  `concept-added`, `concept-removed`, `action-item-added`,
  `action-item-removed`.
- Each rule has a default severity `level`:
    * `contradiction` → **error** (the dangerous signal)
    * `commitment-shift` → **warning** (implied-contract change)
    * everything else → **note** (informational drift)
  Consumers can override these per SARIF convention without touching
  our code.
- Artifact URIs are repo-relative when paths fall under `cwd` (ideal
  for GitHub code scanning upload), else `basename()`. Git-ref labels
  like `HEAD~1:spec.md` pass through unchanged.
- `run.properties` carries `driftScore`, `driftLabel`, `exitCode`,
  and `counts` — SameDiff-specific metadata that SARIF readers will
  ignore but that our own tooling and CI can consume.
- `result.properties.anchorQuality` carries `"exact"` / `"approximate"`
  / `"derived"` so consumers can tell how much to trust a region.

**Location mapping (the load-bearing decision):**

| Finding category | Primary location | Related location |
| --- | --- | --- |
| commitment-shift | after | before |
| contradiction | after | before |
| concept-renamed | after | before |
| concept-added | after | — |
| concept-removed | **before** | — |
| action-item-added | after | — |
| action-item-removed | **before** | — |

Before-only findings (removed concepts, removed action items) use
the *before* file as the primary `artifactLocation`. We intentionally
don't pin them to a line in the after file, which would be a lie —
the whole point of a "removed" finding is that it's not there anymore.

Unanchored findings still appear as SARIF results, but with no
`locations` array at all. Message + ruleId + level survive; the
region is omitted rather than invented. A SARIF viewer will show the
result without file attribution, which is the correct representation
of "we know this changed but we couldn't locate it."

When both sides are anchored (commitment shifts, contradictions,
dual-anchor renames), the primary location goes on the after side and
the before side is attached as a `relatedLocations` entry with a
descriptive message ("corresponding before location"). Single-sided
anchoring — or cases where the primary-side anchor wasn't found but
the other side was — does NOT emit a redundant relatedLocation; we
just use the anchor we have and don't pretend we have two.

**Key decisions & why:**

- **Consume DiffResult, not AnalysisResult.** DiffResult is already
  the canonical intermediate representation for the JSON contract.
  SARIF is another projection of the same thing. This keeps future
  schema changes propagating cleanly: evolve DiffResult once, every
  renderer follows.

- **One ruleId per category, stable across releases.** Not per
  heuristic, not per trigger. Finer-grained rules would be noisier,
  harder for consumers to configure (`rules.commitment-shift.level =
  "error"` is a single line in a SARIF config), and harder to evolve
  without breaking consumers. Trigger strings like "strengthens the
  commitment" ride along in the `message.text` where they belong.

- **No `ruleIndex` on results.** ruleId alone is sufficient for every
  SARIF consumer I can find; ruleIndex adds a fragile coupling between
  rule order and result fields for zero product benefit.

- **Repo-relative URIs, not `file://` absolute.** Absolute paths break
  GitHub code scanning upload (paths must match repo layout). Relative
  paths under cwd work out of the box. When files are outside cwd we
  fall back to `basename()` — honest and portable. Power users wanting
  a different base URI can post-process; we left a `SarifOptions.baseDir`
  hook on the renderer API for when we want to make this configurable.

- **Default severity once, in rule definitions.** SARIF lets you set
  `result.level` to override per-result. We don't, today. The rule-
  default approach makes the whole catalog reconfigurable from the
  outside (`tool.driver.rules[*].defaultConfiguration.level`) without
  any per-result noise.

- **`anchorQuality` in `result.properties`, not `result.rank` or
  anything schema-defined.** SARIF's rank field means "priority" not
  "confidence"; conflating the two would confuse consumers. `properties`
  is the SARIF-sanctioned extension point.

- **No SARIF schema validator in tests.** Pulling in `@sarif/sarif-nodejs`
  or similar just for tests would be heavy. Instead we assert shape
  specifics (version, required fields, rule catalog, location structure,
  level mapping). Matches the project's test philosophy: targeted and
  honest beats "we called a validator."

- **No auto-upload to code scanning.** The mission asked for shape
  compatibility, not a hosted integration. `--sarif -o foo.sarif` +
  a user's GitHub Action (3-line `github/codeql-action/upload-sarif@v3`
  snippet) is the right division of labor; we produce the file, they
  ship it.

**What SARIF preserves vs approximates vs omits:**

| Layer | Preserves exactly | Approximates | Omits |
| --- | --- | --- | --- |
| Tool metadata | name, version, informationUri | — | — |
| Rule catalog | id, name, short/full descriptions, default level | — | per-rule help beyond one URI |
| Result messages | full DiffResult message + triggers | long clauses truncated to 160 chars | markdown formatting (we emit plain `text`) |
| Locations | line/column from provenance when quality=exact | fuzzy-match line range when quality=approximate | locations entirely when provenance=null |
| Severity | per-category level | — | per-finding severity deltas |
| Evidence context | snippet (≤120 chars) | — | full before/after spans (stay in DiffResult JSON) |
| Score / counts | under `run.properties` | — | not mapped to SARIF's `rank` / `baselineState` (those mean different things) |

**Tests added (12 new, 100 total CLI):**
- Valid SARIF 2.1.0 shape + schema URI
- Full rule catalog present with correct IDs
- Rule default levels match the documented mapping
- Dual-anchor commitment shift: primary on right, related on left
- Removed concept: primary on **before** file; no fake after-file coords
- Added concept: primary on after file
- Unanchored case (identical files) → valid SARIF with empty results
- URIs are repo-relative (not absolute, not just basename)
- `anchorQuality` surfaces in `result.properties`
- `run.properties` carries drift score + counts
- `--sarif -o <file>` writes valid SARIF to disk
- `--sarif --json` → usage error (exit 2)

**Paths worth following next:**

1. **GitHub Action snippet** in docs/ showing how to upload
   `samediff.sarif` via `github/codeql-action/upload-sarif`. Tiny but
   high-leverage for users trying SARIF for the first time.

2. **`--sarif --append <file>`** to accumulate SARIF across multiple
   runs (multi-file directory mode will want this).

3. **`originalUriBaseIds`** with `%SRCROOT%` once directory mode lands —
   it's the canonical GitHub code scanning pattern for paths relative
   to repo root. Harmless to skip today since we already emit cwd-relative.

4. **Markdown messages** on SARIF results. We already populate `text`;
   adding a `markdown` variant would light up rich formatting in
   SARIF viewers that support it.

5. **Per-finding severity override** once the engine grows a sharper
   severity signal (e.g. "contradiction with high anchor overlap" vs
   "weak narrowing signal"). Today the score is per-run, not per-finding.

### 2026-04-16 (session 6) — Finding provenance / source anchoring

Findings now tell you *where* they came from. Before this session the
tool could say "commitment narrowed"; it couldn't say "on line 14 of
before.md and line 20 of after.md." That gap made the tool feel like
an oracle instead of an instrument, and blocked every downstream surface
(GitHub annotations, future SARIF, PR review UX) from pointing users at
the right lines. Version 0.5.0.

**What we built:**
- New `SourceAnchor` and `FindingProvenance` types in `src/analysis/types.ts`
- `src/analysis/provenance.ts` — a small pure module:
  - `buildLineIndex(text)` — offset→line lookup, O(n) once
  - `findAnchor(text, idx, query, side, label?)` — exact substring match
    with a whitespace/case-insensitive fallback
  - `anchorOnSide` / `anchorBothSides` — the high-level helpers
  - `formatAnchor` / `formatProvenance` — concise human formatters
    (`@ before:2 after:2`)
- Enrichment in `analyzeTextPair`: after the heuristics engine returns,
  the pipeline post-processes each finding by searching the evidence
  text inside the original sources and attaches a `provenance` field.
  The engine itself was not touched.
- DiffResult's finding types each gain a `provenance: FindingProvenance | null`
  field. The field is always present (null when unlocatable) so consumers
  don't have to key-check.
- Renderers updated:
  - Terminal: concise `@ before:L after:L` suffix on the metadata/trigger
    line under each finding. Drops gracefully to nothing when no anchors.
  - `--compact`: optional third tab field (`\t@before:L after:L`),
    preserving machine-parsability.
  - `--json`: full structured provenance on every finding.
  - `--github`: after-side line numbers become `line=`/`endLine=`/`col=`
    fields on the annotation command, so findings show up inline in PR
    checks at the right region instead of at file top.
- Filter pipeline extended to filter the action-item provenance sidecars
  alongside the action-item lists, so `--json` never surfaces stale
  provenance entries.
- Version bump 0.4 → 0.5.0 (in `package.json` + `resultModel.ts`).

**The provenance model (honest by design):**
```ts
type AnchorQuality = "exact" | "approximate" | "derived";

type SourceAnchor = {
  side: "before" | "after";
  startLine?: number; endLine?: number;
  startColumn?: number; endColumn?: number;
  snippet?: string; label?: string;
  quality?: AnchorQuality;
};

type FindingProvenance = {
  anchors: SourceAnchor[];
  quality?: AnchorQuality;
  note?: string;
};
```

- `exact` — evidence text found verbatim in the source
- `approximate` — found only after whitespace-collapse + case-fold
- `derived` — inferred (reserved; not emitted yet)
- Unlocatable → `provenance: null`. No invented numbers.

Lines and columns are 1-based. Multi-line matches get a proper
`startLine`/`endLine` span; `startColumn`/`endColumn` bracket the
literal match when available.

**Where provenance is populated:**
| Finding | Sides attempted | Source |
| --- | --- | --- |
| commitment shift | before + after | `versionA` → before, `versionB` → after |
| contradiction | before + after | same |
| concept rename | before + after (or one if the other is absent) | same |
| added concept | after only | `sourceClause` → after |
| removed concept | before only | `sourceClause` → before |
| action item added | after only | description string → after |
| action item removed | before only | description string → before |

**Key decisions & why:**

- **Post-process in `analyzeTextPair`, not inside the heuristics engine.**
  The engine is battle-tested and shared with the browser UI. Adding a
  second pass at the pipeline boundary keeps the invariant "heuristics
  are source-of-truth for what's a finding; provenance is enrichment."
  Also makes future provenance improvements (AST-based, token-window,
  etc.) a single-file change.

- **Text search via `indexOf` + whitespace-fuzzy fallback, not a
  parser.** We avoided a major parser rebuild. The existing evidence
  already contains the raw unit text; searching it in source is cheap
  and reliably lands on the right line. Approximate quality is labeled
  honestly.

- **Use the *original* (untrimmed) source text for line numbers.**
  `analyzeTextPair` trims internally for heuristics, but we index the
  pre-trim text so line numbers match what the user sees in their editor.
  Worth the extra pointer.

- **Action item provenance lives in a *sidecar* (`actionItemsAddedProvenance`),
  not on the strings themselves.** The existing `actionItemsAdded: string[]`
  shape is part of the public contract used by the browser UI and by the
  feedback issue body; changing it to an object array would break consumers.
  Sidecar maps keyed by description preserve the existing shape and let
  renderers opt in.

- **`provenance: null` on finding types, not `provenance?`.** Always-
  present, nullable. Means consumers can write `finding.provenance?.anchors`
  without a `"provenance" in f` check. Small ergonomic win.

- **GitHub annotations only use after-side anchors.** The `file=` field
  on annotations targets the right-hand file; pinning a removed-concept
  (which only exists in the before file) to a line in the after file
  would be misleading. We pin when we can and fall back to file-top when
  we can't.

- **Anchor length is snippet-truncated to 120 chars.** Longer snippets
  bloat JSON output; 120 chars is enough context for a human to
  recognize the region. Full text is still available under `evidence`.

- **No columns in human output.** `@ before:2 after:2` reads cleanly in
  a terminal; adding columns (`@ before:2:1-2:51`) would add noise for
  prose comparison where columns rarely matter. Columns are still in
  JSON for SARIF-ready consumers.

- **Fingerprints for baselines do NOT include provenance.** Line
  numbers drift as files evolve; if baseline fingerprints depended on
  them, a single edit above a finding would invalidate the whole
  baseline. Fingerprinting stays text-based.

**Why provenance before SARIF / directory mode / PR bot:**

Those follow-ons all *consume* provenance. SARIF needs `physicalLocation`
with line ranges. A PR-comment bot wants `line=` + snippet. Directory
mode wants to label cross-file findings. Building any of them without
anchors would have forced a rewrite later. This is the load-bearing
spine feature; everything downstream gets meaningfully more useful now.

**Tests added (17 total: 6 engine + 11 CLI, total now 108):**
- Commitment shifts carry dual before+after anchors
- Added concepts anchor only on after; removed concepts only on before
- Action item provenance sidecar has the right sides
- Missing-evidence case doesn't crash or invent anchors
- Anchor line numbers match actual source line content (end-to-end)
- `--json` provenance shape (sides, lines, columns, snippet, quality)
- `--compact` anchor tab field present when anchors exist, absent otherwise
- Terminal output shows `@ before:L after:L` suffix
- `--github` includes `line=` on after-anchored findings
- `--github` omits `line=` for before-only removed concepts

**Paths worth following next:**

1. **SARIF 2.1.0 export.** The provenance model maps almost 1:1 onto
   SARIF's `locations` / `physicalLocation` / `region` — it's now
   a mechanical renderer on top of DiffResult.

2. **Column-level snippet highlighting in `--github`.** Currently we
   set `line=`/`endLine=`/`col=`. Adding `endColumn=` would let GitHub
   highlight the exact drift region, not the whole line.

3. **Anchor-aware terminal UI.** A `--show-snippets` flag that prints
   the 1–3 lines around each anchor, with the matched span highlighted,
   would make the default output much more inspectable. The snippet
   field is already there.

4. **AST / markdown-structure anchoring.** For markdown specifically,
   anchors could point at header paths (`## API contracts > Retries`)
   instead of just line numbers — more robust against reflowing.
   Starts paying off when combined with directory mode.

5. **Anchor stability under whitespace edits.** Today, a trailing-
   whitespace edit doesn't break anchoring (fuzzy fallback), but
   paragraph reflows can cause "approximate" matches. A diff-aware
   anchor could use the pre-existing heuristic unit matcher as ground
   truth.

### 2026-04-16 (session 5) — Repo-level policy/config canonization

The prior session made the CLI CI-ready; this one makes it *repo-native*.
Before: every CI job hand-crafted a string of flags and hoped they stayed
consistent. After: the contract lives in one checked-in file, and a
developer's local run matches CI by construction. Version 0.4.0.

**The product-shape shift:**
SameDiff Lens stops being "a CLI with flags" and becomes "a primitive a
repo uses to declare what semantic drift means and enforce it over time."
That reframing is load-bearing. It changes the README, the subcommand
surface, the way CI snippets look in the docs, and the onboarding flow.

**What we built:**
- `.samediff.json` config file with walk-up discovery (stops at `$HOME`
  or filesystem root; capped at 10 levels)
- Built-in policies always available even without a config file:
  - `adoption` — baseline-aware; fails on NEW drift ≥ score:4 in commits
    / contradictions
  - `strict` — fails on any commit shift or contradiction
  - `docs-only` — commits + contradictions + concepts + todos; score:5
  - `advisory` — `fail_on: null`; reports only
- `default_policy` field in config → auto-applies without any CLI flag
- User-defined policies override same-named built-ins (`samediff policies`
  shows `(override)` next to these)
- New flags: `--config <path>`, `--no-config`, `--policy <name>`,
  `--no-policy`, `--no-baseline`, `--fail-on none`
- New subcommands: `samediff init`, `samediff policies`, `samediff baseline`,
  `samediff check` (explicit alias for bareword run)
- `--json` output gains an additive `policy` block when a policy shaped
  the run (name, source, config path)
- Gentle fallback when a policy-configured baseline path doesn't exist:
  prints a one-line note, continues without the baseline, doesn't crash.
  That preserves the `init → baseline → run` onboarding loop even if a
  user runs the middle step out of order.
- Provenance line on stderr (`SameDiff: config=..., policy=adoption
  (default)`) so users can always see which layers shaped the run

**Config shape:**
```json
{
  "baseline": ".samediff-baseline.json",
  "include": ["commitment-shifts", "contradictions"],
  "exclude": [],
  "fail_on": "score:5",
  "github": false,
  "compact": false,
  "stats": false,
  "default_policy": "adoption",
  "policies": {
    "adoption": { ... },
    "strict":   { ... },
    "advisory": { "fail_on": null }
  }
}
```

`$schema` at the top level is allowed and ignored, matching JSON-schema
conventions.

**Precedence (high to low):**
1. Explicit CLI flags
2. Selected policy block (via `--policy` or `default_policy`)
3. Top-level config block
4. Built-in defaults

Array fields (`include`, `exclude`) replace rather than union across layers.
Union would be confusing — "I said only concepts" shouldn't silently also
include whatever the policy had. Rationale encoded in resolveOptions.ts.

`fail_on: null`, `"none"`, `"never"`, `"off"` are all normalized to
"never fail." That covers what people actually type.

**Key decisions & why:**

- **Config file, not `.samediffrc` or `package.json#samediff`.** Keeping
  it `.samediff.json` makes it a first-class JSON artifact with its own
  `$schema` hook. Linters and editors can type-check it. `package.json`
  integration would conflate tool config with package metadata, and we
  want this file to feel as checked-in as `.eslintrc`.

- **Walk-up discovery, not just cwd.** Developers run the tool from
  subdirectories all the time. Stop at `$HOME` so we never cross into
  another repo or the user's dotfiles.

- **Built-in policies stay in code, not on disk.** Two reasons: (a) users
  get sensible defaults before they ever touch a config file, so
  `samediff --policy strict` works anywhere, and (b) the starter config
  from `samediff init` can be short and aspirational instead of dumping
  100 lines of defaults onto the repo.

- **No DSL.** I intentionally didn't build a rule engine. The config is a
  thin JSON veneer over the existing flag surface. If we later need
  per-file rules or regex matches, we can grow into it — starting with
  a richer config now would add complexity before we've seen real
  requirements.

- **Filters still operate on AnalysisResult.** The invariant from last
  session holds: every renderer sees the same filtered view, score and
  summary are recomputed, so `--policy adoption` + baseline yields
  "fail only on NEW drift ≥ score:4" without any special code paths.

- **`check` as an optional alias, not a required subcommand.** Bareword
  `samediff a.md b.md` still works. Forcing a subcommand would break
  everyone's muscle memory and every shell history. `check` is there
  for users who prefer explicit forms or for scripting clarity.

- **`init` writes an aspirational starter, not a lowest-common-denominator
  one.** It defaults to `adoption` because that's the mode that actually
  works for most repos on day one. "Strict" is right there as a policy
  for when they're ready.

- **Stderr provenance line is always on when a policy/config shaped the
  run.** Silent behavior is great when it matches expectations; it's
  actively harmful when it doesn't. One line on stderr costs nothing and
  lets developers see "oh, that's which policy fired" at a glance.

- **`baseline` subcommand takes `<left> <right>` instead of reading from
  config.** We thought about inferring from `--git` or config, but then
  the first-use flow becomes magic. Explicit paths are unambiguous and
  compose with `--git` cleanly (`samediff baseline a.md b.md -o ...`).

**Why policy/config before SARIF, line anchors, or directory mode:**

Those three are all valuable follow-ons, but they're **surface extensions**
— they add more ways to render or scope findings. The repo-as-policy-owner
reframing is a **product spine change**. Every adjacent feature gets more
valuable once a repo has a canonical contract:

- SARIF renders the output of a policy, not of an ad-hoc CLI run
- Line anchors make the findings inside a policy-shaped run more useful
- Directory mode is "apply the policy across N files"

So getting the spine right unlocks the follow-ons. Building SARIF first
would have produced a SARIF emitter tied to hand-crafted flag strings.
That's technical debt the moment a config file exists.

**JSON output additions (backwards-compatible):**
```jsonc
{
  // ... existing fields ...
  "filters": {
    "only": [...],
    "exclude": [...],
    "baseline": { "path": "...", "suppressed": 11 }
  },
  "policy": {
    "config": "/path/to/.samediff.json",
    "name": "adoption",
    "source": "default"  // or "cli"
  }
}
```

Both blocks are optional. Schema version stays at `"1"` — the contract is
additive.

**Tests added (22 new, 77 total CLI):**
- `policies` subcommand lists built-ins with no config
- `init` writes starter config; refuses to overwrite without `--force`
- `--policy strict` fails on commitment shifts; `--policy advisory` never fails
- Unknown policy / unknown category / invalid JSON / missing default_policy
  all exit 2 with clear messages
- Full adoption flow: `init → baseline → run` yields score 0.0
- Adoption policy without baseline: helpful note, still runs
- Precedence: CLI `--fail-on` / `--only` / `--no-baseline` override policy
- `--no-config` and `--no-policy` escape hatches
- Explicit `--config <path>` uses custom file
- Config can redefine a built-in policy by same name
- `policy` block appears in `--json` output
- `baseline` subcommand writes valid JSON, honors `-o`
- `check` subcommand is byte-identical to bareword invocation

**Paths worth following next:**

1. **Line/source anchoring** — the engine doesn't yet track where a finding
   originated. Adding a `location` field (`{ line, column, range }`) to
   findings would light up the `--github` annotations (currently pinned
   to file top) and enable proper inline PR review. This is the biggest
   UX unlock.

2. **SARIF 2.1.0 output** — now that the result model + policy story is
   settled, SARIF becomes a mechanical renderer. Plugs directly into
   GitHub code scanning and VS Code problems panel.

3. **Directory / glob mode** — `samediff --dir docs/` applies the current
   policy across N files, aggregates findings into one report. Config can
   declare `targets: ["docs/**/*.md"]`.

4. **PR-comment bot** — consume the JSON output, post a single collapsible
   PR comment with the findings. Tiny GitHub Action on top of `--json`
   + `--policy`.

5. **`samediff baseline --update`** — detect when the baseline is older
   than the files it covers and prompt to regenerate.

6. **Config schema publishing** — the `$schema` URL in the starter config
   is a placeholder. Host a real JSON Schema so editors get completion
   and validation on `.samediff.json`.

### 2026-04-16 (session 4) — CI-native developer surface

The CLI already did solid single-run diffing, but for anyone actually adopting it
on a shared repo, single-run isn't enough. Teams need noise control, gradual
adoption, and precise gating. That's what this session builds. Version bumped
to 0.3.0.

**What we built:**
- `--fail-on <spec>` — replaces the crude `--exit-code` threshold. Spec is
  comma-separated: `any`, `score:N`, or category names (with aliases like
  `commits`, `concepts`, `todos`, `all`). Combinable in one flag.
  `--exit-code` still works, aliased to `--fail-on score:1.1`.
- `--baseline <file.json>` — the gradual-adoption feature. Load a prior
  `--json` run, fingerprint every finding, and subtract matches from the
  current run. Score is recomputed from the filtered view, so pre-existing
  drift doesn't inflate the score or trip `--fail-on`. Baseline provenance
  (path + suppressed count) surfaces in `--json` output under `filters.baseline`.
- `--only <cats>` / `--exclude <cats>` — category filter, comma-separated,
  with aliases. Works with every output format. Score is recomputed.
- `--github` — emits GitHub Actions workflow commands (`::error::`,
  `::warning::`, `::notice::`). Commitment shifts and contradictions are
  errors; renames are warnings; the rest are notices. Messages are escaped
  per the workflow-commands spec.
- `--compact` — one finding per line, tab-separated: `CATEGORY\tdetail`.
  Grep-, awk-, `wc -l`-friendly.
- `--stats` — one-line key=value counts (`score=5.8 commitment-shifts=2 …`).
- stdin support — pass `-` as either filename to read from stdin
  (`cat draft.md | samediff - reference.md`).
- Format mutual exclusion — pass two format flags and the CLI errors out
  cleanly with exit code 2 instead of picking one silently.

**Key decisions:**
- **Filter pipeline operates on `AnalysisResult`, not `DiffResult`.** This
  means every existing renderer (terminal, md, html, json) sees the same
  filtered view without code changes. The alternative — pushing all
  renderers onto `DiffResult` — would have been a bigger refactor with
  regression risk. The current design delivers the feature immediately.
- **Score is recomputed from the filtered result, not the raw one.** This is
  what lets `--baseline` + `--fail-on score:5` behave the way a developer
  expects: "fail if NEW drift alone is ≥5". If we kept the raw score, the
  baseline feature would be half-useful — you'd see the filtered findings
  but still fail on pre-existing drift.
- **Summary is also rebuilt from the filtered result** (only when filters
  actually suppressed something, to avoid unnecessary work). Without this,
  the footer would still say "found 2 commitment shifts" after `--only
  contradictions` zeroed them out.
- **Fingerprints are normalized** (lowercased, whitespace-collapsed) so
  trivial edits don't break baseline matching. Contradiction anchors are
  sorted so anchor reordering doesn't break matching either. Fingerprints
  are intentionally opaque internal identifiers — not part of the public
  JSON schema.
- **Baseline JSON loader is lenient** — unknown top-level fields are ignored,
  missing categories are treated as empty arrays. Future schema evolution
  won't break old baselines.
- **`--github` uses `file=` on every annotation** (set to the right-hand
  file). We don't have line numbers for findings yet (the engine doesn't
  track source offsets), so GitHub will annotate at file top. That's still
  useful — it puts the finding in the PR Files tab. Adding real line
  numbers is a good next step, but needs engine changes.
- **Exit code 2 for usage errors** (bad --fail-on spec, unknown category,
  two format flags). Kept exit 1 reserved for "drift detected" so CI scripts
  can distinguish misconfiguration from real findings.
- **`--fail-on score:N` is `>=`, not strict `>`.** A developer reading
  "fail on score 5" naturally expects "5.0 fails." The legacy `--exit-code`
  (strict `> 1`) is preserved via the `score:1.1` alias.
- **No config file yet.** Tempting but out of scope for this session —
  the flag surface is the important thing to get right first. A `.samediffrc`
  layer on top is easy once the flags are stable.

**Why this matters:**
Before this session, the CLI could produce a report. Now it's a CI tool:
- "Gate PRs on contradictions but allow rename churn" → one flag
- "Start using this on a 5-year-old docs repo without bankruptcy" → baseline
- "Pipe findings into my existing tooling" → compact + stdin
- "Light up PR annotations without writing a GitHub Action" → `--github`

The underlying JSON schema didn't need to change; everything composes over
the existing `DiffResult` contract. The new `filters` field on JSON output
is additive and optional.

**Tests added (26 new, 55 total CLI):**
- `--only` / `--exclude` with single, comma-separated, and alias categories
- Filter recomputes score and respects `--json` output
- Unknown category exits with code 2
- `--fail-on any` / `score:N` / category / bad-spec paths
- `--fail-on contradictions` passes when contradictions are excluded
- `--baseline` suppresses findings, zeroes score, passes `--fail-on any`
- `--baseline` with non-JSON file errors cleanly
- `--compact` format shape, ANSI-free, composes with `--only`
- `--github` annotation shape and single-line invariant
- `--stats` one-line format
- stdin on left, stdin on right, both-stdin error
- Two-format-flag conflict errors with exit 2

**Paths worth following:**
- Push existing renderers (terminal, html, md) onto `DiffResult` so they can
  carry baseline provenance, finding-type discriminators, and schema-versioned
  guarantees. The groundwork is in place.
- `--sarif` for code scanning integrations (SARIF 2.1.0 is the lingua franca
  for security/lint tools on GitHub).
- Source line tracking through the engine so `--github` can annotate the
  exact line that changed. This is the biggest unlock for inline PR review UX.
- Config file (`.samediffrc`) for default flags + per-project ignore lists.
- Directory-mode: `samediff --dir docs/` to aggregate drift across many files.

### 2026-04-16 (session 3) — Structured JSON output + canonical result model

**What we built:**
- `--json` CLI flag: emits clean, stable, machine-readable JSON to stdout with no banners or ANSI
- Canonical `DiffResult` type (`src/cli/resultModel.ts`): the structured intermediate representation that bridges the analysis engine and output renderers
- `formatJson.ts` renderer: thin serialization layer over the result model
- Schema version field (`"version": "1"`) for forward compatibility
- Full provenance tracking: tool metadata, input labels/paths/gitRefs, timestamps
- Score with semantic label (`"low"` / `"moderate"` / `"high"` / `"critical"`) and exit code
- Category counts with a `total` field
- Per-finding type discriminators (e.g., `"type": "commitment-shift"`) for downstream consumers
- Evidence attached to every finding (before/after text, triggers, anchors, confidence)
- Works with all existing modes: `--json -o file`, `--json --git`, `--json --exit-code`

**Key decisions:**
- Introduced a `DiffResult` as an explicit intermediate model rather than just JSON.stringify-ing `AnalysisResult`. This keeps the JSON contract decoupled from internal engine types, meaning we can evolve either side independently
- Used `null` instead of `undefined` for optional fields (JSON has no `undefined`)
- Schema version `"1"` — bumping to `"2"` would signal breaking changes to consumers
- Did NOT refactor existing renderers (--html, --md, terminal) to use `DiffResult` yet. That's the natural follow-on but wasn't required for this task, and touching working renderers adds risk. The model is ready for them when we want it
- Findings carry a `type` discriminator to enable `switch(finding.type)` in consumers without guessing from context
- `counts.total` is a convenience field so consumers don't have to sum categories themselves

**What this unlocks:**
- GitHub Actions / CI integrations (parse JSON, gate on score or specific findings)
- PR comment bots (render findings as inline comments)
- Editor integrations (consume JSON, display inline diagnostics)
- Policy/gating logic beyond just exit codes (e.g., "fail if any contradiction found")
- Future dashboards and UIs that consume the same substrate
- Eventually: `--html` and `--md` can be rebuilt as renderers of `DiffResult`, completing the engine → model → renderer(s) layering

**Trade-off called out:** I built `DiffResult` as a new model that the JSON renderer uses, while leaving the HTML/md/terminal renderers on their current code paths consuming `AnalysisResult` directly. This is a deliberate short-term choice: it adds one more type to the codebase, but avoids risking regressions in working output modes. The path to full unification is clear and incremental.

**Tests added (10 new, 29 total CLI):**
- Valid JSON parsing
- Required top-level field presence
- Score range and label validation
- Counts ↔ findings array length consistency
- Type discriminator correctness
- Clean stdout (no ANSI, no banners)
- Identical files → zero drift
- Git mode + JSON combo
- File output (-o) + JSON combo
- Schema shape stability (exact key sets)

### 2026-04-16 (session 2) — Feature expansion: HTML reports, git integration, scoring, watch

**What we built:**
- `--html` output: self-contained HTML report with GitHub-dark theme, expandable cards, drift score meter, light/dark mode support via `prefers-color-scheme`. Single file, no external dependencies, screenshot-ready
- `--git` integration: `samediff --git HEAD~1 -- spec.md` compares working copy against any git ref. Supports `REF:path` syntax for comparing two refs
- Drift severity scoring: 0–10 scale using weighted formula (commitment shifts and contradictions weighted 1.5×, action items 0.5×, concepts 0.3×) with soft ceiling via exponential curve. Visual bar in terminal output
- `--exit-code` for CI: exits 1 if drift score > 1, enabling `samediff --git main -- spec.md --exit-code || alert`
- `--watch` mode: re-diffs on file changes using fs.watch with debounce, clears terminal between runs
- `-o` / `--out`: write any output format to file
- `--score`: print just the numeric score (pipe-friendly)
- Fixed `./samediff` wrapper to resolve relative paths from caller's cwd
- 5 example pairs spanning simple→advanced, standardized on left.md/right.md naming
- Expanded CLI test suite from 9 to 19 tests

**Key decisions:**
- Scoring uses exponential soft ceiling (`10 × (1 - e^(-raw/8))`) so the scale stays meaningful — a document can't just pile up findings to hit 10.0
- HTML report is fully self-contained: inline CSS, inline JS, no CDN dependencies. Works offline, can be emailed or dropped in PRs
- Git integration resolves `REF:path` specs via `git show`, keeping it simple and composable
- Watch mode watches directories (not just files) to handle editor save patterns (write-temp → rename)

### 2026-04-16 (session 1) — CLI proof object + repo coherency pass

**What we did:**
- Full archaeology sweep of existing repo (11 commits, 35 source files)
- Created CLI entry point (`src/cli/index.ts`) and formatted output (`src/cli/formatCli.ts`)
- CLI produces screenshot-worthy `Δ SameDiff Summary` output with colored sections
- Created example fixture under `examples/hydra-doc-drift/` with before/after markdown files that exercise all 4 detection passes
- Wrote initial CLI integration tests
- Fixed plural bug ("guesss" → "guesses") in summary builder
- Updated README to lead with CLI usage, added repo shape docs
- Version bump to 0.2.0

**Key decisions:**
- Did NOT modify the existing analysis engine or browser UI — additive only
- Used CommonJS compilation target + `dist-cli/package.json` override to avoid import extension conflicts with the ESM root package.json
- Kept `bin/samediff.cjs` as the npm bin wrapper to sidestep module system issues

**What we preserved:**
- Entire `src/analysis/` engine — untouched except the plural fix
- All UI components, golden examples, existing test suite
- Bazel targets, GitHub Pages deployment, screenshot tooling

## Dragons We've Slain

### ESM/CJS Module System Conflict
The root `package.json` has `"type": "module"` for Vite/React, but the CLI needs CommonJS output from `tsc` (since the existing source uses extensionless imports that don't work with Node16 module resolution). Solved by compiling to CJS and injecting a `dist-cli/package.json` with `"type": "commonjs"` during the build step. The `bin/samediff.cjs` wrapper handles the entry point.

### Relative Path Resolution in Shell Wrapper
The `./samediff` wrapper `cd`s into the repo root to find build artifacts, which broke relative file paths. Fixed by capturing the original `pwd` before `cd` and resolving non-flag arguments against it. Also passes `SAMEDIFF_ORIG_DIR` env var so the Node process can resolve `-o` output paths correctly.

### Plural Bug in Summary
`buildSummary` used a generic `plural()` helper that appends "s" — but "rename guess" + "s" = "guesss". Fixed with an explicit "es" branch for the rename count.
