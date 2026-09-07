# WIRING — Lane A (engine)

The spine every other lane and the CLI consume. Everything below is re-exported
from `src/index.ts`, so consumers import from the package root (or the deep path
noted). All symbols code to the frozen `src/types.ts`; the subject of evaluation
is always an `AgentRun`, never a bare string.

## Top-level orchestration — `src/evaluate.ts`

```ts
type EvaluateDeps = {
  registry: Record<string, RuleFn>;
  provider: LLMProvider;
};

function evaluate(
  run: AgentRun,
  config: EvalConfig,
  deps: EvaluateDeps,
): Promise<Verdict>;
```

Runs `config.rules` over the run, scores `config.rubric` via `deps.provider`,
and combines into a `Verdict`. Contract:

- An **unknown rule name** in the config **throws** (a refusal — never a silent
  pass). Callers that accept untrusted configs should catch and surface it.
- A **scorer rejection** is caught and turned into a fail-closed **BLOCK**
  (`scores` stays `{}`); it never becomes a zero-that-passes.
- `PASS` only when no `block`-severity violation exists AND (no rubric, or every
  dimension meets threshold).

## Rules — `src/rules/index.ts` (+ `src/rules/*.ts`)

```ts
type RuleRegistryDeps = Record<string, never>; // generic rules need no deps today

function buildRuleRegistry(deps?: RuleRegistryDeps): Record<string, RuleFn>;

function runRules(
  run: AgentRun,
  ruleConfigs: RuleConfig[],
  registry: Record<string, RuleFn>,
): Promise<Violation[]>; // throws on an unknown rule name
```

`buildRuleRegistry()` returns the GENERIC, cross-archetype rules only:

| name                      | params                                            | severity default |
| ------------------------- | ------------------------------------------------- | ---------------- |
| `max-output-length`       | `{ max: number, severity?: "block" \| "warn" }`   | block            |
| `required-metadata-field` | `{ field: string, severity?: "block" \| "warn" }` | block            |
| `forbidden-substring`     | `{ substrings: string[], severity?: ... }`        | block            |

Each rule is also exported individually as a `RuleFn`: `maxOutputLength`,
`requiredMetadataField`, `forbiddenSubstring`.

**Lane C (archetypes):** layer your archetype-specific rules onto this map, e.g.
`{ ...buildRuleRegistry(), 'no-em-dash': noEmDash, ... }`. Do not modify this
registry — extend it.

## Scoring — `src/scoring/index.ts` (+ `claude-provider.ts`)

```ts
function scoreRun(
  run: AgentRun,
  rubric: Rubric | undefined,
  provider: LLMProvider,
): Promise<Scores>; // {} without a rubric / zero dims; provider rejection propagates

function parseScores(text: string, dimensions: string[]): Scores; // pure, fails CLOSED

function makeFakeProvider(scores: Scores): LLMProvider; // deterministic test double

type ClaudeSend = (prompt: string) => Promise<string>;
type ClaudeProviderOpts = { model?: string; send?: ClaudeSend };
function makeClaudeProvider(apiKey: string, opts?: ClaudeProviderOpts): LLMProvider;
```

**Fail-closed is the thesis.** The provider REJECTS (never returns a partial or
a zero) on:

- missing API key (`makeClaudeProvider("")` rejects at call time),
- any transport error (propagated),
- a reply with no JSON object (`parseScores` throws),
- a non-numeric score,
- a requested dimension absent from the reply.

`makeClaudeProvider` defaults to model `claude-opus-5`; override via
`opts.model`. `opts.send` injects a transport (tests use it; the default builds
one from the SDK using `apiKey`). `makeFakeProvider` throws for any requested
dimension it has no score for, so tests exercise the same fail-closed contract.

## Gate — `src/gate/index.ts`

```ts
function evaluateGate(
  violations: Violation[],
  scores: Scores,
  rubric: Rubric | undefined,
  scoringError?: string,
): Verdict;
```

The pure combiner (no I/O). `BLOCK` if any `block`-severity violation, OR a
`scoringError` is present (dimensions are then NOT evaluated — already failed
closed), OR any dimension is missing / non-numeric / under threshold (recorded
in `failedDimensions`). `warn` violations are kept in `violations` but never
force a BLOCK. `reasons` carries one human-readable line per issue.

## Run log / autonomy gate — `src/runlog/index.ts`

```ts
function computeStreak(runs: RunRecord[], configId: string): number;
function clearedForAutonomy(streak: number, gateN: number): boolean;
function readRuns(path: string): Promise<RunRecord[]>;   // missing/corrupt file -> []
function appendRun(path: string, record: RunRecord): Promise<void>;
```

`computeStreak` counts consecutive trailing `PASS` runs for `configId` (a
`BLOCK` resets; other configs are skipped). `clearedForAutonomy` is the
N-clean-runs gate (`streak >= gateN`).

## Not owned by Lane A

Archetype-specific rule sets and fixtures (Lane C), golden-trajectory regression
(Lane B), telemetry sinks (Lane D), and the CLI/CI (Lane E) live in their own
trees and consume the types + symbols above.
