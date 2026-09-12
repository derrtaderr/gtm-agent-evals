// Run eras: which version of an agent produced a given run, and which runs may
// therefore be counted toward a grant.
//
// This is the session-2 fix for the hole session 1 named. The rule under test:
// attribution is proof, timestamp-against-configSince is inference, and a run
// that provably predates the current configuration can never count toward
// eligibility for it.

import { describe, it, expect } from "vitest";
import { runEra, countsTowardEligibility, currentEraStreak, eligibilityEvidence } from "./era.js";
import { registerAgent } from "./agents.js";
import type { AgentRecord, TelemetryEvent, VerdictStatus } from "../types.js";

const agent = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:current",
    modelId: "example-model-v1",
    configIds: ["research-default"],
    gateN: 3,
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

/** The same agent after a config rotation on 09-04. */
const rotated: AgentRecord = {
  ...agent,
  configHash: "sha256:current",
  registeredAt: "2026-09-01T00:00:00.000Z",
  configSince: "2026-09-04T00:00:00.000Z",
};

function ev(
  day: number,
  status: VerdictStatus = "PASS",
  configHash?: string,
): TelemetryEvent {
  return {
    runId: `run-${day}`,
    timestamp: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    configId: "research-default",
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
    ...(configHash ? { agentConfigHash: configHash } : {}),
  };
}

describe("runEra — attribution is proof", () => {
  it("is current when the run carries the agent's current config hash", () => {
    expect(runEra(ev(2, "PASS", "sha256:current"), rotated)).toBe("current");
  });

  it("is prior when the run carries a DIFFERENT hash, however recent it is", () => {
    // Timestamp is well after configSince; the hash still overrules it. An
    // attributed run is never second-guessed by the clock.
    expect(runEra(ev(9, "PASS", "sha256:old"), rotated)).toBe("prior");
  });
});

describe("runEra — an unattributed run is placed by the clock, not guessed", () => {
  it("is unknown-pre-config when it predates the current config's registration", () => {
    expect(runEra(ev(2), rotated)).toBe("unknown-pre-config");
  });

  it("is unknown-in-window when it lands at or after configSince", () => {
    expect(runEra(ev(4), rotated)).toBe("unknown-in-window");
    expect(runEra(ev(5), rotated)).toBe("unknown-in-window");
  });

  it("is unknown-in-window for an agent that never rotated, whatever the date", () => {
    // configSince === registeredAt, so there is exactly one era in this agent's
    // life and every unattributed run falls inside it.
    expect(runEra(ev(2), agent)).toBe("unknown-in-window");
  });
});

describe("countsTowardEligibility", () => {
  it("counts verified current-era runs and unverified in-window ones", () => {
    expect(countsTowardEligibility("current")).toBe(true);
    expect(countsTowardEligibility("unknown-in-window")).toBe(true);
  });

  it("refuses prior-era and pre-config runs — the fail-closed half of the fix", () => {
    expect(countsTowardEligibility("prior")).toBe(false);
    expect(countsTowardEligibility("unknown-pre-config")).toBe(false);
  });
});

describe("currentEraStreak", () => {
  it("counts the clean run at the tail of the agent's evidence", () => {
    expect(currentEraStreak([ev(2), ev(3), ev(4)], agent)).toBe(3);
  });

  it("is ZERO right after a rotation, which is the whole fix", () => {
    // Three clean runs, all recorded before the current config existed. This is
    // the exact state the session-1 blocker granted on.
    expect(currentEraStreak([ev(1), ev(2), ev(3)], rotated)).toBe(0);
  });

  it("counts only the runs recorded since the rotation", () => {
    expect(currentEraStreak([ev(2), ev(3), ev(5), ev(6)], rotated)).toBe(2);
  });

  it("ends the walk at a BLOCK from ANY era — a recorded failure is never ignored", () => {
    expect(currentEraStreak([ev(5), ev(6, "BLOCK"), ev(7)], rotated)).toBe(1);
  });

  it("ends the walk at a prior-era run rather than reaching past it", () => {
    // Walking past a prior-era run would let evidence from a retired version of
    // the agent prop up the tail of a current-era streak.
    expect(currentEraStreak([ev(5, "PASS", "sha256:current"), ev(6, "PASS", "sha256:old"), ev(7, "PASS", "sha256:current")], rotated)).toBe(1);
  });

  it("is zero for an agent with no evidence at all", () => {
    expect(currentEraStreak([], agent)).toBe(0);
  });

  it("ignores runs belonging to another agent's config", () => {
    const foreign: TelemetryEvent = { ...ev(9), configId: "somebody-elses" };
    expect(currentEraStreak([ev(7), ev(8), foreign], agent)).toBe(2);
  });
});

describe("eligibilityEvidence — the surfaces need to name what they counted", () => {
  it("separates verified runs from counted-but-unverified ones", () => {
    const e = eligibilityEvidence([ev(5, "PASS", "sha256:current"), ev(6)], rotated);
    expect(e.streak).toBe(2);
    expect(e.verified).toBe(1);
    expect(e.unverified).toBe(1);
    expect(e.runIds).toEqual(["run-5", "run-6"]);
  });

  it("names the excluded runs so a refusal can explain itself", () => {
    const e = eligibilityEvidence([ev(1), ev(2), ev(3)], rotated);
    expect(e.streak).toBe(0);
    expect(e.excluded.map((x) => x.runId)).toEqual(["run-1", "run-2", "run-3"]);
  });

  it("reports what ended the streak, so the operator knows where to look", () => {
    const e = eligibilityEvidence([ev(5), ev(6, "BLOCK"), ev(7)], rotated);
    expect(e.streak).toBe(1);
    expect(e.endedBy?.runId).toBe("run-6");
    expect(e.endedBy?.reason).toBe("BLOCK");
  });

  it("reports a prior-era boundary as the reason the walk stopped", () => {
    const e = eligibilityEvidence([ev(2), ev(5)], rotated);
    expect(e.streak).toBe(1);
    expect(e.endedBy?.runId).toBe("run-2");
    expect(e.endedBy?.reason).toBe("unknown-pre-config");
  });
});
