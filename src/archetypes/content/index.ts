// Content archetype: the port of gtm-content-evals' proven voice gate onto the
// AgentRun contract. Exports the four RuleFns (as functions, an array, and a
// name->RuleFn registry Lane A's registry can spread), plus a default EvalConfig
// and Rubric a stranger can point the CLI at.

import type { EvalConfig, RuleFn, Rubric } from "../../types.js";
import {
  noEmDash,
  noBodyColon,
  bannedPhrases,
  noBinaryCorrective,
} from "./rules.js";

export { noEmDash, noBodyColon, bannedPhrases, noBinaryCorrective };

/** The four content rules as a plain array. */
export const contentRuleFns: RuleFn[] = [
  noEmDash,
  noBodyColon,
  bannedPhrases,
  noBinaryCorrective,
];

/** name -> RuleFn, the shape Lane A's registry consumes. */
export const contentRules: Record<string, RuleFn> = {
  "no-em-dash": noEmDash,
  "no-body-colon": noBodyColon,
  "banned-phrases": bannedPhrases,
  "no-binary-corrective": noBinaryCorrective,
};

/** Rubric dimensions the LLM scorer grades a content run on. */
export const contentRubric: Rubric = {
  dimensions: [
    { name: "voice-match", threshold: 7 },
    { name: "factual-grounding", threshold: 7 },
  ],
};

/** Default config a stranger can run against a content AgentRun. */
export const contentConfig: EvalConfig = {
  id: "content-default",
  archetype: "content",
  rules: [
    { name: "no-em-dash" },
    { name: "no-body-colon" },
    { name: "no-binary-corrective" },
    {
      name: "banned-phrases",
      params: {
        phrases: [
          "passionate",
          "thrilled",
          "would love",
          "at the end of the day",
          "in today's fast-paced",
        ],
      },
    },
  ],
  rubric: contentRubric,
  gateN: 5,
};
