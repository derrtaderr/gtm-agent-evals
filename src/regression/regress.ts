import type {
  AgentRun,
  GoldenRecord,
  RegressionResult,
  Verdict,
} from "../types.js";
import { classify, type ClassifyOptions } from "./classify.js";

/**
 * Replay a set of goldens against fresh runs and their verdicts, producing one
 * RegressionResult per golden. Fresh runs are matched to goldens by (archetype, input),
 * not by position, so callers need not pre-sort. `freshRuns[i]` is paired with
 * `freshVerdicts[i]`.
 *
 * A golden with no matching fresh run is an explicit REGRESSION — a lost trajectory is a
 * failure, never a silent pass.
 */
export function regressAll(
  goldens: GoldenRecord[],
  freshRuns: AgentRun[],
  freshVerdicts: Verdict[],
  options: ClassifyOptions = {},
): RegressionResult[] {
  if (freshRuns.length !== freshVerdicts.length) {
    throw new Error(
      `regressAll: freshRuns (${freshRuns.length}) and freshVerdicts ` +
        `(${freshVerdicts.length}) must have the same length.`,
    );
  }

  return goldens.map((golden) => {
    const idx = freshRuns.findIndex(
      (r) => r.archetype === golden.archetype && r.input === golden.input,
    );
    if (idx === -1) {
      return {
        goldenId: golden.id,
        status: "REGRESSION" as const,
        diffs: [
          {
            field: "run",
            golden: golden.run,
            actual: undefined,
          },
        ],
      };
    }
    return classify(golden, freshRuns[idx], freshVerdicts[idx], options);
  });
}
