import type { AnalysisResult } from "../analysis/types";

const repositoryIssueUrl = "https://github.com/henry-filgueiras/samediff-lens/issues/new";

type FeedbackIssueOptions = {
  exampleName?: string;
  result: AnalysisResult;
};

export function buildFeedbackIssueUrl({ exampleName, result }: FeedbackIssueOptions) {
  const titleContext = exampleName ? ` in ${exampleName}` : "";
  const title = `Weird result${titleContext}`;
  const body = buildFeedbackIssueBody({ exampleName, result });
  const params = new URLSearchParams({
    body,
    title,
  });

  return `${repositoryIssueUrl}?${params.toString()}`;
}

export function buildFeedbackIssueBody({ exampleName, result }: FeedbackIssueOptions) {
  const firedCategories = getFiredCategories(result);
  const lines = [
    "## SameDiff Lens feedback",
    "",
    `Example: ${exampleName ?? "Custom comparison"}`,
    `Summary: ${result.summary}`,
    `Fired categories: ${firedCategories.length > 0 ? firedCategories.join(", ") : "none"}`,
    "",
    "Questions:",
    "- What did you expect?",
    "- What looked wrong?",
    "- What kind of text was this?",
    "",
    "_Current Version A / Version B text is not included automatically._",
  ];

  return lines.join("\n");
}

function getFiredCategories(result: AnalysisResult) {
  const categories = [
    { label: "Added concepts", items: result.addedConcepts },
    { label: "Removed concepts", items: result.removedConcepts },
    { label: "Renamed ideas", items: result.renamedIdeas },
    { label: "Changed commitments", items: result.changedCommitments },
    { label: "Action items added", items: result.actionItemsAdded },
    { label: "Action items removed", items: result.actionItemsRemoved },
    { label: "Possible contradictions", items: result.possibleContradictions },
  ];

  return categories.filter((category) => category.items.length > 0).map((category) => category.label);
}
