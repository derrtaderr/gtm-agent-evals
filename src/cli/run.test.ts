import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";

let dir: string;
let out: string[];
let err: string[];
let io: CliIo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-cli-run-"));
  out = [];
  err = [];
  io = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: {}, // no ANTHROPIC_API_KEY -> keyless
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, obj: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

const rulesOnlyConfig = {
  id: "outbound-default",
  archetype: "outbound",
  rules: [{ name: "required-cta" }, { name: "no-unfilled-placeholder" }],
  gateN: 3,
};

const passingRun = {
  archetype: "outbound",
  input: "Write a cold email to Northwind Robotics.",
  output:
    "Hi Dana,\n\nNorthwind Robotics posted three RevOps roles this month.\n\nWorth a quick call next Tuesday?\n\nRay",
  steps: [],
};

const failingRun = {
  archetype: "outbound",
  input: "Write a cold email to Northwind Robotics.",
  output: "Hi {{firstName}},\n\nWe help companies like [company] do more with less.",
  steps: [],
};

describe("run — usage errors (exit 1)", () => {
  it("exits 1 on an unknown command", async () => {
    const code = await run(["frobnicate"], io);
    expect(code).toBe(1);
  });

  it("exits 1 when eval is missing --config", async () => {
    const code = await run(["eval", "--run", write("r.json", passingRun)], io);
    expect(code).toBe(1);
  });

  it("exits 1 with no command", async () => {
    const code = await run([], io);
    expect(code).toBe(1);
  });
});

describe("run — input errors (exit 2)", () => {
  it("exits 2 on a missing config file", async () => {
    const code = await run(
      ["eval", "--config", join(dir, "nope.json"), "--run", write("r.json", passingRun)],
      io,
    );
    expect(code).toBe(2);
  });

  it("exits 2 on a malformed config (fail closed, never a silent pass)", async () => {
    const badCfg = write("bad.json", { archetype: "outbound" }); // no rules, no gateN
    const code = await run(
      ["eval", "--config", badCfg, "--run", write("r.json", passingRun), "--rules-only"],
      io,
    );
    expect(code).toBe(2);
  });
});

describe("eval — exit 0 PASS / exit 3 BLOCK", () => {
  it("exits 0 and prints PASS for a clean run in --rules-only mode", async () => {
    const code = await run(
      [
        "eval",
        "--config",
        write("c.json", rulesOnlyConfig),
        "--run",
        write("r.json", passingRun),
        "--rules-only",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("PASS");
  });

  it("exits 3 and prints BLOCK for a run that trips a block rule", async () => {
    const code = await run(
      [
        "eval",
        "--config",
        write("c.json", rulesOnlyConfig),
        "--run",
        write("r.json", failingRun),
        "--rules-only",
      ],
      io,
    );
    expect(code).toBe(3);
    expect(out.join("\n")).toContain("BLOCK");
  });

  it("BLOCKs a full eval keylessly (rubric present, no API key -> fail closed)", async () => {
    const cfgWithRubric = {
      ...rulesOnlyConfig,
      rubric: { dimensions: [{ name: "relevance", threshold: 7 }] },
    };
    const code = await run(
      [
        "eval",
        "--config",
        write("c.json", cfgWithRubric),
        "--run",
        write("r.json", passingRun),
      ],
      io,
    );
    expect(code).toBe(3);
  });
});

describe("eval — telemetry emission", () => {
  it("appends a TelemetryEvent line when --telemetry is given", async () => {
    const tel = join(dir, "events.jsonl");
    await run(
      [
        "eval",
        "--config",
        write("c.json", rulesOnlyConfig),
        "--run",
        write("r.json", passingRun),
        "--rules-only",
        "--telemetry",
        tel,
      ],
      io,
    );
    expect(existsSync(tel)).toBe(true);
    const line = JSON.parse(readFileSync(tel, "utf8").trim());
    expect(line.configId).toBe("outbound-default");
    expect(line.verdict.status).toBe("PASS");
  });
});

describe("record — writes a golden", () => {
  it("evaluates then records the run+verdict as a golden line", async () => {
    const store = join(dir, "goldens.jsonl");
    const code = await run(
      [
        "record",
        "--config",
        write("c.json", rulesOnlyConfig),
        "--run",
        write("r.json", passingRun),
        "--rules-only",
        "--store",
        store,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(existsSync(store)).toBe(true);
    const golden = JSON.parse(readFileSync(store, "utf8").trim());
    expect(golden.archetype).toBe("outbound");
    expect(golden.verdict.status).toBe("PASS");
  });
});

describe("regress — exit 4 on REGRESSION, 0 on match", () => {
  async function seedGolden(store: string) {
    await run(
      [
        "record",
        "--config",
        write("c.json", rulesOnlyConfig),
        "--run",
        write("r.json", passingRun),
        "--rules-only",
        "--store",
        store,
      ],
      { ...io, out: () => {}, err: () => {} },
    );
  }

  it("exits 0 when the fresh run matches its golden", async () => {
    const store = join(dir, "g.jsonl");
    await seedGolden(store);
    const pairs = [
      { run: passingRun, verdict: { status: "PASS", violations: [], reasons: [] } },
    ];
    const code = await run(
      ["regress", "--store", store, "--runs", write("fresh.json", pairs)],
      io,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("MATCH");
  });

  it("exits 4 when a golden that was PASS now BLOCKs", async () => {
    const store = join(dir, "g.jsonl");
    await seedGolden(store);
    const pairs = [
      {
        run: passingRun,
        verdict: { status: "BLOCK", violations: [], reasons: ["regressed"] },
      },
    ];
    const code = await run(
      ["regress", "--store", store, "--runs", write("fresh.json", pairs)],
      io,
    );
    expect(code).toBe(4);
    expect(out.join("\n")).toContain("REGRESSION");
  });
});

describe("report — telemetry history + autonomy streak", () => {
  it("prints the verdict history and streak per config", async () => {
    const tel = join(dir, "events.jsonl");
    const mk = (status: string, i: number) =>
      JSON.stringify({
        runId: `run-${i}`,
        timestamp: `2026-09-06T10:0${i}:00.000Z`,
        configId: "outbound-default",
        archetype: "outbound",
        verdict: { status, violations: [], reasons: [] },
      });
    writeFileSync(tel, [mk("PASS", 0), mk("PASS", 1), mk("PASS", 2)].join("\n") + "\n");
    const code = await run(["report", "--telemetry", tel], io);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("outbound-default");
    expect(text).toContain("3"); // streak of 3
  });

  it("exits 2 on a corrupt telemetry line (fail closed)", async () => {
    const tel = join(dir, "bad.jsonl");
    writeFileSync(tel, "{ not an event\n");
    const code = await run(["report", "--telemetry", tel], io);
    expect(code).toBe(2);
  });
});
