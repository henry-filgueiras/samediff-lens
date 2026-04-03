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

function compileAnalysisModules() {
  const outDir = mkdtempSync(join(tmpdir(), "samediff-lens-analysis-"));
  const sourceFiles = [
    resolve(repoRoot, "src/analysis/analyzeTextPair.ts"),
    resolve(repoRoot, "src/analysis/heuristics.ts"),
    resolve(repoRoot, "src/analysis/types.ts"),
    resolve(repoRoot, "src/examples/goldenExamples.ts"),
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
