import { CategoryCard } from "./CategoryCard";
import type { AnalysisResult } from "../analysis/types";

type ResultsPanelProps = {
  result: AnalysisResult | null;
  hasInput: boolean;
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

export function ResultsPanel({ result, hasInput }: ResultsPanelProps) {
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
        <span className="mini-badge">v0 heuristic analyzer</span>
      </div>

      <section className="summary-card">
        <h3>Summary</h3>
        <p>{result.summary}</p>
      </section>

      <div className="results-grid">
        <CategoryCard title="Added concepts" hasItems={result.addedConcepts.length > 0}>
          {renderStringList(result.addedConcepts)}
        </CategoryCard>

        <CategoryCard title="Removed concepts" hasItems={result.removedConcepts.length > 0}>
          {renderStringList(result.removedConcepts)}
        </CategoryCard>

        <CategoryCard title="Renamed ideas" hasItems={result.renamedIdeas.length > 0}>
          <ul className="result-list">
            {result.renamedIdeas.map((item) => (
              <li key={`${item.from}-${item.to}`}>
                <strong>{item.from}</strong>
                {" -> "}
                <strong>{item.to}</strong>
                <span className="meta-inline">({item.confidence} confidence)</span>
                {item.note ? ` ${item.note}` : ""}
              </li>
            ))}
          </ul>
        </CategoryCard>

        <CategoryCard
          title="Changed commitments"
          hasItems={result.changedCommitments.length > 0}
        >
          {renderStringList(result.changedCommitments)}
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
          {renderStringList(result.possibleContradictions)}
        </CategoryCard>
      </div>
    </section>
  );
}
