import { describe, it, expect } from "vitest";
import * as telemetry from "./index.js";

describe("telemetry barrel", () => {
  it("re-exports the full public surface", () => {
    expect(typeof telemetry.makeJsonlSink).toBe("function");
    expect(typeof telemetry.readEvents).toBe("function");
    expect(typeof telemetry.makeBraintrustSink).toBe("function");
    expect(typeof telemetry.teeSinks).toBe("function");
    expect(typeof telemetry.eventsByConfig).toBe("function");
    expect(typeof telemetry.verdictHistory).toBe("function");
    expect(typeof telemetry.autonomyStreak).toBe("function");
  });
});
