import { describe, it, expect } from "vitest";
import { buildLedger, ledgerEntry } from "./status.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { AutonomyGrant, AutonomyTier, TelemetryEvent, VerdictStatus } from "../types.js";

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

function grant(tier: AutonomyTier, configHash: string, id = `g-${tier}`): AutonomyGrant {
  return {
    id,
    agentId: "example-enricher",
    tier,
    grantedAt: "2026-09-05T00:00:00.000Z",
    grantedBy: "operator",
    evidence: { configHash, modelId: "example-model-v1", streak: 3, gateN: 3, runIds: [] },
    falsifiers: DEFAULT_FALSIFIER_REGISTRY.falsifiers.map((f) => f.id),
  };
}

function ev(status: VerdictStatus, timestamp: string): TelemetryEvent {
  return {
    runId: `run-${timestamp}`,
    timestamp,
    configId: "research-default",
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
  };
}

const clean = [
  ev("PASS", "2026-09-08T00:00:00.000Z"),
  ev("PASS", "2026-09-09T00:00:00.000Z"),
  ev("PASS", "2026-09-10T00:00:00.000Z"),
];
const asOf = "2026-09-11T00:00:00.000Z";

function deps(over: Record<string, unknown> = {}) {
  return { events: clean, registry: DEFAULT_FALSIFIER_REGISTRY, asOf, ...over };
}

describe("effective tier", () => {
  it("is the tier of the grant that still holds", () => {
    const e = ledgerEntry(agent, [grant("auto", "sha256:current")], deps());
    expect(e.effectiveTier).toBe("auto");
  });

  it("falls back to the next-lower grant that still holds when the top one is revoked", () => {
    const grants = [grant("auto", "sha256:stale"), grant("advisory", "sha256:current")];
    const e = ledgerEntry(agent, grants, deps());
    expect(e.checks.find((c) => c.tier === "auto")?.status).toBe("REVOKED");
    expect(e.effectiveTier).toBe("advisory");
  });

  it("falls to the supervised floor when no grant holds", () => {
    const grants = [grant("auto", "sha256:stale"), grant("advisory", "sha256:also-stale")];
    expect(ledgerEntry(agent, grants, deps()).effectiveTier).toBe("supervised");
  });

  it("does NOT count a SUSPECT grant as holding — suspect autonomy is not autonomy", () => {
    const e = ledgerEntry(agent, [grant("auto", "sha256:current")], deps({ events: undefined }));
    expect(e.checks[0].status).toBe("SUSPECT");
    expect(e.effectiveTier).toBe("supervised");
  });

  it("is supervised for an agent with no grants at all", () => {
    expect(ledgerEntry(agent, [], deps()).effectiveTier).toBe("supervised");
  });
});

describe("the rest of the agent's row", () => {
  it("lists every tier the agent holds a grant for, whatever its status", () => {
    const grants = [grant("auto", "sha256:stale"), grant("advisory", "sha256:current")];
    expect(ledgerEntry(agent, grants, deps()).grantedTiers).toEqual(["advisory", "auto"]);
  });

  it("reports the streak toward the next tier and the bar it must clear", () => {
    const e = ledgerEntry(agent, [], deps());
    expect(e.streak).toBe(3);
    expect(e.gateN).toBe(3);
    expect(e.eligible).toBe(true);
  });

  it("is not eligible while the streak is short of the bar", () => {
    const e = ledgerEntry(agent, [], deps({ events: [ev("PASS", "2026-09-10T00:00:00.000Z")] }));
    expect(e.streak).toBe(1);
    expect(e.eligible).toBe(false);
  });

  it("is not eligible when there is no telemetry source to read a streak from", () => {
    const e = ledgerEntry(agent, [], deps({ events: undefined }));
    expect(e.streak).toBe(0);
    expect(e.eligible).toBe(false);
  });

  it("reports the last verdict and when it landed", () => {
    const e = ledgerEntry(agent, [], deps({ events: [...clean, ev("BLOCK", "2026-09-10T12:00:00.000Z")] }));
    expect(e.lastVerdict).toBe("BLOCK");
    expect(e.lastRunAt).toBe("2026-09-10T12:00:00.000Z");
  });

  it("leaves the last verdict undefined when the agent has never run", () => {
    const e = ledgerEntry(agent, [], deps({ events: [] }));
    expect(e.lastVerdict).toBeUndefined();
    expect(e.lastRunAt).toBeUndefined();
  });

  it("carries the agent's name so the surface never has to re-join", () => {
    expect(ledgerEntry(agent, [], deps()).name).toBe("Example Enricher");
  });
});

describe("buildLedger", () => {
  it("builds one row per registered agent, in registry order", () => {
    const drafter = { ...agent, id: "example-drafter", name: "Example Drafter" };
    const ledger = buildLedger([agent, drafter], [], deps());
    expect(ledger.agents.map((a) => a.agentId)).toEqual(["example-enricher", "example-drafter"]);
  });

  it("stamps the as-of instant it was generated for", () => {
    expect(buildLedger([agent], [], deps()).generatedAt).toBe(asOf);
  });

  it("routes each grant to its own agent", () => {
    const drafter = { ...agent, id: "example-drafter", name: "Example Drafter" };
    const ledger = buildLedger([agent, drafter], [grant("auto", "sha256:current")], deps());
    expect(ledger.agents[0].checks).toHaveLength(1);
    expect(ledger.agents[1].checks).toHaveLength(0);
  });

  it("surfaces a grant naming an unknown agent instead of silently dropping it", () => {
    const ghost = { ...grant("auto", "sha256:current"), agentId: "example-ghost" };
    const ledger = buildLedger([agent], [ghost], deps());
    expect(ledger.orphanGrants.map((c) => c.agentId)).toEqual(["example-ghost"]);
    expect(ledger.orphanGrants[0].status).toBe("SUSPECT");
  });

  it("has no orphans when every grant names a registered agent", () => {
    expect(buildLedger([agent], [grant("auto", "sha256:current")], deps()).orphanGrants).toEqual([]);
  });
});
