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
| `no-unfilled-placeholder` | block | leftover merge tokens across styles: `{{firstName}}`, `{role}`, `[company]`, `<company>`, `%firstName%` (Outreach/Salesloft), `((company))`, `$role$` — the fabricated-personalization footgun. A real `$4.2M` figure or `30%` is not a token. |
| `required-cta` | block | no explicit call-to-action. Counts a CTA only as (A) an imperative ASK — a clause starting with a CTA verb AND carrying a reader-directed ask signal or a conditional `if …` (so `Reply if interested`/`Grab 15 minutes on my calendar` pass, but `Download volumes tripled.`/`Schedule slippage was the theme.` flag), (B) a `?`-bearing sentence carrying a time/meeting/response marker (weekday, `minutes`, `work for you`, `chance`, `right place`, `send`, `overview`, `call`, `chat`), or (C) a caller-supplied `params.markers` substring (trusted). `params.imperatives: string[]` overrides the verb list. |
| `length-cap` | warn | output over `params.maxWords` (default 150) |

Rubric dimensions: `relevance`, `specificity` (threshold 7).
Config id: `outbound-default`, `gateN: 5`.

### research — account research / ICP grounding

| rule name | severity | flags |
| --- | --- | --- |
| `source-step-present` | block | run made no `tool_result` step (never retrieved) |
| `no-uncited-assertion` | warn | an obvious unsourced MONEY/magnitude claim (`$50M`, `50 million dollars`) with no matching source amount |

Rubric dimensions: `citation-quality`, `groundedness` (threshold 7).
Config id: `research-default`, `gateN: 5`.

### The rule-vs-rubric split (design principle, fix wave 2)

A deterministic RULE `block`s only on an **unambiguous, decidable** violation.
A check that needs **judgment** belongs in the LLM **rubric**, not a block rule.

- `source-step-present` is a `block`: "the run made zero retrievals" is decidable
  with certainty, and a research run that never looked anything up cannot be
  trusted.
- **Deep numeric grounding is the `groundedness` rubric dimension's job**, not a
  deterministic rule's. `no-uncited-assertion` is therefore a `warn`-level SIGNAL
  only — it never gates the run. It fires solely on an *obvious* unsourced money
  claim: a currency-marked amount (`$4.2M`, `$4,200,000`) or an explicit
  "`<n> million/billion dollars`" whose magnitude matches no amount in any
  `tool_result` step. Magnitudes are normalized (`$4.2M` == `$4,200,000` ==
  source `4.2 million`). It deliberately does **not** fire on founding years,
  ordinals/rankings (`#2`, `top 3`), `24/7`, phone numbers, street addresses,
  bare percentages, or bare headcounts — those are grading questions for the
  rubric, and false-blocking them was the failure this split fixes.

`required-cta` (outbound) stays a `block` by the same test: for cold email,
"did the writer ask for a next step" is tractable and decidable enough to gate.

## Params passed through the registry

Lane A's `runRules` should forward each `RuleConfig.params` to the RuleFn as the
second argument (as the reference `gtm-content-evals` registry does). The rules
that read params: `banned-phrases` (`{ phrases }`), `required-cta`
(`{ markers }`, `{ imperatives }`), `length-cap` (`{ maxWords }`). All params are
optional; every rule has a sane default and the two research rules ignore params.

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
