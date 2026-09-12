// L1 and L3 from the suite-completion review.
//
// L1: the unverified-lineage sentence claimed counted runs were "recorded after
// <configSince>". On a never-rotated agent that is false — an agent's runs
// almost always PREDATE the day somebody registered it, and those runs are
// still counted (correctly) because there is only one configuration era on
// record. The classification was right and the sentence was wrong, which in a
// repo whose whole pitch is "disagree with a verdict by reading two lines"
// makes the sentence load-bearing.
//
// L3: an unparseable `configSince` on a ROTATED agent fell through to
// counted-unverified instead of refusing. Every sibling malformation in these
// stores is a loud refusal naming the line; this one was a silent downgrade to
// the permissive answer.

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrant, confirmationPhrase } from "./grants.js";
import { loadAgents } from "./agents.js";
import { runEra } from "./era.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { AgentRecord, TelemetryEvent } from "../types.js";

/** Registered on 09-05, never rotated. Its runs are older than that. */
const freshAgent: AgentRecord = {
  id: "a",
  name: "A",
  configHash: "sha256:v1",
  modelId: "m",
  gateN: 3,
  configIds: ["c"],
  registeredAt: "2026-09-05T00:00:00.000Z",
  configSince: "2026-09-05T00:00:00.000Z",
};

function ev(day: number): TelemetryEvent {
  return {
    runId: `r-0${day}`,
    timestamp: `2026-09-0${day}T00:00:00.000Z`,
    configId: "c",
    archetype: "x",
    verdict: { status: "PASS", violations: [], reasons: [] },
  };
}

describe("L1: the unverified-lineage sentence matches the actual timestamps", () => {
  const runs = [ev(2), ev(3), ev(4)]; // all BEFORE registeredAt

  /** Collect the caveats. Wrapped because a caveat is emitted BEFORE any
   *  refusal — that ordering is itself a shipped guarantee — so the rotated
   *  case warns and then throws for want of current-era evidence. */
  function warn(agent: AgentRecord): string {
    const warnings: string[] = [];
    try {
      createGrant(
        {
          agent,
          tier: "auto",
          events: runs,
          confirm: confirmationPhrase(agent.id, "auto"),
          grantedBy: "dana",
          registry: DEFAULT_FALSIFIER_REGISTRY,
        },
        { grantedAt: "2026-09-06T00:00:00.000Z", onWarn: (w) => warnings.push(w) },
      );
    } catch {
      // the refusal is not what this block is testing
    }
    return warnings.join("\n");
  }

  it("counts the runs — a first registration still earns its grant", () => {
    expect(warn(freshAgent)).toMatch(/3 of the 3 runs/);
  });

  it("does NOT claim runs were recorded after configSince when they predate it", () => {
    expect(warn(freshAgent)).not.toMatch(/recorded after 2026-09-05/);
  });

  it("says instead that the agent has only one configuration era on record", () => {
    expect(warn(freshAgent)).toMatch(/never rotated|one configuration era|single configuration/i);
  });

  it("keeps the accurate wording on a ROTATED agent, where the claim is true", () => {
    const rotated: AgentRecord = { ...freshAgent, configSince: "2026-09-03T00:00:00.000Z" };
    // r-03 and r-04 are at/after configSince; r-02 is excluded as pre-config.
    expect(warn(rotated)).toMatch(/at or after 2026-09-03/);
  });
});

describe("L3: a malformed configSince is refused, never silently permitted", () => {
  it("refuses an unparseable configSince at store load, naming the line", () => {
    const dir = mkdtempSync(join(tmpdir(), "gae-l3-"));
    const path = join(dir, "agents.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ ...freshAgent, configSince: "not-a-date" }) + "\n",
    );
    expect(() => loadAgents(path)).toThrow(/line 1/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an unparseable registeredAt too", () => {
    const dir = mkdtempSync(join(tmpdir(), "gae-l3b-"));
    const path = join(dir, "agents.jsonl");
    writeFileSync(path, JSON.stringify({ ...freshAgent, registeredAt: "whenever" }) + "\n");
    expect(() => loadAgents(path)).toThrow(/line 1/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("still loads a well-formed record", () => {
    const dir = mkdtempSync(join(tmpdir(), "gae-l3c-"));
    const path = join(dir, "agents.jsonl");
    writeFileSync(path, JSON.stringify(freshAgent) + "\n");
    expect(loadAgents(path)).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("THROWS rather than degrading to counted-unverified in the library path", () => {
    // Defence in depth: a record built in memory never passed through the store
    // validator, and the permissive answer is the dangerous one.
    const broken: AgentRecord = { ...freshAgent, configSince: "not-a-date" };
    expect(() => runEra(ev(2), broken)).toThrow(/configSince/);
  });

  it("does not throw when the hash settles the era without consulting the clock", () => {
    // An ATTRIBUTED run never reads configSince, so a broken one cannot matter.
    const broken: AgentRecord = { ...freshAgent, configSince: "not-a-date" };
    const attributed: TelemetryEvent = { ...ev(2), agentConfigHash: "sha256:v1" };
    expect(runEra(attributed, broken)).toBe("current");
  });
});
