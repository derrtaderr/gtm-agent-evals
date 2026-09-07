import type { RuleFn, Severity, Violation } from "../types.js";

type Params = { substrings: string[]; severity?: Severity };

/** Generic, cross-archetype: one violation per forbidden substring found in the
 *  run's output (case-insensitive). Severity defaults to block. */
export const forbiddenSubstring: RuleFn = (run, params): Violation[] => {
  const { substrings = [], severity = "block" } = (params as Params) ?? { substrings: [] };
  const haystack = run.output.toLowerCase();
  return substrings
    .filter((s) => haystack.includes(s.toLowerCase()))
    .map((s) => ({
      rule: "forbidden-substring",
      message: `Forbidden substring found in output: "${s}".`,
      severity,
    }));
};
