// The shared contract. Every lane codes to these types, which is what lets the
// engine, regression, archetypes, and telemetry lanes build in parallel without
// colliding. Nothing here has behavior — behavior lives in the lane that owns
// each seam. Changing a type is a cross-lane event: it goes through SPEC.md, not
// a single lane's discretion.
//
// The generalization from gtm-content-evals: the subject of evaluation is no
// longer `text: string`, it is an AgentRun. Content is the archetype where the
// run's output happens to be prose; outbound and research runs carry tool calls
// and structured output. Every rule, rubric, and gate operates on an AgentRun.

// ---------------------------------------------------------------------------
// The subject: an agent run (a trajectory), not just its final text.
// ---------------------------------------------------------------------------

export type StepKind = "tool_call" | "tool_result" | "thought" | "message";

/** One step in an agent's trajectory. Tool calls and results are what make a
 *  run more than its final string, and what golden-trajectory regression diffs. */
export type RunStep = {
  kind: StepKind;
  /** tool name for tool_call/tool_result; role for message; omitted for thought */
  name?: string;
  content: string;
};

/** The unit every rule, rubric, and gate evaluates. `output` is the final text
 *  the agent produced; `steps` is the optional trajectory behind it. A pure
 *  content run has no steps and is evaluated on `output` alone, which is exactly
 *  how gtm-content-evals behaves — that tool is the `content` archetype's
 *  reference implementation. */
export type AgentRun = {
  archetype: string; // "content" | "outbound" | "research" | any custom id
  input: string; // the task/prompt handed to the agent
  output: string; // the agent's final output text
  steps?: RunStep[]; // optional trajectory
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Rules: deterministic, cheap, no model in the loop.
// ---------------------------------------------------------------------------

export type Severity = "block" | "warn";

export type Violation = { rule: string; message: string; severity: Severity };

/** A rule is a pure function over a run. It may read steps or only output.
 *  Async is allowed (e.g. a link checker) but a rule must never mutate the run. */
export type RuleFn = (
  run: AgentRun,
  params?: unknown,
) => Violation[] | Promise<Violation[]>;

export type RuleConfig = { name: string; params?: unknown };

// ---------------------------------------------------------------------------
// Rubric: LLM scoring on operator-named dimensions. Fails CLOSED to BLOCK when
// the scorer cannot run — a broken scorer is never a free pass.
// ---------------------------------------------------------------------------

export type RubricDimension = { name: string; threshold: number };
export type Rubric = { dimensions: RubricDimension[] };
export type Scores = Record<string, number>;

/** Scores a run on the named dimensions. Implementations must reject (not return
 *  a partial or a zero) on provider/network/key failure, so the gate can fail
 *  closed. */
export type LLMProvider = (
  run: AgentRun,
  dimensions: string[],
) => Promise<Scores>;

// ---------------------------------------------------------------------------
// Config + verdict.
// ---------------------------------------------------------------------------

export type EvalConfig = {
  id?: string;
  archetype: string;
  rules: RuleConfig[];
  rubric?: Rubric;
  /** N clean runs required before an agent is cleared for autonomous operation. */
  gateN: number;
};

export type VerdictStatus = "PASS" | "BLOCK";

export type Verdict = {
  status: VerdictStatus;
  violations: Violation[];
  scores?: Scores;
  /** dimensions that scored under threshold; drives the BLOCK reason */
  failedDimensions?: string[];
  /** human-readable reasons, one line each, for the CLI and the log */
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Autonomy gate: the N-clean-runs streak, ported from gtm-content-evals.
// ---------------------------------------------------------------------------

export type RunRecord = {
  timestamp: string;
  configId: string;
  archetype: string;
  status: VerdictStatus;
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Golden-trajectory regression: the platform's differentiator over a plain gate.
// Record a known-good run, replay the agent later, diff against the golden.
// ---------------------------------------------------------------------------

export type GoldenRecord = {
  id: string;
  archetype: string;
  input: string;
  run: AgentRun; // the known-good trajectory
  verdict: Verdict; // its verdict at record time
  recordedAt: string;
};

export type RegressionStatus =
  | "MATCH" // same verdict, trajectory within tolerance
  | "DRIFT" // trajectory changed but verdict still PASS
  | "REGRESSION"; // was PASS, now BLOCK, or a scored dimension dropped past tolerance

export type TrajectoryDiff = {
  field: string; // dotted path, e.g. "output" or "steps[2].name"
  golden: unknown;
  actual: unknown;
};

export type RegressionResult = {
  goldenId: string;
  status: RegressionStatus;
  diffs: TrajectoryDiff[];
};

// ---------------------------------------------------------------------------
// Telemetry: vendor-agnostic emit. A JSONL sink ships by default; a
// Braintrust-compatible adapter is the named integration. The dashboard reads
// whatever the sink persisted.
// ---------------------------------------------------------------------------

export type TelemetryEvent = {
  runId: string;
  timestamp: string;
  configId: string;
  archetype: string;
  verdict: Verdict;
  durationMs?: number;
  /** Which agent produced this run. Optional so every event written before the
   *  ledger existed stays readable; an event without it is UNATTRIBUTED, which
   *  the ledger treats as evidence of unknown era rather than as evidence of
   *  nothing. See `src/ledger/era.ts`. */
  agentId?: string;
  /** The agent's config hash AT RUN TIME — the field that makes a run's lineage
   *  provable instead of inferred. This is what scopes an eligibility streak to
   *  the configuration currently on file, closing the session-1 hole where a
   *  rotated agent could be re-granted on its predecessor's streak. Optional for
   *  the same backward-compatibility reason as `agentId`. */
  agentConfigHash?: string;
};

export type TelemetrySink = (event: TelemetryEvent) => Promise<void> | void;

// ---------------------------------------------------------------------------
// The autonomy ledger (Lane G). Everything below is ADDITIVE: no type above
// changes, which is what keeps every prior lane's tests green. See SPEC.md
// "Lane G" for the vocabulary these encode.
// ---------------------------------------------------------------------------

/** Where the human sits, not how good the agent is. Strictly ordered:
 *  supervised (floor, every run reviewed) < advisory (unattended into a human
 *  queue) < auto (unattended, takes effect). `auto` removes the standing
 *  review, never the gate — every run is still evaluated. */
export type AutonomyTier = "supervised" | "advisory" | "auto";

/** The subject that outlives a run. Nothing in the platform had one: rules,
 *  rubrics, verdicts and telemetry are all per-run, keyed by `configId`.
 *  `configIds` is the join — the eval configs whose telemetry counts as this
 *  agent's evidence — which associates every existing artifact to an agent
 *  without changing any of them. */
export type AgentRecord = {
  id: string;
  name: string;
  description?: string;
  /** Hash of whatever defines this agent's behavior (prompt, config, tools).
   *  The platform does not compute it; the operator supplies it, because only
   *  the operator knows what "the agent's configuration" means in their stack. */
  configHash: string;
  modelId: string;
  /** Clean runs required before this agent is eligible for the next tier. */
  gateN: number;
  /** Eval config ids whose telemetry is this agent's evidence. Empty means no
   *  evidence stream is associated, which makes every evidence falsifier
   *  UNEVALUABLE rather than silently satisfied. */
  configIds: string[];
  /** When this agent was FIRST registered. Stable across re-registrations. */
  registeredAt: string;
  /** When the CURRENT `configHash` was first registered. Equal to
   *  `registeredAt` until a config rotates, after which it moves and
   *  `registeredAt` does not. The gap between them is the only config-lineage
   *  signal the platform has, because a TelemetryEvent carries no config hash
   *  (see "What the ledger does not know yet" in the README). */
  configSince: string;
};

/** What the grant was earned ON, frozen at grant time. The falsifiers compare
 *  today's agent against this snapshot, so it is the grant's evidence AND the
 *  baseline the drift is measured from. */
export type GrantEvidence = {
  configHash: string;
  modelId: string;
  /** The clean-run streak at the moment of the grant. */
  streak: number;
  /** The bar that streak cleared. */
  gateN: number;
  /** Telemetry runIds that made up the streak — the receipts, so a reader can
   *  go look at the runs rather than trust the number. */
  runIds: string[];
  /** How many of those runs carried this agent's config hash, making their
   *  lineage PROVEN. Additive; absent on grants written before session 2. */
  verifiedRuns?: number;
  /** How many were counted on the registry's word instead — unattributed runs
   *  inside the current config's window, whose lineage is inferred from the
   *  clock. `verifiedRuns + unverifiedRuns === streak`. A grant resting mostly
   *  on unverified runs is a weaker grant, and saying so is the point. */
  unverifiedRuns?: number;
  /** Free-text from the granting human (a review link, a rationale). */
  note?: string;
};

/** A durable, revocable decision: this agent may operate at this tier, on this
 *  evidence, for as long as these falsifiers hold. */
export type AutonomyGrant = {
  id: string;
  agentId: string;
  tier: AutonomyTier;
  grantedAt: string;
  /** Who typed the confirmation. A grant with no human on it is not a grant. */
  grantedBy: string;
  evidence: GrantEvidence;
  /** Falsifier ids from the registry that must keep holding. */
  falsifiers: string[];
  /** Set once an operator has explicitly RESOLVED this grant. An archived grant
   *  confers no tier and is excluded from `check`'s exit code, but stays in the
   *  ledger and in every detail view. Without this, a revoked grant alarms
   *  forever, and an alarm that can never be cleared is an alarm that gets
   *  ignored. Archiving is annotation, never deletion. */
  archivedAt?: string;
  archivedBy?: string;
};

/** One named fact that must stay true, as DATA. `check` names a function in the
 *  ledger's CHECKS table; `params` carries that check's thresholds. Retuning a
 *  threshold is a data edit, never a code change. */
export type FalsifierSpec = {
  id: string;
  check: string;
  /** Written so a reader can disagree with a verdict by reading two lines. */
  statement: string;
  params?: Record<string, unknown>;
};

export type FalsifierRegistry = { falsifiers: FalsifierSpec[] };

/** HOLDS: still true. DEGRADED: weakening, worth a look. BROKEN: refuted by
 *  evidence. UNEVALUABLE: the check could not run, which is NOT a pass. */
export type FalsifierStatus = "HOLDS" | "DEGRADED" | "BROKEN" | "UNEVALUABLE";

export type FalsifierResult = {
  falsifier: string;
  statement: string;
  status: FalsifierStatus;
  /** The one line that moved it. Printed under the statement on every non-HOLDS
   *  verdict, so disagreeing costs two lines of reading. */
  evidence: string;
};

/** VALID: every falsifier holds. SUSPECT: one is degraded or could not be
 *  checked. REVOKED: one was refuted. There is no path from UNEVALUABLE to
 *  VALID. */
export type GrantStatus = "VALID" | "SUSPECT" | "REVOKED";

export type GrantCheck = {
  grantId: string;
  agentId: string;
  tier: AutonomyTier;
  status: GrantStatus;
  falsifiers: FalsifierResult[];
  checkedAt: string;
  /** True when an operator has resolved this grant. The falsifiers are still
   *  evaluated and still reported — archiving silences the ALARM, never the
   *  facts. */
  archived: boolean;
  /** Carried through from the grant so every surface can show who resolved an
   *  incident without re-joining against the grant store. */
  archivedAt?: string;
  archivedBy?: string;
};

/** One agent's row in the ledger: what it may do unattended right now, and the
 *  whole chain behind that answer. */
export type AgentLedgerEntry = {
  agentId: string;
  name: string;
  /** Highest tier whose grant is currently VALID; `supervised` when none is. */
  effectiveTier: AutonomyTier;
  /** Tiers the agent holds grants for, whatever their current status. */
  grantedTiers: AutonomyTier[];
  checks: GrantCheck[];
  streak: number;
  gateN: number;
  /** True once the streak meets gateN — eligible for a grant, never granted. */
  eligible: boolean;
  lastVerdict?: VerdictStatus;
  lastRunAt?: string;
};

/** The whole ledger as one artifact: what every registered agent may do
 *  unattended right now, plus the grants that name an agent nobody registered.
 *  This is what `--out` writes, and what the dashboard reads. */
export type Ledger = {
  generatedAt: string;
  agents: AgentLedgerEntry[];
  /** Checks for grants whose agentId is not in the registry. Surfaced rather
   *  than dropped: a grant nobody can see is a grant nobody can revoke. */
  orphanGrants: GrantCheck[];
};
