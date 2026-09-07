import { describe, it, expect } from "vitest";
import type { TelemetryEvent, Verdict } from "../types.js";
import { makeBraintrustSink, type BraintrustRecord, type BraintrustTransport } from "./braintrust.js";

function evt(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  const verdict: Verdict = {
    status: "PASS",
    violations: [],
    scores: { relevance: 0.9, specificity: 0.8 },
    reasons: ["all dimensions cleared"],
  };
  return {
    runId: "run-bt-1",
    timestamp: "2026-09-06T12:00:00.000Z",
    configId: "cfg-outbound-demo",
    archetype: "outbound",
    verdict,
    durationMs: 1234,
    ...overrides,
  };
}

function capturingTransport(): { transport: BraintrustTransport; records: BraintrustRecord[] } {
  const records: BraintrustRecord[] = [];
  return { transport: { log: async (r) => void records.push(r) }, records };
}

describe("makeBraintrustSink", () => {
  it("maps verdict status to output and carries the run id", async () => {
    const { transport, records } = capturingTransport();
    await makeBraintrustSink(transport)(evt());
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("run-bt-1");
    expect(records[0].output).toBe("PASS");
  });

  it("maps rubric scores through to the Braintrust scores field", async () => {
    const { transport, records } = capturingTransport();
    await makeBraintrustSink(transport)(evt());
    expect(records[0].scores).toEqual({ relevance: 0.9, specificity: 0.8 });
  });

  it("defaults scores to an empty object when the verdict carried none", async () => {
    const { transport, records } = capturingTransport();
    const v: Verdict = { status: "BLOCK", violations: [], reasons: ["rule fired"] };
    await makeBraintrustSink(transport)(evt({ verdict: v }));
    expect(records[0].scores).toEqual({});
    expect(records[0].output).toBe("BLOCK");
  });

  it("puts configId, archetype, reasons and timestamp in metadata", async () => {
    const { transport, records } = capturingTransport();
    await makeBraintrustSink(transport)(evt());
    expect(records[0].metadata).toMatchObject({
      configId: "cfg-outbound-demo",
      archetype: "outbound",
      reasons: ["all dimensions cleared"],
      timestamp: "2026-09-06T12:00:00.000Z",
    });
  });

  it("maps durationMs into metrics.duration and includes input context", async () => {
    const { transport, records } = capturingTransport();
    await makeBraintrustSink(transport)(evt());
    expect(records[0].metrics).toEqual({ duration: 1234 });
    expect(records[0].input).toEqual({ configId: "cfg-outbound-demo", archetype: "outbound" });
  });

  it("omits metrics when durationMs is absent", async () => {
    const { transport, records } = capturingTransport();
    await makeBraintrustSink(transport)(evt({ durationMs: undefined }));
    expect(records[0].metrics).toBeUndefined();
  });

  it("propagates a transport failure so a broken integration is never a silent drop", async () => {
    const transport: BraintrustTransport = {
      log: async () => {
        throw new Error("braintrust unreachable");
      },
    };
    await expect(makeBraintrustSink(transport)(evt())).rejects.toThrow(/braintrust unreachable/);
  });
});
