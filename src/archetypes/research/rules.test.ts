import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentRun, RunStep } from "../../types.js";
import {
  sourceStepPresent,
  noUncitedAssertion,
  researchRuleFns,
  researchRules,
  researchConfig,
  researchRubric,
} from "./index.js";

function loadFixture(name: string): AgentRun {
  const path = fileURLToPath(
    new URL(`../../../fixtures/research/${name}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as AgentRun;
}

const passing = loadFixture("passing");
const failing = loadFixture("failing");

function run(output: string, steps?: RunStep[]): AgentRun {
  return { archetype: "research", input: "x", output, steps };
}

describe("sourceStepPresent", () => {
  it("passes a run that made a tool_result retrieval", async () => {
    const v = await sourceStepPresent(
      run("summary", [{ kind: "tool_result", name: "s", content: "data" }]),
    );
    expect(v).toEqual([]);
  });
  it("blocks a run with no steps at all", async () => {
    const v = await sourceStepPresent(run("summary"));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("source-step-present");
    expect(v[0].severity).toBe("block");
  });
  it("blocks a run that only thought, never retrieved", async () => {
    const v = await sourceStepPresent(
      run("summary", [{ kind: "thought", content: "I think Acme is big" }]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("source-step-present");
  });
});

describe("noUncitedAssertion", () => {
  const noSource: RunStep[] = [
    { kind: "tool_result", name: "s", content: "no relevant numbers here" },
  ];

  // It is a warn-level SIGNAL, never a gate. Deep numeric grounding is the
  // groundedness RUBRIC's job; this rule only surfaces an obvious unsourced
  // money claim.
  it("warns (never blocks) on an unsourced currency-marked money claim", async () => {
    const v = await noUncitedAssertion(
      run("They raised $50M last quarter.", [
        { kind: "tool_result", name: "s", content: "Series A of 12 million" },
      ]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-uncited-assertion");
    expect(v[0].severity).toBe("warn");
  });
  it("also warns on an unsourced 'N million dollars' claim", async () => {
    const v = await noUncitedAssertion(
      run("They raised 50 million dollars in 2024.", [
        { kind: "tool_result", name: "s", content: "Series A in 2024. Headcount 40." },
      ]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("warn");
  });
  it("treats a source-magnitude-equal money claim as sourced ($4.2M vs 4.2 million)", async () => {
    const v = await noUncitedAssertion(
      run("They raised $4.2M last year.", [
        { kind: "tool_result", name: "s", content: "Series A of 4.2 million" },
      ]),
    );
    expect(v).toEqual([]);
  });
  it("treats same-magnitude reformatting as sourced ($4,200,000 vs 4.2 million)", async () => {
    const v = await noUncitedAssertion(
      run("They raised $4,200,000 in a Series A.", [
        { kind: "tool_result", name: "s", content: "Series A of 4.2 million" },
      ]),
    );
    expect(v).toEqual([]);
  });

  // The class of legitimate-research numbers that must NOT even warn.
  it("does not fire on a founding year", async () => {
    expect(
      await noUncitedAssertion(run("Founded in 1999, they now lead.", noSource)),
    ).toEqual([]);
  });
  it("does not fire on ordinals or rankings (#2, top 3)", async () => {
    expect(
      await noUncitedAssertion(
        run("They are the #2 player and match our top 3 use cases.", noSource),
      ),
    ).toEqual([]);
  });
  it("does not fire on 24/7, phone numbers, or street addresses", async () => {
    expect(
      await noUncitedAssertion(
        run(
          "They run 24/7 support from 1200 Market Street, reachable at 555-0142.",
          noSource,
        ),
      ),
    ).toEqual([]);
  });
  it("does not fire on a bare percentage", async () => {
    expect(
      await noUncitedAssertion(
        run("About 30% of their team is technical.", noSource),
      ),
    ).toEqual([]);
  });
  it("does not fire on a bare headcount (that is the rubric's job)", async () => {
    expect(
      await noUncitedAssertion(
        run("They grew to 5000 people from 40 last year.", noSource),
      ),
    ).toEqual([]);
  });
  it("does not fire on a bare multiplier like 3.5x", async () => {
    expect(
      await noUncitedAssertion(run("Revenue grew 3.5x.", noSource)),
    ).toEqual([]);
  });
});

describe("research archetype exports", () => {
  it("exports the two rule functions as an array", () => {
    expect(researchRuleFns).toHaveLength(2);
    expect(researchRuleFns.every((f) => typeof f === "function")).toBe(true);
  });
  it("exposes a name->RuleFn registry", () => {
    expect(Object.keys(researchRules).sort()).toEqual([
      "no-uncited-assertion",
      "source-step-present",
    ]);
  });
  it("default config names the archetype, rules, rubric, gateN", () => {
    expect(researchConfig.archetype).toBe("research");
    expect(researchConfig.gateN).toBeGreaterThan(0);
    expect(researchConfig.rubric).toBe(researchRubric);
    expect(researchConfig.rules.map((r) => r.name).sort()).toEqual([
      "no-uncited-assertion",
      "source-step-present",
    ]);
  });
  it("rubric carries citation-quality and groundedness", () => {
    const names = researchRubric.dimensions.map((d) => d.name);
    expect(names).toContain("citation-quality");
    expect(names).toContain("groundedness");
  });
});

describe("research fixtures", () => {
  async function allViolations(r: AgentRun) {
    const out = [];
    for (const fn of researchRuleFns) out.push(...(await fn(r)));
    return out;
  }
  it("passing fixture produces no violations", async () => {
    expect(await allViolations(passing)).toEqual([]);
  });
  it("failing fixture trips the source-step-present block (never retrieved)", async () => {
    const v = await allViolations(failing);
    expect(
      v.some(
        (x) => x.rule === "source-step-present" && x.severity === "block",
      ),
    ).toBe(true);
  });
  it("failing fixture warns on its unsourced money claim", async () => {
    const v = await allViolations(failing);
    expect(
      v.some(
        (x) => x.rule === "no-uncited-assertion" && x.severity === "warn",
      ),
    ).toBe(true);
  });
});
