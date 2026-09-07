// Lane D public surface. Integration folds this into the package root with:
//   export * from "./telemetry/index.js";
// (see WIRING.md). This lane does not edit src/index.ts.

export { makeJsonlSink, readEvents } from "./jsonl.js";
export { teeSinks } from "./tee.js";
export {
  makeBraintrustSink,
  type BraintrustRecord,
  type BraintrustTransport,
} from "./braintrust.js";
export { eventsByConfig, verdictHistory, autonomyStreak } from "./query.js";
