import { describe, it, expect } from "vitest";
import { evaluateGate } from "./index.js";
import type { Rubric, Violation } from "../types.js";

const rubric: Rubric = { dimensions: [{ name: "relevance", threshold: 7 }] };

function block(rule: string): Violation {
  return { rule, message: "x", severity: "block" };
}
function warn(rule: string): Violation {
  return { rule, message: "x", severity: "warn" };
}

describe("evaluateGate", () => {
  it("PASSes when rules are clean and every dimension meets threshold", () => {
    const v = evaluateGate([], { relevance: 8 }, rubric);
    expect(v.status).toBe("PASS");
    expect(v.failedDimensions).toEqual([]);
  });

  it("BLOCKs on any block-severity rule violation", () => {
    const v = evaluateGate([block("forbidden-substring")], { relevance: 9 }, rubric);
    expect(v.status).toBe("BLOCK");
  });

  it("does NOT block on a warn-only violation, but keeps it in violations", () => {
    const v = evaluateGate([warn("max-output-length")], { relevance: 9 }, rubric);
    expect(v.status).toBe("PASS");
    expect(v.violations).toHaveLength(1);
  });

  it("BLOCKs and names the dimension that scored under threshold", () => {
    const v = evaluateGate([], { relevance: 6 }, rubric);
    expect(v.status).toBe("BLOCK");
    expect(v.failedDimensions).toEqual(["relevance"]);
  });

  it("BLOCKs and fails CLOSED on a scoring error, with a clear reason", () => {
    const v = evaluateGate([], {}, rubric, "provider timeout");
    expect(v.status).toBe("BLOCK");
    expect(v.reasons.join(" ")).toMatch(/scoring failed/i);
    expect(v.reasons.join(" ")).toContain("provider timeout");
  });

  it("BLOCKs when a required dimension is entirely absent from the scores", () => {
    const v = evaluateGate([], {}, rubric);
    expect(v.status).toBe("BLOCK");
    expect(v.failedDimensions).toEqual(["relevance"]);
  });

  it("BLOCKs on a NaN score (fail closed, never treated as a pass)", () => {
    const v = evaluateGate([], { relevance: Number.NaN }, rubric);
    expect(v.status).toBe("BLOCK");
    expect(v.failedDimensions).toEqual(["relevance"]);
  });

  it("does not evaluate dimensions when there is a scoring error (already failed closed)", () => {
    const v = evaluateGate([], {}, rubric, "boom");
    expect(v.failedDimensions).toEqual([]);
    expect(v.status).toBe("BLOCK");
  });

  it("PASSes with no rubric when rules are clean", () => {
    const v = evaluateGate([], {}, undefined);
    expect(v.status).toBe("PASS");
  });

  it("carries the scores through onto the verdict", () => {
    const v = evaluateGate([], { relevance: 8 }, rubric);
    expect(v.scores).toEqual({ relevance: 8 });
  });
});
