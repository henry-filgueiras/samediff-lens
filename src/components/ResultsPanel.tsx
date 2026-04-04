import { CategoryCard } from "./CategoryCard";
import type { AnalysisResult } from "../analysis/types";

type ResultsPanelProps = {
  result: AnalysisResult | null;
  hasInput: boolean;
  feedbackUrl?: string | null;
};

function renderStringList(items: string[]) {
  return (
    <ul className="result-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function renderConceptEvidenceList(
  items: Array<{ phrase: string; sourceClause: string }>,
  emptyLabel: string,
) {
  if (items.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  return (
    <ul className="result-list evidence-list">
      {items.map((item) => (
        <li key={`${item.phrase}-${item.sourceClause}`}>
          <div>{item.phrase}</div>
          <div className="evidence-block">
            <span className="evidence-label">Evidence</span>
            <p>From: {item.sourceClause}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ResultsPanel({ result, hasInput, feedbackUrl }: ResultsPanelProps) {
  if (!hasInput) {
    return (
      <section className="results-shell results-placeholder">
        <h2>Results</h2>
        <p>Add text or load an example, then run compare.</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="results-shell results-placeholder">
        <h2>Results</h2>
        <p>Press compare to run the v0 heuristic analyzer.</p>
      </section>
    );
  }

  return (
    <section className="results-shell">
      <div className="results-header">
        <div>
          <h2>Results</h2>
          <p className="results-subtitle">
            Structured output from a deterministic, inspectable heuristic pass.
          </p>
          <p className="results-helper">
            False positives and false negatives are expected in v0.
          </p>
        </div>
        <div className="results-actions">
          <span className="mini-badge">v0 heuristic analyzer</span>
          {feedbackUrl ? (
            <a
              className="button button-quiet button-small feedback-link"
              href={feedbackUrl}
              target="_blank"
              rel="noreferrer"
            >
              Report a weird result
            </a>
          ) : null}
          {feedbackUrl ? <p className="results-feedback-note">No source text included.</p> : null}
        </div>
      </div>

      <section className="summary-card">
        <h3>Summary</h3>
        <p>{result.summary}</p>
      </section>

      <div className="results-grid">
        <CategoryCard title="Added concepts" hasItems={result.addedConcepts.length > 0}>
          {renderConceptEvidenceList(result.addedConceptsEvidence, "None detected.")}
        </CategoryCard>

        <CategoryCard title="Removed concepts" hasItems={result.removedConcepts.length > 0}>
          {renderConceptEvidenceList(result.removedConceptsEvidence, "None detected.")}
        </CategoryCard>

        <CategoryCard title="Renamed ideas" hasItems={result.renamedIdeas.length > 0}>
          <ul className="result-list evidence-list">
            {result.renamedIdeas.map((item) => (
              <li key={`${item.from}-${item.to}`}>
                <div>
                  <strong>{item.from}</strong>
                  {" -> "}
                  <strong>{item.to}</strong>
                </div>
                <span className="meta-inline">({item.confidence} confidence)</span>
                <div className="evidence-block">
                  <span className="evidence-label">Why this fired</span>
                  {item.note ? <p>{item.note}</p> : null}
                  {item.sharedContext && item.sharedContext.length > 0 ? (
                    <p>Shared anchors: {item.sharedContext.join(", ")}</p>
                  ) : null}
                  {item.versionA ? <p>A: {item.versionA}</p> : null}
                  {item.versionB ? <p>B: {item.versionB}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </CategoryCard>

        <CategoryCard
          title="Changed commitments"
          hasItems={result.changedCommitments.length > 0}
        >
          <ul className="result-list evidence-list">
            {result.changedCommitmentsEvidence.map((item) => (
              <li key={item.summary}>
                <div>{item.summary}</div>
                <div className="evidence-block">
                  <span className="evidence-label">Why this fired</span>
                  <p>A: {item.versionA}</p>
                  <p>B: {item.versionB}</p>
                  <p>Signals: {item.triggers.join(", ")}</p>
                </div>
              </li>
            ))}
          </ul>
        </CategoryCard>

        <CategoryCard title="Action items added" hasItems={result.actionItemsAdded.length > 0}>
          {renderStringList(result.actionItemsAdded)}
        </CategoryCard>

        <CategoryCard
          title="Action items removed"
          hasItems={result.actionItemsRemoved.length > 0}
        >
          {renderStringList(result.actionItemsRemoved)}
        </CategoryCard>

        <CategoryCard
          title="Possible contradictions"
          hasItems={result.possibleContradictions.length > 0}
        >
          <ul className="result-list evidence-list">
            {result.possibleContradictionsEvidence.map((item) => (
              <li key={item.summary}>
                <div>{item.summary}</div>
                <div className="evidence-block">
                  <span className="evidence-label">Why this fired</span>
                  <p>Anchors: {item.anchors.join(", ")}</p>
                  <p>A: {item.versionA}</p>
                  <p>B: {item.versionB}</p>
                </div>
              </li>
            ))}
          </ul>
        </CategoryCard>
      </div>
    </section>
  );
}
