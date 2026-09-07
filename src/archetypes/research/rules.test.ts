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
  it("passes when every numeric claim appears in a source step", async () => {
    const v = await noUncitedAssertion(
      run("They raised 12 million.", [
        { kind: "tool_result", name: "s", content: "Series A of 12 million" },
      ]),
    );
    expect(v).toEqual([]);
  });
  it("blocks a numeric claim absent from every source step", async () => {
    const v = await noUncitedAssertion(
      run("They raised 50 million.", [
        { kind: "tool_result", name: "s", content: "Series A of 12 million" },
      ]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-uncited-assertion");
    expect(v[0].severity).toBe("block");
  });
  it("only checks tool_result steps, not the agent's own thoughts", async () => {
    const v = await noUncitedAssertion(
      run("They serve 3000 customers.", [
        { kind: "thought", content: "I believe they serve 3000 customers" },
      ]),
    );
    expect(v).toHaveLength(1);
  });
  it("ignores sentences with no numeric claim", async () => {
    const v = await noUncitedAssertion(
      run("Acme Freight looks like a strong fit.", [
        { kind: "tool_result", name: "s", content: "no numbers here" },
      ]),
    );
    expect(v).toEqual([]);
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
  it("failing fixture trips an uncited-assertion block", async () => {
    const v = await allViolations(failing);
    expect(v.some((x) => x.rule === "no-uncited-assertion")).toBe(true);
    expect(v.some((x) => x.severity === "block")).toBe(true);
  });
});
