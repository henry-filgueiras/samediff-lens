import type {
  CommitmentEvidence,
  ConceptEvidence,
  Confidence,
  ContradictionEvidence,
  MatchedPair,
  RenamedIdea,
  TaskState,
  TaskStatusChange,
  TaskTransition,
  Unit,
} from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "to",
  "up",
  "with",
]);

const HARD_BOUNDARY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "or",
  "that",
  "the",
  "their",
  "to",
  "up",
  "with",
]);

const GENERIC_TERMS = new Set(["system", "text", "version", "tool", "registry", "membership"]);
const ANCHOR_GENERIC_TERMS = new Set(["system", "text", "version", "tool"]);

/**
 * Tokens that are too generic on their own to establish that two
 * sentences are *about the same subject*. Stripped from the shared-anchor
 * set used by contradiction detection. If stripping leaves nothing
 * behind, the pair has no real subject continuity and isn't a candidate.
 *
 * Includes:
 *   - All ANCHOR_GENERIC_TERMS (system/text/version/tool)
 *   - Modal verbs (should/must/may/can/will/shall/would/could) — these
 *     pivot the polarity, they don't anchor a subject
 *   - High-frequency structural / agentless nouns that recur across
 *     unrelated bullet points in the same document (request, policy,
 *     service, data, value, default, case)
 */
const STRUCTURAL_ANCHOR_TOKENS = new Set([
  "system", "text", "version", "tool",
  "should", "must", "may", "can", "will", "shall", "would", "could",
  "request", "requests", "requested",
  "policy", "policies",
  "service", "services",
  "data", "value", "values",
  "default", "case", "cases",
  "thing", "things",
  "etc",
]);

const LEADING_VERBISH = new Set([
  "be",
  "is",
  "are",
  "was",
  "were",
  "retry",
  "retries",
  "store",
  "stores",
  "used",
  "use",
  "should",
  "must",
  "will",
]);

const DIRECTIVE_TOKENS = new Set(["challenge", "separate", "prefer", "avoid", "keep"]);

const ACTION_VERBS = new Set([
  "add",
  "audit",
  "build",
  "create",
  "document",
  "ensure",
  "fix",
  "implement",
  "move",
  "remove",
  "review",
  "ship",
  "test",
  "update",
  "write",
]);

const COMMITMENT_MARKERS = [
  "must",
  "should",
  "shall",
  "required",
  "optional",
  "will",
  "may",
  "can",
  "only",
  "up to",
  "at most",
  "at least",
];

const NARROWING_MARKERS = ["only", "up to", "at most", "limited to", "unless", "except"];
const NEGATION_MARKERS = ["not", "never", "no", "without", "instead"];
const EPISTEMIC_MARKERS = ["fact", "facts", "speculation", "assumption", "assumptions"];

const STORAGE_VERBS = new Set([
  "store",
  "stores",
  "stored",
  "keep",
  "keeps",
  "holds",
  "maintains",
  "manages",
  "owns",
]);

const DISTRIBUTED_VERBS = new Set([
  "gossip",
  "gossiped",
  "share",
  "shared",
  "distribute",
  "distributed",
  "replicate",
  "replicated",
  "broadcast",
]);

const MODAL_STRENGTH: Array<{ marker: string; score: number }> = [
  { marker: "optional", score: 0 },
  { marker: "may", score: 1 },
  { marker: "can", score: 1 },
  { marker: "should", score: 2 },
  { marker: "will", score: 3 },
  { marker: "required", score: 4 },
  { marker: "must", score: 4 },
  { marker: "shall", score: 4 },
];

const CLAUSE_SPLIT = /(?<=[.!?;])\s+/;
const BULLET_PREFIX = /^[-*•\d.)]+\s*/;
const TOKEN_PATTERN = /[a-z0-9]+/g;

// v0 note: every helper in this file is deliberately heuristic and deterministic.
// The goal is inspectability, not deep semantic understanding.

export function extractUnits(text: string): Unit[] {
  const units: Unit[] = [];
  let currentHeading: string | null = null;

  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = normalizeSectionLabel(headingMatch[2]);
    }

    // Inline `**Topic**:` (or `__Topic__:`) prefix wins over heading for
    // this line — it identifies the bullet's own subject. Allows an
    // optional bullet/list marker first ("1. **Performance**:").
    //
    // Two valid markdown variants we both accept:
    //   `**Topic**: rest…`   colon outside the bold delimiters
    //   `**Topic:** rest…`   colon inside the bold delimiters
    // The second form is what DIRECTORS_NOTES.md uses and was
    // previously slipping through unsection-tagged.
    const topicMatch =
      line.match(
        /^(?:[-*\u2022]|\d+[.)])?\s*(?:\*\*|__)([^*_\n]{1,80}?)(?:\*\*|__)\s*[:\u2014\u2013\u2010-]/,
      ) ??
      line.match(
        /^(?:[-*\u2022]|\d+[.)])?\s*(?:\*\*|__)([^*_\n]{1,80}?)[:\u2014\u2013\u2010-]\s*(?:\*\*|__)/,
      );
    const lineSection = topicMatch
      ? normalizeSectionLabel(topicMatch[1])
      : currentHeading;

    for (const raw of splitLineIntoUnits(line)) {
      const u = buildUnit(raw);
      u.section = lineSection;
      units.push(u);
    }
  }

  return units;
}

function normalizeSectionLabel(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitLineIntoUnits(line: string): string[] {
  const withoutBullet = line.replace(BULLET_PREFIX, "").trim();

  return withoutBullet
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildUnit(raw: string): Unit {
  const normalized = normalize(raw);
  const tokens = tokenize(normalized).map((token) => stemToken(token));
  const contentTokens = tokens.filter((token) => isContentToken(token));
  const firstToken = tokens[0] ?? "";
  const imperative = looksImperative(raw, firstToken);

  return {
    raw: raw.replace(/[.;!?]+$/g, "").trim(),
    normalized,
    tokens,
    contentTokens,
    isActionItem:
      /^[\s-]*\[[ x]\]/i.test(raw) ||
      /^todo[:\s-]/i.test(raw) ||
      imperative,
    isCommitmentLike:
      containsAny(raw, COMMITMENT_MARKERS) ||
      /^be\b/i.test(raw) ||
      containsAny(raw, ["always", "never", "required", "optional"]),
    isDirectiveLike:
      /^be\b/i.test(raw) ||
      imperative ||
      /\b(challenge|separate|prefer|avoid|keep)\b/i.test(raw),
  };
}

/**
 * "Looks imperative" — used as a fallback signal for action-item /
 * directive detection on lines that aren't checkbox-prefixed or
 * `TODO:`-prefixed.
 *
 * The raw heuristic ("first token is in ACTION_VERBS and line is
 * short") was triggering on declarative sentences like
 * `Tests.** 5 new in tools/cli.test.mjs:` and `Added a macro layer
 * that…` because the stemmer maps `tests → test` and `added → add`,
 * both of which are in ACTION_VERBS. Sentence fragments that happen
 * to start with a plural noun or past-tense verb were being
 * mis-classified as action items.
 *
 * Tightened rules — all must hold:
 *   - first stemmed token must be in ACTION_VERBS
 *   - the original (pre-stem) word must not end in -s / -ed / -ing
 *     (rules out plural nouns and past-tense / gerund usage)
 *   - line length < 140 (action items are usually short)
 *   - no early markdown punctuation (`*`, `_`, `:`, `\``) within the
 *     first 30 chars — those signal labels, headings, or doc structure
 *   - no copula or auxiliary (`is/are/was/were/has/have/been/being`)
 *     — those signal declarative statements, not commands
 */
function looksImperative(raw: string, firstStem: string): boolean {
  if (!ACTION_VERBS.has(firstStem)) return false;
  if (raw.length >= 140) return false;
  // Early markdown punctuation usually signals labels / headings / code
  // spans rather than commands. 60-char window catches lines like
  // "Test enforces that every word in `evidenceTopics`" where the
  // backtick sits past the first 30 chars.
  if (/[*_:`]/.test(raw.slice(0, 60))) return false;
  if (/\b(is|are|was|were|has|have|been|being)\b/i.test(raw)) return false;
  const originalFirst = raw.match(/^\s*([A-Za-z]+)/)?.[1] ?? "";
  // Reject -ed (past tense), -ing (gerund), and trailing -s (plural noun
  // or 3rd-person singular), but keep -ss intact (e.g. "address").
  if (/(ed|ing)$/i.test(originalFirst)) return false;
  if (/[^s]s$/i.test(originalFirst)) return false;
  return true;
}

export function matchUnits(aUnits: Unit[], bUnits: Unit[]): MatchedPair[] {
  const candidates: MatchedPair[] = [];

  aUnits.forEach((a) => {
    bUnits.forEach((b) => {
      const similarity = jaccard(a.contentTokens, b.contentTokens);

      if (similarity >= 0.12) {
        candidates.push({ a, b, similarity });
      }
    });
  });

  const takenA = new Set<string>();
  const takenB = new Set<string>();

  return candidates
    .sort((left, right) => right.similarity - left.similarity)
    .filter((candidate) => {
      if (takenA.has(candidate.a.raw) || takenB.has(candidate.b.raw)) {
        return false;
      }

      takenA.add(candidate.a.raw);
      takenB.add(candidate.b.raw);
      return true;
    });
}

export function getUnmatchedUnits(units: Unit[], pairs: MatchedPair[], side: "a" | "b"): Unit[] {
  const matchedValues = new Set(pairs.map((pair) => pair[side].raw));
  return units.filter((unit) => !matchedValues.has(unit.raw));
}

function isCandidatePhrase(tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  if (
    tokens.length > 1 &&
    !(tokens[0] === "up" && tokens[1] === "to") &&
    (HARD_BOUNDARY_STOP_WORDS.has(tokens[0]) ||
      HARD_BOUNDARY_STOP_WORDS.has(tokens[tokens.length - 1]))
  ) {
    return false;
  }

  const contentWords = tokens.filter((token) => isContentToken(token));

  if (contentWords.length === 0) {
    return false;
  }

  if (tokens.length === 1) {
    return (
      !GENERIC_TERMS.has(tokens[0]) &&
      !LEADING_VERBISH.has(tokens[0]) &&
      (tokens[0].length >= 4 || /\d/.test(tokens[0]))
    );
  }

  if (GENERIC_TERMS.has(tokens[0]) || LEADING_VERBISH.has(tokens[0])) {
    return false;
  }

  return true;
}

export function detectConceptChanges(
  primaryUnits: Unit[],
  secondaryUnits: Unit[],
  limit = 4,
): ConceptEvidence[] {
  const secondaryContent = new Set(secondaryUnits.flatMap((unit) => unit.contentTokens));
  const candidates = primaryUnits.flatMap((unit) => {
    const uniqueTokens = unit.contentTokens.filter(
      (token) => !secondaryContent.has(token) && !GENERIC_TERMS.has(token),
    );

    if (uniqueTokens.length === 0) {
      return [];
    }

    return extractFocusedPhrases(unit.raw, uniqueTokens);
  });

  return candidates
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, allCandidates) => {
      return !allCandidates
        .slice(0, index)
        .some((chosen) => chosen.phrase.includes(candidate.phrase));
    })
    .map((candidate) => ({
      phrase: candidate.phrase,
      sourceClause: candidate.sourceClause,
    }))
    .slice(0, limit);
}

export function extractActionItems(units: Unit[]): string[] {
  return uniqueStrings(units.filter((unit) => unit.isActionItem).map((unit) => unit.raw));
}

/**
 * Compare two lists of action-item raw strings, treating markdown
 * checklists as a structured mini-language: the body of the task is
 * the identity, the `[ ]` / `[x]` / TODO marker is its state.
 *
 * The richer return shape (`statusChanges`) is the primary output and
 * captures all six transitions:
 *     [ ] → [x]         completed
 *     [x] → [ ]         reopened
 *     absent → [ ]      added-open
 *     absent → [x]      added-completed
 *     [ ] → absent      removed-open
 *     [x] → absent      removed-completed
 *
 * `added` / `removed` are kept for backward compatibility with renderers
 * and consumers that still want flat string lists. **They contain only
 * the simple add/remove cases — toggles do NOT appear there.** That is
 * the whole point of this normalisation: a checkbox flip is one event,
 * not two.
 */
export function compareActionItems(
  aItems: string[],
  bItems: string[],
): {
  statusChanges: TaskStatusChange[];
  added: string[];
  removed: string[];
} {
  const aMap = indexTasks(aItems);
  const bMap = indexTasks(bItems);

  const statusChanges: TaskStatusChange[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  const allKeys = new Set<string>([...aMap.keys(), ...bMap.keys()]);

  for (const key of allKeys) {
    const a = aMap.get(key);
    const b = bMap.get(key);

    if (a && b) {
      if (a.state === b.state) continue; // unchanged — not drift
      const transition: TaskTransition =
        a.state === "open" && b.state === "completed" ? "completed" : "reopened";
      statusChanges.push({
        subject: stripTaskMarker(b.raw) || stripTaskMarker(a.raw),
        transition,
        beforeState: a.state,
        afterState: b.state,
        beforeRaw: a.raw,
        afterRaw: b.raw,
      });
      continue;
    }

    if (b && !a) {
      const transition: TaskTransition =
        b.state === "completed" ? "added-completed" : "added-open";
      statusChanges.push({
        subject: stripTaskMarker(b.raw),
        transition,
        beforeState: null,
        afterState: b.state,
        beforeRaw: null,
        afterRaw: b.raw,
      });
      added.push(b.raw);
      continue;
    }

    if (a && !b) {
      const transition: TaskTransition =
        a.state === "completed" ? "removed-completed" : "removed-open";
      statusChanges.push({
        subject: stripTaskMarker(a.raw),
        transition,
        beforeState: a.state,
        afterState: null,
        beforeRaw: a.raw,
        afterRaw: null,
      });
      removed.push(a.raw);
    }
  }

  return { statusChanges, added, removed };
}

function indexTasks(items: string[]): Map<string, { state: TaskState; raw: string }> {
  const m = new Map<string, { state: TaskState; raw: string }>();
  for (const raw of items) {
    const key = taskKey(raw);
    if (!key) continue;
    // First occurrence wins. Duplicate identical tasks within one side
    // would otherwise inflate change counts.
    if (!m.has(key)) m.set(key, { state: detectTaskState(raw), raw });
  }
  return m;
}

/**
 * Identity key for a task — its body, normalised. Strips the checkbox
 * marker, the `TODO:` prefix, leading list bullets, and lowercases /
 * collapses whitespace. Two tasks with the same body but different
 * checkbox states share the same key.
 */
function taskKey(raw: string): string {
  return raw
    .replace(/^\s*[-*\u2022]\s*/, "")            // leading list bullet
    .replace(/^\[[ xX]\]\s*/, "")               // checkbox marker
    .replace(/^todo\s*[:\-\u2014]?\s*/i, "")     // TODO prefix
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Display-friendly version of the task body — preserves original casing
 * but strips the marker. Used as the `subject` field on the resulting
 * TaskStatusChange so renderers can say "Task completed: Write
 * integration tests for auth flow" verbatim.
 */
function stripTaskMarker(raw: string): string {
  return raw
    .replace(/^\s*[-*\u2022]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/^todo\s*[:\-\u2014]?\s*/i, "")
    .trim();
}

/**
 * Read the task's state from its raw form. `[x]` / `[X]` is completed;
 * `[ ]` and bare `TODO: ...` (no checkbox) are both open. The latter is
 * intentional — a bare TODO is a thing-to-do, semantically open.
 */
function detectTaskState(raw: string): TaskState {
  if (/^\s*[-*\u2022]?\s*\[[xX]\]/.test(raw)) return "completed";
  return "open";
}

export function detectChangedCommitments(pairs: MatchedPair[]): CommitmentEvidence[] {
  const findings = pairs.flatMap(({ a, b }) => {
    const notes: string[] = [];

    if (!containsAny(a.raw, NARROWING_MARKERS) && containsAny(b.raw, NARROWING_MARKERS)) {
      notes.push("narrows scope");
    }

    if (!hasOperationalDetail(a.raw) && hasOperationalDetail(b.raw)) {
      notes.push("adds operational detail");
    }

    const bHasModal = containsAny(b.raw, MODAL_STRENGTH.map(({ marker }) => marker));
    const aHasModal = containsAny(a.raw, MODAL_STRENGTH.map(({ marker }) => marker));
    const strengthDelta = modalStrength(b.raw) - modalStrength(a.raw);
    if ((aHasModal || bHasModal) && strengthDelta >= 2) {
      notes.push("strengthens the commitment");
    } else if (bHasModal && strengthDelta <= -2) {
      notes.push("softens the commitment");
    }

    if (!containsAny(a.raw, EPISTEMIC_MARKERS) && containsAny(b.raw, EPISTEMIC_MARKERS)) {
      notes.push("adds epistemic guardrails");
    }

    if (directiveVerbCount(b.raw) > directiveVerbCount(a.raw) + 1) {
      notes.push("adds behavioral directives");
    }

    if (
      notes.length === 0 &&
      (a.isCommitmentLike || b.isCommitmentLike || a.isDirectiveLike || b.isDirectiveLike)
    ) {
      const bUnique = difference(b.contentTokens, a.contentTokens);
      if (bUnique.length >= 2) {
        notes.push("changes the implied contract");
      }
    }

    if (notes.length === 0) {
      return [];
    }

    return [
      {
        summary: `${shorten(a.raw)} -> ${shorten(b.raw)} (${notes.join(", ")})`,
        versionA: a.raw,
        versionB: b.raw,
        triggers: notes,
      },
    ];
  });

  return uniqueEvidenceByKey(findings, (item) => item.summary);
}

export function detectRenameIdeas(pairs: MatchedPair[]): RenamedIdea[] {
  const findings: RenamedIdea[] = [];

  pairs.forEach(({ a, b, similarity }) => {
    const sharedAnchors = intersection(a.contentTokens, b.contentTokens).filter(
      (token) => !ANCHOR_GENERIC_TERMS.has(token),
    );
    const fromTokens = difference(a.contentTokens, b.contentTokens);
    const toTokens = difference(b.contentTokens, a.contentTokens);

    if (sharedAnchors.length === 0 || fromTokens.length === 0 || toTokens.length === 0) {
      return;
    }

    const fromPhrase = pickFocusedPhrase(a.raw, fromTokens);
    const toPhrase = pickFocusedPhrase(b.raw, toTokens);

    if (
      !fromPhrase ||
      !toPhrase ||
      fromPhrase === toPhrase ||
      fromPhrase.split(" ").length > 3 ||
      toPhrase.split(" ").length > 3 ||
      containsDirectiveToken(fromPhrase) ||
      containsDirectiveToken(toPhrase)
    ) {
      return;
    }

    const confidence: Confidence =
      similarity >= 0.45 ? "high" : similarity >= 0.22 ? "medium" : "low";

    findings.push({
      from: fromPhrase,
      to: toPhrase,
      confidence,
      note: `Shares context around ${sharedAnchors.slice(0, 2).join(", ")}.`,
      sharedContext: sharedAnchors,
      versionA: a.raw,
      versionB: b.raw,
    });
  });

  return uniqueRenameIdeas(findings);
}

export function detectPossibleContradictions(aUnits: Unit[], bUnits: Unit[]): ContradictionEvidence[] {
  const findings: ContradictionEvidence[] = [];

  // Drift-invariance guard: if both sentences of a cross-product pair also
  // exist verbatim on the opposite side, the "contradiction" is an artifact
  // of intra-file structure (e.g. a title anchoring a prose negation, or a
  // narrowing bullet-label elsewhere in the same doc) — not drift between
  // versions. This lookup makes `samediff file.md file.md` return zero
  // contradictions by construction.
  const aRawSet = new Set(aUnits.map((u) => u.raw));
  const bRawSet = new Set(bUnits.map((u) => u.raw));

  aUnits.forEach((a) => {
    bUnits.forEach((b) => {
      if (aRawSet.has(b.raw) && bRawSet.has(a.raw)) return;

      // Structural-unit guard: markdown headings, HTML-only lines, and
      // very short label fragments don't make semantic claims. Pairing a
      // title against a prose line that happens to share an anchor token
      // is a classic false positive ("Negation around v0" between
      // `# SameDiff Lens v0 Contract` and a later `v0 is not ...` clause).
      // Require both sides of the pair to be claim-shaped.
      if (!isClaimShaped(a) || !isClaimShaped(b)) return;

      // Topical-overlap guard: a contradiction between two sentences
      // requires them to be about the same topic, not merely to share a
      // coincidental buzzword. Threshold is slightly lower than
      // `matchUnits` (0.12) on purpose — legit negation/required/optional
      // flips often live in short sentences that share exactly one
      // anchor (jaccard ≈ 0.11), and we want to keep those.
      const sim = jaccard(a.contentTokens, b.contentTokens);
      if (sim < 0.1) return;

      // Strip generic modal/structural tokens before deciding whether the
      // pair has *real* subject continuity. "should" + "request" overlap is
      // not enough on its own to justify accusing two sentences of
      // contradicting each other.
      const sharedAnchors = intersection(a.contentTokens, b.contentTokens).filter(
        (token) => !STRUCTURAL_ANCHOR_TOKENS.has(token),
      );

      if (sharedAnchors.length === 0) {
        return;
      }

      // Cross-section guard: when both sides sit inside topical contexts
      // (markdown heading or `**Topic**:` prefix) and those contexts
      // disagree, the pair must clear a stronger bar than same-section
      // pairs. This catches two FP classes:
      //
      //   1. One bullet's **Performance** sentence paired with another
      //      bullet's **Authentication** sentence on `should`/`request`.
      //   2. Engineering-doc generics like `diff/file` or `all/pass`
      //      lining up between unrelated devlog paragraphs.
      //
      // Two strong shared anchors aren't enough on their own — a real
      // cross-section contradiction needs richer subject continuity.
      // Four is the conservative floor.
      //
      // Empirical: dogfooding `--git HEAD~3 HEAD -- DIRECTORS_NOTES.md`
      // produced FP pairs with 3 shared anchors like `file/section/exist`
      // or `multi/file/page` — generic words that appear across many
      // devlog paragraphs without indicating subject continuity. Real
      // same-subject contradictions tend to share four or more strong
      // tokens because they're talking about the same thing in detail.
      const aSec = a.section ?? null;
      const bSec = b.section ?? null;
      const crossSection = aSec !== null && bSec !== null && aSec !== bSec;
      if (crossSection) {
        if (sharedAnchors.length < 4) return;
        if (sim < 0.18) return;
      }

      if (!containsAny(a.raw, NARROWING_MARKERS) && containsAny(b.raw, NARROWING_MARKERS)) {
        findings.push({
          summary: `B narrows ${sharedAnchors.join("/")} with limiting language that may contradict A's broader claim.`,
          anchors: sharedAnchors,
          versionA: a.raw,
          versionB: b.raw,
        });
      }

      if (containsAny(a.raw, NEGATION_MARKERS) !== containsAny(b.raw, NEGATION_MARKERS)) {
        findings.push({
          summary: `Negation or exclusivity flips around ${sharedAnchors.join("/")} may conflict.`,
          anchors: sharedAnchors,
          versionA: a.raw,
          versionB: b.raw,
        });
      }

      if (
        hasAnyToken(a.contentTokens, STORAGE_VERBS) &&
        (hasAnyToken(b.contentTokens, DISTRIBUTED_VERBS) || /only used for/i.test(b.raw))
      ) {
        findings.push({
          summary: `Responsibility for ${sharedAnchors.join("/")} appears to move from central storage toward distribution or limited usage.`,
          anchors: sharedAnchors,
          versionA: a.raw,
          versionB: b.raw,
        });
      }

      if (
        /\brequired\b/i.test(a.raw) && /\boptional\b/i.test(b.raw) ||
        /\boptional\b/i.test(a.raw) && /\brequired\b/i.test(b.raw)
      ) {
        findings.push({
          summary: `Required versus optional language changes around ${sharedAnchors.join("/")} may conflict.`,
          anchors: sharedAnchors,
          versionA: a.raw,
          versionB: b.raw,
        });
      }
    });
  });

  return uniqueEvidenceByKey(findings, (item) => item.summary).slice(0, 3);
}

// ── Contradiction presentation metadata ───────────────────────────────
// Pure derivation over the already-returned ContradictionEvidence shape.
// Adds *only* labels a renderer needs to say "why this fired" and how much
// to trust it. Detection behaviour (what fires, how often, on which inputs)
// is unaffected — this function never runs during detection and never
// mutates the evidence object.

export type ContradictionReason =
  | "narrowing"
  | "negation-flip"
  | "storage-to-distribution"
  | "required-optional-flip"
  | "unknown";

export type ContradictionMeta = {
  reason: ContradictionReason;
  /** One-sentence explanation of why the heuristic fired. */
  reasonDetail: string;
  /** Confidence in this being a *real* contradiction (not the heuristic itself). */
  confidence: Confidence;
  /**
   * True when the prior-version line makes a claim that directly opposes the
   * new line (negation flip, required↔optional, storage→distribution).
   * False when the new line merely adds a narrowing constraint and the prior
   * line is only the implicit broader statement — i.e. additive.
   */
  priorLineFound: boolean;
};

export function describeContradiction(ev: ContradictionEvidence): ContradictionMeta {
  const s = ev.summary;
  if (/\bnarrows\b/i.test(s)) {
    return {
      reason: "narrowing",
      reasonDetail:
        "The later version adds limiting language (only/just/except). The earlier line doesn't directly assert the opposite, so this reads as an additive constraint rather than a flipped claim.",
      confidence: "low",
      priorLineFound: false,
    };
  }
  if (/^Negation\b/i.test(s)) {
    return {
      reason: "negation-flip",
      reasonDetail:
        "Negation markers (not / no / never / without) appear on one side but not the other, while both sides are about the same subject.",
      confidence: "medium",
      priorLineFound: true,
    };
  }
  if (/^Responsibility\b/i.test(s)) {
    return {
      reason: "storage-to-distribution",
      reasonDetail:
        "Verbs shift from storage/holding (store, keep, save) to distribution/usage (send, publish, broadcast) around the shared subject.",
      confidence: "medium",
      priorLineFound: true,
    };
  }
  if (/^Required versus optional\b/i.test(s)) {
    return {
      reason: "required-optional-flip",
      reasonDetail:
        "One side marks the subject as required, the other as optional — a direct commitment reversal.",
      confidence: "high",
      priorLineFound: true,
    };
  }
  return {
    reason: "unknown",
    reasonDetail: "Heuristic fired on a summary template the renderer didn't recognise.",
    confidence: "low",
    priorLineFound: false,
  };
}

export const NO_PRIOR_LINE_TEXT =
  "No explicit conflicting line found (additive change)";

export function buildSummary(parts: {
  addedConcepts: string[];
  removedConcepts: string[];
  renamedIdeas: RenamedIdea[];
  changedCommitments: string[];
  actionItemsAdded: string[];
  actionItemsRemoved: string[];
  actionItemsStatusChanges?: TaskStatusChange[];
  possibleContradictions: string[];
}): string {
  const highlights: string[] = [];

  if (parts.changedCommitments.length > 0) {
    highlights.push(`${parts.changedCommitments.length} commitment shift${plural(parts.changedCommitments.length)}`);
  }

  if (parts.renamedIdeas.length > 0) {
    highlights.push(`${parts.renamedIdeas.length} rename guess${parts.renamedIdeas.length === 1 ? "" : "es"}`);
  }

  const conceptCount = parts.addedConcepts.length + parts.removedConcepts.length;
  if (conceptCount > 0) {
    highlights.push(`${conceptCount} concept delta${plural(conceptCount)}`);
  }

  // Action-item count: prefer the richer status-change list when present
  // (it covers toggles too); otherwise fall back to the legacy add+remove
  // count for old callers / golden fixtures that don't pass status changes.
  const actionCount = parts.actionItemsStatusChanges
    ? parts.actionItemsStatusChanges.length
    : parts.actionItemsAdded.length + parts.actionItemsRemoved.length;
  if (actionCount > 0) {
    highlights.push(`${actionCount} action-item change${plural(actionCount)}`);
  }

  if (parts.possibleContradictions.length > 0) {
    highlights.push(
      `${parts.possibleContradictions.length} possible contradiction${plural(parts.possibleContradictions.length)}`,
    );
  }

  if (highlights.length === 0) {
    return "The v0 heuristics did not find a strong semantic shift. That can mean the texts are close, or that the drift falls outside these simple rules.";
  }

  return `The v0 heuristics found ${highlights.join(", ")}. Treat this as an inspectable first pass, not a final semantic judgment.`;
}

function pickFocusedPhrase(source: string, importantTokens: string[]): string | null {
  return extractFocusedPhrases(source, importantTokens)[0]?.phrase ?? null;
}

/**
 * True when a unit looks like an actual claim rather than structural
 * scaffolding (titles, bullet labels, HTML markup).
 *
 * Structural units can carry shared anchor tokens that trick the
 * contradiction heuristic into pairing, e.g., `# SameDiff Lens v0 Contract`
 * with a later clause about "v0" — the title is just a topic pointer, not
 * a proposition that can agree or disagree. We also exclude HTML-only
 * lines (raw starts with `<`) and very short label fragments that lack a
 * predicate shape (no commitment/action/directive signal and fewer than
 * four content tokens).
 */
function isClaimShaped(unit: Unit): boolean {
  const raw = unit.raw.trimStart();
  if (raw.startsWith("#")) return false; // markdown heading
  if (raw.startsWith("<")) return false; // HTML markup / structural tag
  const hasPredicateSignal =
    unit.isCommitmentLike || unit.isActionItem || unit.isDirectiveLike;
  if (!hasPredicateSignal && unit.contentTokens.length < 4) return false;
  return true;
}

function uniqueRenameIdeas(items: RenamedIdea[]): RenamedIdea[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.from}::${item.to}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueEvidenceByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function directiveVerbCount(text: string): number {
  const tokens = tokenize(normalize(text));
  return tokens.filter((token) => ACTION_VERBS.has(token) || token === "be" || token === "challenge" || token === "separate").length;
}

function modalStrength(text: string): number {
  return MODAL_STRENGTH.reduce((best, { marker, score }) => {
    return containsAny(text, [marker]) ? Math.max(best, score) : best;
  }, 0);
}

function hasOperationalDetail(text: string): boolean {
  const lower = text.toLowerCase();
  return /\d/.test(lower) || /jitter|latency|timeout|retry|limit|quota|bootstrap|observation/.test(lower);
}

function containsAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => containsMarker(text, marker));
}

function hasAnyToken(tokens: string[], dictionary: ReadonlySet<string>): boolean {
  return tokens.some((token) => dictionary.has(token));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("es")) {
    if (/(ches|shes|sses|xes|zes)$/.test(token)) {
      return token.slice(0, -2);
    }

    return token.slice(0, -1);
  }

  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function isContentToken(token: string): boolean {
  return !STOP_WORDS.has(token) && (token.length >= 3 || /\d/.test(token));
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }

  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : overlap / union;
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((token) => !rightSet.has(token));
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((token) => rightSet.has(token));
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function shorten(text: string): string {
  return text.length > 90 ? `${text.slice(0, 87).trim()}...` : text;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function containsMarker(text: string, marker: string): boolean {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escapedMarker}\\b`, "i").test(text);
}

function extractFocusedPhrases(
  raw: string,
  importantTokens: string[],
): Array<{ phrase: string; score: number; sourceClause: string }> {
  const tokens = tokenize(normalize(raw));
  const stems = tokens.map((token) => stemToken(token));
  const important = new Set(importantTokens);
  const candidates = new Map<string, { score: number; sourceClause: string }>();

  stems.forEach((stem, index) => {
    if (!important.has(stem)) {
      return;
    }

    for (let start = Math.max(0, index - 2); start <= index; start += 1) {
      for (let end = index + 1; end <= Math.min(tokens.length, index + 4); end += 1) {
        if (end - start > 4) {
          continue;
        }

        const rawWindow = tokens.slice(start, end);
        const stemWindow = stems.slice(start, end);

        if (rawWindow.length > 3 && rawWindow.includes("and")) {
          continue;
        }

        if (
          rawWindow.length > 1 &&
          rawWindow
            .slice(1)
            .some((token) => ACTION_VERBS.has(stemToken(token)) || DIRECTIVE_TOKENS.has(token))
        ) {
          continue;
        }

        if (!isCandidatePhrase(rawWindow)) {
          continue;
        }

        const uniqueCount = stemWindow.filter((token) => important.has(token)).length;
        const contentCount = rawWindow.filter((token) => isContentToken(stemToken(token))).length;
        const phrase = tidyPhrase(rawWindow.join(" "));
        const score =
          uniqueCount * 3 +
          contentCount +
          (rawWindow.some((token) => /\d/.test(token)) ? 1 : 0) +
          (rawWindow[0] === "only" ? -1 : 0);

        const existing = candidates.get(phrase);

        if (!phrase || (existing?.score ?? 0) >= score) {
          continue;
        }

        candidates.set(phrase, {
          score,
          sourceClause: raw,
        });
      }
    }
  });

  return [...candidates.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .map(([phrase, details]) => ({
      phrase,
      score: details.score,
      sourceClause: details.sourceClause,
    }))
    .filter((candidate, index, array) => {
      return !array.slice(0, index).some((earlier) => earlier.phrase.includes(candidate.phrase));
    });
}

function tidyPhrase(phrase: string): string {
  const tokens = phrase.split(" ");

  while (tokens.length > 1 && (GENERIC_TERMS.has(tokens[0]) || LEADING_VERBISH.has(tokens[0]))) {
    tokens.shift();
  }

  while (tokens.length > 1 && HARD_BOUNDARY_STOP_WORDS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length === 0) {
    return "";
  }

  if (tokens.length === 1 && (GENERIC_TERMS.has(tokens[0]) || LEADING_VERBISH.has(tokens[0]))) {
    return "";
  }

  return tokens.join(" ");
}

function containsDirectiveToken(phrase: string): boolean {
  return phrase
    .split(" ")
    .some((token) => ACTION_VERBS.has(stemToken(token)) || DIRECTIVE_TOKENS.has(token));
}
