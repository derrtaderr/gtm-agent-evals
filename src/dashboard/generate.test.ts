import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDashboard } from "./generate.js";
import type { TelemetryEvent, RegressionResult } from "../types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-dash-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function event(configId: string, status: "PASS" | "BLOCK", minute: number): TelemetryEvent {
  return {
    runId: `${configId}-${minute}`,
    timestamp: `2026-09-06T10:${String(minute).padStart(2, "0")}:00.000Z`,
    configId,
    archetype: "outbound",
    verdict: { status, violations: [], reasons: [status] },
  };
}

function writeJsonl(path: string, events: TelemetryEvent[]): void {
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

describe("generateDashboard", () => {
  it("reads the telemetry JSONL and writes a self-contained HTML file", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1), event("cfg-a", "BLOCK", 2)]);
    const out = join(dir, "dashboard.html");

    generateDashboard(tel, out);

    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, "utf8");
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain("cfg-a");
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("returns the output path it wrote", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1)]);
    const out = join(dir, "dashboard.html");
    expect(generateDashboard(tel, out)).toBe(out);
  });

  it("folds in a regression-results JSON file when given one", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1)]);
    const reg = join(dir, "regression.json");
    const results: RegressionResult[] = [
      { goldenId: "golden-xyz", status: "REGRESSION", diffs: [{ field: "output", golden: "a", actual: "b" }] },
    ];
    writeFileSync(reg, JSON.stringify(results), "utf8");
    const out = join(dir, "dashboard.html");

    generateDashboard(tel, out, reg);

    const html = readFileSync(out, "utf8");
    expect(html).toContain("golden-xyz");
    expect(html).toContain("REGRESSION");
  });

  it("renders the empty state when the telemetry file is missing", () => {
    const out = join(dir, "dashboard.html");
    generateDashboard(join(dir, "does-not-exist.jsonl"), out);
    const html = readFileSync(out, "utf8");
    expect(html).toMatch(/no runs recorded/i);
  });

  it("throws when the regression file is not a JSON array", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1)]);
    const reg = join(dir, "regression.json");
    writeFileSync(reg, JSON.stringify({ not: "an array" }), "utf8");
    expect(() => generateDashboard(tel, join(dir, "out.html"), reg)).toThrow(/array/i);
  });

  it("throws a loud, named error on a malformed regression item, not a raw TypeError", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1)]);
    const reg = join(dir, "regression.json");
    // Item missing `diffs` — would crash later at r.diffs.length with a raw TypeError.
    writeFileSync(reg, JSON.stringify([{ goldenId: "g-1", status: "REGRESSION" }]), "utf8");
    expect(() => generateDashboard(tel, join(dir, "out.html"), reg)).toThrow(/item #0/i);
  });

  it("throws a named error on a regression item with an invalid status", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1)]);
    const reg = join(dir, "regression.json");
    writeFileSync(reg, JSON.stringify([{ goldenId: "g-1", status: "MAYBE", diffs: [] }]), "utf8");
    expect(() => generateDashboard(tel, join(dir, "out.html"), reg)).toThrow(/item #0/i);
  });

  it("passes gateN through so cleared status renders", () => {
    const tel = join(dir, "events.jsonl");
    writeJsonl(tel, [event("cfg-a", "PASS", 1), event("cfg-a", "PASS", 2)]);
    const out = join(dir, "dashboard.html");
    generateDashboard(tel, out, undefined, { gateNByConfig: { "cfg-a": 2 } });
    const html = readFileSync(out, "utf8");
    expect(html).toMatch(/cleared/i);
  });
});
