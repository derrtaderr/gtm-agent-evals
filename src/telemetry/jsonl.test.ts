import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryEvent, Verdict } from "../types.js";
import { makeJsonlSink, readEvents } from "./jsonl.js";

// Synthetic fixtures only — invented config ids/names, no real data.
function verdict(status: "PASS" | "BLOCK"): Verdict {
  return { status, violations: [], reasons: [status === "PASS" ? "all clear" : "blocked"] };
}

function evt(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    runId: "run-001",
    timestamp: "2026-09-06T10:00:00.000Z",
    configId: "cfg-outbound-demo",
    archetype: "outbound",
    verdict: verdict("PASS"),
    ...overrides,
  };
}

describe("makeJsonlSink", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gae-jsonl-"));
    path = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one event as a single JSON line", async () => {
    const sink = makeJsonlSink(path);
    await sink(evt());
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ runId: "run-001", configId: "cfg-outbound-demo" });
  });

  it("creates a missing directory and file", async () => {
    const nested = join(dir, "a", "b", "events.jsonl");
    expect(existsSync(nested)).toBe(false);
    const sink = makeJsonlSink(nested);
    await sink(evt());
    expect(existsSync(nested)).toBe(true);
  });

  it("appends after existing lines without truncating prior events", async () => {
    // Pre-seed the file with a prior event written by an earlier process.
    writeFileSync(path, JSON.stringify(evt({ runId: "prior-run" })) + "\n");
    const sink = makeJsonlSink(path);
    await sink(evt({ runId: "run-002" }));
    await sink(evt({ runId: "run-003" }));
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).runId).toBe("prior-run");
    expect(JSON.parse(lines[1]).runId).toBe("run-002");
    expect(JSON.parse(lines[2]).runId).toBe("run-003");
  });
});

describe("readEvents", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gae-read-"));
    path = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] when the file does not exist", () => {
    expect(readEvents(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("parses each JSONL line into a TelemetryEvent", () => {
    writeFileSync(
      path,
      JSON.stringify(evt({ runId: "r1" })) + "\n" + JSON.stringify(evt({ runId: "r2" })) + "\n",
    );
    const events = readEvents(path);
    expect(events.map((e) => e.runId)).toEqual(["r1", "r2"]);
  });

  it("ignores blank and whitespace-only lines", () => {
    writeFileSync(path, JSON.stringify(evt({ runId: "r1" })) + "\n\n   \n" + JSON.stringify(evt({ runId: "r2" })) + "\n");
    expect(readEvents(path).map((e) => e.runId)).toEqual(["r1", "r2"]);
  });

  it("throws a loud error naming the line number on a malformed line", () => {
    writeFileSync(path, JSON.stringify(evt({ runId: "r1" })) + "\n" + "{not valid json" + "\n");
    expect(() => readEvents(path)).toThrowError(/line 2/i);
  });

  it("rejects a well-formed JSON line that is not a telemetry event shape", () => {
    // Valid JSON, but missing required fields — must not be treated as a clean event.
    writeFileSync(path, JSON.stringify({ hello: "world" }) + "\n");
    expect(() => readEvents(path)).toThrowError(/line 1/i);
  });
});
