# gtm-agent-evals — SPEC

An open-source **eval + regression platform for GTM agents** (content, outbound,
research, deal-coaching). Deterministic rules, an LLM rubric that fails closed, an
N-clean-runs autonomy gate, golden-trajectory regression, vendor-agnostic
telemetry, a CI gate, and a dashboard. The strongest single hireable proof point
for an AI-first GTM Engineer: it answers "what have you shipped that is
production-grade" with a repo a stranger clones and runs.

Row 33 of the build queue, "go bigger" scope (Jason, 2026-09-06): the full
platform across two days, telemetry backend and dashboard included.

- **Language:** TypeScript. **Test runner:** vitest. **License:** MIT.
- **Repo:** `github.com/derrtaderr/gtm-agent-evals` (Jason's personal GitHub, not
  Magnetiz's). Private until a standalone publish-yes; this is a personal build,
  not Magnetiz IP.
- **Not Magnetiz IP.** No client-specific rules, no proprietary rubrics. Eval
  only; the agents themselves are the consumer's choice.

## Prior art this platform stands on (checked 2026-09-06, do not rebuild)

- **`gtm-content-evals`** (public) already implements the three-layer gate for the
  **content** archetype: deterministic rules, an LLM rubric that fails closed to
  BLOCK, and an N-clean-runs autonomy gate. It is the reference implementation of
  the `content` archetype and the proven seam this platform generalizes. Its
  types (`RuleFn`, `EvalConfig{rules,rubric,gateN}`, `RunRecord`,
  `computeStreak`/`clearedForAutonomy`) are lifted from `text: string` to
  `AgentRun` here. **Reuse its shape; do not fork it or reshape it.**
- **`earn-autonomy`** (public) is the N-clean-runs pattern in another setting.
- **`evalgate`**, **`gtm-content-evals`** are the substrate; this is the
  generalization + the regression/telemetry/CI/dashboard halves that were missing.

## The contract: `src/types.ts`

`src/types.ts` is committed in this spec commit and is the single shared contract.
Every lane codes to it. **A lane must not change a type in `types.ts` on its own** —
a type change is a cross-lane event and goes through this SPEC. The core move: the
subject of evaluation is an `AgentRun` (a trajectory), never a bare string. A
content run is the case where `output` is prose and `steps` is empty.

## Components and lane decomposition

Six components. The four Phase-1 lanes all code only to `types.ts`, so they run in
parallel. Phase-2 lanes depend on a Phase-1 seam having landed.

### Phase 1 (parallel, code to `types.ts`)

- **Lane A — engine.** `src/rules/` registry (`buildRuleRegistry`), `src/scoring/`
  (LLM provider + a deterministic fake provider for tests; fails CLOSED on
  provider error), `src/gate/` (`evaluate(run, config, deps) -> Verdict`
  combining rules + rubric), and `src/runlog/` (`computeStreak`,
  `clearedForAutonomy`) ported to `RunRecord`. The spine every other lane and the
  CLI consume. Owns: `src/rules/**` (registry + generic rules only, NOT archetype
  rule sets), `src/scoring/**`, `src/gate/**`, `src/runlog/**`, `src/evaluate.ts`.
- **Lane C — archetypes.** Three worked archetypes as configs + rule sets +
  synthetic fixtures: `content` (port gtm-content-evals' rules to `RuleFn` over
  `AgentRun.output`), `outbound` (cold-email rules: no-fabricated-personalization,
  required-CTA, length, and a rubric for relevance/specificity), `research`
  (grounding rules: every claim cites a source step, no-uncited-assertion, and a
  rubric for citation quality). Owns: `src/archetypes/**`, `examples/**`,
  `fixtures/**`. Consumes Lane A's `RuleFn`/`EvalConfig` types only.
- **Lane B — regression.** Golden-trajectory store (`src/regression/`): record a
  known-good `AgentRun` + its `Verdict` as a `GoldenRecord`, replay, and diff into
  a `RegressionResult` (MATCH / DRIFT / REGRESSION). REGRESSION = was PASS now
  BLOCK, or a scored dimension dropped past tolerance. Owns: `src/regression/**`.
  Consumes `AgentRun`, `Verdict`, `GoldenRecord` types only.
- **Lane D — telemetry.** `src/telemetry/`: a JSONL `TelemetrySink` (default,
  zero-dep) and a Braintrust-compatible adapter (named integration, behind an
  interface, no hard dep), plus a query/read API the dashboard consumes. Owns:
  `src/telemetry/**`. Consumes `TelemetryEvent`/`TelemetrySink` types only.

### Phase 2 (after the Phase-1 seams land)

- **Lane E — CLI + CI.** `src/cli/` commands: `eval` (run a config over a run,
  print a verdict, exit code by status), `record` (write a golden), `regress`
  (replay goldens, exit non-zero on REGRESSION), `report` (read telemetry).
  Machine-safe exit codes (0 PASS, 1 usage, 2 unreadable input/config, 3 BLOCK,
  4 REGRESSION) and a GitHub Action (`action.yml` + workflow example) that blocks
  a merge on BLOCK or REGRESSION. Depends on Lane A (engine) + Lane B (regress).
- **Lane F — dashboard.** A self-contained dashboard over the telemetry store:
  verdict history, autonomy streaks per config, and regression status per golden.
  Ships as a single static build (no server required to view) reading the JSONL
  the telemetry sink wrote. Depends on Lane D (telemetry read API).

### The README (Lane A folds it in, or a final doc lane)

README is the marketing surface. Reads like a Maja Voje resource: frame the
problem (drafting is no longer the bottleneck; the failure moved downstream to
un-evaluated agents), name the pattern (evals gate agents the way tests gate a
deploy), walk the three worked archetypes and the regression story. Cite
influences (Hamel Husain on LLM evals; Braintrust for telemetry). A stranger
clones and runs the quickstart in under two minutes. **Every runnable example in
the README must match real output** — the redaction-gate README drift is the
cautionary precedent; the ship-check gate verifies this.

## Discipline (binding on every lane)

- **TDD, watch-the-red, commit per cycle.** superpowers TDD. No production line
  without a failing test first. Fixtures are synthetic; never a real client name,
  vault path, or secret in any file.
- **Fail closed.** The rubric BLOCKs on any scorer failure. The regress command
  exits non-zero on REGRESSION. A malformed config is a refusal, not a silent
  pass. These are the platform's thesis; they get the sharpest tests.
- **Report as data, WIRING.md not vault edits.** Lane agents write a
  `WIRING.md`, never edit the vault. The orchestrator verifies (re-runs tests,
  exercises the artifact, sweeps for private data) before any merge.
- **Senior review before merge.** Each lane's diff gets an independent ship-check
  (five senior passes: blast-radius, claim-vs-code, refute, severity, missing-
  question) plus a stranger walk. Merge only on a clean bless.

## Ships in the two-day window vs. defers

- **Ships:** all six components above, MIT-licensed, README-as-marketing, synthetic
  fixtures across three archetypes, green CI on the repo itself.
- **Defers (post-window, only if signal):** a Python port; more than three
  archetypes; a hosted/live dashboard (the shipped one is static-over-JSONL); real
  Braintrust account wiring beyond the adapter interface.

## Iteration log

- 2026-09-06 — spec locked, `types.ts` committed, scope = full platform ("go
  bigger"). Lanes A/B/C/D are Phase 1; E/F Phase 2.
