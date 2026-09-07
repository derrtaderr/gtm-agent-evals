# gtm-agent-evals

Eval and regression platform for GTM agents. It answers the question every
agent stack skips: **has this agent earned autonomy, and is it still earning
it?**

Deterministic rules, an LLM rubric that fails closed, an autonomy gate that
counts clean runs, golden-trajectory regression, telemetry, a CI gate, and a
self-contained dashboard. Zero runtime dependencies beyond the Anthropic SDK,
and the deterministic layers run without any API key at all.

## The problem

The common implementation of "we evaluated our agent" is a person reading a few
outputs and nodding. That quietly fails twice. First, a miss looks exactly like
a pass: a cold email that ships `{{firstName}}` unfilled, a research summary
with a fabricated funding number, a draft that violates voice rules — none of
them announce themselves. Second, "worked when I tried it" decays silently: a
prompt tweak that improves one case degrades another, and nothing is watching.

Tests gate a deploy because software regresses. Agent output regresses for the
same reasons plus one more — the model underneath moves. This platform gates an
agent the way tests gate a deploy, and keeps a record.

## Sixty seconds, no API key

```bash
git clone https://github.com/derrtaderr/gtm-agent-evals
cd gtm-agent-evals
npm install && npm run build && npm test   # 293 tests
```

Evaluate a bad cold email against the bundled outbound config:

```bash
node dist/cli/index.js eval --rules-only \
  --config examples/outbound.config.json \
  --run fixtures/outbound/failing.json
```

```text
warning: --rules-only skips the rubric (2 dimension(s) not scored).
outbound-default [outbound]  ->  BLOCK
  mode: rules-only
  rules: 3 checked, 4 blocking
  rubric: skipped (--rules-only)
  reasons:
    - [block] [no-unfilled-placeholder] Unfilled personalization token left in output: "{{firstName}}". A send would ship this literally.
    - [block] [no-unfilled-placeholder] Unfilled personalization token left in output: "[company]". A send would ship this literally.
    - [block] [no-unfilled-placeholder] Unfilled personalization token left in output: "%industry%". A send would ship this literally.
    - [block] [required-cta] No explicit call-to-action found. A cold email needs a concrete ask (an imperative like "Reply if interested"/"Book a time", or a question inviting a call).
# exit 3
```

The passing fixture exits 0. Exit codes are a contract: 0 PASS, 1 usage error,
2 unreadable or malformed input, 3 BLOCK, 4 REGRESSION. A CI job keys on them.

## The layers

**Rules** are deterministic and cheap. Each is a pure function over the run.
They only `block` on unambiguous violations; a check that needs judgment is the
rubric's job, not a regex wearing a gate's badge.

**The rubric** scores named dimensions with an LLM against per-dimension
thresholds. It fails closed: no API key, a provider error, a malformed reply, a
missing dimension, a `NaN` — every one of those is a BLOCK, never a zero that
sneaks past as a pass.

```bash
node dist/cli/index.js eval --config examples/outbound.config.json \
  --run fixtures/outbound/passing.json     # no ANTHROPIC_API_KEY set
# ...
#   reasons:
#     - scoring failed (fail closed): No Anthropic API key: cannot score (failing closed).
# exit 3
```

**The autonomy gate** counts consecutive clean runs per config. An agent earns
unattended operation with N clean runs and loses the streak on any BLOCK.

**Regression** records a known-good run as a golden, replays later runs against
it, and classifies MATCH, DRIFT, or REGRESSION. A PASS that becomes a BLOCK is
a regression. So is a scored dimension that drops past tolerance — or vanishes
entirely, which is the worst drop of all and the one naive comparisons skip.

```bash
node dist/cli/index.js record --rules-only \
  --config examples/outbound.config.json \
  --run fixtures/outbound/passing.json --store goldens.jsonl
# recorded golden outbound-0364ec026259731c -> goldens.jsonl

node dist/cli/index.js regress --store goldens.jsonl --runs fresh-runs.json
# outbound-0364ec026259731c  ->  REGRESSION
#     ~ output
# summary: 1 golden(s) — 0 MATCH, 0 DRIFT, 1 REGRESSION
# exit 4
```

**Telemetry** appends every verdict to a JSONL sink (a Braintrust-style adapter
sits behind an injected interface, no vendor dependency). **`report`** reads it
back:

```bash
node dist/cli/index.js report --telemetry events.jsonl
# telemetry: 2 event(s) across 1 config(s)
# outbound-default
#   history: PASS BLOCK
#   autonomy streak: 0
```

**The dashboard** renders the telemetry store as one self-contained HTML file.
No server, no external assets, every event-origin string HTML-escaped:

```bash
node dist/dashboard/cli.js events.jsonl dashboard.html && open dashboard.html
```

## Three worked archetypes

- **content** — voice rules (em dashes, body colons, banned phrases, binary
  correctives) plus a voice-match and factual-grounding rubric.
- **outbound** — unfilled merge tokens in four template styles, a real
  call-to-action detector tuned on both failure directions, a length warning,
  and a relevance/specificity rubric.
- **research** — a run with no retrieval step blocks; an obviously unsourced
  money claim warns; deep numeric grounding belongs to the groundedness rubric,
  because "is this number supported" is a judgment call and a deterministic
  rule that pretends otherwise blocks legitimate output.

Each ships as a config, a rule set, and synthetic passing/failing fixtures. The
archetypes are examples, not walls — a config is JSON, and custom rules
register alongside the built-ins.

## CI

`action.yml` wires the gate into GitHub Actions: the eval step blocks the job
on exit 3, the optional regression step on exit 4. Inputs pass through `env:`,
never interpolated into shell. A config that would check nothing — no rules and
no rubric left to run — is refused as a misconfiguration rather than reported
as a pass, and an unknown flag is a usage error, because a gate that ran zero
checks and printed green is worse than no gate.

## What this is not

- Not a prompt framework, an agent framework, or a vendor SDK. Eval only; the
  agents are yours.
- Not a claim that rules catch everything. The deterministic layer catches what
  is decidable; the rubric holds the judgment calls; regression catches decay.
  Anything outside those three is outside this tool.
- The regression matcher pairs runs by archetype and input. An agent whose
  *inputs* drift needs its goldens re-recorded; the tool tells you loudly
  rather than guessing.

## Receipts

293 tests. Every fail-closed behavior above was adversarially reviewed before
merge, and the review trail is the development story: independent reviewers
found a research rule that green-lit fabricated funding numbers, a regression
classifier blind to a vanished dimension, a telemetry reader that swallowed
malformed records and string-sorted timestamps, an unescaped field in the
dashboard, and a CLI that passed on a typo'd flag. Each got a failing test
before its fix, and the tests stay.

MIT. `SPEC.md` holds the architecture; each module carries a `WIRING.md` with
its exact surface.
