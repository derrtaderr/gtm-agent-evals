import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerAgent,
  saveAgent,
  loadAgents,
  loadAgent,
  DEFAULT_GATE_N,
} from "./agents.js";

let dir: string;
let store: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-agents-"));
  store = join(dir, "agents.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const enricher = {
  id: "example-enricher",
  name: "Example Enricher",
  configHash: "sha256:aaaa1111",
  modelId: "example-model-v1",
  configIds: ["research-default"],
};

describe("registerAgent", () => {
  it("stamps the registration time from the injected clock", () => {
    const a = registerAgent(enricher, { registeredAt: "2026-09-11T00:00:00.000Z" });
    expect(a.registeredAt).toBe("2026-09-11T00:00:00.000Z");
  });

  it("defaults gateN to the shipped clean-run bar when none is given", () => {
    expect(registerAgent(enricher).gateN).toBe(DEFAULT_GATE_N);
    expect(registerAgent({ ...enricher, gateN: 3 }).gateN).toBe(3);
  });

  it("leaves configIds empty rather than inventing a link to an eval config", () => {
    const { configIds, ...withoutConfigs } = enricher;
    expect(registerAgent(withoutConfigs).configIds).toEqual([]);
  });

  it("refuses an agent with no id", () => {
    expect(() => registerAgent({ ...enricher, id: "" })).toThrow(/id/);
  });

  it("refuses an agent with no config hash — the first falsifier would be unevaluable", () => {
    expect(() => registerAgent({ ...enricher, configHash: "" })).toThrow(/configHash/);
  });

  it("refuses an agent with no model id", () => {
    expect(() => registerAgent({ ...enricher, modelId: "" })).toThrow(/modelId/);
  });
});

// `registeredAt` answers "when did we first see this agent". `configSince`
// answers "since when has it been THIS agent". The second is what prior-era
// evidence is measured against, and the two only diverge once a config rotates,
// which is what keeps the prior-era warning off an ordinary first grant.
describe("config lineage", () => {
  const first = registerAgent(enricher, { registeredAt: "2026-09-01T00:00:00.000Z" });

  it("sets configSince to the registration time on a first registration", () => {
    expect(first.configSince).toBe("2026-09-01T00:00:00.000Z");
    expect(first.registeredAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("carries both forward when re-registering the SAME config hash", () => {
    const again = registerAgent(enricher, {
      registeredAt: "2026-09-05T00:00:00.000Z",
      previous: first,
    });
    expect(again.registeredAt).toBe("2026-09-01T00:00:00.000Z");
    expect(again.configSince).toBe("2026-09-01T00:00:00.000Z");
  });

  it("moves configSince, and only configSince, when the hash rotates", () => {
    const rotated = registerAgent(
      { ...enricher, configHash: "sha256:bbbb2222" },
      { registeredAt: "2026-09-05T00:00:00.000Z", previous: first },
    );
    expect(rotated.configSince).toBe("2026-09-05T00:00:00.000Z");
    expect(rotated.registeredAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps first-seen stable across several rotations", () => {
    const r1 = registerAgent(
      { ...enricher, configHash: "sha256:bbbb" },
      { registeredAt: "2026-09-05T00:00:00.000Z", previous: first },
    );
    const r2 = registerAgent(
      { ...enricher, configHash: "sha256:cccc" },
      { registeredAt: "2026-09-09T00:00:00.000Z", previous: r1 },
    );
    expect(r2.registeredAt).toBe("2026-09-01T00:00:00.000Z");
    expect(r2.configSince).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("agent registry store (JSONL)", () => {
  it("returns an empty registry when the store file does not exist", () => {
    expect(loadAgents(store)).toEqual([]);
  });

  it("persists an agent and reads it back intact", () => {
    const a = registerAgent(enricher, { registeredAt: "2026-09-11T00:00:00.000Z" });
    saveAgent(a, store);
    expect(loadAgents(store)).toEqual([a]);
  });

  it("writes one JSON object per line", () => {
    saveAgent(registerAgent(enricher), store);
    saveAgent(registerAgent({ ...enricher, id: "example-drafter" }), store);
    const lines = readFileSync(store, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("upserts by id, so re-registering a rotated config hash replaces rather than duplicates", () => {
    saveAgent(registerAgent(enricher), store);
    saveAgent(registerAgent({ ...enricher, configHash: "sha256:bbbb2222" }), store);
    const loaded = loadAgents(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].configHash).toBe("sha256:bbbb2222");
  });

  it("loadAgent fetches one by id, undefined when the agent is unknown", () => {
    saveAgent(registerAgent(enricher), store);
    expect(loadAgent(store, "example-enricher")?.name).toBe("Example Enricher");
    expect(loadAgent(store, "nobody")).toBeUndefined();
  });

  it("leaves no temp file behind", () => {
    saveAgent(registerAgent(enricher), store);
    saveAgent(registerAgent({ ...enricher, id: "example-drafter" }), store);
    expect(readdirSync(dir).filter((f) => f !== "agents.jsonl")).toEqual([]);
  });

  it("throws naming the line number on a corrupt ledger line, never skipping it", () => {
    writeFileSync(store, '{"id":"example-enricher"\n', "utf8");
    expect(() => loadAgents(store)).toThrow(/line 1/);
  });

  it("throws on a line that parses but is not an agent record", () => {
    writeFileSync(store, '{"id":"example-enricher","name":"x"}\n', "utf8");
    expect(() => loadAgents(store)).toThrow(/line 1/);
  });
});
