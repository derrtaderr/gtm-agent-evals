// The status surface must agree with the grant surface.
//
// A row whose `*` promises eligibility that `grant` would refuse is the ledger
// lying at a glance, which is the one thing this whole lane exists to stop. So
// `streak` and `eligible` are the CONFIG-SCOPED numbers, and the all-era count
// survives beside them as `observedStreak` — still a useful health signal, just
// not the eligibility question.

import { describe, it, expect } from "vitest";
import { ledgerEntry } from "./status.js";
import { renderLedgerTable, renderAgentDetail } from "./render.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { AgentRecord, Ledger, TelemetryEvent, VerdictStatus } from "../types.js";

const base = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:v2",
    modelId: "example-model-v1",
    configIds: ["research-default"],
    gateN: 3,
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

/** Rotated to v2 on 09-06, so anything before that is prior-era. */
const rotated: AgentRecord = { ...base, configSince: "2026-09-06T00:00:00.000Z" };

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

const asOf = "2026-09-12T00:00:00.000Z";
const deps = (events: TelemetryEvent[]) => ({
  events,
  registry: DEFAULT_FALSIFIER_REGISTRY,
  asOf,
});

const preRotation = [ev(2), ev(3), ev(4)];

describe("the row reports the number a grant would actually be decided on", () => {
  it("shows a ZERO streak after a rotation, not the inherited one", () => {
    const e = ledgerEntry(rotated, [], deps(preRotation));
    expect(e.streak).toBe(0);
    expect(e.eligible).toBe(false);
  });

  it("keeps the all-era count visible as observedStreak", () => {
    // The agent really has been passing. That fact is not deleted, it is just
    // not what eligibility means.
    const e = ledgerEntry(rotated, [], deps(preRotation));
    expect(e.observedStreak).toBe(3);
  });

  it("counts runs recorded under the current config", () => {
    const e = ledgerEntry(rotated, [], deps([...preRotation, ev(7), ev(8), ev(9)]));
    expect(e.streak).toBe(3);
    expect(e.eligible).toBe(true);
  });

  it("splits counted runs into verified and unverified", () => {
    const e = ledgerEntry(
      rotated,
      [],
      deps([ev(7, "PASS", "sha256:v2"), ev(8, "PASS", "sha256:v2"), ev(9)]),
    );
    expect(e.verifiedRuns).toBe(2);
    expect(e.unverifiedRuns).toBe(1);
  });

  it("counts the runs excluded as prior-era", () => {
    expect(ledgerEntry(rotated, [], deps(preRotation)).excludedRuns).toBe(3);
  });

  it("reports zeroes, not crashes, with no telemetry source at all", () => {
    const e = ledgerEntry(rotated, [], { ...deps([]), events: undefined });
    expect(e.streak).toBe(0);
    expect(e.observedStreak).toBe(0);
    expect(e.excludedRuns).toBe(0);
  });
});

describe("the table explains a streak that shrank", () => {
  function render(entry: ReturnType<typeof ledgerEntry>): string {
    const lines: string[] = [];
    const ledger: Ledger = { generatedAt: asOf, agents: [entry], orphanGrants: [] };
    renderLedgerTable({ out: (l) => lines.push(l) }, ledger);
    return lines.join("\n");
  }

  it("names the excluded prior-era runs rather than silently showing 0/3", () => {
    const text = render(ledgerEntry(rotated, [], deps(preRotation)));
    expect(text).toMatch(/0\/3/);
    expect(text).toMatch(/EXCLUDED|excluded/);
  });

  it("names counted-but-unverified runs and how to make them provable", () => {
    const text = render(ledgerEntry(base, [], deps([ev(7), ev(8), ev(9)])));
    expect(text).toMatch(/unverified/i);
    expect(text).toMatch(/--agent/);
  });

  it("says neither when every counted run is attributed to the current config", () => {
    const attributed = [ev(7, "PASS", "sha256:v2"), ev(8, "PASS", "sha256:v2"), ev(9, "PASS", "sha256:v2")];
    const text = render(ledgerEntry(rotated, [], deps(attributed)));
    expect(text).not.toMatch(/unverified/i);
    expect(text).not.toMatch(/excluded/i);
  });
});

describe("the detail view shows the whole evidence split", () => {
  it("reports the observed streak beside the config-scoped one", () => {
    const lines: string[] = [];
    renderAgentDetail({ out: (l) => lines.push(l) }, ledgerEntry(rotated, [], deps(preRotation)), []);
    const text = lines.join("\n");
    expect(text).toMatch(/0\/3/);
    expect(text).toMatch(/3 run\(s\) excluded|excluded/i);
    expect(text).toMatch(/observed/i);
  });
});
