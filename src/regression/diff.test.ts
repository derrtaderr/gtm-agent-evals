import { describe, it, expect } from "vitest";
import { diffTrajectory } from "./diff.js";
import type { AgentRun } from "../types.js";

const golden: AgentRun = {
  archetype: "research",
  input: "Summarize funding for Acme Analytics",
  output: "Acme Analytics raised a Series B in 2025.",
  steps: [
    { kind: "tool_call", name: "search", content: "Acme Analytics funding" },
    { kind: "tool_result", name: "search", content: "Series B, 2025" },
    { kind: "message", name: "assistant", content: "Acme raised a Series B." },
  ],
};

describe("diffTrajectory", () => {
  it("returns no diffs for an identical run", () => {
    expect(diffTrajectory(golden, { ...golden })).toEqual([]);
  });

  it("ignores metadata-only differences", () => {
    const actual: AgentRun = { ...golden, metadata: { model: "new-model" } };
    expect(diffTrajectory(golden, actual)).toEqual([]);
  });

  it("reports an output change on the dotted path 'output'", () => {
    const actual: AgentRun = { ...golden, output: "Acme raised a Series C." };
    const diffs = diffTrajectory(golden, actual);
    expect(diffs).toContainEqual({
      field: "output",
      golden: golden.output,
      actual: "Acme raised a Series C.",
    });
  });

  it("reports a per-step content change with an indexed path", () => {
    const actual: AgentRun = {
      ...golden,
      steps: [
        golden.steps![0],
        { kind: "tool_result", name: "search", content: "Series C, 2026" },
        golden.steps![2],
      ],
    };
    const diffs = diffTrajectory(golden, actual);
    expect(diffs).toContainEqual({
      field: "steps[1].content",
      golden: "Series B, 2025",
      actual: "Series C, 2026",
    });
  });

  it("reports a per-step kind and name change with indexed paths", () => {
    const actual: AgentRun = {
      ...golden,
      steps: [
        { kind: "thought", name: "planner", content: "Acme Analytics funding" },
        golden.steps![1],
        golden.steps![2],
      ],
    };
    const diffs = diffTrajectory(golden, actual);
    expect(diffs).toContainEqual({
      field: "steps[0].kind",
      golden: "tool_call",
      actual: "thought",
    });
    expect(diffs).toContainEqual({
      field: "steps[0].name",
      golden: "search",
      actual: "planner",
    });
  });

  it("reports the tool-call sequence when a tool call is dropped", () => {
    const actual: AgentRun = {
      ...golden,
      steps: [golden.steps![2]], // only the message step remains, no tool_call
    };
    const diffs = diffTrajectory(golden, actual);
    expect(diffs).toContainEqual({
      field: "toolCallSequence",
      golden: ["search"],
      actual: [],
    });
  });

  it("reports steps present in the golden but missing from the actual", () => {
    const actual: AgentRun = { ...golden, steps: [golden.steps![0]] };
    const diffs = diffTrajectory(golden, actual);
    expect(diffs.some((d) => d.field === "steps[1].kind")).toBe(true);
    expect(diffs.some((d) => d.field === "steps[2].kind")).toBe(true);
  });

  it("treats absent steps on both sides as no trajectory diff", () => {
    const g: AgentRun = { archetype: "content", input: "x", output: "hello" };
    const a: AgentRun = { archetype: "content", input: "x", output: "hello" };
    expect(diffTrajectory(g, a)).toEqual([]);
  });
});
