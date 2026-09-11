// CLI coverage for the autonomy-ledger commands: register, grant, check, status.
// Everything here is keyless and deterministic — --as-of pins the clock, so the
// same argv produces the same bytes on every machine.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";
import type { Ledger, TelemetryEvent, VerdictStatus } from "../types.js";

let dir: string;
let out: string[];
let err: string[];
let io: CliIo;
let agents: string;
let grants: string;
let telemetry: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-cli-ledger-"));
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };
  agents = join(dir, "agents.jsonl");
  grants = join(dir, "grants.jsonl");
  telemetry = join(dir, "events.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const text = (): string => out.join("\n");
const errText = (): string => err.join("\n");

function ev(status: VerdictStatus, timestamp: string, configId = "research-default"): TelemetryEvent {
  return {
    runId: `run-${timestamp}`,
    timestamp,
    configId,
    archetype: "research",
    verdict: { status, violations: [], reasons: [] },
  };
}

function writeTelemetry(events: TelemetryEvent[]): void {
  writeFileSync(telemetry, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

const cleanThree = [
  ev("PASS", "2026-09-08T00:00:00.000Z"),
  ev("PASS", "2026-09-09T00:00:00.000Z"),
  ev("PASS", "2026-09-10T00:00:00.000Z"),
];

const ASOF = "2026-09-11T00:00:00.000Z";

async function register(over: string[] = []): Promise<number> {
  return run(
    [
      "register",
      "--agents", agents,
      "--id", "example-enricher",
      "--name", "Example Enricher",
      "--model", "example-model-v1",
      "--config-hash", "sha256:aaaa1111",
      "--eval-configs", "research-default",
      "--gate-n", "3",
      "--as-of", ASOF,
      ...over,
    ],
    io,
  );
}

async function grantAuto(over: string[] = []): Promise<number> {
  return run(
    [
      "grant",
      "--agents", agents,
      "--grants", grants,
      "--telemetry", telemetry,
      "--agent", "example-enricher",
      "--tier", "auto",
      "--confirm", "grant auto to example-enricher",
      "--granted-by", "operator",
      "--as-of", ASOF,
      ...over,
    ],
    io,
  );
}

describe("register", () => {
  it("writes the agent to the registry and reports it, exit 0", async () => {
    expect(await register()).toBe(0);
    expect(existsSync(agents)).toBe(true);
    expect(text()).toContain("example-enricher");
    expect(readFileSync(agents, "utf8")).toContain("sha256:aaaa1111");
  });

  it("exits 1 on a missing required flag", async () => {
    const code = await run(["register", "--agents", agents, "--id", "x"], io);
    expect(code).toBe(1);
    expect(errText()).toMatch(/--name|--model|--config-hash/);
  });

  it("exits 1 on an unknown flag rather than ignoring it", async () => {
    expect(await register(["--tier", "auto"])).toBe(1);
    expect(errText()).toMatch(/unknown option/);
  });

  it("re-registering with a rotated config hash replaces the entry", async () => {
    await register();
    expect(await register(["--config-hash", "sha256:bbbb2222"])).toBe(0);
    const lines = readFileSync(agents, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sha256:bbbb2222");
  });

  it("exits 1 on a --gate-n that is not a number, rather than storing NaN", async () => {
    expect(await register(["--gate-n", "three"])).toBe(1);
    expect(errText()).toMatch(/gate-n/);
  });

  it("warns when no eval configs are associated, because the agent then has no evidence", async () => {
    const code = await run(
      [
        "register", "--agents", agents, "--id", "example-drafter", "--name", "Example Drafter",
        "--model", "example-model-v1", "--config-hash", "sha256:dddd", "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(errText()).toMatch(/no eval configs/i);
  });
});

describe("grant", () => {
  beforeEach(async () => {
    await register();
    writeTelemetry(cleanThree);
    out = [];
    err = [];
  });

  it("records the grant once the streak clears the bar and a human confirms, exit 0", async () => {
    expect(await grantAuto()).toBe(0);
    expect(readFileSync(grants, "utf8")).toContain('"tier":"auto"');
    expect(text()).toMatch(/auto/);
  });

  it("exits 1 and prints the exact phrase required when the confirmation is missing", async () => {
    const code = await grantAuto(["--confirm", "yes"]);
    expect(code).toBe(1);
    expect(errText()).toContain('--confirm "grant auto to example-enricher"');
    expect(existsSync(grants)).toBe(false);
  });

  it("refuses with exit 5 when the clean-run streak is short of gateN", async () => {
    writeTelemetry([ev("PASS", "2026-09-10T00:00:00.000Z")]);
    const code = await grantAuto();
    expect(code).toBe(5);
    expect(errText()).toMatch(/streak of 1/);
    expect(existsSync(grants)).toBe(false);
  });

  it("refuses with exit 5 when the newest run blocked", async () => {
    writeTelemetry([...cleanThree, ev("BLOCK", "2026-09-10T12:00:00.000Z")]);
    expect(await grantAuto()).toBe(5);
  });

  it("exits 1 for an agent that is not registered", async () => {
    const code = await grantAuto(["--agent", "example-ghost", "--confirm", "grant auto to example-ghost"]);
    expect(code).toBe(1);
    expect(errText()).toMatch(/example-ghost/);
  });

  it("exits 1 on a tier outside the vocabulary", async () => {
    const code = await grantAuto(["--tier", "unlimited", "--confirm", "grant unlimited to example-enricher"]);
    expect(code).toBe(1);
    expect(errText()).toMatch(/supervised, advisory, auto/);
  });
});

describe("check", () => {
  beforeEach(async () => {
    await register();
    writeTelemetry(cleanThree);
    await grantAuto();
    out = [];
    err = [];
  });

  const check = (over: string[] = []): Promise<number> =>
    run(["check", "--agents", agents, "--grants", grants, "--telemetry", telemetry, "--as-of", ASOF, ...over], io);

  it("exits 0 while every grant still holds", async () => {
    expect(await check()).toBe(0);
    expect(text()).toContain("VALID");
  });

  it("flips the grant SUSPECT with exit 5 when the config hash is mutated in the registry", async () => {
    await register(["--config-hash", "sha256:bbbb2222"]);
    const code = await check();
    expect(code).toBe(5);
    expect(text()).toContain("config_hash_unchanged");
    expect(text()).toContain("sha256:bbbb2222");
  });

  it("REVOKES on a BLOCK recorded after the grant, naming the run", async () => {
    // Strictly AFTER the grant at ASOF. A BLOCK from before the grant is
    // already priced into the evidence and must not revoke anything.
    writeTelemetry([...cleanThree, ev("BLOCK", "2026-09-11T06:00:00.000Z")]);
    expect(await check(["--as-of", "2026-09-12T00:00:00.000Z"])).toBe(5);
    expect(text()).toContain("REVOKED");
    expect(text()).toContain("no_block_since_grant");
  });

  it("goes SUSPECT rather than VALID when no telemetry source is supplied at all", async () => {
    const code = await run(["check", "--agents", agents, "--grants", grants, "--as-of", ASOF], io);
    expect(code).toBe(5);
    expect(text()).toContain("SUSPECT");
    expect(text()).toMatch(/no telemetry source/);
  });

  it("exits 0 and says so when the ledger holds no grants", async () => {
    rmSync(grants);
    expect(await check()).toBe(0);
    expect(text()).toMatch(/no grants/i);
  });

  it("writes a machine-readable ledger to --out", async () => {
    const outPath = join(dir, "ledger.json");
    await check(["--out", outPath]);
    const ledger = JSON.parse(readFileSync(outPath, "utf8")) as Ledger;
    expect(ledger.generatedAt).toBe(ASOF);
    expect(ledger.agents[0].effectiveTier).toBe("auto");
    expect(ledger.agents[0].checks[0].falsifiers).toHaveLength(4);
  });

  it("exits 2 on an --as-of that is not strict ISO with a timezone — a local-time clock would move every verdict", async () => {
    expect(await check(["--as-of", "2026-09-11"])).toBe(2);
    expect(errText()).toMatch(/as-of/);
  });

  it("exits 2 on a corrupt grant ledger rather than reporting a clean board", async () => {
    writeFileSync(grants, "{not json\n", "utf8");
    expect(await check()).toBe(2);
  });

  it("exits 2 on a falsifier registry naming a check that does not exist", async () => {
    const reg = join(dir, "falsifiers.json");
    writeFileSync(reg, JSON.stringify({ falsifiers: [{ id: "x", check: "nope", statement: "s" }] }));
    expect(await check(["--falsifiers", reg])).toBe(2);
    expect(errText()).toMatch(/nope/);
  });
});

describe("status", () => {
  beforeEach(async () => {
    await register();
    writeTelemetry(cleanThree);
    await grantAuto();
    out = [];
    err = [];
  });

  const status = (over: string[] = []): Promise<number> =>
    run(["status", "--agents", agents, "--grants", grants, "--telemetry", telemetry, "--as-of", ASOF, ...over], io);

  it("prints one table row per agent showing the effective tier, exit 0", async () => {
    expect(await status()).toBe(0);
    expect(text()).toMatch(/example-enricher\s+auto/);
  });

  it("exits 0 even when a grant is revoked — status reports, it does not gate", async () => {
    await register(["--config-hash", "sha256:bbbb2222"]);
    out = [];
    expect(await status()).toBe(0);
    expect(text()).toContain("REVOKED");
    expect(text()).toMatch(/example-enricher\s+supervised/);
  });

  it("shows the full evidence chain for one agent with --agent", async () => {
    expect(await status(["--agent", "example-enricher"])).toBe(0);
    expect(text()).toContain("Example Enricher");
    expect(text()).toContain("granted");
    expect(text()).toContain("config_hash_unchanged");
  });

  it("exits 1 naming the registered agents when --agent is unknown", async () => {
    const code = await status(["--agent", "example-ghost"]);
    expect(code).toBe(1);
    expect(errText()).toContain("example-enricher");
  });

  it("reports an empty registry plainly rather than printing an empty table", async () => {
    rmSync(agents);
    expect(await status()).toBe(0);
    expect(text()).toMatch(/no agents registered/i);
  });
});
