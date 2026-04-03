type PickedFileHandle = {
  getFile: () => Promise<File>;
};

type BrowserFilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options?: {
      excludeAcceptAllOption?: boolean;
      multiple?: boolean;
      types?: Array<{
        accept: Record<string, string[]>;
        description?: string;
      }>;
    }) => Promise<PickedFileHandle[]>;
  };

export const textFileInputAccept = ".txt,.md,text/plain,text/markdown";

export function supportsModernFilePicker() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as BrowserFilePickerWindow).showOpenFilePicker === "function";
}

export async function openLocalTextFile() {
  const pickerWindow = window as BrowserFilePickerWindow;
  const fileHandles = await pickerWindow.showOpenFilePicker?.({
    excludeAcceptAllOption: false,
    multiple: false,
    types: [
      {
        description: "Text or Markdown",
        accept: {
          "text/plain": [".txt", ".md"],
          "text/markdown": [".md"],
        },
      },
    ],
  });

  const selectedHandle = fileHandles?.[0];

  if (!selectedHandle) {
    return null;
  }

  return selectedHandle.getFile();
}

export function isFilePickerAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
