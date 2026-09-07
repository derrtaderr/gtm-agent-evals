// Outbound archetype: cold-email rules + a relevance/specificity rubric. Exports
// the three RuleFns (functions, array, and a name->RuleFn registry for Lane A),
// plus a default EvalConfig and Rubric a stranger can point the CLI at.

import type { EvalConfig, RuleFn, Rubric } from "../../types.js";
import { noUnfilledPlaceholder, requiredCTA, lengthCap } from "./rules.js";

export { noUnfilledPlaceholder, requiredCTA, lengthCap };

/** The three outbound rules as a plain array. */
export const outboundRuleFns: RuleFn[] = [
  noUnfilledPlaceholder,
  requiredCTA,
  lengthCap,
];

/** name -> RuleFn, the shape Lane A's registry consumes. */
export const outboundRules: Record<string, RuleFn> = {
  "no-unfilled-placeholder": noUnfilledPlaceholder,
  "required-cta": requiredCTA,
  "length-cap": lengthCap,
};

/** Rubric dimensions the LLM scorer grades an outbound run on. */
export const outboundRubric: Rubric = {
  dimensions: [
    { name: "relevance", threshold: 7 },
    { name: "specificity", threshold: 7 },
  ],
};

/** Default config a stranger can run against an outbound AgentRun. */
export const outboundConfig: EvalConfig = {
  id: "outbound-default",
  archetype: "outbound",
  rules: [
    { name: "no-unfilled-placeholder" },
    { name: "required-cta" },
    { name: "length-cap", params: { maxWords: 150 } },
  ],
  rubric: outboundRubric,
  gateN: 5,
};
