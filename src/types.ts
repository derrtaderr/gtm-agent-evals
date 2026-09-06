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
};

export type TelemetrySink = (event: TelemetryEvent) => Promise<void> | void;
