# Lane G — Autonomy ledger — WIRING

The layer that answers **"what may this agent do unattended, and what is the
evidence"** as a durable, revocable record. Not a gate: the gates produce the
evidence, this holds the decision made on it and expires that decision when the
evidence stops holding.

Owns `src/ledger/**` and `src/cli/ledger.ts`. `src/types.ts` was extended
**additively** (see SPEC.md, Lane G) — no existing type changed, which is what
keeps the prior lanes' 293 tests green.

Two files outside the lane were touched, both minimally:

- `src/telemetry/query.ts` — `chronological` renamed to an exported
  `chronologicalEvents`. Behavior unchanged; the ledger needs to order one
  agent's events across SEVERAL configs, and a second copy of that strict-ISO
  timestamp parser is how two surfaces come to disagree about one streak.
- `src/cli/exit.ts` — added `EXIT.AUTONOMY = 5` and taught `exitCodeFor` the
  lane's two refusal types. **No code was renumbered.**
- `src/index.ts` and `src/cli/run.ts` — one export line and four dispatch cases.

## The operator's flow

```
register ──▶ observe ──▶ grant ──▶ check ──▶ (demote) ──▶ archive
   │           │           │         │                       │
   │           │           │         │                       └─ resolves a handled
   │           │           │         │                          incident so the alarm
   │           │           │         │                          can go green again
   │           │           │         └─ re-runs every falsifier; worst wins
   │           │           └─ refuses unless streak ≥ gateN AND a human typed
   │           │              the confirmation phrase for this agent+tier;
   │           │              WARNS when the streak predates the current config
   │           └─ `status` shows the streak; the eval gate writes the telemetry
   └─ an id, a config hash, a model, and the eval configs that are its evidence
```

`status` is readable at any point and never gates. `check` is the schedulable
command; exit 5 is "at least one grant is not VALID".

### Every state the flow can be in, and what happens

| State | What the operator sees |
|---|---|
| Agent registered, no runs | `supervised`, streak `0/N`, not eligible. |
| Agent registered, no `--eval-configs` | `register` warns. No telemetry can be attributed, so the streak stays 0 and every evidence falsifier is UNEVALUABLE. |
| Streak reaches gateN | `*` in the status table. **Eligible, not autonomous.** |
| `grant` with a short streak | Refused, exit 5, naming the streak and the bar. Nothing is written. |
| `grant` with a wrong/missing confirmation | Refused, exit 1, printing the exact phrase required. Nothing is written. |
| `grant supervised` | Refused. The floor is what an agent has, not something it earns. |
| `grant` for an unregistered agent | Refused, exit 1. A grant nobody can check against anything is not a grant. |
| Every falsifier holds | `VALID`. Effective tier = the granted tier. |
| A falsifier DEGRADES (stale evidence) | `SUSPECT`, exit 5. Effective tier falls back. |
| **A falsifier cannot be evaluated** | `SUSPECT`, never `VALID`. Four distinct causes, and the evidence line always says which: agent absent from the registry; no `--telemetry` supplied; the agent has no eval configs; the check itself threw (`check raised: …`). None can become `VALID`. |
| A falsifier is BROKEN | `REVOKED`, exit 5. The grant row stays in the ledger with its verdict. |
| **Unknown agent** — a grant naming an id the registry lacks | Every identity falsifier is UNEVALUABLE → `SUSPECT`, and the grant is listed under `orphanGrants` in the ledger and under an "unknown agent" heading in the table. Surfaced, never dropped: a grant nobody can see is a grant nobody can revoke. |
| **Corrupt ledger** — a bad line in `agents.jsonl` or `grants.jsonl` | Throws naming the 1-based line number; exit 2. Never skipped, because a skipped agent hides its grants and a skipped grant reads as an agent with less privilege than it has. A grant line whose `tier` is outside the vocabulary is corrupt by this rule. |
| A falsifier registry naming an unknown `check` | Load-time refusal, exit 2. A skipped check reads as `VALID` downstream. |
| `--as-of` without a timezone | Refused, exit 2. Local-time parsing would make a staleness verdict depend on who ran the check. |
| Grant carries zero falsifiers | `SUSPECT`. "Nothing to check" and "everything checks out" are opposite facts. |
| Grant names a falsifier the registry no longer defines | That falsifier reports UNEVALUABLE → `SUSPECT`. Never dropped: dropping it could flip a SUSPECT grant to VALID by deleting a registry entry. |
| `grant` with no `--telemetry` | Refused, exit 5, naming the missing source. NOT reported as "streak of 0", which is a true sentence naming the wrong cause. |
| `grant` on a streak predating the current config | Warns on stderr naming the offending runs, then proceeds. Fires only once a rotation has happened (`configSince !== registeredAt`), so an ordinary first grant is silent. |
| A grant is revoked and the incident is handled | `archive` it. Exit code returns to 0; the grant keeps its verdict and stays in `check` output and `status --agent`, marked archived with who and when. |
| `archive` with a wrong phrase / unknown grant / already archived | Refused, exit 1, in all three cases. |
| Higher grant not holding behind a still-valid lower one | The `INCIDENT` column names it (`auto REVOKED`). The glance view never reads clean green mid-incident. |

## Exports (all via `src/ledger/index.js`, re-exported from `src/index.js`)

```ts
// Vocabulary
TIERS: readonly AutonomyTier[]          // ["supervised","advisory","auto"], lowest first
SUPERVISED: AutonomyTier                // the floor
tierRank(tier): number                  // supervised = 0
isTier(value: unknown): boolean         // case-SENSITIVE
highestTier(tiers: AutonomyTier[]): AutonomyTier   // [] -> supervised

// Agent registry (JSONL, upsert by id)
registerAgent(input, { registeredAt? }): AgentRecord   // throws on empty id/name/configHash/modelId
saveAgent(agent, path): void
loadAgents(path): AgentRecord[]         // missing file -> []; bad line -> throws w/ line number
loadAgent(path, id): AgentRecord | undefined
DEFAULT_GATE_N = 5

// Evidence, read per agent across its configIds
agentEvents(events, agent): TelemetryEvent[]   // chronological; no configIds -> []
agentStreak(events, agent): number             // BLOCK in ANY of its configs resets
lastEvent(events, agent): TelemetryEvent | undefined

// Falsifiers (data + a check table)
DEFAULT_FALSIFIER_REGISTRY: FalsifierRegistry
CHECKS: Record<string, FalsifierCheck>
loadFalsifierRegistry(raw: unknown): FalsifierRegistry  // refuses unknown check id, dup id
runFalsifier(spec, ctx): FalsifierResult               // a throwing check -> UNEVALUABLE

// Grants
confirmationPhrase(agentId, tier): string   // `grant <tier> to <agentId>`
createGrant(input, { grantedAt?, onWarn? }): AutonomyGrant
  // throws GrantRefused (exit 1) | InsufficientEvidence (exit 5)
grantId(agentId, tier, grantedAt): string
priorEraRuns(agent, events, runIds): TelemetryEvent[]   // [] unless rotated
archiveConfirmationPhrase(id): string       // `archive <id>`
archiveGrant(grant, { confirm, archivedBy }, { archivedAt? }): AutonomyGrant
saveGrant / loadGrants / grantsForAgent

// The re-check
worstStatus(results): GrantStatus        // BROKEN>DEGRADED=UNEVALUABLE>HOLDS; [] -> SUSPECT
checkGrant(grant, { agents, events?, registry, asOf }): GrantCheck
checkGrants(grants, deps): GrantCheck[]

// The surface
ledgerEntry(agent, grants, deps): AgentLedgerEntry
buildLedger(agents, grants, deps): Ledger
renderLedgerTable / renderCheckReport / renderAgentDetail   // take a { out(line) } io
```

## The four shipped falsifiers

| id | check | Holds while | Params |
|---|---|---|---|
| `config_hash_unchanged` | `config_hash` | the registry hash equals the grant's | — |
| `model_unchanged` | `model_id` | the model id equals the grant's | — |
| `no_block_since_grant` | `no_block_since` | no BLOCK at or after `grantedAt` | — |
| `evidence_not_stale` | `evidence_freshness` | a PASS inside the window | `suspectAfterDays` (14) |

`evidence_not_stale` can DEGRADE but never BREAK: a quiet week is a reason to
re-check, not proof of a failure. The other three can BREAK. Retuning a
threshold is an edit to `examples/falsifiers.json`; teaching the ledger a new
KIND of fact is a function in `CHECKS` plus a registry entry naming it.

## Files

```
src/ledger/tiers.ts        the vocabulary and its ordering
src/ledger/agents.ts       AgentRecord + the JSONL store helpers both stores share
src/ledger/evidence.ts     telemetry read per agent instead of per config
src/ledger/falsifiers.ts   the registry (data), the CHECKS table, the four checks
src/ledger/grants.ts       createGrant's two refusals, the prior-era warning,
                           archiveGrant, the grant store
src/ledger/errors.ts       GrantRefused (exit 1) vs InsufficientEvidence (exit 5)
src/ledger/check.ts        worst-wins re-check
src/ledger/status.ts       effective tier, computed never stored; the Ledger artifact
src/ledger/render.ts       three terminal surfaces
src/cli/ledger.ts          register / grant / archive / check / status
examples/falsifiers.json   the default registry, shipped as editable data
fixtures/ledger/           a synthetic three-agent fleet, calibrated to
                           --as-of 2026-09-07T00:00:00.000Z
```

211 tests, deterministic and keyless. Two of them guard the docs:

- `src/cli/ledger-fixtures.test.ts` runs the bundled walkthrough and asserts its
  output against expectations held in the test.
- `src/cli/readme-examples.test.ts` runs every README block marked
  `<!-- verified: <argv> -->` through the real CLI and compares it byte for
  byte, exit code included. The fixture test alone did NOT catch README drift —
  it never opens README.md — which is how the INCIDENT column and the
  "unarchived" summary shipped with two stale example blocks. Adding a verified
  example is one comment line above the fence.

## Session 2 additions

- **`era.ts` — config-scoped eligibility.** `runEra(event, agent)` places every
  run as `current` / `prior` / `unknown-in-window` / `unknown-pre-config`;
  `currentEraStreak` and `eligibilityEvidence` are what `createGrant` refuses
  against and what `AgentLedgerEntry.streak` reports. Attribution is proof, the
  clock is the fallback for unattributed runs, and a never-rotated agent's runs
  are always in-window (without that guard a first registration excludes its own
  evidence, since runs almost always predate the day somebody registered the
  agent).
- **`reviews.ts` — independent review.** `recordReview` enforces reviewer
  independence at WRITE time (never the agent, never the grant's `grantedBy`,
  archived grants included). `--grants` is REQUIRED on the `review` command so
  the rule cannot be skipped by omitting a flag; every review recorded through
  the CLI has passed it. Ids are compared normalized (case- and
  whitespace-insensitive); aliases and second accounts are out of reach and
  stated as such in the README. `loadReviews` / `saveReview` / `latestReview` mirror the other stores.
- **`review_freshness` check + `review_not_stale`** — ships OUTSIDE
  `DEFAULT_FALSIFIER_REGISTRY`, in `examples/falsifiers-with-review.json`. A
  fifth default would flip every grant already on disk to SUSPECT for want of a
  reviews file. BLOCK review → BROKEN → REVOKED; no or stale review → DEGRADED
  → SUSPECT; no source → UNEVALUABLE.
- **CLI:** `review` command; `--reviews` on `check` and `status`;
  `--agents/--agent` on `eval` and `record`.
- **`AgentLedgerEntry`** gains `observedStreak`, `verifiedRuns`,
  `unverifiedRuns`, `excludedRuns`, and the `lastReview*` fields; `streak` and
  `eligible` narrowed to the config-scoped question so the table's `*` can never
  promise a grant that `grant` would refuse.

## Known limitations (see SPEC.md and the README for the full statement)

- **Unattributed runs are placed by inference, not proof.** An event written
  before session 2 carries no config hash, so an in-window one is counted as
  UNVERIFIED and named as such on every surface. The rotation exploit is closed
  regardless (rotating moves `configSince` past every run on disk); full
  per-run verification needs attributed telemetry, which `--agent` produces.
- **No write lock on the JSONL stores.** Concurrent writers can lose a write.
  Fail-safe in direction (the surviving state is the more alarming one).
- **`--as-of` does not cap future-dated events.** A BLOCK from the future still
  revokes. Fail-closed on purpose.

## Not in this session (see SPEC.md for the full list)

Per-task-class tiers, a scheduled re-check ledger with carried-forward verdicts,
a manual `revoke` command, redaction-gate egress wiring, hosted or multi-tenant
anything, and the `earn-autonomy` naming consolidation.
