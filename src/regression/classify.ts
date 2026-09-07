import type {
  AgentRun,
  GoldenRecord,
  RegressionResult,
  Verdict,
} from "../types.js";
import { diffTrajectory } from "./diff.js";

export const DEFAULT_SCORE_TOLERANCE = 1.0;

export type ClassifyOptions = {
  /** A dimension dropping by MORE than this (golden - fresh) is a REGRESSION. */
  scoreTolerance?: number;
};

/** True if any dimension present in both verdicts dropped by more than the tolerance. */
function scoreDropped(
  golden: Verdict,
  fresh: Verdict,
  tolerance: number,
): boolean {
  const g = golden.scores;
  const f = fresh.scores;
  if (!g || !f) return false;
  for (const [dim, goldenScore] of Object.entries(g)) {
    const freshScore = f[dim];
    if (freshScore === undefined) continue; // compared only when present in both
    if (goldenScore - freshScore > tolerance) return true;
  }
  return false;
}

/**
 * Compare a fresh run + verdict against a golden and classify the outcome.
 *
 * - REGRESSION: was PASS now BLOCK, or a scored dimension dropped past tolerance.
 *   This is the fail-loud case the CI gate keys on.
 * - MATCH: same verdict status and no trajectory diffs (identical or metadata-only).
 * - DRIFT: anything else non-regressive — the trajectory (or a still-passing verdict)
 *   moved, but it is not a regression.
 *
 * A mismatched input means the caller paired the wrong run with this golden; that is a
 * loud error, never a silent MATCH.
 */
export function classify(
  golden: GoldenRecord,
  freshRun: AgentRun,
  freshVerdict: Verdict,
  options: ClassifyOptions = {},
): RegressionResult {
  if (freshRun.input !== golden.input) {
    throw new Error(
      `regression: input mismatch for golden ${golden.id} — golden input ` +
        `${JSON.stringify(golden.input)} does not match fresh run input ` +
        `${JSON.stringify(freshRun.input)}. Refusing to compare mismatched cases.`,
    );
  }

  const tolerance = options.scoreTolerance ?? DEFAULT_SCORE_TOLERANCE;
  const diffs = diffTrajectory(golden.run, freshRun);

  const wasPassNowBlock =
    golden.verdict.status === "PASS" && freshVerdict.status === "BLOCK";
  const dropped = scoreDropped(golden.verdict, freshVerdict, tolerance);

  let status: RegressionResult["status"];
  if (wasPassNowBlock || dropped) {
    status = "REGRESSION";
  } else if (golden.verdict.status === freshVerdict.status && diffs.length === 0) {
    status = "MATCH";
  } else {
    status = "DRIFT";
  }

  return { goldenId: golden.id, status, diffs };
}
