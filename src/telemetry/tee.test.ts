import { describe, it, expect } from "vitest";
import type { TelemetryEvent, TelemetrySink, Verdict } from "../types.js";
import { teeSinks } from "./tee.js";

function verdict(status: "PASS" | "BLOCK"): Verdict {
  return { status, violations: [], reasons: [status] };
}

const sample: TelemetryEvent = {
  runId: "run-tee-1",
  timestamp: "2026-09-06T11:00:00.000Z",
  configId: "cfg-research-demo",
  archetype: "research",
  verdict: verdict("PASS"),
};

describe("teeSinks", () => {
  it("fans one event out to every sink", async () => {
    const a: TelemetryEvent[] = [];
    const b: TelemetryEvent[] = [];
    const tee = teeSinks(
      (e) => void a.push(e),
      (e) => void b.push(e),
    );
    await tee(sample);
    expect(a).toEqual([sample]);
    expect(b).toEqual([sample]);
  });

  it("awaits async sinks before resolving", async () => {
    const order: string[] = [];
    const slow: TelemetrySink = async (_e) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("slow");
    };
    const fast: TelemetrySink = (_e) => {
      order.push("fast");
    };
    await teeSinks(slow, fast)(sample);
    expect(order).toContain("slow");
    expect(order).toContain("fast");
  });

  it("is a no-op that resolves when given no sinks", async () => {
    await expect(teeSinks()(sample)).resolves.toBeUndefined();
  });

  it("still delivers to the other sinks when one sink throws", async () => {
    const delivered: TelemetryEvent[] = [];
    const boom: TelemetrySink = () => {
      throw new Error("sink down");
    };
    const good: TelemetrySink = (e) => void delivered.push(e);
    await expect(teeSinks(boom, good)(sample)).rejects.toThrow(/sink down/);
    // the healthy sink must have received the event despite the sibling failing
    expect(delivered).toEqual([sample]);
  });
});
