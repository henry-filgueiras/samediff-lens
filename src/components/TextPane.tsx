import type { ChangeEvent, RefObject } from "react";
import { textFileInputAccept } from "../lib/localFiles";

type TextPaneProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  openButtonLabel: string;
  onOpenFile: () => void;
  onFallbackFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedFileName?: string | null;
  errorMessage?: string | null;
};

export function TextPane({
  label,
  value,
  onChange,
  placeholder,
  openButtonLabel,
  onOpenFile,
  onFallbackFileSelected,
  fileInputRef,
  selectedFileName,
  errorMessage,
}: TextPaneProps) {
  return (
    <div className="text-pane">
      <div className="pane-header">
        <span className="pane-label">{label}</span>
        <button className="button button-quiet button-small" type="button" onClick={onOpenFile}>
          {openButtonLabel}
        </button>
      </div>
      <p className="pane-meta">
        {selectedFileName
          ? `Loaded: ${selectedFileName}`
          : "Paste text or open a local .txt or .md file."}
      </p>
      {errorMessage ? <p className="pane-error">{errorMessage}</p> : null}
      <input
        ref={fileInputRef}
        accept={textFileInputAccept}
        hidden
        type="file"
        onChange={onFallbackFileSelected}
      />
      <textarea
        className="pane-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
