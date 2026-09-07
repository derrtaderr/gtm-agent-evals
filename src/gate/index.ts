import type { Rubric, Scores, Verdict, Violation } from "../types.js";

/** Combine rule violations and rubric scores into a Verdict. Fails CLOSED:
 *
 *  - any `block`-severity violation  -> BLOCK
 *  - a scoring error (scorer rejected) -> BLOCK, dimensions NOT evaluated
 *  - any dimension missing, non-numeric, or under threshold -> BLOCK
 *
 *  `warn`-severity violations are recorded but never force a BLOCK. PASS only
 *  when rules carry no block violation AND (no rubric, or every dimension meets
 *  threshold). This is the platform's thesis: a broken scorer is never a free
 *  pass. */
export function evaluateGate(
  violations: Violation[],
  scores: Scores,
  rubric: Rubric | undefined,
  scoringError?: string,
): Verdict {
  const reasons: string[] = [];
  const failedDimensions: string[] = [];
  let blocked = false;

  for (const v of violations) {
    reasons.push(`[${v.severity}] [${v.rule}] ${v.message}`);
    if (v.severity === "block") blocked = true;
  }

  if (scoringError) {
    reasons.push(`scoring failed (fail closed): ${scoringError}`);
    blocked = true;
  } else if (rubric) {
    for (const d of rubric.dimensions) {
      const s = scores[d.name];
      if (typeof s !== "number" || !Number.isFinite(s) || s < d.threshold) {
        failedDimensions.push(d.name);
        reasons.push(`dimension "${d.name}" scored ${s ?? "n/a"} < ${d.threshold}`);
        blocked = true;
      }
    }
  }

  return {
    status: blocked ? "BLOCK" : "PASS",
    violations,
    scores,
    failedDimensions,
    reasons,
  };
}
