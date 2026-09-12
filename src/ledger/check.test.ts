import { describe, it, expect } from "vitest";
import { checkGrant, checkGrants, worstStatus } from "./check.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { AutonomyGrant, FalsifierResult, TelemetryEvent, VerdictStatus } from "../types.js";

const agent = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:aaaa1111",
    modelId: "example-model-v1",
    configIds: ["research-default"],
    gateN: 3,
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

const grant: AutonomyGrant = {
  id: "example-enricher-auto-abc",
  agentId: "example-enricher",
  tier: "auto",
  grantedAt: "2026-09-05T00:00:00.000Z",
  grantedBy: "operator",
  evidence: {
    configHash: "sha256:aaaa1111",
    modelId: "example-model-v1",
    streak: 3,
    gateN: 3,
    runIds: ["run-2", "run-3", "run-4"],
  },
  falsifiers: DEFAULT_FALSIFIER_REGISTRY.falsifiers.map((f) => f.id),
};

function ev(status: VerdictStatus, timestamp: string): TelemetryEvent {
  return {
    runId: `run-${timestamp}`,
    timestamp,
    configId: "research-default",
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
  };
}

const fresh = [ev("PASS", "2026-09-10T00:00:00.000Z")];
const asOf = "2026-09-11T00:00:00.000Z";

function deps(over: Record<string, unknown> = {}) {
  return {
    agents: [agent],
    events: fresh,
    registry: DEFAULT_FALSIFIER_REGISTRY,
    asOf,
    ...over,
  };
}

function f(status: FalsifierResult["status"]): FalsifierResult {
  return { falsifier: "x", statement: "s", status, evidence: "e" };
}

describe("worstStatus — worst falsifier wins", () => {
  it("is VALID only when every falsifier holds", () => {
    expect(worstStatus([f("HOLDS"), f("HOLDS")])).toBe("VALID");
  });

  it("is SUSPECT when one falsifier is degraded", () => {
    expect(worstStatus([f("HOLDS"), f("DEGRADED")])).toBe("SUSPECT");
  });

  it("is SUSPECT when one falsifier could not be evaluated — never VALID", () => {
    expect(worstStatus([f("HOLDS"), f("UNEVALUABLE")])).toBe("SUSPECT");
  });

  it("is REVOKED when any falsifier is broken", () => {
    expect(worstStatus([f("HOLDS"), f("BROKEN")])).toBe("REVOKED");
  });

  it("lets BROKEN outrank both DEGRADED and UNEVALUABLE", () => {
    expect(worstStatus([f("DEGRADED"), f("BROKEN"), f("UNEVALUABLE")])).toBe("REVOKED");
  });

  it("is SUSPECT, not VALID, when a grant carries no falsifiers at all", () => {
    expect(worstStatus([])).toBe("SUSPECT");
  });
});

describe("checkGrant", () => {
  it("is VALID while the agent is unchanged and its runs are clean and recent", () => {
    const c = checkGrant(grant, deps());
    expect(c.status).toBe("VALID");
    expect(c.falsifiers.every((r) => r.status === "HOLDS")).toBe(true);
  });

  it("carries the grant id, agent id, tier and the as-of instant onto the verdict", () => {
    const c = checkGrant(grant, deps());
    expect(c.grantId).toBe("example-enricher-auto-abc");
    expect(c.agentId).toBe("example-enricher");
    expect(c.tier).toBe("auto");
    expect(c.checkedAt).toBe(asOf);
  });

  it("reports every falsifier the grant carries, in the grant's order", () => {
    expect(checkGrant(grant, deps()).falsifiers.map((r) => r.falsifier)).toEqual(grant.falsifiers);
  });

  it("REVOKES when the config hash rotates, naming the falsifier and both hashes", () => {
    const rotated = { ...agent, configHash: "sha256:bbbb2222" };
    const c = checkGrant(grant, deps({ agents: [rotated] }));
    expect(c.status).toBe("REVOKED");
    const broken = c.falsifiers.filter((r) => r.status === "BROKEN");
    expect(broken.map((r) => r.falsifier)).toEqual(["config_hash_unchanged"]);
    expect(broken[0].evidence).toContain("sha256:bbbb2222");
  });

  it("REVOKES on a BLOCK recorded since the grant, naming the run", () => {
    const c = checkGrant(grant, deps({ events: [...fresh, ev("BLOCK", "2026-09-11T00:00:00.000Z")] }));
    expect(c.status).toBe("REVOKED");
    expect(c.falsifiers.find((r) => r.falsifier === "no_block_since_grant")?.status).toBe("BROKEN");
  });

  it("goes SUSPECT, not VALID, when the agent is not in the registry at all", () => {
    const c = checkGrant(grant, deps({ agents: [] }));
    expect(c.status).toBe("SUSPECT");
    expect(c.falsifiers.every((r) => r.status === "UNEVALUABLE")).toBe(true);
  });

  it("goes SUSPECT when no telemetry source was supplied, however healthy the identity is", () => {
    const c = checkGrant(grant, deps({ events: undefined }));
    expect(c.status).toBe("SUSPECT");
    expect(c.falsifiers.find((r) => r.falsifier === "config_hash_unchanged")?.status).toBe("HOLDS");
    expect(c.falsifiers.find((r) => r.falsifier === "no_block_since_grant")?.status).toBe(
      "UNEVALUABLE",
    );
  });

  it("goes SUSPECT when the evidence has gone stale", () => {
    const c = checkGrant(grant, deps({ asOf: "2026-10-11T00:00:00.000Z" }));
    expect(c.status).toBe("SUSPECT");
    expect(c.falsifiers.find((r) => r.falsifier === "evidence_not_stale")?.status).toBe("DEGRADED");
  });

  it("marks a falsifier the registry no longer defines UNEVALUABLE rather than dropping it", () => {
    const stale = { ...grant, falsifiers: [...grant.falsifiers, "review_not_stale"] };
    const c = checkGrant(stale, deps());
    const orphan = c.falsifiers.find((r) => r.falsifier === "review_not_stale");
    expect(orphan?.status).toBe("UNEVALUABLE");
    expect(orphan?.evidence).toMatch(/not in the falsifier registry/);
    expect(c.status).toBe("SUSPECT");
  });
});

describe("archived grants", () => {
  const archived: AutonomyGrant = {
    ...grant,
    archivedAt: "2026-09-11T00:00:00.000Z",
    archivedBy: "operator",
  };

  it("marks the check as archived", () => {
    expect(checkGrant(archived, deps()).archived).toBe(true);
    expect(checkGrant(grant, deps()).archived).toBe(false);
  });

  it("still evaluates and reports the falsifiers — archiving silences the alarm, not the facts", () => {
    const rotated = { ...agent, configHash: "sha256:bbbb2222" };
    const c = checkGrant(archived, deps({ agents: [rotated] }));
    expect(c.status).toBe("REVOKED");
    expect(c.falsifiers.find((r) => r.falsifier === "config_hash_unchanged")?.status).toBe("BROKEN");
  });
});

describe("checkGrants", () => {
  it("checks every grant in the store", () => {
    const other: AutonomyGrant = { ...grant, id: "other", tier: "advisory" };
    expect(checkGrants([grant, other], deps()).map((c) => c.grantId)).toEqual([
      "example-enricher-auto-abc",
      "other",
    ]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(checkGrants([], deps())).toEqual([]);
  });
});
