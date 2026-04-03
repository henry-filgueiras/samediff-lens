import type { GoldenExample } from "../examples/goldenExamples";

type ExamplePickerProps = {
  examples: GoldenExample[];
  selectedExampleId: string;
  onSelectedExampleIdChange: (nextId: string) => void;
  onLoadExample: () => void;
};

export function ExamplePicker({
  examples,
  selectedExampleId,
  onSelectedExampleIdChange,
  onLoadExample,
}: ExamplePickerProps) {
  return (
    <div className="example-picker">
      <label className="picker-label" htmlFor="example-picker">
        Load example
      </label>
      <div className="picker-controls">
        <select
          id="example-picker"
          className="select"
          value={selectedExampleId}
          onChange={(event) => onSelectedExampleIdChange(event.target.value)}
        >
          {examples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.title}
            </option>
          ))}
        </select>
        <button className="button" type="button" onClick={onLoadExample}>
          Load Example
        </button>
      </div>
    </div>
  );
}
