import type { RuleFn, Severity, Violation } from "../types.js";

type Params = { max: number; severity?: Severity };

/** Generic, cross-archetype: block when the run's final output is longer than
 *  `max` characters. Severity defaults to block, overridable via params. */
export const maxOutputLength: RuleFn = (run, params): Violation[] => {
  const { max, severity = "block" } = (params as Params) ?? { max: Infinity };
  if (run.output.length <= max) return [];
  return [
    {
      rule: "max-output-length",
      message: `Output is ${run.output.length} chars, over the ${max} limit.`,
      severity,
    },
  ];
};
