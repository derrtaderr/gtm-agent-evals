// The read/query API the dashboard (Lane F) and CLI report (Lane E) consume.
// Pure functions over an already-read event array (see readEvents in jsonl.ts).
// verdictHistory and autonomyStreak sort by timestamp so file/append order can
// never distort the answer.

import type { TelemetryEvent, VerdictStatus } from "../types.js";

/** All events for one config, in the order given (no sorting). */
export function eventsByConfig(events: TelemetryEvent[], configId: string): TelemetryEvent[] {
  return events.filter((e) => e.configId === configId);
}

/** Chronological (oldest -> newest) list of PASS/BLOCK verdicts for one config. */
export function verdictHistory(events: TelemetryEvent[], configId: string): VerdictStatus[] {
  return chronological(eventsByConfig(events, configId)).map((e) => e.verdict.status);
}

/** The current consecutive-PASS streak for one config, counted back from the
 *  most recent run. A BLOCK anywhere in the tail (including the newest run)
 *  resets the count. This is what the autonomy gate reads to decide whether an
 *  agent has earned unattended operation. */
export function autonomyStreak(events: TelemetryEvent[], configId: string): number {
  const history = chronological(eventsByConfig(events, configId));
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].verdict.status === "PASS") streak++;
    else break;
  }
  return streak;
}

/** Sort ascending by ISO timestamp. Copies first so the caller's array is not
 *  mutated. Ties preserve input order (stable sort in modern V8). */
function chronological(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...events].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}
