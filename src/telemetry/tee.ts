// A multi-sink that fans one TelemetryEvent to several sinks. Every sink is
// invoked even if a sibling fails, so one broken transport never silently drops
// the event from the healthy ones. If any sink failed, the tee rejects with the
// first failure (surfacing the problem rather than swallowing it).

import type { TelemetryEvent, TelemetrySink } from "../types.js";

/** Fan one event to several sinks. Returns a sink that resolves once every child
 *  has settled; rejects with the first error if any child threw or rejected. */
export function teeSinks(...sinks: TelemetrySink[]): TelemetrySink {
  return async (event: TelemetryEvent): Promise<void> => {
    // Wrap each call in its own async closure so a *synchronous* throw from one
    // sink becomes a rejected promise instead of aborting the fan-out loop.
    const results = await Promise.allSettled(sinks.map(async (sink) => sink(event)));
    const firstRejection = results.find((r) => r.status === "rejected");
    if (firstRejection && firstRejection.status === "rejected") {
      throw firstRejection.reason;
    }
  };
}
