// Config-scoped eligibility at the grant surface — the session-1 blocker, closed.
//
// Session 1's own README described the hole as a reproduction: "Rotate an
// agent's config and its grant is correctly REVOKED. Run `grant` again
// immediately, with zero runs under the new config, and it SUCCEEDS — because
// the streak it reads was earned by the previous version of the agent."
//
// That reproduction is the first test below, and it now refuses.

import { describe, it, expect } from "vitest";
import { createGrant, confirmationPhrase } from "./grants.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import { InsufficientEvidence } from "./errors.js";
import type { AgentRecord, TelemetryEvent, VerdictStatus } from "../types.js";

const agent = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:v1",
    modelId: "example-model-v1",
    configIds: ["research-default"],
    gateN: 3,
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

/** The same agent after rotating to v2 on 09-06. */
const rotated: AgentRecord = {
  ...agent,
  configHash: "sha256:v2",
  configSince: "2026-09-06T00:00:00.000Z",
};

function ev(day: number, status: VerdictStatus = "PASS", configHash?: string): TelemetryEvent {
  return {
    runId: `run-${day}`,
    timestamp: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    configId: "research-default",
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
    ...(configHash ? { agentConfigHash: configHash } : {}),
  };
}

/** Three clean runs under the OLD config, the evidence the blocker rested on. */
const oldEraStreak = [ev(2, "PASS", "sha256:v1"), ev(3, "PASS", "sha256:v1"), ev(4, "PASS", "sha256:v1")];

function args(over: Record<string, unknown> = {}) {
  return {
    agent: rotated,
    tier: "auto" as const,
    events: oldEraStreak,
    confirm: confirmationPhrase("example-enricher", "auto"),
    grantedBy: "operator",
    registry: DEFAULT_FALSIFIER_REGISTRY,
    ...over,
  };
}

const at = { grantedAt: "2026-09-07T00:00:00.000Z" };

describe("the session-1 blocker, reproduced and refused", () => {
  it("REFUSES a re-grant that rests entirely on the previous config's streak", () => {
    expect(() => createGrant(args(), at)).toThrow(InsufficientEvidence);
  });

  it("names current-era evidence as what is missing, not the agent's behavior", () => {
    // The old message said "streak of 3, short of gateN 3" would have PASSED.
    // The new one must send the operator to the rotation, not to the agent.
    expect(() => createGrant(args(), at)).toThrow(/current-era|current configuration/i);
  });

  it("refuses even though the agent's all-era streak clears the bar", () => {
    // 3 clean runs, gateN 3. The observed streak is exactly at the bar; the
    // config-scoped streak is 0. That gap IS the hole.
    let message = "";
    try {
      createGrant(args(), at);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/0/);
    expect(message).toMatch(/run-2 run-3 run-4|3 run/);
  });

  it("refuses unattributed pre-rotation runs the same way as attributed ones", () => {
    // The migration case: an operator upgrading carries a store of events with
    // no config hash at all. Rotating still empties the current-era streak.
    const unattributed = [ev(2), ev(3), ev(4)];
    expect(() => createGrant(args({ events: unattributed }), at)).toThrow(InsufficientEvidence);
  });
});

describe("a rotated agent earns the tier back with real current-era runs", () => {
  const earned = [...oldEraStreak, ev(7, "PASS", "sha256:v2"), ev(8, "PASS", "sha256:v2"), ev(9, "PASS", "sha256:v2")];
  const later = { grantedAt: "2026-09-10T00:00:00.000Z" };

  it("grants once three runs under the CURRENT config exist", () => {
    const g = createGrant(args({ events: earned }), later);
    expect(g.tier).toBe("auto");
    expect(g.evidence.streak).toBe(3);
  });

  it("rests the grant only on the current-era runs, never the inherited ones", () => {
    const g = createGrant(args({ events: earned }), later);
    expect(g.evidence.runIds).toEqual(["run-7", "run-8", "run-9"]);
  });

  it("records that all three were verified by attribution, none taken on trust", () => {
    const g = createGrant(args({ events: earned }), later);
    expect(g.evidence.verifiedRuns).toBe(3);
    expect(g.evidence.unverifiedRuns).toBe(0);
  });

  it("still refuses when only two of the three runs are current-era", () => {
    const short = [...oldEraStreak, ev(7, "PASS", "sha256:v2"), ev(8, "PASS", "sha256:v2")];
    expect(() => createGrant(args({ events: short }), later)).toThrow(InsufficientEvidence);
  });
});

describe("counted-but-unverified runs are never counted silently", () => {
  // An agent that never rotated, with a pre-upgrade store carrying no
  // attribution. These runs DO count — excluding them would zero every existing
  // operator's streak on upgrade — but the operator is told before they confirm.
  const legacy = [ev(2), ev(3), ev(4)];

  it("grants on unattributed in-window runs", () => {
    const g = createGrant(args({ agent, events: legacy }), at);
    expect(g.evidence.streak).toBe(3);
  });

  it("records them as unverified rather than as proven evidence", () => {
    const g = createGrant(args({ agent, events: legacy }), at);
    expect(g.evidence.verifiedRuns).toBe(0);
    expect(g.evidence.unverifiedRuns).toBe(3);
  });

  it("WARNS that the evidence is inferred, naming how to make it provable", () => {
    const warnings: string[] = [];
    createGrant(args({ agent, events: legacy }), { ...at, onWarn: (w) => warnings.push(w) });
    const text = warnings.join("\n");
    expect(text).toMatch(/3 of the 3 runs/);
    expect(text).toMatch(/unverified|not attributed|carry no config hash/i);
    expect(text).toMatch(/--agent/);
  });

  it("stays quiet when every counted run is attributed to the current config", () => {
    const attributed = [ev(7, "PASS", "sha256:v2"), ev(8, "PASS", "sha256:v2"), ev(9, "PASS", "sha256:v2")];
    const warnings: string[] = [];
    createGrant(args({ events: attributed }), {
      grantedAt: "2026-09-10T00:00:00.000Z",
      onWarn: (w) => warnings.push(w),
    });
    expect(warnings.join("\n")).not.toMatch(/unverified/i);
  });
});
