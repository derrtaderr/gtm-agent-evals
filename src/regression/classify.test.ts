import { describe, it, expect } from "vitest";
import { classify } from "./classify.js";
import { record } from "./record.js";
import type { AgentRun, Verdict } from "../types.js";

const baseRun: AgentRun = {
  archetype: "outbound",
  input: "Cold email to Priya Nair at Lumen Freight",
  output: "Hi Priya, noticed Lumen is scaling lanes — worth 15 minutes?",
  steps: [
    { kind: "tool_call", name: "enrich", content: "Lumen Freight" },
    { kind: "tool_result", name: "enrich", content: "logistics, Series A" },
    { kind: "message", name: "assistant", content: "draft" },
  ],
};

const passVerdict: Verdict = {
  status: "PASS",
  violations: [],
  scores: { relevance: 8, specificity: 7 },
  reasons: ["clean"],
};

const goldenPass = record(baseRun, passVerdict, { recordedAt: "2026-09-06T00:00:00.000Z" });

describe("classify", () => {
  it("MATCH — identical trajectory and same PASS verdict", () => {
    const result = classify(goldenPass, { ...baseRun }, passVerdict);
    expect(result.status).toBe("MATCH");
    expect(result.diffs).toEqual([]);
    expect(result.goldenId).toBe(goldenPass.id);
  });

  it("MATCH — only metadata differs", () => {
    const fresh: AgentRun = { ...baseRun, metadata: { model: "new" } };
    expect(classify(goldenPass, fresh, passVerdict).status).toBe("MATCH");
  });

  it("REGRESSION — was PASS, now BLOCK", () => {
    const blockVerdict: Verdict = {
      status: "BLOCK",
      violations: [{ rule: "required-cta", message: "no CTA", severity: "block" }],
      scores: { relevance: 8, specificity: 7 },
      reasons: ["missing CTA"],
    };
    const fresh: AgentRun = { ...baseRun, output: "Hi Priya, Lumen is cool." };
    const result = classify(goldenPass, fresh, blockVerdict);
    expect(result.status).toBe("REGRESSION");
  });

  it("REGRESSION — a scored dimension dropped past tolerance, even while still PASS", () => {
    const droppedVerdict: Verdict = {
      status: "PASS",
      violations: [],
      scores: { relevance: 4, specificity: 7 }, // relevance 8 -> 4, drop of 4 > 1.0
      reasons: ["passed rules"],
    };
    const result = classify(goldenPass, { ...baseRun }, droppedVerdict);
    expect(result.status).toBe("REGRESSION");
  });

  it("does NOT regress when a dimension drops within tolerance", () => {
    const withinTol: Verdict = {
      status: "PASS",
      violations: [],
      scores: { relevance: 7.5, specificity: 7 }, // drop of 0.5 <= 1.0
      reasons: ["passed"],
    };
    const result = classify(goldenPass, { ...baseRun }, withinTol);
    expect(result.status).toBe("MATCH");
  });

  it("DRIFT — trajectory changed but the fresh verdict is still PASS", () => {
    const fresh: AgentRun = {
      ...baseRun,
      output: "Hi Priya, saw Lumen just opened a west-coast lane — worth 15 minutes?",
    };
    const result = classify(goldenPass, fresh, passVerdict);
    expect(result.status).toBe("DRIFT");
    expect(result.diffs.some((d) => d.field === "output")).toBe(true);
  });

  it("respects a custom score tolerance", () => {
    const droppedVerdict: Verdict = {
      status: "PASS",
      violations: [],
      scores: { relevance: 6, specificity: 7 }, // drop of 2
      reasons: ["passed"],
    };
    // tolerance 3 -> drop of 2 is within tolerance -> not a regression
    const lenient = classify(goldenPass, { ...baseRun }, droppedVerdict, { scoreTolerance: 3 });
    expect(lenient.status).toBe("MATCH");
    // tolerance 1 -> drop of 2 exceeds -> REGRESSION
    const strict = classify(goldenPass, { ...baseRun }, droppedVerdict, { scoreTolerance: 1 });
    expect(strict.status).toBe("REGRESSION");
  });

  it("throws loudly on mismatched input rather than silently MATCHing", () => {
    const wrongRun: AgentRun = { ...baseRun, input: "a completely different task" };
    expect(() => classify(goldenPass, wrongRun, passVerdict)).toThrow(/input/i);
  });
});
