import { describe, it, expect } from "vitest";
import { buildRuleRegistry, runRules } from "./index.js";
import type { AgentRun } from "../types.js";

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    archetype: "content",
    input: "write something",
    output: "a clean output",
    ...over,
  };
}

describe("buildRuleRegistry", () => {
  it("exposes the generic cross-archetype rules by name", () => {
    const reg = buildRuleRegistry();
    expect(Object.keys(reg).sort()).toEqual(
      ["forbidden-substring", "max-output-length", "required-metadata-field"].sort(),
    );
  });
});

describe("max-output-length", () => {
  it("blocks when output exceeds the max", async () => {
    const reg = buildRuleRegistry();
    const v = await reg["max-output-length"](run({ output: "abcdef" }), { max: 3 });
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("block");
    expect(v[0].rule).toBe("max-output-length");
  });

  it("is clean when output is within the max", async () => {
    const reg = buildRuleRegistry();
    expect(await reg["max-output-length"](run({ output: "ab" }), { max: 3 })).toEqual([]);
  });
});

describe("required-metadata-field", () => {
  it("blocks when the named metadata field is absent", async () => {
    const reg = buildRuleRegistry();
    const v = await reg["required-metadata-field"](run({ metadata: {} }), { field: "campaignId" });
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("block");
  });

  it("blocks when metadata is entirely missing", async () => {
    const reg = buildRuleRegistry();
    const v = await reg["required-metadata-field"](run({ metadata: undefined }), { field: "campaignId" });
    expect(v).toHaveLength(1);
  });

  it("is clean when the field is present", async () => {
    const reg = buildRuleRegistry();
    const clean = run({ metadata: { campaignId: "x" } });
    expect(await reg["required-metadata-field"](clean, { field: "campaignId" })).toEqual([]);
  });
});

describe("forbidden-substring", () => {
  it("reports one violation per forbidden substring found in the output", async () => {
    const reg = buildRuleRegistry();
    const r = run({ output: "we GUARANTEE a REFUND" });
    const v = await reg["forbidden-substring"](r, { substrings: ["guarantee", "refund", "lawsuit"] });
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.severity === "block")).toBe(true);
  });

  it("honors a warn severity override in params", async () => {
    const reg = buildRuleRegistry();
    const v = await reg["forbidden-substring"](run({ output: "guarantee" }), {
      substrings: ["guarantee"],
      severity: "warn",
    });
    expect(v[0].severity).toBe("warn");
  });
});

describe("runRules", () => {
  it("aggregates violations across configured rules", async () => {
    const reg = buildRuleRegistry();
    const v = await runRules(run({ output: "toolong" }), [{ name: "max-output-length", params: { max: 3 } }], reg);
    expect(v).toHaveLength(1);
  });

  it("throws on an unknown rule name (malformed config is a refusal)", async () => {
    const reg = buildRuleRegistry();
    await expect(runRules(run(), [{ name: "does-not-exist" }], reg)).rejects.toThrow(/unknown rule/i);
  });
});
