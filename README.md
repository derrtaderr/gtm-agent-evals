# gtm-agent-evals

**The layer that answers "has this agent earned autonomy" — and keeps checking.**

Shipping an agent is easy now. Deciding it may run without a person reading its
output is the hard part, and almost nothing in the stack helps you make that
call or take it back. Evals judge a run. This judges an **agent**: what it is
allowed to do unattended right now, on what evidence, and what would have to
become true for that permission to expire.

Four layers, one suite:

| | Answers |
|---|---|
| **Evals** | Did this run clear the bar? Deterministic rules plus an LLM rubric that fails closed. |
| **Regression** | Did the agent get worse? Golden trajectories, replayed and diffed. |
| **Telemetry** | What has it actually been doing? Every verdict, appended, queryable, on a dashboard. |
| **The autonomy ledger** | May it run unattended — *still*? A human's grant, the evidence under it, and the falsifiers that expire it. |

The first three produce evidence. The fourth is where a person decides, and
where the decision gets taken away again when the evidence stops holding. It is
**not a fifth gate** — the gates judge runs, and adding another would just be a
louder counter. Autonomy that expires unless re-earned is the move; a permanent
green checkmark is the failure mode this exists to prevent.

Zero runtime dependencies beyond the Anthropic SDK. Every deterministic layer,
and the entire ledger, runs with no API key at all.

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
npm install && npm run build && npm test   # 614 tests
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

```bash
node dist/cli/index.js status --agents fixtures/ledger/agents.jsonl \
  --grants fixtures/ledger/grants.jsonl --telemetry fixtures/ledger/events.jsonl \
  --as-of 2026-09-07T00:00:00.000Z
```

<!-- verified: status --agents fixtures/ledger/agents.jsonl --grants fixtures/ledger/grants.jsonl --telemetry fixtures/ledger/events.jsonl --as-of 2026-09-07T00:00:00.000Z -->
```text
autonomy ledger — 2026-09-07T00:00:00.000Z
AGENT               TIER        GRANT    INCIDENT          STREAK  LAST   FALSIFIERS
example-enricher    auto        VALID    —                 3/3 *   PASS   4/4 holding
example-drafter     supervised  —        —                 0/3     BLOCK  —
example-researcher  supervised  REVOKED  advisory REVOKED  0/3     PASS   3/4 holding

STREAK is clean runs against the agent's gateN; * marks an agent eligible for a grant.
Eligibility is not autonomy — a grant is a human decision (see the `grant` command).
INCIDENT lists grants that are not holding. The effective tier already accounts for them; resolve one with `archive` once it is handled.
3 run(s) are EXCLUDED from eligibility: they were produced by a configuration that is no longer on file, so they cannot earn a grant for the current one.
# exit 0
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

<!-- verified: check --agents fixtures/ledger/agents.jsonl --grants fixtures/ledger/grants.jsonl --telemetry fixtures/ledger/events.jsonl --as-of 2026-09-07T00:00:00.000Z -->
```text
example-enricher-auto-08bd48bcd395  [auto]  ->  VALID
example-researcher-advisory-4b51b7ab3e5d  [advisory]  ->  REVOKED
    BROKEN [config_hash_unchanged]: The agent's configuration is still the one this grant was earned on.
      config hash is sha256:REWRITTENv3; the grant was earned on sha256:6b22researcherv2
summary: 2 unarchived grant(s) — 1 VALID, 0 SUSPECT, 1 REVOKED
# exit 5
```

Somebody rewrote that agent's prompt. The clean runs it was granted on were
produced by different software, so the grant no longer describes it, and the
agent drops back to `supervised`. Re-granting requires a human to run `grant`
again, and — since the rewrite reset the agent's eligibility along with its
grant — it requires clean runs from the *new* config first. Every non-VALID
verdict prints the falsifier's statement and the evidence line that moved it,
because you should be able to *disagree* with a revocation by reading two lines
rather than by re-deriving the check.

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

### A grant can also expire because nobody looked

The four default falsifiers all read machines: a config hash, a model id, a
verdict stream, a clock. Every one of them can hold perfectly while an agent
drifts somewhere none of them are looking. `review_not_stale` makes a person's
attention a fact the grant can lose.

```bash
node dist/cli/index.js review --reviews reviews.jsonl --grants grants.jsonl \
  --agent example-enricher --reviewer priya --verdict BLESS \
  --evidence https://example.invalid/reviews/17
```

A **BLOCK** review BREAKS the grant, which worst-wins carries through to
REVOKED — a human saying "this should not be running unattended" is the
strongest evidence the ledger can hold, and a later BLESS from somebody else
does not age it out. No review since the grant, or one that has aged past the
window, is DEGRADED, so the grant goes SUSPECT.

**Independence is enforced when the review is written**, not when it is read. A
reviewer may be neither the agent itself nor the human who granted its tier:

```text
error: review: dana granted example-enricher its auto tier (grant example-enricher-auto-08bd48bcd395),
so they are not an independent reviewer of it. Review by somebody who did not make the decision
being re-examined.
# exit 1
```

Refusing at the door means the reviews file only ever holds reviews a reader can
trust without knowing this rule exists.

It ships **opt-in**, in `examples/falsifiers-with-review.json` rather than in the
default registry. Making it a fifth default would turn every grant already on
disk SUSPECT the moment you upgraded, for want of a reviews file you had not
written yet — which is precisely the alarm-fatigue failure `archive` exists to
prevent. Review cadence is your policy, so it is your data.

The pattern is an adversarial-review CONTRACT treated as a *scheduled input*
rather than a one-time blessing. This repo is self-contained; it implements the
idea, it does not depend on anything that pioneered it.

### The fleet on one page

`check --out` and `status --out` write the ledger as JSON, and the dashboard
renders it beside the run telemetry — per-agent tier, grant status, incident
flags, falsifier health, and review recency:

```bash
node dist/cli/index.js check --agents agents.jsonl --grants grants.jsonl \
  --telemetry events.jsonl --out ledger.json
node dist/dashboard/cli.js events.jsonl dashboard.html --ledger ledger.json
```

Still one self-contained file, still no server, and every ledger-origin string
— agent names and reviewer ids included — HTML-escaped on the way in.

## Eligibility is scoped to the configuration that earned it

An earlier version of this README documented a hole here, and this section is
what replaced it. The hole was worth stating plainly, so the fix is too.

**What was wrong.** A `TelemetryEvent` recorded which eval config produced a
verdict, but not which *version* of the agent produced it. The clean-run streak
therefore had no config scope, and the consequence was sharp: rotate an agent's
config, watch its grant be correctly REVOKED, then run `grant` again
immediately with zero runs under the new config — and it **succeeded**, resting
entirely on a streak earned by the previous version of the agent. Session 1
could only warn about it.

**What closed it.** A run now records which agent and which configuration
produced it, and eligibility counts only runs from the configuration on file:

```bash
node dist/cli/index.js eval --rules-only --config examples/outbound.config.json \
  --run fixtures/outbound/passing.json --telemetry events.jsonl \
  --agents agents.jsonl --agent example-drafter
```

You name the agent; the **registry supplies the hash**, so a run's attribution
can never drift from the agent's registration through a typo. Rotating a config
now empties the eligibility streak, and the re-grant is refused:

```text
warning: 3 of the 3 runs on file for example-enricher were EXCLUDED from eligibility: ...
error: grant: example-enricher has a current-era clean-run streak of 0, short of its gateN of 3.
  3 run(s) on file were excluded as prior-era evidence (run-1 run-2 run-3) ...
  Re-earn the tier with runs from the current configuration.
# exit 5
```

The agent earns the tier back the honest way: run it under the new config until
the streak is real again, then grant.

**Where a run's era comes from, exactly.** Attribution is proof and the clock is
a fallback:

| The run | Its era | Counts? |
|---|---|---|
| carries the agent's current config hash | current | **yes — verified** |
| carries a different hash | prior | no |
| carries no hash, recorded at/after `configSince` | unknown, in window | **yes — counted but UNVERIFIED** |
| carries no hash, recorded before `configSince` | unknown, pre-config | no |

That third row is the honest residual, and it is the migration path rather than
a loophole. Events written before this version exists carry no hash, so their
lineage cannot be *proven*; the ledger places them with the only signal the
registry has — whether they predate the current config — and then says so out
loud wherever it counts them, on the grant, in `status --agent`, and on the
dashboard. **Inference is not proof. Attribution is what makes a run verified,
and new runs produce it.**

So, precisely: **the rotation exploit is closed** — rotating moves `configSince`
past every run already on disk, whether or not those runs are attributed. Full
per-run verification requires attributed telemetry, which every run recorded
with `--agent` from here on provides. The reason unattributed in-window runs are
counted at all rather than discarded: discarding them would zero the streak of
every existing operator the moment they upgrade, so the tool's first act after
an install would be a false claim about their fleet.

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

614 tests, all deterministic and keyless. The eval and regression halves were
adversarially reviewed before merge, and that review trail is the development
story: independent reviewers found a research rule that green-lit fabricated
funding numbers, a regression classifier blind to a vanished dimension, a
telemetry reader that swallowed malformed records and string-sorted timestamps,
an unescaped field in the dashboard, and a CLI that passed on a typo'd flag.
Each got a failing test before its fix, and the tests stay.

The autonomy ledger is newer, and its history is the more useful story. Its
first independent review returned **BLOCK**. Three fixes landed immediately: a
grant surface that claimed a config lineage the platform could not establish, an
alarm that could never be cleared after a handled incident, and a status table
that read clean green while an agent was mid-demotion. The fourth finding — that
eligibility had no config scope, so a rotated agent could be re-granted on its
predecessor's streak — was too big for that session and was written into this
README as a known hole, reproduction steps included.

The next session closed it, and closing it meant **deleting three tests that
asserted the old behavior was correct**, including one that pinned
`expect(code).toBe(0)` on the re-grant under the comment *"still allowed — this
is an informed confirmation, not a new gate"*. Those rewrites are marked
`SESSION 2 REWRITE` in place, each carrying the reason. A test suite that can
never change is a suite that has stopped describing the product; a suite whose
assertions get quietly adjusted is worse. The middle path is changing them in
the open.

## Relationship to `earn-autonomy`

[`earn-autonomy`](https://github.com/derrtaderr/earn-autonomy) is where the
graduation mechanic in this repo was first worked out: a clean-run streak as the
thing an agent earns, and a config change as the thing that resets it. This
platform absorbed that idea and generalized it — the single reset rule became a
falsifier registry, and the streak became one input to a human's revocable
grant.

The two overlap, deliberately, and consolidating or renaming them is a decision
above any one pull request. Nothing here depends on that repo.

Every `text` block in this README preceded by a `<!-- verified: ... -->` comment
is run through the real CLI by `src/cli/readme-examples.test.ts` and compared
byte for byte, exit code included. The promise that examples match real output
is a test, not an intention.

MIT. `SPEC.md` holds the architecture; each module carries a `WIRING.md` with
its exact surface.
