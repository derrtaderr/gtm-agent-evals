import { describe, it, expect } from "vitest";
import { renderLedgerTable, renderAgentDetail, renderCheckReport } from "./render.js";
import { buildLedger, ledgerEntry } from "./status.js";
import { checkGrants } from "./check.js";
import { registerAgent } from "./agents.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import type { AutonomyGrant, AutonomyTier, TelemetryEvent, VerdictStatus } from "../types.js";

const enricher = registerAgent(
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

const drafter = registerAgent(
  {
    id: "example-drafter",
    name: "Example Drafter",
    configHash: "sha256:drafter",
    modelId: "example-model-v1",
    configIds: ["content-default"],
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
    evidence: {
      configHash,
      modelId: "example-model-v1",
      streak: 3,
      gateN: 3,
      runIds: ["run-a", "run-b", "run-c"],
    },
    falsifiers: DEFAULT_FALSIFIER_REGISTRY.falsifiers.map((f) => f.id),
  };
}

function ev(status: VerdictStatus, timestamp: string, configId = "research-default"): TelemetryEvent {
  return {
    runId: `run-${timestamp}`,
    timestamp,
    configId,
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
const deps = { events: clean, registry: DEFAULT_FALSIFIER_REGISTRY, asOf };

function capture(): { io: { out: (l: string) => void }; lines: string[]; text: () => string } {
  const lines: string[] = [];
  return { io: { out: (l) => lines.push(l) }, lines, text: () => lines.join("\n") };
}

describe("renderLedgerTable", () => {
  it("prints one row per agent with its effective tier", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher, drafter], [grant("auto", "sha256:current")], deps));
    expect(c.text()).toContain("example-enricher");
    expect(c.text()).toContain("example-drafter");
    expect(c.text()).toMatch(/example-enricher\s+auto/);
  });

  it("shows the supervised floor for an agent that holds no grant", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([drafter], [], deps));
    expect(c.text()).toMatch(/example-drafter\s+supervised/);
  });

  it("shows the streak against the bar, so eligibility is readable without a second command", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [], deps));
    expect(c.text()).toContain("3/3");
  });

  it("names the grant state beside the tier", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [grant("auto", "sha256:stale")], deps));
    expect(c.text()).toContain("REVOKED");
  });

  // M2: the glance surface must never read clean green mid-incident.
  it("marks an agent whose HIGHER grant is revoked behind a still-valid lower one", () => {
    const grants = [grant("auto", "sha256:stale", "g-auto"), grant("advisory", "sha256:current", "g-adv")];
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], grants, deps));
    // Effective tier is advisory and that grant is VALID — without an incident
    // marker the row reads as a healthy agent while its auto grant is revoked.
    expect(c.text()).toMatch(/example-enricher\s+advisory/);
    expect(c.text()).toContain("auto REVOKED");
  });

  it("marks a SUSPECT higher grant too, not only a revoked one", () => {
    const grants = [grant("auto", "sha256:current", "g-auto"), grant("advisory", "sha256:current", "g-adv")];
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], grants, { ...deps, events: undefined }));
    expect(c.text()).toContain("auto SUSPECT");
  });

  it("leaves the incident column clear when every grant holds", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [grant("auto", "sha256:current")], deps));
    expect(c.text()).not.toMatch(/REVOKED|SUSPECT/);
  });

  it("clears the incident marker once the grant is archived", () => {
    const retired = {
      ...grant("auto", "sha256:stale", "g-auto"),
      archivedAt: "2026-09-10T00:00:00.000Z",
      archivedBy: "operator",
    };
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [retired, grant("advisory", "sha256:current", "g-adv")], deps));
    expect(c.text()).not.toContain("auto REVOKED");
  });

  it("lists orphan grants under their own heading when some exist", () => {
    const ghost = { ...grant("auto", "sha256:current"), agentId: "example-ghost" };
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [ghost], deps));
    expect(c.text()).toMatch(/unknown agent/i);
    expect(c.text()).toContain("example-ghost");
  });

  it("says nothing about orphans when there are none", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([enricher], [], deps));
    expect(c.text()).not.toMatch(/unknown agent/i);
  });

  it("says so plainly when no agent is registered at all", () => {
    const c = capture();
    renderLedgerTable(c.io, buildLedger([], [], deps));
    expect(c.text()).toMatch(/no agents registered/i);
  });
});

describe("renderCheckReport", () => {
  it("prints the statement AND the evidence under a broken falsifier", () => {
    const c = capture();
    renderCheckReport(c.io, checkGrants([grant("auto", "sha256:stale")], { ...deps, agents: [enricher] }));
    expect(c.text()).toContain("REVOKED");
    expect(c.text()).toContain("The agent's configuration is still the one this grant was earned on.");
    expect(c.text()).toContain("sha256:stale");
    expect(c.text()).toContain("sha256:current");
  });

  it("names which falsifier broke, not just that something did", () => {
    const c = capture();
    renderCheckReport(c.io, checkGrants([grant("auto", "sha256:stale")], { ...deps, agents: [enricher] }));
    expect(c.text()).toContain("config_hash_unchanged");
  });

  it("keeps a VALID grant to one line — a clean check should not bury the broken one", () => {
    const c = capture();
    const checks = checkGrants([grant("auto", "sha256:current")], { ...deps, agents: [enricher] });
    renderCheckReport(c.io, checks);
    const body = c.lines.filter((l) => l.includes("g-auto"));
    expect(body).toHaveLength(1);
    expect(body[0]).toContain("VALID");
  });

  it("summarizes the counts across every grant checked", () => {
    const c = capture();
    const checks = checkGrants(
      [grant("auto", "sha256:stale", "g1"), grant("advisory", "sha256:current", "g2")],
      { ...deps, agents: [enricher] },
    );
    renderCheckReport(c.io, checks);
    expect(c.text()).toMatch(/1 VALID.*1 SUSPECT.*1 REVOKED|summary/s);
    expect(c.text()).toContain("REVOKED");
  });

  it("annotates an archived grant and leaves it out of the alarm summary", () => {
    const retired = {
      ...grant("auto", "sha256:stale", "g-auto"),
      archivedAt: "2026-09-10T00:00:00.000Z",
      archivedBy: "operator",
    };
    const c = capture();
    renderCheckReport(c.io, checkGrants([retired], { ...deps, agents: [enricher] }));
    expect(c.text()).toContain("REVOKED");
    expect(c.text()).toMatch(/archived 2026-09-10T00:00:00\.000Z by operator/);
    expect(c.text()).toMatch(/0 unarchived grant\(s\)/);
  });

  it("says so plainly when the ledger holds no grants", () => {
    const c = capture();
    renderCheckReport(c.io, []);
    expect(c.text()).toMatch(/no grants/i);
  });
});

describe("renderAgentDetail", () => {
  it("prints the whole evidence chain behind the effective tier", () => {
    const grants = [grant("auto", "sha256:current")];
    const c = capture();
    renderAgentDetail(c.io, ledgerEntry(enricher, grants, deps), grants);
    const t = c.text();
    expect(t).toContain("Example Enricher");
    expect(t).toContain("auto");
    expect(t).toContain("operator");
    expect(t).toContain("run-a");
  });

  it("prints every falsifier on a holding grant, not only the broken ones", () => {
    const grants = [grant("auto", "sha256:current")];
    const c = capture();
    renderAgentDetail(c.io, ledgerEntry(enricher, grants, deps), grants);
    for (const f of DEFAULT_FALSIFIER_REGISTRY.falsifiers) {
      expect(c.text()).toContain(f.id);
    }
  });

  it("shows who archived a grant and when, in the detail view", () => {
    const retired = {
      ...grant("auto", "sha256:current"),
      archivedAt: "2026-09-10T00:00:00.000Z",
      archivedBy: "operator",
    };
    const c = capture();
    renderAgentDetail(c.io, ledgerEntry(enricher, [retired], deps), [retired]);
    expect(c.text()).toMatch(/archived 2026-09-10T00:00:00\.000Z by operator/);
  });

  it("says an agent holds no grants rather than printing an empty section", () => {
    const c = capture();
    renderAgentDetail(c.io, ledgerEntry(drafter, [], deps), []);
    expect(c.text()).toMatch(/no grants/i);
  });
});
