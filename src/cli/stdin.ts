/**
 * Read all of stdin as UTF-8. Used when a file arg is `-`.
 *
 * Synchronous via readFileSync on /dev/stdin to keep the rest of the
 * CLI synchronous. Node supports this on POSIX systems; on the rare
 * platforms where it doesn't, we fall back to a blocking read loop.
 */

import { readFileSync, readSync, closeSync, openSync } from "node:fs";

export function readAllStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    // Fallback for environments where fd 0 reads fail
    try {
      const fd = openSync("/dev/stdin", "r");
      const buf = Buffer.alloc(64 * 1024);
      const chunks: Buffer[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const n = readSync(fd, buf, 0, buf.length, null);
        if (!n) break;
        chunks.push(Buffer.from(buf.subarray(0, n)));
      }
      closeSync(fd);
      return Buffer.concat(chunks).toString("utf-8");
    } catch (err: any) {
      throw new Error(
        `Could not read stdin: ${err?.message ?? err}. Pipe text in or pass a file path.`,
      );
    }
  }
}
