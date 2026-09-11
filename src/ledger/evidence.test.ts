import { describe, it, expect } from "vitest";
import { agentEvents, agentStreak, lastEvent } from "./evidence.js";
import { registerAgent } from "./agents.js";
import type { TelemetryEvent, VerdictStatus } from "../types.js";

function ev(configId: string, status: VerdictStatus, timestamp: string): TelemetryEvent {
  return {
    runId: `${configId}-${timestamp}`,
    timestamp,
    configId,
    archetype: "outbound",
    verdict: { status, violations: [], reasons: [] },
  };
}

const agent = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:aaaa1111",
    modelId: "example-model-v1",
    configIds: ["research-default", "outbound-default"],
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

describe("agentEvents", () => {
  it("gathers every config the agent is associated with, not just one", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-02T00:00:00.000Z"),
      ev("outbound-default", "PASS", "2026-09-03T00:00:00.000Z"),
    ];
    expect(agentEvents(events, agent)).toHaveLength(2);
  });

  it("ignores events belonging to somebody else's config", () => {
    const events = [
      ev("someone-elses-config", "PASS", "2026-09-02T00:00:00.000Z"),
      ev("research-default", "PASS", "2026-09-03T00:00:00.000Z"),
    ];
    expect(agentEvents(events, agent).map((e) => e.configId)).toEqual(["research-default"]);
  });

  it("returns nothing for an agent with no configs associated", () => {
    const orphan = { ...agent, configIds: [] };
    expect(agentEvents([ev("research-default", "PASS", "2026-09-02T00:00:00.000Z")], orphan)).toEqual(
      [],
    );
  });

  it("orders by time, not by the order the file happened to be appended in", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-05T00:00:00.000Z"),
      ev("outbound-default", "PASS", "2026-09-02T00:00:00.000Z"),
    ];
    expect(agentEvents(events, agent).map((e) => e.timestamp)).toEqual([
      "2026-09-02T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
    ]);
  });
});

describe("agentStreak", () => {
  it("counts consecutive clean runs across every config the agent owns", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-02T00:00:00.000Z"),
      ev("outbound-default", "PASS", "2026-09-03T00:00:00.000Z"),
      ev("research-default", "PASS", "2026-09-04T00:00:00.000Z"),
    ];
    expect(agentStreak(events, agent)).toBe(3);
  });

  it("resets on a BLOCK in ANY of the agent's configs, not only the one that passed last", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-02T00:00:00.000Z"),
      ev("outbound-default", "BLOCK", "2026-09-03T00:00:00.000Z"),
      ev("research-default", "PASS", "2026-09-04T00:00:00.000Z"),
    ];
    expect(agentStreak(events, agent)).toBe(1);
  });

  it("is zero when the newest run blocked", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-02T00:00:00.000Z"),
      ev("research-default", "BLOCK", "2026-09-04T00:00:00.000Z"),
    ];
    expect(agentStreak(events, agent)).toBe(0);
  });

  it("is zero for an agent with no evidence at all", () => {
    expect(agentStreak([], agent)).toBe(0);
  });
});

describe("lastEvent", () => {
  it("is the newest event by time, across configs", () => {
    const events = [
      ev("research-default", "PASS", "2026-09-05T00:00:00.000Z"),
      ev("outbound-default", "BLOCK", "2026-09-06T00:00:00.000Z"),
    ];
    expect(lastEvent(events, agent)?.verdict.status).toBe("BLOCK");
  });

  it("is undefined when the agent has no evidence", () => {
    expect(lastEvent([], agent)).toBeUndefined();
  });
});
