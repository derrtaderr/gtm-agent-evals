// What the grant surfaces CLAIM about their evidence.
//
// Session 1's surfaces carried a standing caveat — "run-era config lineage is
// not tracked yet, so those runs are not proven to have been produced by that
// config" — which was true then and is false now for an attributed run. A
// retired claim survives in every file the replacement did not touch, and a
// file that is read cannot tell that it is stale. These tests are what makes
// the surfaces tell the truth about which kind of evidence they are holding.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";

let dir: string;
let out: string[];
let err: string[];
let io: CliIo;
let agents: string;
let grants: string;
let telemetry: string;

const AGENT = {
  id: "example-enricher",
  name: "Example Enricher",
  configHash: "sha256:v1",
  modelId: "example-model-v1",
  gateN: 3,
  configIds: ["outbound-default"],
  registeredAt: "2026-09-01T00:00:00.000Z",
  configSince: "2026-09-01T00:00:00.000Z",
};

function ev(day: number, configHash?: string): string {
  return JSON.stringify({
    runId: `r-0${day}`,
    timestamp: `2026-09-0${day}T09:00:00.000Z`,
    configId: "outbound-default",
    archetype: "outbound",
    agentId: "example-enricher",
    ...(configHash ? { agentConfigHash: configHash } : {}),
    verdict: { status: "PASS", violations: [], reasons: [] },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-grant-out-"));
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };
  agents = join(dir, "agents.jsonl");
  grants = join(dir, "grants.jsonl");
  telemetry = join(dir, "events.jsonl");
  writeFileSync(agents, JSON.stringify(AGENT) + "\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const text = (): string => out.join("\n");

function grant(): Promise<number> {
  return run(
    [
      "grant", "--agents", agents, "--grants", grants, "--telemetry", telemetry,
      "--agent", "example-enricher", "--tier", "auto",
      "--confirm", "grant auto to example-enricher", "--granted-by", "dana",
      "--as-of", "2026-09-05T00:00:00.000Z",
    ],
    io,
  );
}

describe("grant output on VERIFIED evidence", () => {
  beforeEach(() => {
    writeFileSync(telemetry, [ev(2, "sha256:v1"), ev(3, "sha256:v1"), ev(4, "sha256:v1")].join("\n") + "\n");
  });

  it("does not repeat the retired 'lineage is not tracked' caveat", async () => {
    await grant();
    expect(text()).not.toMatch(/not tracked|cannot yet tell|not proven to have been produced/);
  });

  it("does not point at a README section that no longer exists", async () => {
    await grant();
    expect(text()).not.toMatch(/does not know yet/);
  });

  it("says the runs were produced by the config on file, because they were", async () => {
    await grant();
    expect(text()).toMatch(/3 verified|verified by config hash|all 3/i);
  });
});

describe("grant output on UNVERIFIED evidence", () => {
  beforeEach(() => {
    // Unattributed runs — the pre-upgrade store. Counted, but inferred.
    writeFileSync(telemetry, [ev(2), ev(3), ev(4)].join("\n") + "\n");
  });

  it("says plainly that the lineage is inferred rather than proven", async () => {
    await grant();
    expect(text()).toMatch(/unverified|inferred/i);
  });

  it("never claims those runs are proven", async () => {
    await grant();
    expect(text()).not.toMatch(/3 verified/);
  });
});

describe("status --agent detail", () => {
  it("does not carry the retired caveat either", async () => {
    writeFileSync(telemetry, [ev(2, "sha256:v1"), ev(3, "sha256:v1"), ev(4, "sha256:v1")].join("\n") + "\n");
    await grant();
    out = [];
    await run(
      [
        "status", "--agents", agents, "--grants", grants, "--telemetry", telemetry,
        "--agent", "example-enricher", "--as-of", "2026-09-06T00:00:00.000Z",
      ],
      io,
    );
    expect(text()).not.toMatch(/lineage is not tracked/);
  });
});
