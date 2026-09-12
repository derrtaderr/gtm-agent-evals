// Agent attribution on an eval run — the other half of the config-lineage fix.
//
// Scoping eligibility to the current configuration is only worth anything if a
// run can SAY which configuration produced it. These flags are where that fact
// enters the system: the operator names the agent, and the registry supplies
// the hash, so the two can never drift apart through a typo at the command line.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";
import type { TelemetryEvent } from "../types.js";

let dir: string;
let out: string[];
let err: string[];
let io: CliIo;
let config: string;
let runFile: string;
let telemetry: string;
let agents: string;

const AGENT = {
  id: "example-drafter",
  name: "Example Drafter",
  configHash: "sha256:drafterv7",
  modelId: "example-model-v1",
  gateN: 3,
  configIds: ["outbound-default"],
  registeredAt: "2026-09-01T00:00:00.000Z",
  configSince: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-attrib-"));
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };

  config = join(dir, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      id: "outbound-default",
      archetype: "outbound",
      rules: [{ name: "required-cta" }],
      gateN: 3,
    }),
  );

  runFile = join(dir, "run.json");
  writeFileSync(
    runFile,
    JSON.stringify({
      archetype: "outbound",
      input: "draft a first-touch email",
      output: "We help teams ship faster. Reply if you want a walkthrough.",
    }),
  );

  telemetry = join(dir, "events.jsonl");
  agents = join(dir, "agents.jsonl");
  writeFileSync(agents, JSON.stringify(AGENT) + "\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function events(): TelemetryEvent[] {
  return readFileSync(telemetry, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as TelemetryEvent);
}

describe("eval --agent stamps the run with its producer", () => {
  it("records the agent id and the config hash the REGISTRY holds", async () => {
    const code = await run(
      [
        "eval", "--rules-only", "--config", config, "--run", runFile,
        "--telemetry", telemetry, "--agents", agents, "--agent", "example-drafter",
      ],
      io,
    );
    expect(code).toBe(0);
    const [e] = events();
    expect(e.agentId).toBe("example-drafter");
    expect(e.agentConfigHash).toBe("sha256:drafterv7");
  });

  it("follows the registry when the config rotates, with no flag to keep in sync", async () => {
    writeFileSync(
      agents,
      JSON.stringify({ ...AGENT, configHash: "sha256:drafterv8", configSince: "2026-09-10T00:00:00.000Z" }) + "\n",
    );
    await run(
      [
        "eval", "--rules-only", "--config", config, "--run", runFile,
        "--telemetry", telemetry, "--agents", agents, "--agent", "example-drafter",
      ],
      io,
    );
    expect(events()[0].agentConfigHash).toBe("sha256:drafterv8");
  });

  it("stamps a `record` run too — a golden is evidence like any other", async () => {
    const code = await run(
      [
        "record", "--rules-only", "--config", config, "--run", runFile,
        "--store", join(dir, "goldens.jsonl"), "--telemetry", telemetry,
        "--agents", agents, "--agent", "example-drafter",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(events()[0].agentId).toBe("example-drafter");
  });
});

describe("attribution is refused rather than guessed", () => {
  it("refuses --agent without --agents, instead of writing an unattributed run", async () => {
    const code = await run(
      [
        "eval", "--rules-only", "--config", config, "--run", runFile,
        "--telemetry", telemetry, "--agent", "example-drafter",
      ],
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/--agents/);
  });

  it("refuses an agent id the registry does not hold", async () => {
    const code = await run(
      [
        "eval", "--rules-only", "--config", config, "--run", runFile,
        "--telemetry", telemetry, "--agents", agents, "--agent", "ghost",
      ],
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/ghost/);
  });

  it("warns when the named agent does not claim this eval config as its evidence", async () => {
    // Attribution without association writes a run the ledger will never read,
    // which looks like evidence and is not.
    writeFileSync(agents, JSON.stringify({ ...AGENT, configIds: ["something-else"] }) + "\n");
    const code = await run(
      [
        "eval", "--rules-only", "--config", config, "--run", runFile,
        "--telemetry", telemetry, "--agents", agents, "--agent", "example-drafter",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(err.join("\n")).toMatch(/outbound-default/);
    expect(err.join("\n")).toMatch(/--eval-configs/);
  });
});

describe("backward compatibility", () => {
  it("writes an unattributed event when no agent is named", async () => {
    await run(
      ["eval", "--rules-only", "--config", config, "--run", runFile, "--telemetry", telemetry],
      io,
    );
    const [e] = events();
    expect(e.agentId).toBeUndefined();
    expect(e.agentConfigHash).toBeUndefined();
    // Still a perfectly valid event in every other respect.
    expect(e.configId).toBe("outbound-default");
    expect(e.verdict.status).toBe("PASS");
  });
});
