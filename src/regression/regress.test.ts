import { describe, it, expect } from "vitest";
import { regressAll } from "./regress.js";
import { record } from "./record.js";
import type { AgentRun, Verdict } from "../types.js";

function run(archetype: string, input: string, output: string, steps?: AgentRun["steps"]): AgentRun {
  return { archetype, input, output, steps };
}

const pass: Verdict = { status: "PASS", violations: [], scores: { quality: 8 }, reasons: ["ok"] };
const block: Verdict = {
  status: "BLOCK",
  violations: [{ rule: "r", message: "m", severity: "block" }],
  scores: { quality: 8 },
  reasons: ["blocked"],
};

const runA = run("content", "task A", "output A");
const runB = run("content", "task B", "output B");
const goldenA = record(runA, pass, { recordedAt: "2026-09-06T00:00:00.000Z" });
const goldenB = record(runB, pass, { recordedAt: "2026-09-06T00:00:00.000Z" });

describe("regressAll", () => {
  it("classifies each golden against its matching fresh run by input", () => {
    const results = regressAll(
      [goldenA, goldenB],
      [runB, runA], // deliberately out of order — matched by input, not index
      [pass, pass],
    );
    const byId = Object.fromEntries(results.map((r) => [r.goldenId, r.status]));
    expect(byId[goldenA.id]).toBe("MATCH");
    expect(byId[goldenB.id]).toBe("MATCH");
    expect(results).toHaveLength(2);
  });

  it("fires REGRESSION for a golden whose fresh run flipped PASS to BLOCK", () => {
    const results = regressAll([goldenA], [runA], [block]);
    expect(results[0].status).toBe("REGRESSION");
  });

  it("fires an explicit REGRESSION when a golden has no matching fresh run, never a silent MATCH", () => {
    const results = regressAll([goldenA], [], []);
    expect(results[0].status).toBe("REGRESSION");
    expect(results[0].goldenId).toBe(goldenA.id);
  });

  it("throws when freshRuns and freshVerdicts are not the same length", () => {
    expect(() => regressAll([goldenA], [runA], [])).toThrow(/length/i);
  });
});
