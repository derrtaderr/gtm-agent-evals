import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmationPhrase,
  createGrant,
  grantId,
  saveGrant,
  loadGrants,
  grantsForAgent,
  priorEraRuns,
  archiveGrant,
  archiveConfirmationPhrase,
} from "./grants.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { TelemetryEvent, VerdictStatus } from "../types.js";

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

function ev(status: VerdictStatus, day: number): TelemetryEvent {
  const timestamp = `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  return {
    runId: `run-${day}`,
    timestamp,
    configId: "research-default",
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
  };
}

const cleanStreak = [ev("PASS", 2), ev("PASS", 3), ev("PASS", 4)];
const at = { grantedAt: "2026-09-05T00:00:00.000Z" };

function grantArgs(over: Record<string, unknown> = {}) {
  return {
    agent,
    tier: "auto" as const,
    events: cleanStreak,
    confirm: confirmationPhrase("example-enricher", "auto"),
    grantedBy: "operator",
    registry: DEFAULT_FALSIFIER_REGISTRY,
    ...over,
  };
}

describe("confirmationPhrase", () => {
  it("names the agent and the tier, so a pasted phrase cannot promote the wrong agent", () => {
    expect(confirmationPhrase("example-enricher", "auto")).toBe("grant auto to example-enricher");
  });
});

describe("createGrant refuses until a human means it", () => {
  it("refuses when the confirmation phrase is absent, printing the phrase required", () => {
    expect(() => createGrant(grantArgs({ confirm: "" }), at)).toThrow(
      /grant auto to example-enricher/,
    );
  });

  it("refuses a confirmation phrase for a DIFFERENT tier", () => {
    expect(() =>
      createGrant(grantArgs({ confirm: confirmationPhrase("example-enricher", "advisory") }), at),
    ).toThrow(/confirmation/i);
  });

  it("refuses a confirmation phrase for a different agent", () => {
    expect(() =>
      createGrant(grantArgs({ confirm: confirmationPhrase("example-drafter", "auto") }), at),
    ).toThrow(/confirmation/i);
  });

  it("refuses to grant the supervised floor — it is what an agent has, not something it earns", () => {
    expect(() =>
      createGrant(
        grantArgs({ tier: "supervised", confirm: confirmationPhrase("example-enricher", "supervised") }),
        at,
      ),
    ).toThrow(/supervised/);
  });
});

describe("createGrant requires the streak the gate defines", () => {
  it("refuses when the clean-run streak is short of gateN, naming both numbers", () => {
    expect(() => createGrant(grantArgs({ events: [ev("PASS", 4)] }), at)).toThrow(/1.*3|3.*1/s);
  });

  it("refuses when the newest run blocked, even if earlier runs were clean", () => {
    expect(() =>
      createGrant(grantArgs({ events: [...cleanStreak, ev("BLOCK", 4)] }), at),
    ).toThrow(/streak/i);
  });

  it("refuses an agent with no eval configs — there is no evidence to earn a grant with", () => {
    const orphan = { ...agent, configIds: [] };
    expect(() => createGrant(grantArgs({ agent: orphan }), at)).toThrow(/streak|configs/i);
  });
});

describe("createGrant records what the grant was earned on", () => {
  it("freezes the config hash and model id as the grant's evidence baseline", () => {
    const g = createGrant(grantArgs(), at);
    expect(g.evidence.configHash).toBe("sha256:aaaa1111");
    expect(g.evidence.modelId).toBe("example-model-v1");
  });

  it("records the streak, the bar it cleared, and the runIds behind it", () => {
    const g = createGrant(grantArgs(), at);
    expect(g.evidence.streak).toBe(3);
    expect(g.evidence.gateN).toBe(3);
    expect(g.evidence.runIds).toEqual(["run-2", "run-3", "run-4"]);
  });

  it("records who granted it — a grant with no human on it is not a grant", () => {
    expect(createGrant(grantArgs(), at).grantedBy).toBe("operator");
    expect(() => createGrant(grantArgs({ grantedBy: "" }), at)).toThrow(/granted-by/i);
  });

  it("attaches every falsifier id in the registry", () => {
    expect(createGrant(grantArgs(), at).falsifiers).toEqual([
      "config_hash_unchanged",
      "model_unchanged",
      "no_block_since_grant",
      "evidence_not_stale",
    ]);
  });

  it("stamps the grant time from the injected clock", () => {
    expect(createGrant(grantArgs(), at).grantedAt).toBe("2026-09-05T00:00:00.000Z");
  });
});

// B1: the platform cannot yet tell which config produced a given run —
// TelemetryEvent carries no config hash. The cheap strengthening available with
// data already in the store is `configSince`: a run predating the current
// config's registration was produced before this config existed. It only means
// anything once a rotation has happened, which is why a first registration
// (configSince === registeredAt) never warns.
describe("prior-era evidence (the known config-lineage hole)", () => {
  // A ROTATED agent: first seen 09-01, but its current config only since
  // 09-04T00:00:00Z. The streak runs land at 09-02, 09-03 and 09-04 (all
  // T00:00:00Z), so run-4 sits ON the boundary and the other two behind it —
  // which is what makes this fixture test the split rather than "all of them".
  const rotated = { ...agent, registeredAt: "2026-09-01T00:00:00.000Z", configSince: "2026-09-04T00:00:00.000Z" };

  it("names the streak runs that predate the current config's registration", () => {
    const found = priorEraRuns(rotated, cleanStreak, ["run-2", "run-3", "run-4"]);
    expect(found.map((e) => e.runId)).toEqual(["run-2", "run-3"]);
  });

  it("finds nothing when the agent has never rotated its config", () => {
    expect(priorEraRuns(agent, cleanStreak, ["run-2", "run-3", "run-4"])).toEqual([]);
  });

  it("only considers the runs the grant actually rests on", () => {
    const found = priorEraRuns(rotated, cleanStreak, ["run-3"]);
    expect(found.map((e) => e.runId)).toEqual(["run-3"]);
  });

  it("WARNS at grant time when the streak rests on runs from before the current config", () => {
    const warnings: string[] = [];
    createGrant(grantArgs({ agent: rotated }), { ...at, onWarn: (w) => warnings.push(w) });
    expect(warnings.join("\n")).toMatch(/2 of the 3 runs/);
    expect(warnings.join("\n")).toMatch(/run-2 run-3/);
  });

  it("still grants after warning — this is an informed confirmation, not a second gate", () => {
    const g = createGrant(grantArgs({ agent: rotated }), { ...at, onWarn: () => {} });
    expect(g.tier).toBe("auto");
  });

  it("stays silent on a first grant, when no rotation has happened", () => {
    const warnings: string[] = [];
    createGrant(grantArgs(), { ...at, onWarn: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);
  });
});

// M1: a revoked grant is never deleted, so without an explicit resolution
// mechanic `check` alarms forever after any historical incident. Archiving is
// how an operator says "handled" — on the record, with their name on it.
describe("archiveGrant", () => {
  const g = createGrant(grantArgs(), at);
  const archiveAt = { archivedAt: "2026-09-20T00:00:00.000Z" };

  it("requires a confirmation phrase naming the exact grant", () => {
    expect(archiveConfirmationPhrase(g.id)).toBe(`archive ${g.id}`);
    expect(() => archiveGrant(g, { confirm: "yes", archivedBy: "operator" }, archiveAt)).toThrow(
      new RegExp(`archive ${g.id}`),
    );
  });

  it("records who archived it and when", () => {
    const a = archiveGrant(
      g,
      { confirm: archiveConfirmationPhrase(g.id), archivedBy: "operator" },
      archiveAt,
    );
    expect(a.archivedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(a.archivedBy).toBe("operator");
  });

  it("refuses an anonymous archive — resolving an incident is also a human act", () => {
    expect(() =>
      archiveGrant(g, { confirm: archiveConfirmationPhrase(g.id), archivedBy: "" }, archiveAt),
    ).toThrow(/archived-by/i);
  });

  it("preserves every other field — archiving is annotation, never deletion", () => {
    const a = archiveGrant(
      g,
      { confirm: archiveConfirmationPhrase(g.id), archivedBy: "operator" },
      archiveAt,
    );
    expect(a.id).toBe(g.id);
    expect(a.tier).toBe(g.tier);
    expect(a.evidence).toEqual(g.evidence);
    expect(a.falsifiers).toEqual(g.falsifiers);
  });

  it("refuses to archive a grant that is already archived", () => {
    const a = archiveGrant(
      g,
      { confirm: archiveConfirmationPhrase(g.id), archivedBy: "operator" },
      archiveAt,
    );
    expect(() =>
      archiveGrant(a, { confirm: archiveConfirmationPhrase(g.id), archivedBy: "operator" }, archiveAt),
    ).toThrow(/already archived/i);
  });
});

describe("grantId", () => {
  it("is stable for the same agent, tier and instant", () => {
    expect(grantId("example-enricher", "auto", "2026-09-05T00:00:00.000Z")).toBe(
      grantId("example-enricher", "auto", "2026-09-05T00:00:00.000Z"),
    );
  });

  it("differs when the same agent is re-granted at a different instant", () => {
    expect(grantId("example-enricher", "auto", "2026-09-05T00:00:00.000Z")).not.toBe(
      grantId("example-enricher", "auto", "2026-09-06T00:00:00.000Z"),
    );
  });

  it("reads as agent-tier at a glance", () => {
    expect(grantId("example-enricher", "auto", "2026-09-05T00:00:00.000Z")).toMatch(
      /^example-enricher-auto-/,
    );
  });
});

describe("grant store (JSONL)", () => {
  let dir: string;
  let store: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gae-grants-"));
    store = join(dir, "grants.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is empty when the file does not exist", () => {
    expect(loadGrants(store)).toEqual([]);
  });

  it("persists a grant and reads it back intact", () => {
    const g = createGrant(grantArgs(), at);
    saveGrant(g, store);
    expect(loadGrants(store)).toEqual([g]);
  });

  it("keeps a revoked-tier grant alongside a new one — the history is the point", () => {
    saveGrant(createGrant(grantArgs({ tier: "advisory", confirm: confirmationPhrase("example-enricher", "advisory") }), at), store);
    saveGrant(createGrant(grantArgs(), at), store);
    expect(loadGrants(store)).toHaveLength(2);
  });

  it("upserts by grant id rather than duplicating an identical re-grant", () => {
    saveGrant(createGrant(grantArgs(), at), store);
    saveGrant(createGrant(grantArgs(), at), store);
    expect(loadGrants(store)).toHaveLength(1);
  });

  it("writes one JSON object per line", () => {
    saveGrant(createGrant(grantArgs(), at), store);
    const lines = readFileSync(store, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("grantsForAgent returns only that agent's grants", () => {
    saveGrant(createGrant(grantArgs(), at), store);
    expect(grantsForAgent(loadGrants(store), "example-enricher")).toHaveLength(1);
    expect(grantsForAgent(loadGrants(store), "example-drafter")).toHaveLength(0);
  });

  it("throws naming the line number on a corrupt grant ledger", () => {
    writeFileSync(store, '{"id":"x","agentId":"y"\n', "utf8");
    expect(() => loadGrants(store)).toThrow(/line 1/);
  });

  it("throws on a grant line carrying a tier that is not in the vocabulary", () => {
    writeFileSync(
      store,
      JSON.stringify({
        id: "x",
        agentId: "y",
        tier: "unlimited",
        grantedAt: "2026-09-05T00:00:00.000Z",
        grantedBy: "operator",
        evidence: { configHash: "h", modelId: "m", streak: 3, gateN: 3, runIds: [] },
        falsifiers: [],
      }) + "\n",
      "utf8",
    );
    expect(() => loadGrants(store)).toThrow(/line 1/);
  });
});
