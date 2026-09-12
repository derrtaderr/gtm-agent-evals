# gtm-agent-evals

Eval and regression platform for GTM agents. It answers the question every
agent stack skips: **has this agent earned autonomy, and is it still earning
it?**

Deterministic rules, an LLM rubric that fails closed, an autonomy gate that
counts clean runs, golden-trajectory regression, telemetry, a CI gate, a
self-contained dashboard, and a per-agent autonomy ledger where a grant carries
the facts that must stay true for it to keep holding. Zero runtime dependencies
beyond the Anthropic SDK, and the deterministic layers run without any API key
at all.

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
npm install && npm run build && npm test   # 495 tests
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
2 unreadable or malformed input, 3 BLOCK, 4 REGRESSION, 5 AUTONOMY (an autonomy
grant no longer holds). A CI job keys on them.

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

## "May this agent run unattended?" — the autonomy ledger

Everything above judges a **run**. None of it remembers a **decision**. `report`
will happily tell you an agent has nine clean runs in a row; nothing anywhere
records that a person looked at those nine runs and decided this agent may now
run without a human reading its output — or what would have to change for that
to stop being true.

The ledger is that record. It is not another gate. It is the layer that answers
the question the gates produce evidence for.

**Agents get an identity.** A stable id, the config hash and model that define
what the agent currently is, the clean-run bar it must clear, and the eval
configs whose telemetry counts as its evidence. That last field is the join: the
platform's verdicts are already keyed by config, so one mapping associates every
run you have ever recorded to an agent.

```bash
node dist/cli/index.js register --agents agents.jsonl \
  --id example-enricher --name "Example Enricher" \
  --model example-model-v1 --config-hash sha256:1f0aenricherv3 \
  --eval-configs research-default --gate-n 3
```

**Three tiers, defined by where the human sits.** `supervised` — every run is
reviewed before it has any effect; the floor, never granted. `advisory` — the
agent runs unattended and its output lands in a human queue as a recommendation.
`auto` — the output takes effect with nobody in the path. `auto` removes the
standing review, never the gate: every run is still evaluated, and a BLOCK is
still a BLOCK.

**A streak makes an agent eligible. A person grants.**

```text
autonomy ledger — 2026-09-07T00:00:00.000Z
AGENT               TIER        GRANT    STREAK  LAST   FALSIFIERS
example-enricher    auto        VALID    3/3 *   PASS   4/4 holding
example-drafter     supervised  —        0/3     BLOCK  —
example-researcher  supervised  REVOKED  3/3 *   PASS   3/4 holding

STREAK is clean runs against the agent's gateN; * marks an agent eligible for a grant.
Eligibility is not autonomy — a grant is a human decision (see the `grant` command).
```

`grant` refuses twice before it writes anything down: once if the streak is
short of the bar, and once if a human has not typed a phrase naming this exact
agent and this exact tier. A counter that promotes itself has not decided
anything.

```bash
node dist/cli/index.js grant --agents agents.jsonl --grants grants.jsonl \
  --telemetry events.jsonl --agent example-enricher --tier auto \
  --confirm "grant auto to example-enricher" --granted-by you
```

**The part nothing else does: the grant carries its own falsifiers.** Autonomy
is not a checkmark you keep. A grant records the facts that must stay true —
the config hash it was earned on, the model, no BLOCK since, evidence not gone
stale — and `check` re-tests them.

```bash
node dist/cli/index.js check --agents fixtures/ledger/agents.jsonl \
  --grants fixtures/ledger/grants.jsonl --telemetry fixtures/ledger/events.jsonl \
  --as-of 2026-09-07T00:00:00.000Z
```

```text
example-enricher-auto-08bd48bcd395  [auto]  ->  VALID
example-researcher-advisory-4b51b7ab3e5d  [advisory]  ->  REVOKED
    BROKEN [config_hash_unchanged]: The agent's configuration is still the one this grant was earned on.
      config hash is sha256:REWRITTENv3; the grant was earned on sha256:6b22researcherv2
summary: 2 grant(s) — 1 VALID, 0 SUSPECT, 1 REVOKED
# exit 5
```

Somebody rewrote that agent's prompt. The clean runs it was granted on were
produced by different software, so the grant no longer describes it, and the
agent drops back to `supervised`. Re-granting requires a human to run `grant`
again — though see the config-lineage limitation below for what that re-grant
can and cannot currently rest on. Every non-VALID verdict prints the
falsifier's statement and the evidence line that moved it, because you should
be able to *disagree* with a revocation by reading two lines rather than by
re-deriving the check.

Falsifiers are data, in `examples/falsifiers.json`. Retuning the freshness
window is an edit to that file. A registry naming a check that does not exist is
refused at load — a skipped check reads as VALID downstream, and a grant that is
valid because nobody looked is the failure this repo exists to prevent. In the
same spirit, a check that *cannot run* — no telemetry supplied, the agent
missing from the registry — makes the grant `SUSPECT`, never `VALID`.

A revoked grant is never deleted — "this agent held auto and lost it on the
14th" is the most useful line in the file. Once you have handled an incident,
`archive` resolves it: the grant keeps its verdict and stays in every detail
view, but stops conferring a tier and stops driving the alarm.

```bash
node dist/cli/index.js archive --grants grants.jsonl \
  --grant example-researcher-advisory-4b51b7ab3e5d \
  --confirm "archive example-researcher-advisory-4b51b7ab3e5d" --archived-by you
```

`check` exits 5 when any **unarchived** grant is not VALID, so a scheduled job
can re-verify a fleet the way CI re-verifies a build — and can go green again
after a handled incident without anybody editing a JSONL file by hand.
`status` reports and never gates; its `INCIDENT` column names every grant that
is not holding, so the glance view never reads clean while an agent is demoted.

## What the ledger does not know yet

Stated here rather than in a commit message, because these are the edges where
the tool will surprise you.

**Run-era config lineage is not tracked.** This is the big one. A
`TelemetryEvent` records which eval config produced a verdict, but not which
*version* of the agent produced it — there is no config hash on a run. So the
clean-run streak has no config scope, and one consequence is sharp:

> Rotate an agent's config and its grant is correctly REVOKED. Run `grant`
> again immediately, with zero runs under the new config, and it **succeeds** —
> because the streak it reads was earned by the previous version of the agent.

Two things blunt it today, and neither closes it. `grant` **warns loudly**,
naming the offending runs, when the streak rests on runs recorded before the
current config was registered; the confirmation you type is informed. And no
surface claims those runs came from the current config — the grant output
reports the observed runs and the agent's identity at grant time as two
separate facts, because fusing them would assert a lineage this tool cannot
establish.

The fix is a config hash on `TelemetryEvent` plus an eval run knowing which
agent it belongs to, so eligibility can be scoped to runs produced by the
current configuration. That is a cross-cutting change to the eval half of the
platform and is scoped for the next session, not patched around here.

**Concurrent writers can lose a write.** The JSONL stores are read-modify-write
with an atomic rename. Two processes archiving different grants at the same
instant can have one overwrite the other. The failure is safe in direction — a
lost write leaves the older, *more* alarming state, never a falsely resolved
one — but it is real. One writer at a time, or a lock, if you automate this.

**`--as-of` does not cap future events.** It pins the clock for staleness and
for the re-check, but a telemetry event timestamped after `--as-of` is still
read. A BLOCK from the future still revokes. That direction is fail-closed on
purpose: ignoring a recorded failure because of a clock argument would be the
worse error.

**Tiers can be skipped, and a held tier can be re-granted.** `supervised` →
`auto` in one step is allowed; so is granting `auto` to an agent that already
holds it. Both are deliberate. The ladder is a vocabulary, not a promotion
track, and re-granting is how an agent recovers a tier after a revocation.
Every one of those moves still needs the streak and the typed confirmation.

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

495 tests, all deterministic and keyless. The eval and regression halves were
adversarially reviewed before merge, and that review trail is the development
story: independent reviewers found a research rule that green-lit fabricated
funding numbers, a regression classifier blind to a vanished dimension, a
telemetry reader that swallowed malformed records and string-sorted timestamps,
an unescaped field in the dashboard, and a CLI that passed on a typo'd flag.
Each got a failing test before its fix, and the tests stay.

The autonomy ledger is newer, with 202 tests of its own written before the code
they cover. Its first independent review returned BLOCK, and the fixes are in:
a grant surface that claimed a config lineage the platform cannot establish, an
alarm that could never be cleared after a handled incident, and a status table
that read clean green while an agent was mid-demotion. The limitations that
review surfaced and did *not* close are written down above rather than left in
a commit message.

MIT. `SPEC.md` holds the architecture; each module carries a `WIRING.md` with
its exact surface.
