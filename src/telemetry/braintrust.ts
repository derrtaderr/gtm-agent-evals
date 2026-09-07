// The Braintrust-compatible adapter. This is a *named integration*, not a hard
// dependency: the `braintrust` package is never imported here. The transport is
// injected as an interface, so the core stays zero-dep and testable, and a real
// Braintrust logger is wired in only by the consumer who wants it.
//
// Mapping (TelemetryEvent -> Braintrust-style record):
//   runId       -> id
//   verdict.status  -> output              ("PASS" | "BLOCK")
//   verdict.scores  -> scores              (rubric dimension -> number; {} if none)
//   { configId, archetype }  -> input      (the context the run was scored under)
//   { configId, archetype, timestamp, reasons, violations, failedDimensions }
//                   -> metadata
//   durationMs  -> metrics.duration        (omitted when absent)
//
// A Braintrust `experiment.log(...)` / `logger.log(...)` call accepts exactly a
// record of this shape, so a consumer wires the real client as:
//   makeBraintrustSink({ log: (r) => experiment.log(r) })

import type { TelemetryEvent, TelemetrySink } from "../types.js";

/** A Braintrust-style log record. Field names follow Braintrust's `log()` input
 *  so a consumer can forward it straight to the SDK. */
export type BraintrustRecord = {
  id: string;
  input: { configId: string; archetype: string };
  output: string;
  scores: Record<string, number>;
  metadata: Record<string, unknown>;
  metrics?: { duration: number };
};

/** The injected transport. Any object with a `log` that accepts a Braintrust
 *  record satisfies it — including a real `braintrust` experiment/logger. */
export type BraintrustTransport = {
  log: (record: BraintrustRecord) => Promise<void> | void;
};

/** Build a sink that maps each TelemetryEvent to a Braintrust record and hands
 *  it to the injected transport. A transport failure propagates (fail loud), so
 *  a broken integration is never a silent drop. */
export function makeBraintrustSink(deps: BraintrustTransport): TelemetrySink {
  return async (event: TelemetryEvent): Promise<void> => {
    const record: BraintrustRecord = {
      id: event.runId,
      input: { configId: event.configId, archetype: event.archetype },
      output: event.verdict.status,
      scores: event.verdict.scores ?? {},
      metadata: {
        configId: event.configId,
        archetype: event.archetype,
        timestamp: event.timestamp,
        reasons: event.verdict.reasons,
        violations: event.verdict.violations,
        failedDimensions: event.verdict.failedDimensions,
      },
    };
    if (event.durationMs !== undefined) {
      record.metrics = { duration: event.durationMs };
    }
    await deps.log(record);
  };
}
