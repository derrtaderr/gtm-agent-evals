import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluate.js";
import { buildRuleRegistry } from "./rules/index.js";
import { makeFakeProvider } from "./scoring/index.js";
import type { AgentRun, EvalConfig, LLMProvider } from "./types.js";

const registry = buildRuleRegistry();

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    archetype: "outbound",
    input: "write a cold email to a VP of Sales",
    output: "Hi, quick idea on your pipeline reviews.",
    metadata: { campaignId: "c-1" },
    ...over,
  };
}

const config: EvalConfig = {
  id: "outbound-default",
  archetype: "outbound",
  rules: [
    { name: "required-metadata-field", params: { field: "campaignId" } },
    { name: "forbidden-substring", params: { substrings: ["guarantee"] } },
  ],
  rubric: { dimensions: [{ name: "relevance", threshold: 7 }] },
  gateN: 3,
};

describe("evaluate (orchestration)", () => {
  it("PASSes a clean run with all dimensions at/above threshold", async () => {
    const v = await evaluate(run(), config, {
      registry,
      provider: makeFakeProvider({ relevance: 9 }),
    });
    expect(v.status).toBe("PASS");
  });

  it("BLOCKs when a block-severity rule fires", async () => {
    const v = await evaluate(run({ output: "we guarantee results" }), config, {
      registry,
      provider: makeFakeProvider({ relevance: 9 }),
    });
    expect(v.status).toBe("BLOCK");
    expect(v.violations.some((x) => x.rule === "forbidden-substring")).toBe(true);
  });

  it("BLOCKs and names the failed dimension when the score is under threshold", async () => {
    const v = await evaluate(run(), config, {
      registry,
      provider: makeFakeProvider({ relevance: 4 }),
    });
    expect(v.status).toBe("BLOCK");
    expect(v.failedDimensions).toEqual(["relevance"]);
  });

  it("fails CLOSED to BLOCK when the provider rejects (the thesis end to end)", async () => {
    const throwing: LLMProvider = async () => {
      throw new Error("provider exploded");
    };
    const v = await evaluate(run(), config, { registry, provider: throwing });
    expect(v.status).toBe("BLOCK");
    expect(v.reasons.join(" ")).toMatch(/scoring failed/i);
    expect(v.reasons.join(" ")).toContain("provider exploded");
  });

  it("never scores a zero into a pass: a rejecting provider is a BLOCK, not a 0", async () => {
    const throwing: LLMProvider = async () => {
      throw new Error("network");
    };
    const v = await evaluate(run(), config, { registry, provider: throwing });
    expect(v.status).toBe("BLOCK");
    expect(v.scores).toEqual({});
  });

  it("refuses an unknown rule name rather than silently passing it", async () => {
    const bad: EvalConfig = { ...config, rules: [{ name: "no-such-rule" }] };
    await expect(
      evaluate(run(), bad, { registry, provider: makeFakeProvider({ relevance: 9 }) }),
    ).rejects.toThrow(/unknown rule/i);
  });
});
