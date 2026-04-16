import type {
  AnalysisResult,
  CommitmentEvidence,
  ConceptEvidence,
  ContradictionEvidence,
  RenamedIdea,
} from "../analysis/types";
import { describeContradiction, NO_PRIOR_LINE_TEXT } from "../analysis/heuristics";

type ReportOptions = {
  generatedAt?: string;
  result: AnalysisResult;
  versionALabel?: string;
  versionBLabel?: string;
};

export function formatAnalysisReport({
  generatedAt,
  result,
  versionALabel = "Version A",
  versionBLabel = "Version B",
}: ReportOptions) {
  const lines = [
    "# SameDiff Lens Report",
    "",
    "Generated locally in the browser from a deterministic heuristic pass.",
    "",
  ];

  if (generatedAt) {
    lines.push(`Generated: ${generatedAt}`, "");
  }

  lines.push("## Summary", "", result.summary, "");
  lines.push("## Compared inputs", "", `- A: ${versionALabel}`, `- B: ${versionBLabel}`, "");

  appendConceptSection(lines, "Added concepts", result.addedConcepts, result.addedConceptsEvidence);
  appendConceptSection(
    lines,
    "Removed concepts",
    result.removedConcepts,
    result.removedConceptsEvidence,
  );
  appendRenamedIdeasSection(lines, result.renamedIdeas);
  appendCommitmentSection(lines, result.changedCommitments, result.changedCommitmentsEvidence);
  appendStringSection(lines, "Action items added", result.actionItemsAdded);
  appendStringSection(lines, "Action items removed", result.actionItemsRemoved);
  appendContradictionSection(
    lines,
    result.possibleContradictions,
    result.possibleContradictionsEvidence,
  );

  if (onlyContainsSummaryAndInputs(lines)) {
    lines.push("## Findings", "", "No populated semantic-drift categories were detected.", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function appendConceptSection(
  lines: string[],
  title: string,
  items: string[],
  evidenceItems: ConceptEvidence[],
) {
  if (items.length === 0) {
    return;
  }

  lines.push(`## ${title}`, "");

  if (evidenceItems.length === 0) {
    items.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
    return;
  }

  const seenPhrases = new Set<string>();

  evidenceItems.forEach((item) => {
    seenPhrases.add(item.phrase);
    lines.push(`- ${item.phrase}`);
    lines.push(`  Evidence: ${item.sourceClause}`);
  });

  items
    .filter((item) => !seenPhrases.has(item))
    .forEach((item) => {
      lines.push(`- ${item}`);
    });

  lines.push("");
}

function appendRenamedIdeasSection(lines: string[], items: RenamedIdea[]) {
  if (items.length === 0) {
    return;
  }

  lines.push("## Renamed ideas", "");

  items.forEach((item) => {
    lines.push(`- ${item.from} -> ${item.to} (${item.confidence} confidence)`);
    if (item.note) {
      lines.push(`  Why this fired: ${item.note}`);
    }
    if (item.sharedContext && item.sharedContext.length > 0) {
      lines.push(`  Shared anchors: ${item.sharedContext.join(", ")}`);
    }
    if (item.versionA) {
      lines.push(`  A: ${item.versionA}`);
    }
    if (item.versionB) {
      lines.push(`  B: ${item.versionB}`);
    }
  });

  lines.push("");
}

function appendCommitmentSection(
  lines: string[],
  items: string[],
  evidenceItems: CommitmentEvidence[],
) {
  if (items.length === 0) {
    return;
  }

  lines.push("## Changed commitments", "");

  if (evidenceItems.length === 0) {
    items.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
    return;
  }

  evidenceItems.forEach((item) => {
    lines.push(`- ${item.summary}`);
    lines.push(`  A: ${item.versionA}`);
    lines.push(`  B: ${item.versionB}`);
    lines.push(`  Signals: ${item.triggers.join(", ")}`);
  });

  lines.push("");
}

function appendStringSection(lines: string[], title: string, items: string[]) {
  if (items.length === 0) {
    return;
  }

  lines.push(`## ${title}`, "");
  items.forEach((item) => {
    lines.push(`- ${item}`);
  });
  lines.push("");
}

function appendContradictionSection(
  lines: string[],
  items: string[],
  evidenceItems: ContradictionEvidence[],
) {
  if (items.length === 0) {
    return;
  }

  lines.push("## Possible contradictions", "");

  if (evidenceItems.length === 0) {
    items.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
    return;
  }

  evidenceItems.forEach((item) => {
    const meta = describeContradiction(item);
    lines.push(`- ${item.summary}`);
    lines.push(`  - **NEW LINE:** ${item.versionB}`);
    if (meta.priorLineFound) {
      lines.push(`  - **PRIOR LINE:** ${item.versionA}`);
    } else {
      lines.push(`  - **PRIOR LINE:** _${NO_PRIOR_LINE_TEXT}_`);
      lines.push(`    - matched against: ${item.versionA}`);
    }
    lines.push(`  - **REASON:** \`${meta.reason}\` — ${meta.reasonDetail}`);
    lines.push(`  - **CONFIDENCE:** ${meta.confidence.toUpperCase()}`);
    if (item.anchors.length > 0) {
      lines.push(`  - Anchors: ${item.anchors.join(", ")}`);
    }
  });

  lines.push("");
}

function onlyContainsSummaryAndInputs(lines: string[]) {
  return !lines.some((line) =>
    [
      "## Added concepts",
      "## Removed concepts",
      "## Renamed ideas",
      "## Changed commitments",
      "## Action items added",
      "## Action items removed",
      "## Possible contradictions",
    ].includes(line),
  );
}
