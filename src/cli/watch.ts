import { watch, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Watch two files and call onChange when either is modified.
 * Debounces rapid changes (e.g., editor save + write-temp + rename).
 */
export function watchFiles(
  fileA: string,
  fileB: string,
  onChange: () => void,
): void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastMtimeA = getMtime(fileA);
  let lastMtimeB = getMtime(fileB);

  const debounced = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const mtimeA = getMtime(fileA);
      const mtimeB = getMtime(fileB);

      if (mtimeA !== lastMtimeA || mtimeB !== lastMtimeB) {
        lastMtimeA = mtimeA;
        lastMtimeB = mtimeB;
        onChange();
      }
    }, 200);
  };

  // Watch the directories (more reliable than watching files directly,
  // since editors often write-to-temp then rename)
  const dirs = new Set([dirname(fileA), dirname(fileB)]);

  for (const dir of dirs) {
    watch(dir, { persistent: true }, (_event, filename) => {
      if (filename && (fileA.endsWith(filename) || fileB.endsWith(filename))) {
        debounced();
      }
    });
  }

  // Also watch files directly as a fallback
  for (const file of [fileA, fileB]) {
    try {
      watch(file, { persistent: true }, () => debounced());
    } catch {
      // directory watcher will cover it
    }
  }
}

function getMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
