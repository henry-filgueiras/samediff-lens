import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as ts from "typescript";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiledDir = compileAnalysisModules();

process.on("exit", () => {
  rmSync(compiledDir, { force: true, recursive: true });
});

const { analyzeTextPair } = require(join(compiledDir, "analysis/analyzeTextPair.js"));
const { goldenExamples } = require(join(compiledDir, "examples/goldenExamples.js"));
const { formatAnalysisReport } = require(join(compiledDir, "lib/report.js"));
const { buildFeedbackIssueBody, buildFeedbackIssueUrl } = require(join(
  compiledDir,
  "lib/feedback.js",
));

test("golden examples return the full v0 result shape", () => {
  for (const example of goldenExamples) {
    const result = analyzeTextPair(example.versionA, example.versionB);

    assert.equal(typeof result.summary, "string");
    assert.ok(Array.isArray(result.addedConcepts));
    assert.ok(Array.isArray(result.removedConcepts));
    assert.ok(Array.isArray(result.renamedIdeas));
  assert.ok(Array.isArray(result.changedCommitments));
  assert.ok(Array.isArray(result.actionItemsAdded));
  assert.ok(Array.isArray(result.actionItemsRemoved));
  assert.ok(Array.isArray(result.possibleContradictions));
  assert.ok(Array.isArray(result.addedConceptsEvidence));
  assert.ok(Array.isArray(result.removedConceptsEvidence));
  assert.ok(Array.isArray(result.changedCommitmentsEvidence));
  assert.ok(Array.isArray(result.possibleContradictionsEvidence));
  }
});

test("spec drift example surfaces narrowed retry behavior", () => {
  const example = goldenExamples.find((candidate) => candidate.id === "spec-drift");
  assert.ok(example, "Expected the spec drift example to exist.");

  const result = analyzeTextPair(example.versionA, example.versionB);

  assert.ok(
    result.changedCommitments.some((item) => item.includes("narrows scope")),
    "Expected narrowed scope language in changed commitments.",
  );
  assert.ok(
    result.changedCommitmentsEvidence.some(
      (item) =>
        item.versionA.includes("retry failed jobs") &&
        item.versionB.includes("idempotent jobs"),
    ),
    "Expected commitment evidence to retain the triggering A/B clauses.",
  );
  assert.ok(
    result.addedConcepts.some((item) => item.includes("idempotent") || item.includes("jitter")),
    "Expected operational constraint concepts to be surfaced.",
  );
  assert.ok(
    result.addedConceptsEvidence.some((item) => item.sourceClause.includes("jitter")),
    "Expected added concept evidence to retain the source clause.",
  );
});

test("prompt/policy drift example surfaces behavioral and epistemic changes", () => {
  const example = goldenExamples.find((candidate) => candidate.id === "prompt-policy-drift");
  assert.ok(example, "Expected the prompt/policy example to exist.");

  const result = analyzeTextPair(example.versionA, example.versionB);

  assert.ok(
    result.changedCommitments.some(
      (item) =>
        item.includes("epistemic guardrails") || item.includes("behavioral directives"),
    ),
    "Expected changed commitments to mention behavior or epistemic guardrails.",
  );
  assert.ok(
    result.addedConcepts.includes("challenge weak assumptions") ||
      result.addedConcepts.includes("separate facts from speculation"),
    "Expected at least one added behavioral concept.",
  );
});

test("architecture drift example surfaces system model movement", () => {
  const example = goldenExamples.find((candidate) => candidate.id === "architecture-drift");
  assert.ok(example, "Expected the architecture drift example to exist.");

  const result = analyzeTextPair(example.versionA, example.versionB);

  assert.ok(
    result.addedConcepts.some((item) => item.includes("gossip") || item.includes("bootstrap")),
    "Expected distributed-system concepts to be added.",
  );
  assert.ok(
    result.possibleContradictions.some((item) => item.includes("Responsibility")),
    "Expected a responsibility-shift contradiction hint.",
  );
  assert.ok(
    result.possibleContradictionsEvidence.some((item) => item.anchors.includes("membership")),
    "Expected contradiction evidence to retain anchor terms.",
  );
});

test("revised design spec example surfaces broad architectural and operational drift", () => {
  const example = goldenExamples.find((candidate) => candidate.id === "revised-design-spec");
  assert.ok(example, "Expected the revised design spec example to exist.");

  const result = analyzeTextPair(example.versionA, example.versionB);

  assert.ok(
    result.changedCommitments.length > 0,
    "Expected the larger spec revision to produce changed commitments.",
  );
  assert.ok(
    result.addedConcepts.some((item) => /gossip|jitter|bootstrap|idempotent/i.test(item)) ||
      result.addedConceptsEvidence.some((item) =>
        /gossip|jitter|bootstrap|idempotent/i.test(`${item.phrase} ${item.sourceClause}`),
      ),
    "Expected architectural or retry-specific concepts to be surfaced.",
  );
  assert.ok(
    result.possibleContradictions.some((item) => /Responsibility|narrows/i.test(item)),
    "Expected a responsibility-shift or narrowing hint.",
  );
  assert.ok(
    result.changedCommitmentsEvidence.some(
      (item) =>
        /idempotent|jitter|bootstrap|gossip|verify gossip health/i.test(
          `${item.versionA} ${item.versionB}`,
        ),
    ),
    "Expected evidence for retry or incident-procedure changes.",
  );
});

test("identical text stays low-drift", () => {
  const text = "The system should retry failed jobs.";
  const result = analyzeTextPair(text, text);

  assert.deepEqual(result.addedConcepts, []);
  assert.deepEqual(result.removedConcepts, []);
  assert.deepEqual(result.renamedIdeas, []);
  assert.deepEqual(result.changedCommitments, []);
  assert.deepEqual(result.actionItemsAdded, []);
  assert.deepEqual(result.actionItemsRemoved, []);
  assert.deepEqual(result.possibleContradictions, []);
  assert.deepEqual(result.addedConceptsEvidence, []);
  assert.deepEqual(result.removedConceptsEvidence, []);
  assert.deepEqual(result.changedCommitmentsEvidence, []);
  assert.deepEqual(result.possibleContradictionsEvidence, []);
  assert.match(result.summary, /did not find a strong semantic shift/i);
});

test("empty versus empty returns a safe empty result", () => {
  const result = analyzeTextPair("", "");

  assert.deepEqual(result, {
    addedConcepts: [],
    removedConcepts: [],
    renamedIdeas: [],
    changedCommitments: [],
    actionItemsAdded: [],
    actionItemsRemoved: [],
    possibleContradictions: [],
    addedConceptsEvidence: [],
    removedConceptsEvidence: [],
    changedCommitmentsEvidence: [],
    possibleContradictionsEvidence: [],
    summary: "No text provided yet. Paste two versions or load a golden example to inspect drift.",
  });
});

test("action-item adds and removals are surfaced directly", () => {
  const result = analyzeTextPair(
    "TODO: remove legacy retry path.\nReview logs.",
    "TODO: add retry dashboard.\nReview logs.",
  );

  assert.deepEqual(result.actionItemsAdded, ["TODO: add retry dashboard"]);
  assert.deepEqual(result.actionItemsRemoved, ["TODO: remove legacy retry path"]);
  assert.deepEqual(result.renamedIdeas, []);
});

test("obvious narrowing also raises a contradiction hint", () => {
  const result = analyzeTextPair(
    "All users must verify email.",
    "Only admin users must verify email.",
  );

  assert.ok(
    result.changedCommitments.some((item) => item.includes("narrows scope")),
    "Expected the commitment analysis to detect narrowing.",
  );
  assert.ok(
    result.possibleContradictions.some((item) => /narrows/i.test(item)),
    "Expected a contradiction or narrowing hint.",
  );
  assert.ok(
    result.possibleContradictionsEvidence.some((item) => item.anchors.includes("email")),
    "Expected contradiction evidence to include overlapping anchors.",
  );
});

test("unrelated texts avoid rename guesses", () => {
  const result = analyzeTextPair(
    "Bananas are yellow and grow in bunches.",
    "PostgreSQL supports transactional DDL and indexes.",
  );

  assert.deepEqual(result.renamedIdeas, []);
  assert.deepEqual(result.changedCommitments, []);
  assert.deepEqual(result.possibleContradictions, []);
});

test("report formatting includes summary, labels, and evidence", () => {
  const report = formatAnalysisReport({
    generatedAt: "2026-04-03T12:00:00.000Z",
    result: analyzeTextPair(
      "The system should retry failed jobs.",
      "The system retries only idempotent jobs up to 3 times with jitter.",
    ),
    versionALabel: "retry-spec-v1.md",
    versionBLabel: "retry-spec-v2.md",
  });

  assert.match(report, /^# SameDiff Lens Report/m);
  assert.match(report, /Generated: 2026-04-03T12:00:00.000Z/);
  assert.match(report, /- A: retry-spec-v1.md/);
  assert.match(report, /- B: retry-spec-v2.md/);
  assert.match(report, /## Summary/);
  assert.match(report, /## Changed commitments/);
  assert.match(report, /Signals:/);
  assert.match(report, /## Added concepts/);
  assert.match(report, /Evidence:/);
});

test("report formatting omits empty categories and adds a no-findings note", () => {
  const report = formatAnalysisReport({
    result: analyzeTextPair(
      "The system should retry failed jobs.",
      "The system should retry failed jobs.",
    ),
  });

  assert.doesNotMatch(report, /## Added concepts/);
  assert.doesNotMatch(report, /## Changed commitments/);
  assert.match(report, /No populated semantic-drift categories were detected/);
});

test("feedback issue body includes example, summary, and fired categories without source text", () => {
  const body = buildFeedbackIssueBody({
    exampleName: "1. Spec drift",
    result: analyzeTextPair(
      "The system should retry failed jobs.",
      "The system retries only idempotent jobs up to 3 times with jitter.",
    ),
  });

  assert.match(body, /Example: 1. Spec drift/);
  assert.match(body, /Summary:/);
  assert.match(body, /Fired categories: .*Added concepts.*Changed commitments/);
  assert.match(body, /What did you expect\?/);
  assert.match(body, /What looked wrong\?/);
  assert.match(body, /What kind of text was this\?/);
  assert.match(body, /not included automatically/i);
  assert.doesNotMatch(body, /The system retries only idempotent jobs up to 3 times with jitter/);
});

// ── Provenance / source anchoring ────────────────────────────────────

test("commitment shifts carry dual (before + after) line anchors", () => {
  const before = [
    "Preface line.",
    "The service may cache responses for performance.",
    "Clients should validate tokens before each request.",
  ].join("\n");
  const after = [
    "Preface line.",
    "The service must cache responses for performance.",
    "Clients must validate tokens before each request.",
  ].join("\n");

  const result = analyzeTextPair(before, after);
  assert.ok(result.changedCommitmentsEvidence.length >= 1);
  for (const ev of result.changedCommitmentsEvidence) {
    assert.ok(ev.provenance, "commitment shift should have provenance");
    const sides = ev.provenance.anchors.map((a) => a.side).sort();
    assert.deepEqual(sides, ["after", "before"]);
    for (const a of ev.provenance.anchors) {
      assert.equal(typeof a.startLine, "number");
      assert.ok(a.startLine >= 1);
      assert.equal(typeof a.endLine, "number");
    }
    assert.ok(["exact", "approximate"].includes(ev.provenance.quality));
  }
});

test("added concepts anchor only on the after side", () => {
  const before = "The system handles retries.";
  const after = [
    "The system handles retries.",
    "Jobs must be idempotent and use exponential backoff.",
  ].join("\n");

  const result = analyzeTextPair(before, after);
  assert.ok(result.addedConceptsEvidence.length > 0);
  for (const ev of result.addedConceptsEvidence) {
    if (!ev.provenance) continue;
    const sides = ev.provenance.anchors.map((a) => a.side);
    assert.deepEqual(sides, ["after"]);
    assert.ok(ev.provenance.anchors[0].startLine >= 1);
  }
});

test("removed concepts anchor only on the before side", () => {
  const before = [
    "The system handles retries.",
    "Jobs must be idempotent and use exponential backoff.",
  ].join("\n");
  const after = "The system handles retries.";

  const result = analyzeTextPair(before, after);
  assert.ok(result.removedConceptsEvidence.length > 0);
  for (const ev of result.removedConceptsEvidence) {
    if (!ev.provenance) continue;
    const sides = ev.provenance.anchors.map((a) => a.side);
    assert.deepEqual(sides, ["before"]);
  }
});

test("action item drift produces side-appropriate provenance sidecar", () => {
  const before = [
    "# Plan",
    "- [ ] benchmark against GMP",
    "- [ ] write docs",
  ].join("\n");
  const after = [
    "# Plan",
    "- [ ] benchmark against GMP",
    "- [ ] validate karatsuba threshold",
  ].join("\n");

  const result = analyzeTextPair(before, after);
  assert.ok(result.actionItemsAdded.length > 0);
  assert.ok(result.actionItemsRemoved.length > 0);
  assert.ok(Array.isArray(result.actionItemsAddedProvenance));
  assert.ok(Array.isArray(result.actionItemsRemovedProvenance));
  // Each sidecar entry pairs a description with optional provenance
  for (const e of result.actionItemsAddedProvenance) {
    if (e.provenance) {
      assert.deepEqual(
        e.provenance.anchors.map((a) => a.side),
        ["after"],
      );
    }
  }
  for (const e of result.actionItemsRemovedProvenance) {
    if (e.provenance) {
      assert.deepEqual(
        e.provenance.anchors.map((a) => a.side),
        ["before"],
      );
    }
  }
});

test("missing evidence text does not crash or invent anchors", () => {
  // Two texts where commitment shift evidence is genuine. Then strip the
  // source texts down so we simulate a "can't locate" scenario — we do
  // this by passing one text twice which yields no findings, and by
  // checking that absent provenance is gracefully absent.
  const result = analyzeTextPair("hello world", "hello world");
  for (const arr of [
    result.changedCommitmentsEvidence,
    result.possibleContradictionsEvidence,
    result.addedConceptsEvidence,
    result.removedConceptsEvidence,
  ]) {
    for (const ev of arr ?? []) {
      // No crash on access; provenance is either set or undefined
      if (ev.provenance !== undefined) {
        assert.ok(Array.isArray(ev.provenance.anchors));
      }
    }
  }
});

test("anchor line numbers match actual source lines", () => {
  const before = [
    "Line 1 preamble.",
    "Line 2 preamble.",
    "Line 3 preamble.",
    "Clients should validate tokens before each request.",
    "Line 5 postamble.",
  ].join("\n");
  const after = [
    "Line 1 preamble.",
    "Line 2 preamble.",
    "Line 3 preamble.",
    "Line 4 insert.",
    "Clients must validate tokens before each request.",
    "Line 6 postamble.",
  ].join("\n");

  const result = analyzeTextPair(before, after);
  const commitment = result.changedCommitmentsEvidence.find((e) =>
    /validate tokens/.test(e.versionB),
  );
  assert.ok(commitment, "expected a commitment shift finding");
  const beforeAnchor = commitment.provenance.anchors.find((a) => a.side === "before");
  const afterAnchor = commitment.provenance.anchors.find((a) => a.side === "after");
  assert.equal(beforeAnchor.startLine, 4, "before anchor line 4");
  assert.equal(afterAnchor.startLine, 5, "after anchor line 5");
});

test("feedback issue URL encodes a prefilled GitHub issue", () => {
  const url = buildFeedbackIssueUrl({
    result: analyzeTextPair(
      "Be helpful and concise.",
      "Be concise, challenge weak assumptions, and separate facts from speculation.",
    ),
  });
  const parsedUrl = new URL(url);

  assert.equal(parsedUrl.origin, "https://github.com");
  assert.equal(parsedUrl.pathname, "/henry-filgueiras/samediff-lens/issues/new");
  assert.match(parsedUrl.searchParams.get("title") ?? "", /Weird result/);
  assert.match(parsedUrl.searchParams.get("body") ?? "", /Custom comparison/);
});

function compileAnalysisModules() {
  const outDir = mkdtempSync(join(tmpdir(), "samediff-lens-analysis-"));
  const sourceFiles = [
    resolve(repoRoot, "src/analysis/analyzeTextPair.ts"),
    resolve(repoRoot, "src/analysis/heuristics.ts"),
    resolve(repoRoot, "src/analysis/provenance.ts"),
    resolve(repoRoot, "src/analysis/types.ts"),
    resolve(repoRoot, "src/examples/goldenExamples.ts"),
    resolve(repoRoot, "src/lib/feedback.ts"),
    resolve(repoRoot, "src/lib/report.ts"),
  ];

  const compilerHost = ts.createCompilerHost({
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    outDir,
    rootDir: resolve(repoRoot, "src"),
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });

  const program = ts.createProgram(sourceFiles, {
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    outDir,
    rootDir: resolve(repoRoot, "src"),
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  }, compilerHost);

  const emitResult = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  if (diagnostics.length > 0) {
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => "\n",
    });

    throw new Error(`Failed to compile analysis modules for smoke tests.\n${message}`);
  }

  return outDir;
}
