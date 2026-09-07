# Lane B — Regression: WIRING

Golden-trajectory record / replay / diff. This is the platform's differentiator over a
plain gate: it does not just re-score a run, it records a known-good trajectory and fails
loud when a later run drifts or regresses.

Owned tree: `src/regression/**`. Consumes only these frozen types from `src/types.ts`:
`AgentRun`, `Verdict`, `GoldenRecord`, `RegressionStatus`, `TrajectoryDiff`,
`RegressionResult`. No type in `types.ts` was changed.

Everything below is re-exported from the package root (`src/index.ts`) via
`src/regression/index.ts`.

## Exported symbols

```ts
// record.ts
function record(run: AgentRun, verdict: Verdict, options?: RecordOptions): GoldenRecord
function goldenId(archetype: string, input: string): string
type RecordOptions = { id?: string; recordedAt?: string }

// diff.ts
function diffTrajectory(golden: AgentRun, actual: AgentRun): TrajectoryDiff[]

// classify.ts
function classify(
  golden: GoldenRecord,
  freshRun: AgentRun,
  freshVerdict: Verdict,
  options?: ClassifyOptions,
): RegressionResult
const DEFAULT_SCORE_TOLERANCE = 1.0
type ClassifyOptions = { scoreTolerance?: number }

// regress.ts
function regressAll(
  goldens: GoldenRecord[],
  freshRuns: AgentRun[],
  freshVerdicts: Verdict[],
  options?: ClassifyOptions,
): RegressionResult[]

// store.ts
function saveGolden(golden: GoldenRecord, path: string): void
function loadGoldens(path: string): GoldenRecord[]
function loadGolden(path: string, id: string): GoldenRecord | undefined
```

## Golden store format

A single **JSONL** file, one `GoldenRecord` JSON object per line. Chosen over a
directory-of-files so the store is one artifact CI can commit, diff, and `cat`, and stays
append-friendly.

- Records are keyed by `id`. `saveGolden` is an **upsert**: re-saving a golden with the
  same id replaces its line rather than appending a duplicate.
- `id` is derived by `goldenId(archetype, input)` = `` `${archetype}-${sha256(archetype\0input)[:16]}` ``,
  so re-recording the same case is idempotent. Override with `RecordOptions.id`.
- A missing store file reads as an empty store (`[]`), never an error.
- `saveGolden` writes **atomically**: it writes a sibling temp file then `rename`s it over
  the target (atomic on the same filesystem), so a crash mid-write can never corrupt the
  committed CI golden store — a reader sees either the old store or the fully-written new
  one, never a torn file.
- Default path convention for the CLI: `goldens.jsonl` in the repo root (CLI lane's call).

Example line (formatted here for reading; on disk it is one line):

```json
{ "id": "outbound-1a2b...", "archetype": "outbound", "input": "...", "run": { ... }, "verdict": { ... }, "recordedAt": "2026-09-06T00:00:00.000Z" }
```

## Classification contract (what the CI gate keys on)

`classify` / `regressAll` return a `RegressionResult { goldenId, status, diffs }`.

- **REGRESSION** — was PASS now BLOCK, **or** a scored dimension eroded past tolerance.
  A dimension eroded when it dropped by more than `scoreTolerance` (default `1.0`, i.e.
  `goldenScore - freshScore > tol` — strictly greater; a drop of exactly the tolerance is
  within budget) **or when it VANISHED**: the golden scored it but the fresh verdict omits
  it (undefined, no `scores` object, or `scores: {}`). A vanished dimension is the
  largest possible drop (drop-to-zero semantics) — the agent, or the scorer, stopped
  producing that quality signal, and the gate must fail loud, never silently MATCH. A
  dimension the golden never scored cannot regress. Each regressed dimension is surfaced in
  `diffs` as a `scores.<dim>` entry (`RegressionResult` has no free-text `reasons` field, so
  the named dimension rides the `diffs` channel). This is the fail-loud case: the CLI
  `regress` command must exit non-zero when any result is REGRESSION.
- **MATCH** — same verdict status **and** no trajectory diffs (identical, or only-metadata
  differences — `diffTrajectory` deliberately ignores `metadata`).
- **DRIFT** — any other non-regressive outcome: the trajectory (or a still-passing verdict)
  moved, but it is not a regression. Non-blocking, worth surfacing.

`diffTrajectory` emits dotted-path diffs over `output`, each `steps[i].kind` /
`steps[i].name` / `steps[i].content`, and the overall `toolCallSequence` (ordered
`tool_call` names). `metadata` is not diffed.

### Loud-failure / never-silent-MATCH boundaries

- `classify` **throws** on a mismatched input (golden.input !== freshRun.input) **or a
  mismatched archetype** (golden.archetype !== freshRun.archetype): the caller paired the
  wrong run with this golden.
- `regressAll` matches fresh runs to goldens by `(archetype, input)`, not position, so
  `freshRuns[i]` pairs with `freshVerdicts[i]` but order across the arrays is free. A golden
  with **no matching fresh run** yields an explicit **REGRESSION** (a lost trajectory is a
  failure, not a pass), never a silent MATCH.
- `regressAll` throws when `freshRuns.length !== freshVerdicts.length`.

## How the CLI lane (Lane E) wires this

- `record` command: build an `AgentRun`, get its `Verdict` from the engine (Lane A
  `evaluate`), call `record(run, verdict)`, `saveGolden(golden, storePath)`.
- `regress` command: `loadGoldens(storePath)`, re-run the agent to produce fresh
  `AgentRun`s, evaluate each for a fresh `Verdict`, call
  `regressAll(goldens, freshRuns, freshVerdicts)`. Exit code 4 (per SPEC) if any result
  `status === "REGRESSION"`.
