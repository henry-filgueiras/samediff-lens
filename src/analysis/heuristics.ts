import type {
  CommitmentEvidence,
  ConceptEvidence,
  Confidence,
  ContradictionEvidence,
  MatchedPair,
  RenamedIdea,
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
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => splitLineIntoUnits(line))
    .map((raw) => buildUnit(raw));
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

  return {
    raw: raw.replace(/[.;!?]+$/g, "").trim(),
    normalized,
    tokens,
    contentTokens,
    isActionItem:
      /^[\s-]*\[[ x]\]/i.test(raw) ||
      /^todo[:\s-]/i.test(raw) ||
      (ACTION_VERBS.has(firstToken) && raw.length < 140),
    isCommitmentLike:
      containsAny(raw, COMMITMENT_MARKERS) ||
      /^be\b/i.test(raw) ||
      containsAny(raw, ["always", "never", "required", "optional"]),
    isDirectiveLike:
      /^be\b/i.test(raw) ||
      (ACTION_VERBS.has(firstToken) && raw.length < 140) ||
      /\b(challenge|separate|prefer|avoid|keep)\b/i.test(raw),
  };
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

export function compareActionItems(aItems: string[], bItems: string[]) {
  const normalizedA = new Map(aItems.map((item) => [normalize(item), item]));
  const normalizedB = new Map(bItems.map((item) => [normalize(item), item]));

  const added = [...normalizedB.entries()]
    .filter(([normalized]) => !normalizedA.has(normalized))
    .map(([, value]) => value);

  const removed = [...normalizedA.entries()]
    .filter(([normalized]) => !normalizedB.has(normalized))
    .map(([, value]) => value);

  return { added, removed };
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

  aUnits.forEach((a) => {
    bUnits.forEach((b) => {
      const sharedAnchors = intersection(a.contentTokens, b.contentTokens).filter(
        (token) => !ANCHOR_GENERIC_TERMS.has(token),
      );

      if (sharedAnchors.length === 0) {
        return;
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

export function buildSummary(parts: {
  addedConcepts: string[];
  removedConcepts: string[];
  renamedIdeas: RenamedIdea[];
  changedCommitments: string[];
  actionItemsAdded: string[];
  actionItemsRemoved: string[];
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

  const actionCount = parts.actionItemsAdded.length + parts.actionItemsRemoved.length;
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
