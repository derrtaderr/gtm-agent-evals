// Research archetype: grounding rules + a citation-quality/groundedness rubric.
// Exports the two RuleFns (functions, array, and a name->RuleFn registry for
// Lane A), plus a default EvalConfig and Rubric a stranger can point the CLI at.

import type { EvalConfig, RuleFn, Rubric } from "../../types.js";
import { sourceStepPresent, noUncitedAssertion } from "./rules.js";

export { sourceStepPresent, noUncitedAssertion };

/** The two research rules as a plain array. */
export const researchRuleFns: RuleFn[] = [sourceStepPresent, noUncitedAssertion];

/** name -> RuleFn, the shape Lane A's registry consumes. */
export const researchRules: Record<string, RuleFn> = {
  "source-step-present": sourceStepPresent,
  "no-uncited-assertion": noUncitedAssertion,
};

/** Rubric dimensions the LLM scorer grades a research run on. */
export const researchRubric: Rubric = {
  dimensions: [
    { name: "citation-quality", threshold: 7 },
    { name: "groundedness", threshold: 7 },
  ],
};

/** Default config a stranger can run against a research AgentRun. */
export const researchConfig: EvalConfig = {
  id: "research-default",
  archetype: "research",
  rules: [
    { name: "source-step-present" },
    { name: "no-uncited-assertion" },
  ],
  rubric: researchRubric,
  gateN: 5,
};
