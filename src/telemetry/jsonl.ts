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

/** The minimal structural check that separates a real TelemetryEvent from any
 *  other well-formed JSON. A line that parses but is not this shape must fail
 *  loudly rather than pass as a clean event. */
function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.configId === "string" &&
    typeof v.archetype === "string" &&
    typeof v.verdict === "object" &&
    v.verdict !== null &&
    typeof (v.verdict as Record<string, unknown>).status === "string"
  );
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
