# Lane E — CLI + CI gate — WIRING

The command-line surface and GitHub Action that turn the engine (Lane A) +
regression (Lane B) + telemetry (Lane D) into a gate CI can block a merge on.

Owns: `src/cli/**`, `action.yml`, `.github/workflows/eval-gate.yml`. Consumes the
package root (`src/index.ts`) only — `evaluate`, `buildRuleRegistry`,
`allArchetypeRules`, `makeClaudeProvider`, `record`, `saveGolden`, `loadGoldens`,
`regressAll`, `makeJsonlSink`, `readEvents`, `verdictHistory`, `autonomyStreak` —
plus the frozen types. No type in `src/types.ts` was changed; `src/index.ts` was
not edited (the CLI is a leaf, not part of the library surface).

## Entry points

- `src/cli/index.ts` — the `bin` (`gtm-agent-evals`, `package.json` →
  `dist/cli/index.js`). The only file touching `process.argv` / `process.exit`.
- `src/cli/run.ts` — `run(argv: string[], io?: CliIo): Promise<number>`. Returns
  the exit code so every command is unit-testable without spawning. Tests capture
  `io.out` / `io.err` and inject `io.env` (the API key is read from `io.env`,
  never from `process.env` directly, and is never printed).

## Commands

| command   | required flags                          | optional flags                    | success exit |
| --------- | --------------------------------------- | --------------------------------- | ------------ |
| `eval`    | `--config <cfg.json> --run <run.json>`  | `--rules-only`, `--telemetry <p>` | 0 PASS / 3 BLOCK |
| `record`  | `--config --run --store <goldens.jsonl>`| `--rules-only`, `--telemetry <p>` | 0 PASS / 3 BLOCK |
| `regress` | `--store <goldens.jsonl> --runs <p>`    | —                                 | 0 / 4 REGRESSION |
| `report`  | `--telemetry <events.jsonl>`            | —                                 | 0            |
| `help`    | —                                       | —                                 | 0            |

- **eval** — load + validate the config and run, build the registry
  (`buildRuleRegistry()` merged with `allArchetypeRules` so archetype rule names
  resolve), `evaluate()`, print the verdict, exit by status. Emits a
  `TelemetryEvent` when `--telemetry` is given.
- **record** — evaluate, then `record(run, verdict)` and `saveGolden(golden, store)`.
  Records whatever verdict results and exits by status; a non-passing verdict is
  recorded but flagged on stderr (a golden is meant to be a known-good run).
- **regress** — `loadGoldens(store)`, read the `--runs` file (see below),
  `regressAll(goldens, runs, verdicts)`, print each result, exit **4** if any is
  `REGRESSION`.
- **report** — `readEvents(telemetry)`, then per distinct config print
  `verdictHistory` and `autonomyStreak`.

### `--runs` file shape (regress)

A JSON array of already-evaluated pairs:

```json
[{ "run": { "archetype": "outbound", "input": "...", "output": "..." },
   "verdict": { "status": "PASS", "violations": [], "reasons": [] } }]
```

Kept **pre-evaluated** so `regress` is deterministic and needs **no API key** in
CI. Produce the verdicts in an upstream `eval` step (or your own harness), then
diff them against the goldens here. `regressAll` matches fresh runs to goldens by
`(archetype, input)`, not by position, and a golden with no matching fresh run is
an explicit REGRESSION (a lost trajectory is a failure, not a pass).

## Exit codes (machine-safe, the CI contract)

| code | name       | meaning                                                        |
| ---- | ---------- | ------------------------------------------------------------- |
| 0    | PASS       | the run cleared the gate (or a successful `regress`/`report`) |
| 1    | USAGE      | bad invocation: unknown/absent command, missing required flag |
| 2    | INPUT      | a file was unreadable, or a config/run/store was malformed    |
| 3    | BLOCK      | the gate BLOCKed the run                                       |
| 4    | REGRESSION | at least one golden regressed on replay                        |

`UsageError → 1`; every other thrown error fails closed to `2` — an unreadable or
malformed input is never allowed to look like a PASS. Proven by
`src/cli/run.test.ts` (exit 0/1/2/3/4 each asserted) and `src/cli/exit.test.ts`.

## Fail-closed config validation (`src/cli/load.ts`)

This is where untrusted runtime JSON crosses into the platform, so validation
lands here (the engine review's carried finding).

- **Unknown `severity`** — a rule config whose `params.severity` is present but
  not `"block"` / `"warn"` is **coerced UP to `"block"`** (the safe direction —
  never silently downgraded to a non-blocking `warn`), and a warning naming the
  rule is written to stderr. Documented and tested
  (`load.test.ts` → "unknown severity coerces to block").
- **Malformed config** — not an object, missing/empty `archetype`, missing/
  non-array `rules`, a rule with no `name`, a rule name **absent from the
  registry**, missing/non-numeric `gateN`, or a malformed `rubric` → `InputError`
  → **exit 2**, never a silent pass. Same for a malformed run (missing `output`,
  non-array `steps`) and a malformed `--runs` file (a verdict `status` that is not
  exactly `PASS`/`BLOCK`).
- A missing file or invalid JSON → **exit 2**.

## Provider / API key

- Full `eval`/`record` build `makeClaudeProvider(io.env.ANTHROPIC_API_KEY ?? "")`.
  The engine fails **closed**: a keyless full eval BLOCKs (the scorer cannot run),
  which is correct, not a bug.
- `--rules-only` strips the rubric and runs deterministic rules **without** the
  rubric — the keyless CI path for the rules layer. The provider is never invoked
  in this mode (a guard throws if it somehow is).
- The key is read from `io.env` and **never printed or logged**.

## Telemetry emission

`eval` and `record` append a `TelemetryEvent` to `--telemetry <path>` via
`makeJsonlSink` when the flag is given: `runId` (uuid), ISO-8601 `timestamp` (a
`Z`-suffixed `toISOString()`, which the query layer accepts), `configId`
(`config.id ?? config.archetype`), `archetype`, the `verdict`, and `durationMs`.

## CI (`action.yml` + `.github/workflows/eval-gate.yml`)

- `action.yml` is a **composite** action: inputs `config`, `run`, `rules-only`,
  `anthropic-api-key`, `store`, `runs`, `telemetry`. It runs `eval` (blocking on
  exit 3) and, when `store` + `runs` are both set, `regress` (blocking on exit 4).
  A consumer swaps the build-from-checkout steps for `npx gtm-agent-evals`.
- `eval-gate.yml` is a runnable example: a `gate` job that must PASS a clean run,
  a `test` job (the full suite), and a `gate-blocks-bad-run` job that asserts the
  CLI exits **3** on `fixtures/outbound/failing.json` — the proof the gate stops a
  bad run from merging. It runs on the repo's own synthetic fixtures so CI stays
  green.

## Tests

`npm test` (vitest). CLI files: `args.test.ts` (5), `exit.test.ts` (4),
`load.test.ts` (22), `run.test.ts` (14) — 45 CLI tests. `run.test.ts` proves each
exit code (0/1/2/3/4), the fail-closed keyless BLOCK, telemetry emission, golden
recording, regression exit 4, and report streak output.
