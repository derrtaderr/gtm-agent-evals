import type { AgentRun, EvalConfig, LLMProvider, RuleFn, Scores, Verdict } from "./types.js";
import { runRules } from "./rules/index.js";
import { scoreRun } from "./scoring/index.js";
import { evaluateGate } from "./gate/index.js";

export type EvaluateDeps = {
  registry: Record<string, RuleFn>;
  provider: LLMProvider;
};

/** Top-level evaluation: run the config's rules over the run, score it on the
 *  rubric, and combine into a Verdict.
 *
 *  A malformed config (unknown rule name) is a refusal — it throws, never a
 *  silent pass. A scorer failure is caught and handed to the gate as a scoring
 *  error, which fails CLOSED to BLOCK. */
export async function evaluate(
  run: AgentRun,
  config: EvalConfig,
  deps: EvaluateDeps,
): Promise<Verdict> {
  const violations = await runRules(run, config.rules, deps.registry);

  let scores: Scores = {};
  let scoringError: string | undefined;
  try {
    scores = await scoreRun(run, config.rubric, deps.provider);
  } catch (e) {
    scoringError = e instanceof Error ? e.message : String(e);
  }

  return evaluateGate(violations, scores, config.rubric, scoringError);
}
