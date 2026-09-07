# Lane D — Telemetry — WIRING

Vendor-agnostic telemetry: a zero-dependency JSONL sink (default), a
Braintrust-compatible adapter behind an injected transport (named integration,
no hard dep), a tee/multi-sink, and a pure read/query API the dashboard (Lane F)
and CLI report (Lane E) consume.

Owns `src/telemetry/**` only. Consumes only `TelemetryEvent` and `TelemetrySink`
from `src/types.ts` (plus `Verdict`/`VerdictStatus` for the query return types).
`src/types.ts` was **not** modified.

## Integration (do this in the root, NOT in this lane)

`src/index.ts` is a shared file. This lane did not edit it. Integration folds the
surface in with one line:

```ts
export * from "./telemetry/index.js";
```

## Exports + signatures

All re-exported from `src/telemetry/index.js`.

### Sinks

```ts
// Default, zero-dependency. Appends one TelemetryEvent per line. Creates the
// parent dir/file if missing. Append-only: never truncates prior lines.
makeJsonlSink(path: string): TelemetrySink

// Fan one event to several sinks. Every sink is invoked even if a sibling
// throws (sync or async); rejects with the first failure so it is never
// silently swallowed. teeSinks() with no args is a resolving no-op.
teeSinks(...sinks: TelemetrySink[]): TelemetrySink

// Braintrust-compatible adapter. `deps` is an INJECTED transport; the
// `braintrust` package is never imported here, so the core stays zero-dep.
makeBraintrustSink(deps: BraintrustTransport): TelemetrySink

type BraintrustTransport = { log: (record: BraintrustRecord) => Promise<void> | void }
type BraintrustRecord = {
  id: string;
  input: { configId: string; archetype: string };
  output: string;                       // verdict.status: "PASS" | "BLOCK"
  scores: Record<string, number>;       // verdict.scores, or {} if none
  metadata: Record<string, unknown>;
  metrics?: { duration: number };       // present only when durationMs is set
}
```

### Read / query API (pure functions over read events)

```ts
readEvents(path: string): TelemetryEvent[]        // missing file -> []
eventsByConfig(events: TelemetryEvent[], configId: string): TelemetryEvent[]
verdictHistory(events: TelemetryEvent[], configId: string): VerdictStatus[]   // chronological
autonomyStreak(events: TelemetryEvent[], configId: string): number            // consecutive-PASS tail
```

`verdictHistory` and `autonomyStreak` order by **parsed time** (`Date.parse` on
each `timestamp`), not by lexical string comparison, so equal instants written
with different UTC offsets (`+05:00` vs `Z`) or fractional precision (`…00Z` vs
`…00.500Z`) sort correctly. An **unparseable** timestamp throws, naming the
offending value, rather than sorting to `NaN` and landing arbitrarily. Two events
sharing the exact same parsed instant keep their input (append) order.
`eventsByConfig` does not sort — it preserves input order.

## JSONL line format

One `TelemetryEvent` serialized with `JSON.stringify`, one per line, `\n`
terminated, UTF-8, append-only. Each line is exactly the `TelemetryEvent` shape
from `types.ts`:

```json
{"runId":"run-001","timestamp":"2026-09-06T10:00:00.000Z","configId":"cfg-outbound-demo","archetype":"outbound","verdict":{"status":"PASS","violations":[],"reasons":["all clear"]},"durationMs":1234}
```

- `durationMs` is optional (omitted when absent).
- Blank / whitespace-only lines are skipped by `readEvents`.
- **A malformed line (invalid JSON) or a well-formed line that is not a valid
  `TelemetryEvent` throws a loud error naming the 1-based line number.** A corrupt
  line is never treated as a clean event. `readEvents` validates both shape and
  the values of the load-bearing fields:
  - `runId`, `timestamp`, `configId`, `archetype` must each be a **non-empty**
    string.
  - `verdict.status` must be **exactly** `"PASS"` or `"BLOCK"` (a status like
    `"MAYBE"` is rejected, not kept — it would otherwise corrupt the autonomy
    streak downstream).
  - `verdict.violations` and `verdict.reasons` must each be an array.
- **Unknown extra top-level fields are deliberately allowed** (a line with fields
  beyond the `TelemetryEvent` contract is kept, not rejected). This is a conscious
  forward-compatibility decision: a newer producer can add fields without a reader
  built against this version refusing its logs. Validation is a floor on the known
  fields, not a closed schema. Covered by the `jsonl.test.ts` test "keeps a valid
  event that carries unknown extra top-level fields (forward-compat)".

## Braintrust adapter mapping

`makeBraintrustSink({ log })` maps each `TelemetryEvent` to a `BraintrustRecord`:

| TelemetryEvent                                                        | BraintrustRecord   |
| -------------------------------------------------------------------- | ------------------ |
| `runId`                                                              | `id`               |
| `{ configId, archetype }`                                           | `input`            |
| `verdict.status`                                                    | `output`           |
| `verdict.scores` (`{}` if none)                                    | `scores`           |
| `configId, archetype, timestamp, reasons, violations, failedDimensions` | `metadata`     |
| `durationMs` (omitted if absent)                                   | `metrics.duration` |

A real Braintrust client is wired by the consumer, e.g.:

```ts
import { initLogger } from "braintrust"; // consumer's dependency, not this repo's
const logger = initLogger({ projectName: "gtm-agent-evals" });
const sink = makeBraintrustSink({ log: (r) => logger.log(r) });
```

`scores` are passed through as the rubric produced them. Braintrust's convention
is 0..1; the rubric owner (Lane A/C) decides normalization — this adapter does
not rescale.

## Composing sinks

```ts
const sink = teeSinks(
  makeJsonlSink("telemetry/events.jsonl"),   // durable local record (dashboard reads this)
  makeBraintrustSink({ log: (r) => logger.log(r) }),
);
await sink(event);
```

## For Lane F (dashboard) and Lane E (CLI report)

Read with `readEvents(path)`, then:

- **verdict history per config** → `verdictHistory(events, configId)`
- **autonomy streak per config** → `autonomyStreak(events, configId)`
- **filter** → `eventsByConfig(events, configId)`

All three are pure and synchronous; a static build can call them directly on the
parsed JSONL with no server.

## Tests

`npm test` (vitest). 30 tests across 5 files, all green. Notable guards:

- Append-safety: `jsonl.test.ts` → "appends after existing lines without
  truncating prior events" (pre-seeds a file, appends two, asserts all three
  lines survive in order).
- Corrupt line: `jsonl.test.ts` → "throws a loud error naming the line number on
  a malformed line" and "rejects a well-formed JSON line that is not a telemetry
  event shape".
