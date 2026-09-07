# Lane F — Dashboard — WIRING

A **self-contained static dashboard** over the telemetry store. A generator reads
the telemetry JSONL (and optionally a regression-results JSON) and emits a single
HTML file with **inline CSS and inline JS, no external assets and no server** — a
stranger opens the file in a browser. This matches the platform's "distribute,
don't host" posture.

Owns `src/dashboard/**` only. Consumes:

- Lane D telemetry read API (`readEvents`, `verdictHistory`, `autonomyStreak`,
  `eventsByConfig`) — history/streak logic is **not** reimplemented here.
- Lane A `clearedForAutonomy` (from `src/runlog/`) for the gate decision.
- The frozen types in `src/types.ts` (`TelemetryEvent`, `Verdict`,
  `VerdictStatus`, `RegressionResult`, `RegressionStatus`). `src/types.ts` was
  **not** modified.

## Integration (already folded into the root)

`src/index.ts` re-exports the surface with one additive line (it edits no other
lane's tree):

```ts
export * from "./dashboard/index.js";
```

## Exports + signatures

All re-exported from `src/dashboard/index.js` (and the package root).

### Data layer (pure, unit-tested)

```ts
buildViewModel(events: TelemetryEvent[], options?: BuildViewModelOptions): DashboardViewModel

type BuildViewModelOptions = {
  regressions?: RegressionResult[];          // omitted -> no regression rows
  gateNByConfig?: Record<string, number>;    // per-config N-clean-runs gate
};
```

`buildViewModel` takes the telemetry events (plus optional regression results and
per-config gateN) and returns the view model. It does no IO, so it is testable in
isolation. Streak and history come straight from Lane D's query API; the
cleared-for-autonomy decision comes from Lane A's `clearedForAutonomy`.

### View-model shape

```ts
type DashboardViewModel = {
  summary: DashboardSummary;
  configs: ConfigView[];
  regressions: RegressionView[];
};

type DashboardSummary = {
  totalRuns: number;
  passCount: number;
  blockCount: number;
  passRate: number;   // 0..1; 0 on an empty store (never divides by zero)
  configCount: number;
};

type ConfigView = {
  configId: string;
  archetype: string;
  history: VerdictStatus[];        // chronological PASS/BLOCK (Lane D verdictHistory)
  total: number;
  passCount: number;
  streak: number;                  // consecutive-PASS tail (Lane D autonomyStreak)
  gateN?: number;                  // when the caller supplied it
  clearedForAutonomy?: boolean;    // undefined when gateN is unknown
  latestStatus?: VerdictStatus;    // the chronologically-latest run's status
  latestReason?: string;           // latest run's reasons, joined; shown when blocked
};

type RegressionView = {
  goldenId: string;
  status: RegressionStatus;        // MATCH | DRIFT | REGRESSION
  diffCount: number;
};
```

### Render layer

```ts
renderDashboard(vm: DashboardViewModel): string   // full <!doctype html> document
escapeHtml(value: string): string                 // used on every event-origin string
```

`renderDashboard` returns the entire HTML document as a string. It is
**self-contained**: inline `<style>` and inline `<script>`, no `<link>`, no
`src=`, no `http(s)://` reference (asserted by tests). Every value that
originates in event data — config ids, verdict reasons, regression golden ids —
passes through `escapeHtml` before entering the markup, so a reason carrying
`<script>` renders as inert text (asserted by tests).

### Generate + CLI (the only IO)

```ts
generateDashboard(
  telemetryPath: string,
  outPath: string,
  regressionPath?: string,
  options?: { gateNByConfig?: Record<string, number> },
): string   // returns the output path written

parseDashboardArgs(argv: string[]): { telemetryPath; outPath; regressionPath? }
```

`generateDashboard` reads the telemetry JSONL via Lane D's `readEvents` (which
fails loud on a corrupt line; a missing file yields an empty store and the empty
state renders), optionally reads a regression-results JSON file (which **must be
a JSON array** of `RegressionResult` — anything else throws), builds the view
model, renders, creates the output directory if needed, and writes the file.

The regression-results JSON is exactly `RegressionResult[]` — the same shape Lane
B's `regressAll` returns and Lane E's `regress` command can serialize.

## How a stranger generates + opens the dashboard

```bash
npm install
npm run build                      # tsc -> dist/

# minimal: telemetry JSONL -> HTML
node dist/dashboard/cli.js telemetry/events.jsonl dashboard.html

# with regression results folded in
node dist/dashboard/cli.js telemetry/events.jsonl dashboard.html --regression regression.json

open dashboard.html                # macOS; or double-click it. No server needed.
```

Programmatic use:

```ts
import { generateDashboard } from "gtm-agent-evals";
generateDashboard("telemetry/events.jsonl", "dashboard.html", "regression.json", {
  gateNByConfig: { "cfg-outbound-demo": 5 },   // so "cleared" status can render
});
```

`gateN` is not carried in the telemetry stream, so the cleared-for-autonomy badge
renders only when the caller supplies `gateNByConfig`. Without it, the streak is
still shown; the gate cell reads `—`.

## Tests

`npm test` (vitest). Lane F adds 6 test files:

- `escape.test.ts` — the five HTML-significant characters, `<script>`
  neutralized, ampersand-first ordering.
- `model.test.ts` — summary counts + pass rate (no divide-by-zero), chronological
  history, streak, config sort, cleared/not-cleared vs gateN, latest-block reason.
- `render.test.ts` — full document, **self-contained** (no `src=`/`<link>`/
  `http(s)`), summary numbers, config rows, streak/cleared, regression rows,
  empty state, and **escaping of config ids, golden ids, and the required
  reason-`<script>` test**.
- `generate.test.ts` — reads JSONL and writes HTML, returns the path, folds in
  regression JSON, empty state on missing file, throws on non-array regression
  JSON, gateN pass-through.
- `cli.test.ts` — positional + `--regression` arg parsing and usage errors.

Synthetic fixtures only (invented `cfg-*` / `golden-*` ids). No real client,
vault path, or secret in any file.

## Regression rows and telemetry configs are independent

The regression section renders one row per `RegressionResult` and the per-config
section renders one row per telemetry config. There is no join, merge, or filter
between them: a golden with no corresponding telemetry config (or vice versa) is
intended. The two sections answer different questions and sit side by side by design.
