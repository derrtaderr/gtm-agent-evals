// Reading the ledger JSON the CLI already writes, and rendering it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDashboardArgs } from "./cli.js";
import { generateDashboard, readLedgerFile } from "./generate.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-fleet-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const LEDGER = {
  generatedAt: "2026-09-20T00:00:00.000Z",
  agents: [
    {
      agentId: "example-enricher",
      name: "Example Enricher",
      effectiveTier: "auto",
      grantedTiers: ["auto"],
      checks: [
        {
          grantId: "g1",
          agentId: "example-enricher",
          tier: "auto",
          status: "VALID",
          falsifiers: [],
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
    },
  ],
  orphanGrants: [],
};

function writeLedger(value: unknown): string {
  const p = join(dir, "ledger.json");
  writeFileSync(p, JSON.stringify(value));
  return p;
}

describe("parseDashboardArgs --ledger", () => {
  it("accepts a ledger path", () => {
    const args = parseDashboardArgs(["events.jsonl", "out.html", "--ledger", "ledger.json"]);
    expect(args.ledgerPath).toBe("ledger.json");
  });

  it("leaves it undefined when not given", () => {
    expect(parseDashboardArgs(["events.jsonl", "out.html"]).ledgerPath).toBeUndefined();
  });

  it("refuses --ledger with no path rather than ignoring it", () => {
    expect(() => parseDashboardArgs(["e.jsonl", "o.html", "--ledger"])).toThrow(/ledger/);
  });
});

describe("readLedgerFile", () => {
  it("reads a ledger the CLI wrote", () => {
    expect(readLedgerFile(writeLedger(LEDGER)).agents).toHaveLength(1);
  });

  it("throws loudly on a file that is not a ledger, never rendering an empty fleet", () => {
    expect(() => readLedgerFile(writeLedger({ nope: true }))).toThrow(/ledger/i);
  });

  it("throws on an agents field that is not an array", () => {
    expect(() => readLedgerFile(writeLedger({ generatedAt: "x", agents: "no" }))).toThrow(/agents/);
  });
});

describe("generateDashboard with a ledger", () => {
  it("renders the fleet section into the written file", () => {
    const telemetry = join(dir, "events.jsonl");
    writeFileSync(telemetry, "");
    const out = join(dir, "dash.html");
    generateDashboard(telemetry, out, undefined, { ledgerPath: writeLedger(LEDGER) });
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Fleet");
    expect(html).toContain("example-enricher");
  });

  it("omits the fleet section when no ledger is given", () => {
    const telemetry = join(dir, "events.jsonl");
    writeFileSync(telemetry, "");
    const out = join(dir, "dash.html");
    generateDashboard(telemetry, out);
    expect(readFileSync(out, "utf8")).not.toContain("Fleet");
  });
});
