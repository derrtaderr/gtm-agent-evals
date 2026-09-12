# gtm-agent-evals — SPEC

An open-source **eval + regression platform for GTM agents** (content, outbound,
research, deal-coaching). Deterministic rules, an LLM rubric that fails closed, an
N-clean-runs autonomy gate, golden-trajectory regression, vendor-agnostic
telemetry, a CI gate, and a dashboard. A repo a stranger clones and runs: it
answers "does this agent's output clear a bar, and is it still clearing it"
with running code rather than a rubric in a doc.

Built 2026-09-06 as one two-day push: the full platform, telemetry backend and
dashboard included, as parallel lanes against this spec.

- **Language:** TypeScript. **Test runner:** vitest. **License:** MIT.
- **Repo:** `github.com/derrtaderr/gtm-agent-evals`.
- **No client-specific rules, no proprietary rubrics.** Eval only; the agents
  themselves are the consumer's choice. Every fixture is synthetic.

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

---

# Lane G — the autonomy ledger (added 2026-09-11)

The platform measures runs. It does not remember decisions. `report` will tell you
an agent has a streak of nine clean runs; nothing anywhere records that a person
looked at that streak and decided this agent may now run unattended, on what
evidence, and under what conditions that decision stops being true.

**The ledger is the layer that ANSWERS "has this agent earned autonomy," not a
fifth gate.** The gate decides one run. The ledger decides one agent, holds the
evidence beside the decision, and expires the decision when the evidence stops
holding. Autonomy that expires unless re-earned is the move; a permanent green
checkmark is the failure mode it exists to prevent.

## Prior art this lane stands on (do not rebuild)

- **The N-clean-runs gate already in this repo** (`src/runlog/`, `src/telemetry/query.ts`)
  is the promotion *mechanic*. The ledger consumes it; it does not reimplement it.
  A streak makes an agent **eligible**. Only a person grants.
- **`earn-autonomy`** (public) is the same streak pattern in another setting, and
  is where "config-hash change resets the streak" comes from. The ledger
  generalizes that single rule into a falsifier registry.
- **A tier classifier running in production at a paying client** (private, not
  extracted, not copied) contributes one pattern, cited here and reimplemented
  from scratch: **deterministic rules override any LLM proposal, and the stricter
  tier always wins.** No code, config, or vocabulary from it enters this repo.
  The ledger's v1 has no LLM in the tier path at all, which is the strictest
  reading of that pattern.
- **A falsifier-registry drift detector** (private, not extracted, not copied)
  contributes the validity model, cited here and reimplemented in TypeScript:
  a durable claim carries the facts that must stay true, each falsifier is DATA
  (id, statement, check id, thresholds) rather than a hardcoded branch, verdicts
  are `VALID` / `SUSPECT` / broken, worst-wins across falsifiers, and a check
  that cannot run produces `SUSPECT` — never a pass. Its `statement` + `evidence`
  pairing is the reporting contract: a reader disagrees with a verdict by reading
  two lines, not by re-deriving the check.

## Agent identity

Nothing in the platform had a subject that outlives a run. `AgentRecord` is it:
a stable `id`, a human `name`, the `configHash` and `modelId` that define what the
agent currently *is*, a `gateN`, and `configIds` — the eval-config ids whose
telemetry counts as this agent's evidence. That last field is the join: every
existing artifact (telemetry event, verdict, streak) is keyed by `configId`, so
one additive mapping associates the whole existing record to an agent without
touching any of it.

## Autonomy tiers — the vocabulary, defined

Three tiers, strictly ordered. A tier describes **where the human sits**, not how
good the agent is.

| Tier | The human's position | Earned how |
|---|---|---|
| `supervised` | Every run is reviewed by a person before it has any effect. | The floor. Never granted, never revoked — it is what an agent has when no grant holds. |
| `advisory` | The agent runs unattended; its output lands in a human queue as a recommendation. Effects on the world still need a human action. | A clean streak meeting `gateN`, then an explicit human grant. |
| `auto` | The agent runs unattended and its output takes effect with no human in the path. | A clean streak meeting `gateN` at the time of grant, then an explicit human grant. |

Ordering: `supervised` (0) < `advisory` (1) < `auto` (2).

Two rules that keep this honest:

1. **`auto` removes the standing review, never the gate.** Every run is still
   evaluated, still BLOCKs, still lands in telemetry. A BLOCK under `auto` is
   what breaks the grant's `no_block_since_grant` falsifier.
2. **The tier is per agent in v1.** Per-task-class tiers are a real extension
   (`AgentRun.archetype` is the natural key) and are deliberately deferred —
   forcing it now would mean guessing the task-class vocabulary before any
   operator has used the per-agent one.

## The grant, with falsifiers — the novel core

An `AutonomyGrant` is a durable record: which agent, which tier, when, granted by
whom, the **evidence basis** at grant time (config hash, model id, the streak, the
`gateN` it cleared, the telemetry `runId`s that made up the streak), and the ids
of the **falsifiers** that must keep holding.

**Granting is never automatic.** The streak makes an agent eligible; `grant`
requires a typed confirmation phrase that must match exactly, and refuses a tier
the agent is not eligible for, naming the shortfall. A gate that promotes itself
is not a decision, it is a counter.

### The falsifier registry is data

```jsonc
{
  "falsifiers": [
    {
      "id": "config_hash_unchanged",
      "check": "config_hash",
      "statement": "The agent's configuration is the one the grant was earned on."
    },
    {
      "id": "evidence_not_stale",
      "check": "evidence_freshness",
      "statement": "A clean run has been recorded recently enough for the grant's evidence to still describe this agent.",
      "params": { "suspectAfterDays": 14 }
    }
  ]
}
```

`check` names a function in a `CHECKS` table in code. **A registry naming a check
id that does not exist is a load-time refusal, not a skipped check** — a skipped
check reads as VALID downstream, which is the exact false-pass this platform
exists to prevent. Retuning a threshold is a data edit; a genuinely new *kind* of
falsifier is a check function plus a registry entry.

The four shipped falsifiers:

| id | Must still be true | Breaks when |
|---|---|---|
| `config_hash_unchanged` | The agent's config hash equals the one in the grant's evidence. | It differs → BROKEN. Agent not in the registry → UNEVALUABLE. |
| `model_unchanged` | The agent's model id equals the one in the grant's evidence. | It differs → BROKEN. Agent not in the registry → UNEVALUABLE. |
| `no_block_since_grant` | No BLOCK verdict has been recorded for this agent since `grantedAt`. | Any BLOCK at or after `grantedAt` → BROKEN. No telemetry source → UNEVALUABLE. |
| `evidence_not_stale` | A clean run is recent enough that the grant's evidence still describes this agent. | No PASS within `suspectAfterDays` → DEGRADED. No telemetry source → UNEVALUABLE. |

### The re-check, and how a grant dies

`check` re-evaluates every grant's falsifiers against the current agent registry
and telemetry. Per-falsifier status is `HOLDS` / `DEGRADED` / `BROKEN` /
`UNEVALUABLE`; the grant's status is **worst-wins**:

- any `BROKEN` → **REVOKED**
- else any `DEGRADED` or `UNEVALUABLE` → **SUSPECT**
- else → **VALID**

**Fail closed, restated for this lane: a falsifier that cannot be evaluated makes
the grant SUSPECT, never VALID, and no path exists from UNEVALUABLE to VALID.**
A check that throws is caught and reported as UNEVALUABLE carrying the exception
text — never dropped.

Every non-VALID verdict prints the broken falsifier's `statement` and the
`evidence` line that moved it, both named.

**Effective tier** = the highest tier among that agent's grants whose current
status is VALID **and which has not been archived**, falling back to the
next-lower grant that still holds, and to the `supervised` floor when none does.
Revocation is therefore a *demotion*, not an erasure: the grant record stays in
the ledger with its verdict, because "this agent used to be cleared for auto and
lost it on 9/14" is the most useful line in the file.

### Resolving an incident: `archive`

Because grants are never deleted, a revoked grant would otherwise make `check`
exit 5 forever, and an alarm that cannot be cleared is an alarm operators learn
to ignore. `archive` is the explicit resolution: a typed confirmation naming the
grant, plus `--archived-by`, recorded on the row.

An archived grant keeps every field and every falsifier verdict, and still
prints in `check` and in `status --agent`. What changes is that it confers no
tier and is excluded from `check`'s exit-code calculus (and from the alarm
counts in the summary, so the numbers and the exit code always agree).

Archiving therefore doubles as the **manual revoke** path: retiring a grant that
still holds is a deliberate demotion, recorded rather than erased. This is why
v1 ships no separate `revoke` command.

### The status table's INCIDENT column

The glance surface must never read clean green mid-incident. An agent whose
`auto` grant is revoked while its `advisory` grant still holds has an effective
tier of `advisory` and a VALID top grant — a row that looks perfectly healthy
while the agent has in fact been demoted. The `INCIDENT` column names every
unarchived grant that is not holding, so the demotion is visible without
opening the detail view.

## Commands (fitting the existing CLI, `src/cli/`)

```
register --agents <agents.jsonl> --id <id> --name <n> --model <m> --config-hash <h>
         [--eval-configs a,b] [--gate-n <N>] [--description <d>]
grant    --agents <a> --grants <g> --telemetry <e> --agent <id> --tier <t>
         --confirm "grant <tier> to <agent-id>" --granted-by <who> [--note <n>] [--falsifiers <r.json>]
archive  --grants <g> --grant <grant-id> --confirm "archive <grant-id>" --archived-by <who>
check    --agents <a> --grants <g> [--telemetry <e>] [--falsifiers <r.json>]
         [--as-of <iso>] [--out <ledger.json>]
status   --agents <a> --grants <g> [--telemetry <e>] [--agent <id>] [--as-of <iso>] [--out <l.json>]
```

`--granted-by` and `--archived-by` are REQUIRED, not optional: a decision with
no human on it is not a decision, and an anonymous resolution is
indistinguishable from the alarm never having fired.

### Deliberate tier semantics

- **Tiers may be skipped.** `supervised` → `auto` in one step is allowed. The
  ladder is a vocabulary for where the human sits, not a promotion track to be
  climbed one rung at a time, and an operator who has read the evidence may
  decide the top rung is right. The streak and the typed confirmation are what
  gate it, not the distance travelled.
- **A held tier may be re-granted.** This is how an agent recovers a tier after
  a revocation. Re-granting is idempotent within one instant (the grant id is
  derived from agent, tier and time) and produces a new row otherwise, which is
  what makes "granted, revoked, re-earned" legible in the file.

Exit codes extend additively (existing codes are not renumbered): **5 =
AUTONOMY**, at least one grant is not VALID. `check` is the CI-schedulable
command; `status` is the human surface and always exits 0 unless its input is
bad. `--as-of` exists so every run is reproducible and every test is
deterministic.

`--out` writes the ledger as JSON matching the repo's telemetry file conventions,
so the existing dashboard *could* read it. **Wiring it into the dashboard is
session 2**, deliberately, so the ledger's shape is settled by the terminal
surface first.

## types.ts additions (additive only)

`AgentId`, `AgentRecord`, `AutonomyTier`, `AutonomyGrant`, `GrantEvidence`,
`FalsifierSpec`, `FalsifierRegistry`, `FalsifierStatus`, `FalsifierResult`,
`GrantStatus`, `GrantCheck`, `AgentLedgerEntry`. **No existing type is changed or
removed**, which is what keeps all 293 prior tests green.

## Known limitations (documented, not fixed, in session 1)

- **Run-era config lineage is untracked, so eligibility has no config scope.**
  A `TelemetryEvent` carries no config hash, so the platform cannot say which
  version of an agent produced a run. Concretely: rotate a config, watch the
  grant be correctly REVOKED, then re-grant immediately with zero runs under the
  new config — and it succeeds, resting on the previous version's streak.
  Mitigated but NOT closed in session 1 by (a) a loud grant-time warning naming
  the runs that predate the current config's registration, and (b) grant
  surfaces that never claim the observed runs came from the current config.
  **Session-2 fix:** add a config hash to `TelemetryEvent` and make an eval run
  agent-aware, then scope the eligibility streak to runs produced by the current
  configuration. Cross-cutting into the eval half, which is why it is not
  patched here.
- **No write lock on the JSONL stores.** Read-modify-write plus an atomic
  rename; concurrent writers can lose a write. Fail-safe in direction — the
  surviving state is the older, more alarming one, never a falsely resolved
  grant — but real. Single-writer, or add a lock, under automation.
- **`--as-of` does not cap future-dated events.** It pins the clock for
  staleness and the re-check, but an event timestamped after it is still read,
  so a BLOCK from the future still revokes. Deliberate: ignoring a recorded
  failure because of a clock argument is the worse error.

## Session-2 non-goals (named so they are not improvised into session 1)

- Dashboard view of the ledger (session 1 writes the JSON; session 2 renders it).
- ship-check integration — independent adversarial review as a fifth falsifier
  (`review_not_stale`), which needs the review artifact to have a shape here.
- Naming consolidation with `earn-autonomy`; that is a positioning decision.
- redaction-gate egress wiring as a tier precondition.
- Per-task-class tiers.
- A scheduled re-check ledger with carried-forward verdicts and recheck intervals.
- A manual `revoke` command as such. `archive` covers it: an archived grant
  confers no tier, so retiring one deliberately is a recorded act rather than a
  hand edit.

## Iteration log

- 2026-09-06 — spec locked, `types.ts` committed, scope = full platform ("go
  bigger"). Lanes A/B/C/D are Phase 1; E/F Phase 2.
- 2026-09-11 — Lane G specced: agent identity, the three-tier vocabulary, and
  falsifier-backed autonomy grants. First additive change to `types.ts` since the
  six-lane build; baseline before the lane is 293 tests green on `a56edc2`.
- 2026-09-11 — independent ship-check returned BLOCK. Wave 1 applied: the
  config-lineage hole named as a known limitation and mitigated with a
  rotation-aware grant-time warning; grant surfaces stopped asserting run-era
  config lineage; `AgentRecord` gained `configSince`; `archive` added as the
  incident-resolution mechanic; the status table gained an `INCIDENT` column.
  The eligibility fix itself remains session 2.
