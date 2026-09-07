// The default telemetry sink: a zero-dependency JSONL writer, plus the read API
// the dashboard (Lane F) and the CLI report command (Lane E) consume. One
// TelemetryEvent per line, append-only. A corrupt or wrong-shaped line is a loud
// error naming the line, never a silently-accepted clean event.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { TelemetryEvent, TelemetrySink } from "../types.js";

/** Append-only JSONL sink. Creates the parent directory and file if missing.
 *  Each call appends exactly one line, so it never truncates prior events and is
 *  safe for concurrent-ish writers (append is atomic for small lines on POSIX). */
export function makeJsonlSink(path: string): TelemetrySink {
  return (event: TelemetryEvent): void => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
  };
}

/** Validate that parsed JSON is a real TelemetryEvent — shape AND the values of
 *  the load-bearing fields. A line that parses but carries a bad value (a
 *  verdict.status that is not exactly PASS/BLOCK, an empty required string, a
 *  non-array violations/reasons) must fail loudly rather than pass as a clean
 *  event, because a corrupted status flows straight into the autonomy streak.
 *  Unknown extra top-level fields are deliberately allowed (forward-compat). */
function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const nonEmptyString = (x: unknown): x is string => typeof x === "string" && x.length > 0;
  if (
    !nonEmptyString(v.runId) ||
    !nonEmptyString(v.timestamp) ||
    !nonEmptyString(v.configId) ||
    !nonEmptyString(v.archetype)
  ) {
    return false;
  }
  if (typeof v.verdict !== "object" || v.verdict === null) return false;
  const verdict = v.verdict as Record<string, unknown>;
  if (verdict.status !== "PASS" && verdict.status !== "BLOCK") return false;
  if (!Array.isArray(verdict.violations)) return false;
  if (!Array.isArray(verdict.reasons)) return false;
  return true;
}

/** Read a JSONL telemetry file into events. Missing file → []. Blank and
 *  whitespace-only lines are skipped. A malformed or wrong-shaped line throws an
 *  error naming the 1-based line number — it is never treated as a clean event. */
export function readEvents(path: string): TelemetryEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const events: TelemetryEvent[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `readEvents: malformed JSON on line ${i + 1} of ${path}: ${(err as Error).message}`,
      );
    }
    if (!isTelemetryEvent(parsed)) {
      throw new Error(
        `readEvents: line ${i + 1} of ${path} parsed but is not a TelemetryEvent (missing required fields)`,
      );
    }
    events.push(parsed);
  }
  return events;
}
