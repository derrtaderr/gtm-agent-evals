// The `review` command, and reviews reaching `check`/`status`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
let reviews: string;
let registry: string;

const ASOF = "2026-09-20T00:00:00.000Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-review-cli-"));
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };
  agents = join(dir, "agents.jsonl");
  grants = join(dir, "grants.jsonl");
  reviews = join(dir, "reviews.jsonl");
  registry = join(process.cwd(), "examples", "falsifiers-with-review.json");

  writeFileSync(
    agents,
    JSON.stringify({
      id: "example-enricher",
      name: "Example Enricher",
      configHash: "sha256:v2",
      modelId: "example-model-v1",
      gateN: 3,
      configIds: ["research-default"],
      registeredAt: "2026-09-01T00:00:00.000Z",
      configSince: "2026-09-01T00:00:00.000Z",
    }) + "\n",
  );
  writeFileSync(
    grants,
    JSON.stringify({
      id: "example-enricher-auto-abc123",
      agentId: "example-enricher",
      tier: "auto",
      grantedAt: "2026-09-06T00:00:00.000Z",
      grantedBy: "dana",
      evidence: {
        configHash: "sha256:v2",
        modelId: "example-model-v1",
        streak: 3,
        gateN: 3,
        runIds: ["r-3"],
      },
      falsifiers: ["review_not_stale"],
    }) + "\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const errText = (): string => err.join("\n");
const text = (): string => out.join("\n");

function review(over: string[] = []): Promise<number> {
  return run(
    [
      "review", "--reviews", reviews, "--grants", grants,
      "--agent", "example-enricher", "--reviewer", "priya",
      "--verdict", "BLESS", "--evidence", "https://example.invalid/r/1",
      "--as-of", "2026-09-10T00:00:00.000Z",
      ...over,
    ],
    io,
  );
}

describe("review", () => {
  it("records a review and says so", async () => {
    expect(await review()).toBe(0);
    expect(text()).toMatch(/BLESS/);
    expect(readFileSync(reviews, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("REFUSES a review by the human who granted the tier, naming the grant", async () => {
    const code = await review(["--reviewer", "dana"]);
    expect(code).toBe(1);
    expect(errText()).toMatch(/dana/);
    expect(errText()).toMatch(/example-enricher-auto-abc123|granted/);
    // A refused review never reaches the file — the store is not created at all.
    expect(existsSync(reviews)).toBe(false);
  });

  it("REFUSES a review by the agent itself", async () => {
    expect(await review(["--reviewer", "example-enricher"])).toBe(1);
    expect(errText()).toMatch(/itself|its own/i);
  });

  it("refuses a verdict outside the vocabulary", async () => {
    expect(await review(["--verdict", "LGTM"])).toBe(1);
  });

  it("refuses a review with no evidence pointer", async () => {
    const code = await run(
      [
        "review", "--reviews", reviews, "--grants", grants, "--agent", "example-enricher",
        "--reviewer", "priya", "--verdict", "BLESS", "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(1);
    expect(errText()).toMatch(/evidence/i);
  });

  it("rejects an unknown flag rather than ignoring it", async () => {
    expect(await review(["--reviwer", "typo"])).toBe(1);
  });
});

describe("check --reviews", () => {
  it("is SUSPECT with the review falsifier and no reviews source", async () => {
    const code = await run(
      ["check", "--agents", agents, "--grants", grants, "--falsifiers", registry, "--as-of", ASOF],
      io,
    );
    expect(code).toBe(5);
    expect(text()).toMatch(/no reviews source/);
  });

  it("HOLDS once an independent BLESS is on file", async () => {
    await review();
    out = [];
    const code = await run(
      [
        "check", "--agents", agents, "--grants", grants, "--reviews", reviews,
        "--falsifiers", registry, "--telemetry", join(dir, "none.jsonl"), "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(text()).toMatch(/VALID/);
  });

  it("REVOKES the grant on a BLOCK review, naming the reviewer", async () => {
    await review(["--verdict", "BLOCK", "--evidence", "https://example.invalid/r/2"]);
    out = [];
    const code = await run(
      [
        "check", "--agents", agents, "--grants", grants, "--reviews", reviews,
        "--falsifiers", registry, "--telemetry", join(dir, "none.jsonl"), "--as-of", ASOF,
      ],
      io,
    );
    expect(code).toBe(5);
    expect(text()).toMatch(/REVOKED/);
    expect(text()).toMatch(/BROKEN \[review_not_stale\]/);
    expect(text()).toMatch(/priya/);
  });
});
