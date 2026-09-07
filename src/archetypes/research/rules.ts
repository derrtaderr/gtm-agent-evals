// Research (account research / ICP) archetype rules. Pure functions over the
// AgentRun trajectory. The failure mode here is a confident, fabricated fact: a
// research agent that states a funding number or headcount no source ever
// returned. source-step-present blocks a run that never retrieved anything;
// no-uncited-assertion blocks a numeric claim absent from every retrieved source.

import type { AgentRun, RuleFn, RunStep, Violation } from "../../types.js";

// Matches a whole numeric token including an optional leading "$", thousands
// separators, and a decimal part: "$4.2M" -> "$4.2", "3,000" -> "3,000",
// "3.5x" -> "3.5", "12%" -> "12". The trailing unit (M/x/%) is not captured, so
// magnitude words are compared by their numeric core only.
const NUMBER_TOKEN = /\$?\d[\d,]*(?:\.\d+)?/g;

/** Normalized numeric cores in a string, e.g. "$4.2M" -> "4.2", "3,000" -> "3000". */
function extractNumbers(text: string): string[] {
  const matches = text.match(NUMBER_TOKEN) ?? [];
  return matches.map((m) => m.replace(/[$,]/g, ""));
}

function toolResultSteps(run: AgentRun): RunStep[] {
  return (run.steps ?? []).filter((s) => s.kind === "tool_result");
}

/** Splits output into candidate assertion sentences WITHOUT breaking decimals:
 *  a period only ends a sentence when it is not sitting between two digits, so
 *  "$4.2M" and "3.5x" stay intact. */
function sentences(text: string): string[] {
  return text
    .split(/(?<!\d)[.!?]+(?!\d)|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Blocks a run that never made a retrieval (no tool_result step). */
export const sourceStepPresent: RuleFn = (run: AgentRun): Violation[] => {
  if (toolResultSteps(run).length > 0) return [];
  return [
    {
      rule: "source-step-present",
      message:
        "No retrieval step (tool_result) in the run. A research claim with no source behind it cannot be trusted.",
      severity: "block",
    },
  ];
};

/** Blocks each numeric assertion in the output that no source step supports. */
export const noUncitedAssertion: RuleFn = (run: AgentRun): Violation[] => {
  const sourceNumbers = new Set<string>();
  for (const step of toolResultSteps(run)) {
    for (const n of extractNumbers(step.content)) sourceNumbers.add(n);
  }
  const violations: Violation[] = [];
  for (const sentence of sentences(run.output)) {
    const nums = extractNumbers(sentence);
    if (nums.length === 0) continue; // no numeric claim to ground
    // EVERY number in the sentence must be sourced. A single fabricated figure
    // must not ride through on an incidental sourced number in the same sentence.
    const unsourced = nums.filter((n) => !sourceNumbers.has(n));
    if (unsourced.length === 0) continue;
    violations.push({
      rule: "no-uncited-assertion",
      message: `Uncited numeric claim(s) ${unsourced
        .map((n) => `"${n}"`)
        .join(", ")}, no source step contains them: "${sentence}".`,
      severity: "block",
    });
  }
  return violations;
};
