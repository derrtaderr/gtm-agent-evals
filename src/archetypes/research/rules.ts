// Research (account research / ICP) archetype rules. Pure functions over the
// AgentRun trajectory.
//
// DESIGN PRINCIPLE (fix wave 2): a deterministic RULE only `block`s on an
// UNAMBIGUOUS, decidable violation. Anything that needs JUDGMENT — is this number
// grounded? is this figure the same claim as the source? — belongs in the LLM
// RUBRIC, not a deterministic block rule.
//
//  - source-step-present  BLOCKs: "the run made zero retrievals" is decidable.
//  - no-uncited-assertion WARNs (never gates): numeric grounding is not
//    deterministically solvable, so this rule is a cheap heuristic that surfaces
//    only an OBVIOUS unsourced money claim. Deep grounding is the `groundedness`
//    rubric dimension's job.

import type { AgentRun, RuleFn, RunStep, Violation } from "../../types.js";

function toolResultSteps(run: AgentRun): RunStep[] {
  return (run.steps ?? []).filter((s) => s.kind === "tool_result");
}

/** Splits output into candidate sentences WITHOUT breaking decimals: a period
 *  only ends a sentence when it is not sitting between two digits, so "$4.2M"
 *  stays intact. */
function sentences(text: string): string[] {
  return text
    .split(/(?<!\d)[.!?]+(?!\d)|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- money-claim detection --------------------------------------------------
// A money claim is deliberately NARROW so the rule never fires on founding years,
// rankings (#2, top 3), "24/7", phone numbers, street addresses, bare
// percentages, or bare headcounts. Two forms count:
//   A. currency-marked: "$50M", "$4.2 million", "$4,200,000"
//   B. explicit dollars: "50 million dollars", "4.2 billion dollars"
const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  mm: 1e6,
  b: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

const MONEY_FORM_A =
  /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mm|b|t|thousand|million|billion|trillion)?\b/gi;
const MONEY_FORM_B =
  /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)\s+dollars\b/gi;

function magnitude(numText: string, unit?: string): number {
  const base = parseFloat(numText.replace(/,/g, ""));
  const mult = unit ? (MULTIPLIER[unit.toLowerCase()] ?? 1) : 1;
  return base * mult;
}

/** Money magnitudes stated as CLAIMS in a piece of text (forms A and B). */
function moneyClaims(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_FORM_A)) out.push(magnitude(m[1], m[2]));
  for (const m of text.matchAll(MONEY_FORM_B)) out.push(magnitude(m[1], m[2]));
  return out;
}

// Any magnitude a SOURCE could be expressing, so "$4.2M" in the output matches a
// bare "4.2 million" in a source step (which is not itself currency-marked).
const SOURCE_MAGNITUDE =
  /\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mm|b|t|thousand|million|billion|trillion)?\b/gi;

function sourceMagnitudes(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(SOURCE_MAGNITUDE)) {
    out.add(magnitude(m[1], m[2]));
    // Also add the raw base value so a source that writes "$4,200,000" still
    // matches an output "$4.2M" and vice-versa.
    out.add(parseFloat(m[1].replace(/,/g, "")));
  }
  return out;
}

/** Blocks a run that never made a retrieval (no tool_result step). Decidable. */
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

/** WARNs on an obvious unsourced money/magnitude claim. Never gates the run —
 *  deep numeric grounding is the `groundedness` rubric's job. */
export const noUncitedAssertion: RuleFn = (run: AgentRun): Violation[] => {
  const sourced = new Set<number>();
  for (const step of toolResultSteps(run)) {
    for (const v of sourceMagnitudes(step.content)) sourced.add(v);
  }
  const violations: Violation[] = [];
  for (const sentence of sentences(run.output)) {
    const claims = moneyClaims(sentence);
    const unsourced = claims.filter((c) => !sourced.has(c));
    if (unsourced.length === 0) continue;
    violations.push({
      rule: "no-uncited-assertion",
      message: `Possible unsourced money claim in "${sentence}". No retrieved source states this amount. Confirm against a source (the groundedness rubric grades this).`,
      severity: "warn",
    });
  }
  return violations;
};
