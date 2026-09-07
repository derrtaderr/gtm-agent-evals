// The read/query API the dashboard (Lane F) and CLI report (Lane E) consume.
// Pure functions over an already-read event array (see readEvents in jsonl.ts).
// verdictHistory and autonomyStreak order by PARSED time, so append order does
// not distort the answer except when two events share the exact same instant,
// where the tie falls back to input (append) order.

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

/** Sort ascending by ACTUAL time (parsed), not by lexical string comparison — a
 *  string sort mis-orders equal instants written with different UTC offsets or
 *  fractional precision, which would corrupt the autonomy streak. Copies first so
 *  the caller's array is not mutated. Events sharing the same parsed instant keep
 *  their input (append) order via the stable sort, so an exact tie is
 *  file-order dependent. An unparseable timestamp throws, naming it, rather than
 *  sorting to NaN and silently landing anywhere. */
function chronological(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...events]
    .map((e) => {
      const t = parseInstant(e.timestamp, e);
      return { e, t };
    })
    .sort((a, b) => a.t - b.t)
    .map(({ e }) => e);
}

// Strict ISO-8601 with an EXPLICIT timezone. The trailing `Z` or `±HH:MM` is
// mandatory: a timezone-less string like "2026-09-06T00:00:00" is read as
// machine-LOCAL time by Date.parse, which would make the autonomy streak depend
// on the reader's timezone. Requiring the offset also rejects Date.parse's
// over-permissive inputs ("0", "Sept 6 2026", date-only "2026-02-30").
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Parse a timestamp to a millisecond instant, throwing (naming the value and
 *  the event) unless it is strict ISO-8601 carrying an explicit timezone. A
 *  wrong or absent timezone is refused, never silently interpreted as local. */
function parseInstant(timestamp: string, e: TelemetryEvent): number {
  if (!ISO_WITH_TZ.test(timestamp)) {
    throw new Error(
      `telemetry query: timestamp "${timestamp}" on event ${e.runId} (config ${e.configId}) ` +
        `is not strict ISO-8601 with an explicit timezone (require a trailing Z or ±HH:MM offset)`,
    );
  }
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) {
    throw new Error(
      `telemetry query: unparseable timestamp "${timestamp}" on event ${e.runId} (config ${e.configId})`,
    );
  }
  return t;
}
