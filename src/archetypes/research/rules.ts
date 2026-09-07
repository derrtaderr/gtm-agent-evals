// Research (account research / ICP) archetype rules. Pure functions over the
// AgentRun trajectory. The failure mode here is a confident, fabricated fact: a
// research agent that states a funding number or headcount no source ever
// returned. source-step-present blocks a run that never retrieved anything;
// no-uncited-assertion blocks a numeric claim absent from every retrieved source.

import type { AgentRun, RuleFn, RunStep, Violation } from "../../types.js";

/** Normalized numeric cores in a string, e.g. "$4.2M" -> "4.2", "3,000" -> "3000". */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

function toolResultSteps(run: AgentRun): RunStep[] {
  return (run.steps ?? []).filter((s) => s.kind === "tool_result");
}

/** Splits output into candidate assertion sentences. */
function sentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
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
    if (nums.some((n) => sourceNumbers.has(n))) continue; // at least one is sourced
    violations.push({
      rule: "no-uncited-assertion",
      message: `Uncited numeric claim, no source step contains it: "${sentence}".`,
      severity: "block",
    });
  }
  return violations;
};
