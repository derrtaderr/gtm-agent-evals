import { describe, it, expect } from "vitest";
import { computeStreak, clearedForAutonomy } from "./index.js";
import type { RunRecord } from "../types.js";

function rec(configId: string, status: "PASS" | "BLOCK"): RunRecord {
  return {
    timestamp: new Date().toISOString(),
    configId,
    archetype: "content",
    status,
    reasons: [],
  };
}

describe("computeStreak", () => {
  it("counts trailing PASS runs for the config", () => {
    const runs = [rec("a", "PASS"), rec("a", "PASS"), rec("a", "PASS")];
    expect(computeStreak(runs, "a")).toBe(3);
  });

  it("stops at the most recent BLOCK for the config", () => {
    const runs = [rec("a", "PASS"), rec("a", "BLOCK"), rec("a", "PASS")];
    expect(computeStreak(runs, "a")).toBe(1);
  });

  it("ignores runs for other configs", () => {
    const runs = [rec("a", "PASS"), rec("b", "BLOCK"), rec("a", "PASS")];
    expect(computeStreak(runs, "a")).toBe(2);
  });

  it("is zero when there are no runs for the config", () => {
    expect(computeStreak([rec("b", "PASS")], "a")).toBe(0);
  });
});

describe("clearedForAutonomy", () => {
  it("clears when the streak meets the gate", () => {
    expect(clearedForAutonomy(3, 3)).toBe(true);
  });

  it("does not clear when the streak is short of the gate", () => {
    expect(clearedForAutonomy(2, 3)).toBe(false);
  });
});
