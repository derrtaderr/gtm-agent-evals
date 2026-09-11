import { describe, it, expect } from "vitest";
import {
  CHECKS,
  DEFAULT_FALSIFIER_REGISTRY,
  loadFalsifierRegistry,
  runFalsifier,
  type FalsifierContext,
} from "./falsifiers.js";
import { registerAgent } from "./agents.js";
import type { AgentRecord, AutonomyGrant, FalsifierSpec, TelemetryEvent, VerdictStatus } from "../types.js";

const agent: AgentRecord = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:aaaa1111",
    modelId: "example-model-v1",
    configIds: ["research-default"],
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

const grant: AutonomyGrant = {
  id: "example-enricher-auto-0000",
  agentId: "example-enricher",
  tier: "auto",
  grantedAt: "2026-09-05T00:00:00.000Z",
  grantedBy: "operator",
  evidence: {
    configHash: "sha256:aaaa1111",
    modelId: "example-model-v1",
    streak: 5,
    gateN: 5,
    runIds: ["r1", "r2", "r3", "r4", "r5"],
  },
  falsifiers: ["config_hash_unchanged"],
};

function ev(status: VerdictStatus, timestamp: string, configId = "research-default"): TelemetryEvent {
  return {
    runId: `run-${timestamp}`,
    timestamp,
    configId,
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
  };
}

function ctx(over: Partial<FalsifierContext> = {}): FalsifierContext {
  return { grant, agent, events: [], asOf: "2026-09-11T00:00:00.000Z", ...over };
}

function spec(id: string): FalsifierSpec {
  const found = DEFAULT_FALSIFIER_REGISTRY.falsifiers.find((f) => f.id === id);
  if (!found) throw new Error(`test fixture: no shipped falsifier "${id}"`);
  return found;
}

describe("the falsifier registry is data", () => {
  it("ships the four v1 falsifiers", () => {
    expect(DEFAULT_FALSIFIER_REGISTRY.falsifiers.map((f) => f.id)).toEqual([
      "config_hash_unchanged",
      "model_unchanged",
      "no_block_since_grant",
      "evidence_not_stale",
    ]);
  });

  it("gives every shipped falsifier a statement a reader can disagree with", () => {
    for (const f of DEFAULT_FALSIFIER_REGISTRY.falsifiers) {
      expect(f.statement.length).toBeGreaterThan(20);
      expect(CHECKS[f.check]).toBeTypeOf("function");
    }
  });

  it("loads a registry whose checks all exist", () => {
    const loaded = loadFalsifierRegistry(DEFAULT_FALSIFIER_REGISTRY);
    expect(loaded.falsifiers).toHaveLength(4);
  });

  it("REFUSES a registry naming a check that does not exist, rather than skipping it", () => {
    const raw = {
      falsifiers: [
        { id: "x", check: "no_such_check", statement: "something that must stay true here" },
      ],
    };
    expect(() => loadFalsifierRegistry(raw)).toThrow(/no_such_check/);
  });

  it("refuses a registry that is not an object with a falsifiers array", () => {
    expect(() => loadFalsifierRegistry({})).toThrow(/falsifiers/);
    expect(() => loadFalsifierRegistry([])).toThrow(/falsifiers/);
  });

  it("refuses a falsifier missing an id or a statement", () => {
    expect(() =>
      loadFalsifierRegistry({ falsifiers: [{ check: "config_hash", statement: "x" }] }),
    ).toThrow(/id/);
    expect(() =>
      loadFalsifierRegistry({ falsifiers: [{ id: "a", check: "config_hash" }] }),
    ).toThrow(/statement/);
  });

  it("refuses two falsifiers sharing an id — one would silently shadow the other", () => {
    const f = { id: "dup", check: "config_hash", statement: "the configuration is unchanged" };
    expect(() => loadFalsifierRegistry({ falsifiers: [f, f] })).toThrow(/dup/);
  });
});

describe("runFalsifier", () => {
  it("carries the spec's id and statement onto every result", () => {
    const r = runFalsifier(spec("config_hash_unchanged"), ctx());
    expect(r.falsifier).toBe("config_hash_unchanged");
    expect(r.statement).toBe(spec("config_hash_unchanged").statement);
  });

  it("turns a check that throws into UNEVALUABLE carrying the message, never a pass", () => {
    const boom: FalsifierSpec = {
      id: "boom",
      check: "config_hash",
      statement: "this check is about to explode on purpose",
    };
    // A grant with no evidence object at all makes the check throw.
    const broken = { ...grant, evidence: undefined as unknown as AutonomyGrant["evidence"] };
    const r = runFalsifier(boom, ctx({ grant: broken }));
    expect(r.status).toBe("UNEVALUABLE");
    expect(r.evidence).toMatch(/check raised/);
  });

  it("refuses to run a spec whose check id is not registered", () => {
    const bad: FalsifierSpec = { id: "b", check: "nope", statement: "s" };
    expect(() => runFalsifier(bad, ctx())).toThrow(/nope/);
  });
});

describe("config_hash_unchanged", () => {
  it("HOLDS when the registry hash still equals the hash the grant was earned on", () => {
    expect(runFalsifier(spec("config_hash_unchanged"), ctx()).status).toBe("HOLDS");
  });

  it("is BROKEN when the agent's config hash has rotated, naming both hashes", () => {
    const rotated = { ...agent, configHash: "sha256:bbbb2222" };
    const r = runFalsifier(spec("config_hash_unchanged"), ctx({ agent: rotated }));
    expect(r.status).toBe("BROKEN");
    expect(r.evidence).toContain("sha256:aaaa1111");
    expect(r.evidence).toContain("sha256:bbbb2222");
  });

  it("is UNEVALUABLE, never HOLDS, when the agent is not in the registry", () => {
    const r = runFalsifier(spec("config_hash_unchanged"), ctx({ agent: undefined }));
    expect(r.status).toBe("UNEVALUABLE");
    expect(r.evidence).toMatch(/not in the agent registry/);
  });
});

describe("model_unchanged", () => {
  it("HOLDS while the model id matches the grant's evidence", () => {
    expect(runFalsifier(spec("model_unchanged"), ctx()).status).toBe("HOLDS");
  });

  it("is BROKEN when the agent was moved onto a different model", () => {
    const moved = { ...agent, modelId: "example-model-v2" };
    const r = runFalsifier(spec("model_unchanged"), ctx({ agent: moved }));
    expect(r.status).toBe("BROKEN");
    expect(r.evidence).toContain("example-model-v2");
  });

  it("is UNEVALUABLE when the agent is not in the registry", () => {
    expect(runFalsifier(spec("model_unchanged"), ctx({ agent: undefined })).status).toBe(
      "UNEVALUABLE",
    );
  });
});

describe("no_block_since_grant", () => {
  it("HOLDS when every run since the grant passed", () => {
    const events = [ev("PASS", "2026-09-06T00:00:00.000Z"), ev("PASS", "2026-09-08T00:00:00.000Z")];
    expect(runFalsifier(spec("no_block_since_grant"), ctx({ events })).status).toBe("HOLDS");
  });

  it("is BROKEN by a BLOCK after the grant, naming the run", () => {
    const events = [ev("PASS", "2026-09-06T00:00:00.000Z"), ev("BLOCK", "2026-09-08T00:00:00.000Z")];
    const r = runFalsifier(spec("no_block_since_grant"), ctx({ events }));
    expect(r.status).toBe("BROKEN");
    expect(r.evidence).toContain("run-2026-09-08T00:00:00.000Z");
  });

  it("ignores a BLOCK from BEFORE the grant — that one is already priced in", () => {
    const events = [ev("BLOCK", "2026-09-01T00:00:00.000Z"), ev("PASS", "2026-09-06T00:00:00.000Z")];
    expect(runFalsifier(spec("no_block_since_grant"), ctx({ events })).status).toBe("HOLDS");
  });

  it("ignores a BLOCK in a config this agent does not own", () => {
    const events = [ev("BLOCK", "2026-09-08T00:00:00.000Z", "somebody-elses-config")];
    expect(runFalsifier(spec("no_block_since_grant"), ctx({ events })).status).toBe("HOLDS");
  });

  it("is UNEVALUABLE when no telemetry source was supplied at all", () => {
    const r = runFalsifier(spec("no_block_since_grant"), ctx({ events: undefined }));
    expect(r.status).toBe("UNEVALUABLE");
    expect(r.evidence).toMatch(/no telemetry source/);
  });

  it("is UNEVALUABLE when the agent has no eval configs, so nothing can be attributed to it", () => {
    const orphan = { ...agent, configIds: [] };
    const r = runFalsifier(spec("no_block_since_grant"), ctx({ agent: orphan }));
    expect(r.status).toBe("UNEVALUABLE");
    expect(r.evidence).toMatch(/no eval configs/);
  });
});

describe("evidence_not_stale", () => {
  it("HOLDS while a clean run sits inside the freshness window", () => {
    const events = [ev("PASS", "2026-09-10T00:00:00.000Z")];
    expect(runFalsifier(spec("evidence_not_stale"), ctx({ events })).status).toBe("HOLDS");
  });

  it("DEGRADES when the newest clean run has aged past the window", () => {
    const events = [ev("PASS", "2026-09-05T12:00:00.000Z")];
    const r = runFalsifier(spec("evidence_not_stale"), ctx({ events, asOf: "2026-10-11T00:00:00.000Z" }));
    expect(r.status).toBe("DEGRADED");
    expect(r.evidence).toMatch(/days/);
  });

  it("DEGRADES when no clean run at all has been recorded since the grant aged out", () => {
    const r = runFalsifier(spec("evidence_not_stale"), ctx({ events: [], asOf: "2026-10-11T00:00:00.000Z" }));
    expect(r.status).toBe("DEGRADED");
    expect(r.evidence).toMatch(/no clean run/);
  });

  it("HOLDS on a fresh grant that has not run yet — the window has not elapsed", () => {
    expect(runFalsifier(spec("evidence_not_stale"), ctx({ events: [] })).status).toBe("HOLDS");
  });

  it("never returns BROKEN — staleness is a reason to re-check, not proof of a failure", () => {
    const r = runFalsifier(spec("evidence_not_stale"), ctx({ events: [], asOf: "2027-01-01T00:00:00.000Z" }));
    expect(r.status).toBe("DEGRADED");
  });

  it("is UNEVALUABLE when no telemetry source was supplied", () => {
    expect(runFalsifier(spec("evidence_not_stale"), ctx({ events: undefined })).status).toBe(
      "UNEVALUABLE",
    );
  });

  it("reads its window from the spec's params, not from a constant in the code", () => {
    const tighter: FalsifierSpec = { ...spec("evidence_not_stale"), params: { suspectAfterDays: 1 } };
    const events = [ev("PASS", "2026-09-09T00:00:00.000Z")];
    expect(runFalsifier(tighter, ctx({ events })).status).toBe("DEGRADED");
  });
});
