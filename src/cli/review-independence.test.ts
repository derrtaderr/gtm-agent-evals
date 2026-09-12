// B1: reviewer independence must not be skippable on the blessed path.
//
// The hole this file exists to close: `--grants` was OPTIONAL on `review`, and
// omitting it silently skipped the granter-conflict rule. Because
// `review_freshness` never re-checks independence at read time — by documented
// design, since the rule is enforced at write time — a non-independent review
// recorded that way went on to HOLD the very grant its author had made. Four
// surfaces (README, SPEC, WIRING, and reviews.ts' own comment) claimed the
// reviews file "only ever holds reviews a reader can trust without knowing this
// rule exists", and the omission path made all four false.
//
// No test covered the omission, which is exactly how it shipped.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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
let telemetry: string;

const ASOF = "2026-09-20T00:00:00.000Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-indep-"));
  out = [];
  err = [];
  io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} };
  agents = join(dir, "agents.jsonl");
  grants = join(dir, "grants.jsonl");
  reviews = join(dir, "reviews.jsonl");
  telemetry = join(dir, "events.jsonl");
  registry = join(process.cwd(), "examples", "falsifiers-with-review.json");

  writeFileSync(
    agents,
    JSON.stringify({
      id: "bot",
      name: "Bot",
      configHash: "sha256:v1",
      modelId: "m",
      gateN: 3,
      configIds: ["c"],
      registeredAt: "2026-09-01T00:00:00.000Z",
      configSince: "2026-09-01T00:00:00.000Z",
    }) + "\n",
  );
  // jane granted bot its auto tier, so jane is not an independent reviewer of bot.
  writeFileSync(
    grants,
    JSON.stringify({
      id: "bot-auto-xyz",
      agentId: "bot",
      tier: "auto",
      grantedAt: "2026-09-06T00:00:00.000Z",
      grantedBy: "jane",
      evidence: { configHash: "sha256:v1", modelId: "m", streak: 3, gateN: 3, runIds: ["r1"] },
      falsifiers: ["review_not_stale"],
    }) + "\n",
  );
  writeFileSync(telemetry, "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const errText = (): string => err.join("\n");
const text = (): string => out.join("\n");

function review(extra: string[]): Promise<number> {
  return run(
    [
      "review", "--reviews", reviews, "--agent", "bot",
      "--verdict", "BLESS", "--evidence", "https://example.invalid/r",
      "--as-of", "2026-09-10T00:00:00.000Z",
      ...extra,
    ],
    io,
  );
}

describe("the omission path — the exploit, closed", () => {
  it("REFUSES to record a review at all when --grants is omitted", async () => {
    const code = await review(["--reviewer", "jane"]);
    expect(code).toBe(1);
    expect(errText()).toMatch(/--grants/);
  });

  it("names WHY the flag is required, not just that it is missing", async () => {
    await review(["--reviewer", "jane"]);
    expect(errText()).toMatch(/independen/i);
  });

  it("writes nothing — the reviews file is never created by a refused review", async () => {
    await review(["--reviewer", "jane"]);
    expect(existsSync(reviews)).toBe(false);
  });

  it("refuses the granter's own BLESS the same way with the flag as without it", async () => {
    const without = await review(["--reviewer", "jane"]);
    err = [];
    const with_ = await review(["--reviewer", "jane", "--grants", grants]);
    expect(without).toBe(1);
    expect(with_).toBe(1);
  });

  it("a non-independent review can therefore never reach `check` and hold a grant", async () => {
    // The full exploit, end to end: jane tries to bless the grant she made.
    await review(["--reviewer", "jane"]);
    expect(existsSync(reviews)).toBe(false);
    out = [];
    const code = await run(
      [
        "check", "--agents", agents, "--grants", grants, "--telemetry", telemetry,
        "--reviews", reviews, "--falsifiers", registry, "--as-of", ASOF,
      ],
      io,
    );
    // No review on file -> DEGRADED -> SUSPECT. Never VALID on jane's say-so.
    expect(code).toBe(5);
    expect(text()).toMatch(/SUSPECT/);
  });

  it("still records an INDEPENDENT review, with the flag supplied", async () => {
    const code = await review(["--reviewer", "priya", "--grants", grants]);
    expect(code).toBe(0);
    expect(readFileSync(reviews, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("accepts a grants path that does not exist yet — a pre-grant review loses nothing", async () => {
    const code = await review(["--reviewer", "priya", "--grants", join(dir, "not-yet.jsonl")]);
    expect(code).toBe(0);
  });
});

describe("M1: independence matching is normalized, not exact-string", () => {
  it("refuses a reviewer id differing from the granter only in CASE", async () => {
    const code = await review(["--reviewer", "Jane", "--grants", grants]);
    expect(code).toBe(1);
    expect(errText()).toMatch(/independent/i);
  });

  it("refuses a reviewer id differing only in surrounding whitespace", async () => {
    const code = await review(["--reviewer", " jane ", "--grants", grants]);
    expect(code).toBe(1);
  });

  it("refuses SHOUTED ids too", async () => {
    expect(await review(["--reviewer", "JANE", "--grants", grants])).toBe(1);
  });

  it("still allows a genuinely different reviewer whose id merely contains the granter's", async () => {
    // "janet" is not "jane"; normalization must not become substring matching.
    expect(await review(["--reviewer", "janet", "--grants", grants])).toBe(0);
  });
});
