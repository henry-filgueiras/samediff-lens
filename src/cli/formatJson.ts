/**
 * JSON output renderer for SameDiff analysis results.
 *
 * Consumes the canonical DiffResult model and emits clean,
 * stable JSON suitable for machine consumption.
 *
 * No prose, no banners, no ANSI — just JSON on stdout.
 */

import type { DiffResult } from "./resultModel";

/**
 * Serialize a DiffResult to a pretty-printed JSON string.
 *
 * The output is deterministic for the same input (modulo timestamps).
 * Trailing newline included for POSIX friendliness.
 */
export function formatJsonOutput(result: DiffResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}
