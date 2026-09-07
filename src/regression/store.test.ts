import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGolden, loadGoldens, loadGolden } from "./store.js";
import { record } from "./record.js";
import type { AgentRun, Verdict } from "../types.js";

const pass: Verdict = { status: "PASS", violations: [], scores: { quality: 8 }, reasons: ["ok"] };
function mkRun(input: string): AgentRun {
  return { archetype: "content", input, output: `out:${input}` };
}

let dir: string;
let store: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-store-"));
  store = join(dir, "goldens.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("golden store (JSONL)", () => {
  it("returns an empty list when the store file does not exist", () => {
    expect(loadGoldens(store)).toEqual([]);
  });

  it("persists a golden and reads it back intact", () => {
    const g = record(mkRun("task one"), pass, { recordedAt: "2026-09-06T00:00:00.000Z" });
    saveGolden(g, store);
    const loaded = loadGoldens(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(g);
  });

  it("writes one JSON object per line (valid JSONL)", () => {
    saveGolden(record(mkRun("a"), pass), store);
    saveGolden(record(mkRun("b"), pass), store);
    const lines = readFileSync(store, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("upserts by id — re-saving the same golden replaces, never duplicates", () => {
    const g1 = record(mkRun("task one"), pass, { recordedAt: "2026-09-06T00:00:00.000Z" });
    saveGolden(g1, store);
    const updated = { ...g1, recordedAt: "2026-09-07T00:00:00.000Z" };
    saveGolden(updated, store);
    const loaded = loadGoldens(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].recordedAt).toBe("2026-09-07T00:00:00.000Z");
  });

  it("loadGolden fetches a single record by id, undefined when absent", () => {
    const g = record(mkRun("task one"), pass);
    saveGolden(g, store);
    expect(loadGolden(store, g.id)?.input).toBe("task one");
    expect(loadGolden(store, "nope")).toBeUndefined();
  });
});
