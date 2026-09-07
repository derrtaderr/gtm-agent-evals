import type {
  AgentRun,
  GoldenRecord,
  RegressionResult,
  TrajectoryDiff,
  Verdict,
} from "../types.js";
import { diffTrajectory } from "./diff.js";

export const DEFAULT_SCORE_TOLERANCE = 1.0;

export type ClassifyOptions = {
  /** A dimension dropping by MORE than this (golden - fresh) is a REGRESSION. */
  scoreTolerance?: number;
};

/**
 * The scored dimensions that regressed, each as a `scores.<dim>` diff. A dimension is a
 * regression when it dropped by MORE than the tolerance OR when it VANISHED — the golden
 * scored it but the fresh verdict omits it (undefined, absent scores object, or {}). A
 * vanished dimension is the largest possible drop (drop-to-zero semantics): the agent, or
 * the scorer, stopped producing that quality signal, and a safety gate must fail loud, not
 * silently MATCH. Dimensions the golden never scored cannot regress.
 */
function scoreRegressions(
  golden: Verdict,
  fresh: Verdict,
  tolerance: number,
): TrajectoryDiff[] {
  const g = golden.scores;
  if (!g) return []; // golden scored nothing — nothing to regress against
  const f = fresh.scores ?? {};
  const diffs: TrajectoryDiff[] = [];
  for (const [dim, goldenScore] of Object.entries(g)) {
    const freshScore = f[dim];
    if (freshScore === undefined) {
      // vanished dimension = worst-case erosion, past any tolerance
      diffs.push({ field: `scores.${dim}`, golden: goldenScore, actual: undefined });
    } else if (goldenScore - freshScore > tolerance) {
      diffs.push({ field: `scores.${dim}`, golden: goldenScore, actual: freshScore });
    }
  }
  return diffs;
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
 * A mismatched input or archetype means the caller paired the wrong run with this golden;
 * that is a loud error, never a silent MATCH.
 */
export function classify(
  golden: GoldenRecord,
  freshRun: AgentRun,
  freshVerdict: Verdict,
  options: ClassifyOptions = {},
): RegressionResult {
  if (freshRun.archetype !== golden.archetype) {
    throw new Error(
      `regression: archetype mismatch for golden ${golden.id} — golden archetype ` +
        `${JSON.stringify(golden.archetype)} does not match fresh run archetype ` +
        `${JSON.stringify(freshRun.archetype)}. Refusing to compare mismatched cases.`,
    );
  }
  if (freshRun.input !== golden.input) {
    throw new Error(
      `regression: input mismatch for golden ${golden.id} — golden input ` +
        `${JSON.stringify(golden.input)} does not match fresh run input ` +
        `${JSON.stringify(freshRun.input)}. Refusing to compare mismatched cases.`,
    );
  }

  const tolerance = options.scoreTolerance ?? DEFAULT_SCORE_TOLERANCE;
  const trajectoryDiffs = diffTrajectory(golden.run, freshRun);
  const scoreDiffs = scoreRegressions(golden.verdict, freshVerdict, tolerance);
  const diffs = [...trajectoryDiffs, ...scoreDiffs];

  const wasPassNowBlock =
    golden.verdict.status === "PASS" && freshVerdict.status === "BLOCK";
  const scoreDropped = scoreDiffs.length > 0;

  let status: RegressionResult["status"];
  if (wasPassNowBlock || scoreDropped) {
    status = "REGRESSION";
  } else if (
    golden.verdict.status === freshVerdict.status &&
    trajectoryDiffs.length === 0
  ) {
    status = "MATCH";
  } else {
    status = "DRIFT";
  }

  return { goldenId: golden.id, status, diffs };
}
