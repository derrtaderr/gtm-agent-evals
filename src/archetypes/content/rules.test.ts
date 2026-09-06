import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentRun } from "../../types.js";
import {
  noEmDash,
  noBodyColon,
  bannedPhrases,
  noBinaryCorrective,
  contentRuleFns,
  contentRules,
  contentConfig,
  contentRubric,
} from "./index.js";

function loadFixture(name: string): AgentRun {
  const path = fileURLToPath(
    new URL(`../../../fixtures/content/${name}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as AgentRun;
}

const passing = loadFixture("passing");
const failing = loadFixture("failing");

function run(output: string): AgentRun {
  return { archetype: "content", input: "x", output };
}

describe("noEmDash", () => {
  it("flags an em dash in output with block severity", async () => {
    const v = await noEmDash(run("one thing — evaluating agents"));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-em-dash");
    expect(v[0].severity).toBe("block");
  });
  it("passes clean output", async () => {
    expect(await noEmDash(run("one thing, evaluating agents"))).toEqual([]);
  });
});

describe("noBodyColon", () => {
  it("flags a colon in a body line", async () => {
    const v = await noBodyColon(run("Here is the truth: gate them"));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-body-colon");
    expect(v[0].severity).toBe("block");
  });
  it("ignores colons in header lines, urls, and clock times", async () => {
    const v = await noBodyColon(
      run("# Title: a heading\nSee https://ex.com/a:b\nMeet at 9:30 today"),
    );
    expect(v).toEqual([]);
  });
});

describe("bannedPhrases", () => {
  it("flags each configured phrase case-insensitively", async () => {
    const v = await bannedPhrases(run("I'm Passionate and would love to help"), {
      phrases: ["passionate", "would love"],
    });
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.rule === "banned-phrases")).toBe(true);
    expect(v.every((x) => x.severity === "block")).toBe(true);
  });
  it("returns nothing with no phrases configured", async () => {
    expect(await bannedPhrases(run("passionate"), undefined)).toEqual([]);
  });
});

describe("noBinaryCorrective", () => {
  it("flags the it's-not-X-it's-Y form", async () => {
    const v = await noBinaryCorrective(
      run("it's not about the model, it's about the gate"),
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-binary-corrective");
    expect(v[0].severity).toBe("block");
  });
  it("passes text without the corrective form", async () => {
    expect(await noBinaryCorrective(run("lead with the positive path"))).toEqual(
      [],
    );
  });
});

describe("content archetype exports", () => {
  it("exports the four rule functions as an array", () => {
    expect(contentRuleFns).toHaveLength(4);
    expect(contentRuleFns.every((f) => typeof f === "function")).toBe(true);
  });
  it("exposes a name->RuleFn registry for wiring", () => {
    expect(Object.keys(contentRules).sort()).toEqual([
      "banned-phrases",
      "no-binary-corrective",
      "no-body-colon",
      "no-em-dash",
    ]);
  });
  it("default config names the archetype, its rules, a rubric and gateN", () => {
    expect(contentConfig.archetype).toBe("content");
    expect(contentConfig.gateN).toBeGreaterThan(0);
    expect(contentConfig.rubric).toBe(contentRubric);
    expect(contentConfig.rules.map((r) => r.name).sort()).toEqual([
      "banned-phrases",
      "no-binary-corrective",
      "no-body-colon",
      "no-em-dash",
    ]);
  });
  it("rubric carries the content dimensions", () => {
    expect(contentRubric.dimensions.map((d) => d.name)).toContain("voice-match");
    expect(contentRubric.dimensions.map((d) => d.name)).toContain(
      "factual-grounding",
    );
  });
});

describe("content fixtures", () => {
  async function allViolations(r: AgentRun) {
    const out = [];
    for (const fn of contentRuleFns) {
      out.push(...(await fn(r, { phrases: ["passionate", "thrilled"] })));
    }
    return out;
  }
  it("passing fixture produces no violations", async () => {
    expect(await allViolations(passing)).toEqual([]);
  });
  it("failing fixture trips at least one block rule", async () => {
    const v = await allViolations(failing);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.severity === "block")).toBe(true);
  });
});
