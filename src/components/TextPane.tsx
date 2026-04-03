type TextPaneProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
};

export function TextPane({ label, value, onChange, placeholder }: TextPaneProps) {
  return (
    <label className="text-pane">
      <span className="pane-label">{label}</span>
      <textarea
        className="pane-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </label>
  );
}
