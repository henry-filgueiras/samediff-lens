import { useRef, useState, type ChangeEvent } from "react";
import { TextPane } from "./components/TextPane";
import { ResultsPanel } from "./components/ResultsPanel";
import { ExamplePicker } from "./components/ExamplePicker";
import { analyzeTextPair } from "./analysis/analyzeTextPair";
import type { AnalysisResult } from "./analysis/types";
import { goldenExamples } from "./examples/goldenExamples";
import {
  isFilePickerAbortError,
  openLocalTextFile,
  supportsModernFilePicker,
} from "./lib/localFiles";
import { formatAnalysisReport } from "./lib/report";
import { buildFeedbackIssueUrl } from "./lib/feedback";

const initialExample = goldenExamples[0];
type PaneKey = "A" | "B";
type PaneMeta = {
  error: string | null;
  fileName: string | null;
};

function App() {
  const [selectedExampleId, setSelectedExampleId] = useState(initialExample.id);
  const [versionA, setVersionA] = useState(initialExample.versionA);
  const [versionB, setVersionB] = useState(initialExample.versionB);
  const [result, setResult] = useState<AnalysisResult | null>(
    analyzeTextPair(initialExample.versionA, initialExample.versionB),
  );
  const [paneMeta, setPaneMeta] = useState<Record<PaneKey, PaneMeta>>({
    A: { error: null, fileName: null },
    B: { error: null, fileName: null },
  });
  const versionAInputRef = useRef<HTMLInputElement>(null);
  const versionBInputRef = useRef<HTMLInputElement>(null);

  const selectedExample =
    goldenExamples.find((example) => example.id === selectedExampleId) ?? initialExample;
  const usingSelectedExample =
    !paneMeta.A.fileName &&
    !paneMeta.B.fileName &&
    versionA === selectedExample.versionA &&
    versionB === selectedExample.versionB;

  const activeComparisonTitle = usingSelectedExample ? selectedExample.title : "Custom comparison";
  const activeComparisonDescription = usingSelectedExample
    ? selectedExample.description
    : "Compare your own local notes, prompts, specs, or runbooks. Everything stays in the browser, and export produces a lightweight local report.";
  const activeComparisonSignals = usingSelectedExample
    ? selectedExample.expectedSignals
    : [
        "Load one local .txt or .md file into each side, then compare.",
        "Inspect the evidence blocks to see why the v0 heuristic fired.",
        "Export a compact Markdown report without sending text anywhere.",
      ];
  const feedbackUrl = result
    ? buildFeedbackIssueUrl({
        exampleName: usingSelectedExample ? selectedExample.title : undefined,
        result,
      })
    : null;

  const handleCompare = () => {
    setResult(analyzeTextPair(versionA, versionB));
  };

  const updatePaneMeta = (pane: PaneKey, next: Partial<PaneMeta>) => {
    setPaneMeta((current) => ({
      ...current,
      [pane]: {
        ...current[pane],
        ...next,
      },
    }));
  };

  const updateVersion = (pane: PaneKey, nextValue: string) => {
    if (pane === "A") {
      setVersionA(nextValue);
    } else {
      setVersionB(nextValue);
    }

    updatePaneMeta(pane, { error: null });
    setResult(null);
  };

  const loadFileIntoPane = async (pane: PaneKey, file: File) => {
    try {
      const text = await file.text();
      updateVersion(pane, text);
      updatePaneMeta(pane, { error: null, fileName: file.name });
    } catch {
      updatePaneMeta(pane, {
        error: "Could not read that file. Try a plain text or Markdown file.",
        fileName: null,
      });
    }
  };

  const handleOpenFile = async (pane: PaneKey) => {
    updatePaneMeta(pane, { error: null });

    if (supportsModernFilePicker()) {
      try {
        const file = await openLocalTextFile();
        if (!file) {
          return;
        }

        await loadFileIntoPane(pane, file);
        return;
      } catch (error) {
        if (isFilePickerAbortError(error)) {
          return;
        }
      }
    }

    const fallbackInput = pane === "A" ? versionAInputRef.current : versionBInputRef.current;
    fallbackInput?.click();
  };

  const handleFallbackFileSelected =
    (pane: PaneKey) => async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";

      if (!file) {
        return;
      }

      await loadFileIntoPane(pane, file);
    };

  const handleLoadExample = () => {
    setVersionA(selectedExample.versionA);
    setVersionB(selectedExample.versionB);
    setPaneMeta({
      A: { error: null, fileName: null },
      B: { error: null, fileName: null },
    });
    setResult(analyzeTextPair(selectedExample.versionA, selectedExample.versionB));
  };

  const handleReset = () => {
    setVersionA("");
    setVersionB("");
    setPaneMeta({
      A: { error: null, fileName: null },
      B: { error: null, fileName: null },
    });
    setResult(null);
  };

  const handleExportReport = () => {
    if (!result) {
      return;
    }

    const report = formatAnalysisReport({
      generatedAt: new Date().toISOString(),
      result,
      versionALabel: paneMeta.A.fileName ?? "Version A",
      versionBLabel: paneMeta.B.fileName ?? "Version B",
    });
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = `samediff-report-${new Date().toISOString().replaceAll(":", "-")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">SameDiff</p>
          <h1>SameDiff Lens</h1>
          <p className="hero-copy">
            Compare two text versions and surface likely semantic drift that raw line diff
            misses.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge">Local-only</span>
          <span className="badge">Browser-run</span>
          <span className="badge badge-warning">Heuristic / experimental</span>
        </div>
      </header>

      <section className="banner">
        <strong>What this v0 looks for:</strong> added concepts, removed concepts, renamed
        ideas, changed commitments, action-item drift, and possible contradictions. Results are
        generated by deterministic heuristics, not an LLM.
      </section>

      <section className="controls-panel">
        <ExamplePicker
          examples={goldenExamples}
          selectedExampleId={selectedExampleId}
          onSelectedExampleIdChange={setSelectedExampleId}
          onLoadExample={handleLoadExample}
        />
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={handleCompare}>
            Compare
          </button>
          <button className="button" type="button" onClick={handleExportReport} disabled={!result}>
            Export report
          </button>
          <button className="button" type="button" onClick={handleReset}>
            Reset
          </button>
        </div>
      </section>

      <section className="example-note">
        <div>
          <h2>{activeComparisonTitle}</h2>
          <p>{activeComparisonDescription}</p>
        </div>
        <div className="expectation-block">
          <span className="mini-label">
            {usingSelectedExample ? "Expected spirit" : "Good fit"}
          </span>
          <ul>
            {activeComparisonSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>
      </section>

      <main className="workspace">
        <div className="pane-grid">
          <TextPane
            label="Version A"
            value={versionA}
            onChange={(nextValue) => updateVersion("A", nextValue)}
            placeholder="Paste the baseline text here."
            openButtonLabel="Open file for A"
            onOpenFile={() => void handleOpenFile("A")}
            onFallbackFileSelected={(event) => void handleFallbackFileSelected("A")(event)}
            fileInputRef={versionAInputRef}
            selectedFileName={paneMeta.A.fileName}
            errorMessage={paneMeta.A.error}
          />
          <TextPane
            label="Version B"
            value={versionB}
            onChange={(nextValue) => updateVersion("B", nextValue)}
            placeholder="Paste the revised text here."
            openButtonLabel="Open file for B"
            onOpenFile={() => void handleOpenFile("B")}
            onFallbackFileSelected={(event) => void handleFallbackFileSelected("B")(event)}
            fileInputRef={versionBInputRef}
            selectedFileName={paneMeta.B.fileName}
            errorMessage={paneMeta.B.error}
          />
        </div>

        <ResultsPanel
          result={result}
          hasInput={Boolean(versionA.trim() || versionB.trim())}
          feedbackUrl={feedbackUrl}
        />
      </main>

      <footer className="app-footer">
        <span>SameDiff Lens is heuristic / experimental.</span>
        <a
          href="https://github.com/henry-filgueiras/samediff-lens"
          target="_blank"
          rel="noreferrer"
        >
          View source on GitHub
        </a>
      </footer>
    </div>
  );
}

export default App;
