// The bundled ledger walkthrough, asserted end to end.
//
// This repo's README promises that every runnable example matches real output.
// That promise decays silently — a message reworded here, a column widened
// there — unless something runs the bundled command and reads the result. This
// file is that something. The fixtures are calibrated to --as-of so the output
// is identical on every machine and in every timezone.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";

const F = join(process.cwd(), "fixtures", "ledger");
const AGENTS = join(F, "agents.jsonl");
const GRANTS = join(F, "grants.jsonl");
const EVENTS = join(F, "events.jsonl");
const ASOF = "2026-09-07T00:00:00.000Z";

let out: string[];
let err: string[];
let io: CliIo;
beforeEach(() => {
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };
});
const text = (): string => out.join("\n");

describe("the bundled ledger fixtures", () => {
  it("show a three-agent fleet at three different tiers", async () => {
    const code = await run(
      ["status", "--agents", AGENTS, "--grants", GRANTS, "--telemetry", EVENTS, "--as-of", ASOF],
      io,
    );
    expect(code).toBe(0);
    expect(text()).toMatch(/example-enricher\s+auto\s+VALID/);
    expect(text()).toMatch(/example-drafter\s+supervised/);
    expect(text()).toMatch(/example-researcher\s+supervised\s+REVOKED/);
  });

  it("check reports one VALID and one REVOKED grant, exit 5", async () => {
    const code = await run(
      ["check", "--agents", AGENTS, "--grants", GRANTS, "--telemetry", EVENTS, "--as-of", ASOF],
      io,
    );
    expect(code).toBe(5);
    expect(text()).toContain("summary: 2 grant(s) — 1 VALID, 0 SUSPECT, 1 REVOKED");
  });

  it("names the falsifier and the evidence behind the revocation", async () => {
    await run(
      ["check", "--agents", AGENTS, "--grants", GRANTS, "--telemetry", EVENTS, "--as-of", ASOF],
      io,
    );
    expect(text()).toContain("BROKEN [config_hash_unchanged]");
    expect(text()).toContain("The agent's configuration is still the one this grant was earned on.");
  });

  it("goes SUSPECT for both grants when no telemetry source is supplied", async () => {
    const code = await run(["check", "--agents", AGENTS, "--grants", GRANTS, "--as-of", ASOF], io);
    expect(code).toBe(5);
    expect(text()).toMatch(/no telemetry source/);
  });

  it("runs against the shipped falsifier registry file, not only the built-in default", async () => {
    const registry = join(process.cwd(), "examples", "falsifiers.json");
    const code = await run(
      [
        "check", "--agents", AGENTS, "--grants", GRANTS, "--telemetry", EVENTS,
        "--falsifiers", registry, "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(5);
    expect(text()).toContain("summary: 2 grant(s) — 1 VALID, 0 SUSPECT, 1 REVOKED");
  });

  it("shows the whole evidence chain for the agent that holds auto", async () => {
    const code = await run(
      [
        "status", "--agents", AGENTS, "--grants", GRANTS, "--telemetry", EVENTS,
        "--agent", "example-enricher", "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(text()).toContain("effective tier: auto");
    expect(text()).toContain("[HOLDS] config_hash_unchanged");
  });
});
