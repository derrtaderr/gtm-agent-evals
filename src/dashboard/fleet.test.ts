// The fleet section: the autonomy ledger rendered beside the run telemetry.
//
// The dashboard already answers "how are the configs doing". This answers "what
// is each agent allowed to do unattended, and is anything wrong right now" —
// the same question `status` answers in a terminal, on the surface somebody
// actually leaves open.
//
// Every string here originates in operator data (agent names, reviewer ids,
// falsifier evidence). This surface took an XSS finding once, so escaping is
// asserted rather than assumed.

import { describe, it, expect } from "vitest";
import { buildViewModel } from "./model.js";
import { renderDashboard } from "./render.js";
import type { Ledger } from "../types.js";

function entry(over: Record<string, unknown> = {}) {
  return {
    agentId: "example-enricher",
    name: "Example Enricher",
    effectiveTier: "auto" as const,
    grantedTiers: ["auto" as const],
    checks: [
      {
        grantId: "example-enricher-auto-abc",
        agentId: "example-enricher",
        tier: "auto" as const,
        status: "VALID" as const,
        falsifiers: [
          { falsifier: "config_hash_unchanged", statement: "s", status: "HOLDS" as const, evidence: "e" },
          { falsifier: "model_unchanged", statement: "s", status: "HOLDS" as const, evidence: "e" },
        ],
        checkedAt: "2026-09-20T00:00:00.000Z",
        archived: false,
      },
    ],
    streak: 3,
    observedStreak: 3,
    verifiedRuns: 3,
    unverifiedRuns: 0,
    excludedRuns: 0,
    gateN: 3,
    eligible: true,
    lastVerdict: "PASS" as const,
    lastRunAt: "2026-09-19T00:00:00.000Z",
    ...over,
  };
}

function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    generatedAt: "2026-09-20T00:00:00.000Z",
    agents: [entry()],
    orphanGrants: [],
    ...over,
  } as Ledger;
}

describe("the fleet view model", () => {
  it("is absent when no ledger is supplied — the dashboard still works alone", () => {
    expect(buildViewModel([]).fleet).toBeUndefined();
  });

  it("carries each agent's tier and grant status", () => {
    const vm = buildViewModel([], { ledger: ledger() });
    expect(vm.fleet).toHaveLength(1);
    expect(vm.fleet![0].effectiveTier).toBe("auto");
    expect(vm.fleet![0].grantStatus).toBe("VALID");
  });

  it("counts falsifier health", () => {
    const vm = buildViewModel([], { ledger: ledger() });
    expect(vm.fleet![0].falsifiersHolding).toBe(2);
    expect(vm.fleet![0].falsifiersTotal).toBe(2);
  });

  it("names every unarchived grant that is not holding as an incident", () => {
    const demoted = entry({
      effectiveTier: "supervised",
      checks: [
        {
          grantId: "g-auto",
          agentId: "example-enricher",
          tier: "auto",
          status: "REVOKED",
          falsifiers: [
            { falsifier: "config_hash_unchanged", statement: "s", status: "BROKEN", evidence: "rotated" },
          ],
          checkedAt: "2026-09-20T00:00:00.000Z",
          archived: false,
        },
      ],
    });
    const vm = buildViewModel([], { ledger: ledger({ agents: [demoted] }) });
    expect(vm.fleet![0].incidents).toEqual(["auto REVOKED"]);
  });

  it("does not count an ARCHIVED non-holding grant as a live incident", () => {
    const resolved = entry({
      checks: [
        {
          grantId: "g-auto",
          agentId: "example-enricher",
          tier: "auto",
          status: "REVOKED",
          falsifiers: [],
          checkedAt: "2026-09-20T00:00:00.000Z",
          archived: true,
          archivedBy: "operator",
        },
      ],
    });
    const vm = buildViewModel([], { ledger: ledger({ agents: [resolved] }) });
    expect(vm.fleet![0].incidents).toEqual([]);
  });

  it("carries review recency when the ledger recorded it", () => {
    const reviewed = entry({
      lastReviewAt: "2026-09-18T00:00:00.000Z",
      lastReviewVerdict: "BLESS",
      lastReviewBy: "priya",
    });
    const vm = buildViewModel([], { ledger: ledger({ agents: [reviewed] }) });
    expect(vm.fleet![0].lastReviewBy).toBe("priya");
    expect(vm.fleet![0].lastReviewVerdict).toBe("BLESS");
  });
});

describe("the fleet section renders", () => {
  it("shows the agent, its tier and its streak", () => {
    const html = renderDashboard(buildViewModel([], { ledger: ledger() }));
    expect(html).toContain("Example Enricher");
    expect(html).toContain("auto");
    expect(html).toMatch(/3\s*\/\s*3/);
  });

  it("is omitted entirely when there is no ledger", () => {
    expect(renderDashboard(buildViewModel([]))).not.toContain("Fleet");
  });

  it("flags an incident visibly rather than reading clean green", () => {
    const demoted = entry({
      effectiveTier: "supervised",
      checks: [
        {
          grantId: "g-auto",
          agentId: "example-enricher",
          tier: "auto",
          status: "REVOKED",
          falsifiers: [
            { falsifier: "config_hash_unchanged", statement: "s", status: "BROKEN", evidence: "rotated" },
          ],
          checkedAt: "2026-09-20T00:00:00.000Z",
          archived: false,
        },
      ],
    });
    const html = renderDashboard(buildViewModel([], { ledger: ledger({ agents: [demoted] }) }));
    expect(html).toContain("auto REVOKED");
  });

  it("says plainly when an agent has never been reviewed", () => {
    const html = renderDashboard(buildViewModel([], { ledger: ledger() }));
    expect(html).toMatch(/never reviewed|no review/i);
  });

  it("ESCAPES agent names — this surface took an XSS finding once", () => {
    const hostile = entry({ name: '<script>alert("x")</script>' });
    const html = renderDashboard(buildViewModel([], { ledger: ledger({ agents: [hostile] }) }));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ESCAPES reviewer ids too", () => {
    const hostile = entry({ lastReviewBy: '<img src=x onerror=1>', lastReviewVerdict: "BLESS", lastReviewAt: "2026-09-18T00:00:00.000Z" });
    const html = renderDashboard(buildViewModel([], { ledger: ledger({ agents: [hostile] }) }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("stays self-contained — no external asset creeps in with the new section", () => {
    const html = renderDashboard(buildViewModel([], { ledger: ledger() }));
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
