# WIRING — Lane C (archetypes)

How Lane A's registry, the gate, and the CLI consume Lane C. Lane C imports only
from `src/types.ts`; it defines no engine behavior. Every RuleFn is a pure
`(run: AgentRun, params?) => Violation[]` and never mutates the run.

## Public surface

Each archetype module lives under `src/archetypes/<id>/index.ts` and exports:

- the individual `RuleFn`s (named),
- `<id>RuleFns: RuleFn[]` — the rules as a plain array,
- `<id>Rules: Record<string, RuleFn>` — name → RuleFn, the shape Lane A's
  `buildRuleRegistry` consumes,
- `<id>Config: EvalConfig` — a default, runnable config,
- `<id>Rubric: Rubric`.

The barrel `src/archetypes/index.ts` exports:

- `archetypes: Record<string, { rules, config, rubric }>` — all three, keyed by id,
- `allArchetypeRules: Record<string, RuleFn>` — the flat, collision-free merge of
  every archetype's rules, ready to spread into the engine registry,
- `content`, `outbound`, `research` namespaces (re-exports of each module).

### Integration TODO (owned by Lane A, not edited here)

`src/index.ts` currently re-exports only `./types.js`. To expose Lane C from the
package root, add:

```ts
export * from "./archetypes/index.js";
```

Lane C did not edit `src/index.ts` to avoid colliding with other lanes on that
shared file. The orchestrator/Lane A folds this line in at integration.

## Rule catalog (name → severity → what it flags)

### content — port of `gtm-content-evals` onto `AgentRun.output`

| rule name | severity | flags |
| --- | --- | --- |
| `no-em-dash` | block | any `—` in `run.output` |
| `no-body-colon` | block | a `:` in a body line (headers, URLs, clock times exempt) |
| `banned-phrases` | block | each configured phrase (`params.phrases: string[]`), case-insensitive |
| `no-binary-corrective` | block | the "it's not X, it's Y" / "not X, it's Y" form |

Rubric dimensions: `voice-match`, `factual-grounding` (threshold 7).
Config id: `content-default`, `gateN: 5`.

### outbound — cold email

| rule name | severity | flags |
| --- | --- | --- |
| `no-unfilled-placeholder` | block | leftover merge tokens: `{{firstName}}`, `{role}`, `[company]`, `<company>` (the fabricated-personalization footgun) |
| `required-cta` | block | no call-to-action marker present (`params.markers: string[]` overrides the default marker list) |
| `length-cap` | warn | output over `params.maxWords` (default 150) |

Rubric dimensions: `relevance`, `specificity` (threshold 7).
Config id: `outbound-default`, `gateN: 5`.

### research — account research / ICP grounding

| rule name | severity | flags |
| --- | --- | --- |
| `source-step-present` | block | run made no `tool_result` step (never retrieved) |
| `no-uncited-assertion` | block | each sentence with a numeric claim whose numbers appear in no `tool_result` step |

Rubric dimensions: `citation-quality`, `groundedness` (threshold 7).
Config id: `research-default`, `gateN: 5`.

`no-uncited-assertion` is deterministic and numeric-only by design: it normalizes
numbers (`$4.2M` → `4.2`, `3,000` → `3000`) from `run.output` sentences and from
every `tool_result` step's `content`, and blocks a sentence when none of its
numbers are found in any source. It is a first-pass grounding gate, not a full
NLI checker — the LLM rubric (`groundedness`) is the second layer.

## Params passed through the registry

Lane A's `runRules` should forward each `RuleConfig.params` to the RuleFn as the
second argument (as the reference `gtm-content-evals` registry does). The rules
that read params: `banned-phrases` (`{ phrases }`), `required-cta`
(`{ markers }`), `length-cap` (`{ maxWords }`). All params are optional; every
rule has a sane default and the two research rules ignore params.

## Examples (CLI targets)

`examples/content.config.json`, `examples/outbound.config.json`,
`examples/research.config.json` are runnable `EvalConfig`s a stranger points the
`eval` CLI at. `src/archetypes/index.test.ts` asserts each example's rule names
resolve to a real RuleFn and never drift from the archetype's default config.

## Fixtures (synthetic AgentRuns the tests load)

Under `fixtures/<id>/passing.json` and `fixtures/<id>/failing.json`. Each is a
serialized `AgentRun`. The passing run trips no rule; the failing run trips at
least one `block` rule. All names are invented (see below). Lane B (regression)
and Lane A (gate) can reuse these as ready-made trajectories.

Invented (synthetic) names used, no real client or person:
`Northwind Robotics`, `Acme Freight`, `Dana`, `Ray Okafor` (invented sender).
