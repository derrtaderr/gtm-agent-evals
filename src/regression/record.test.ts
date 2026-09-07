import { describe, it, expect } from "vitest";
import { record } from "./record.js";
import type { AgentRun, Verdict } from "../types.js";

const run: AgentRun = {
  archetype: "outbound",
  input: "Write a cold email to Dana Fielding at Northwind Robotics",
  output: "Hi Dana, saw Northwind shipped a new arm — worth a quick call?",
  steps: [
    { kind: "tool_call", name: "lookup_company", content: "Northwind Robotics" },
    { kind: "tool_result", name: "lookup_company", content: "robotics, 200 employees" },
    { kind: "message", name: "assistant", content: "drafting email" },
  ],
  metadata: { model: "fake-1" },
};

const verdict: Verdict = {
  status: "PASS",
  violations: [],
  scores: { relevance: 8, specificity: 7 },
  reasons: ["all rules passed"],
};

describe("record", () => {
  it("produces a GoldenRecord carrying the run, verdict, archetype and input", () => {
    const golden = record(run, verdict);
    expect(golden.archetype).toBe("outbound");
    expect(golden.input).toBe(run.input);
    expect(golden.run).toEqual(run);
    expect(golden.verdict).toEqual(verdict);
  });

  it("derives a stable id from archetype + input, identical across calls", () => {
    const a = record(run, verdict);
    const b = record(run, verdict);
    expect(a.id).toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
  });

  it("gives different inputs different ids", () => {
    const other = record({ ...run, input: "a different task" }, verdict);
    const base = record(run, verdict);
    expect(other.id).not.toBe(base.id);
  });

  it("stamps recordedAt as an ISO timestamp, injectable for determinism", () => {
    const golden = record(run, verdict, { recordedAt: "2026-09-06T00:00:00.000Z" });
    expect(golden.recordedAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("honors an explicit id override", () => {
    const golden = record(run, verdict, { id: "custom-id-1" });
    expect(golden.id).toBe("custom-id-1");
  });
});
