import { describe, it, expect } from "vitest";
import type { TelemetryEvent, Verdict, VerdictStatus, RegressionResult } from "../types.js";
import { buildViewModel } from "./model.js";

function verdict(status: VerdictStatus): Verdict {
  return { status, violations: [], reasons: [status] };
}

// minute controls chronology; archetype defaults to outbound
function evt(
  configId: string,
  status: VerdictStatus,
  minute: number,
  archetype = "outbound",
): TelemetryEvent {
  const ts = `2026-09-06T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return { runId: `${configId}-${minute}`, timestamp: ts, configId, archetype, verdict: verdict(status) };
}

describe("buildViewModel summary", () => {
  it("counts total runs, pass rate, and configs tracked", () => {
    const events = [
      evt("cfg-a", "PASS", 1),
      evt("cfg-a", "BLOCK", 2),
      evt("cfg-b", "PASS", 3),
      evt("cfg-b", "PASS", 4),
    ];
    const vm = buildViewModel(events);
    expect(vm.summary.totalRuns).toBe(4);
    expect(vm.summary.passCount).toBe(3);
    expect(vm.summary.blockCount).toBe(1);
    expect(vm.summary.passRate).toBeCloseTo(0.75);
    expect(vm.summary.configCount).toBe(2);
  });

  it("reports a zero pass rate on empty input without dividing by zero", () => {
    const vm = buildViewModel([]);
    expect(vm.summary.totalRuns).toBe(0);
    expect(vm.summary.passRate).toBe(0);
    expect(vm.configs).toEqual([]);
  });
});

describe("buildViewModel per-config", () => {
  it("gives chronological verdict history and consecutive-PASS streak per config", () => {
    // out of file order to prove it sorts by parsed time via Lane D's query API
    const events = [evt("cfg-a", "PASS", 3), evt("cfg-a", "BLOCK", 1), evt("cfg-a", "PASS", 2)];
    const vm = buildViewModel(events);
    const a = vm.configs.find((c) => c.configId === "cfg-a")!;
    expect(a.history).toEqual(["BLOCK", "PASS", "PASS"]);
    expect(a.streak).toBe(2);
    expect(a.total).toBe(3);
    expect(a.passCount).toBe(2);
    expect(a.archetype).toBe("outbound");
  });

  it("sorts configs by id for a stable render", () => {
    const events = [evt("cfg-z", "PASS", 1), evt("cfg-a", "PASS", 2)];
    expect(buildViewModel(events).configs.map((c) => c.configId)).toEqual(["cfg-a", "cfg-z"]);
  });

  it("marks a config cleared once its consecutive-PASS streak reaches its gateN", () => {
    const events = [evt("cfg-a", "PASS", 1), evt("cfg-a", "PASS", 2), evt("cfg-a", "PASS", 3)];
    const vm = buildViewModel(events, { gateNByConfig: { "cfg-a": 3 } });
    const a = vm.configs.find((c) => c.configId === "cfg-a")!;
    expect(a.gateN).toBe(3);
    expect(a.clearedForAutonomy).toBe(true);
  });

  it("marks a config not cleared when its streak is short of gateN", () => {
    const events = [evt("cfg-a", "BLOCK", 1), evt("cfg-a", "PASS", 2)];
    const vm = buildViewModel(events, { gateNByConfig: { "cfg-a": 3 } });
    const a = vm.configs.find((c) => c.configId === "cfg-a")!;
    expect(a.clearedForAutonomy).toBe(false);
  });

  it("leaves cleared status undefined when no gateN is known for the config", () => {
    const vm = buildViewModel([evt("cfg-a", "PASS", 1)]);
    const a = vm.configs.find((c) => c.configId === "cfg-a")!;
    expect(a.gateN).toBeUndefined();
    expect(a.clearedForAutonomy).toBeUndefined();
  });
});

describe("buildViewModel latestReason", () => {
  it("carries the chronologically-latest run's reasons for a blocked config", () => {
    const events = [
      evt("cfg-a", "PASS", 1),
      { ...evt("cfg-a", "BLOCK", 2), verdict: { status: "BLOCK" as VerdictStatus, violations: [], reasons: ["blocked: no CTA", "blocked: too long"] } },
    ];
    const vm = buildViewModel(events);
    const a = vm.configs.find((c) => c.configId === "cfg-a")!;
    expect(a.latestStatus).toBe("BLOCK");
    expect(a.latestReason).toBe("blocked: no CTA; blocked: too long");
  });

  it("reports the latest status as PASS with no reason surfaced when the tail passes", () => {
    const events = [evt("cfg-a", "BLOCK", 1), evt("cfg-a", "PASS", 2)];
    const a = buildViewModel(events).configs.find((c) => c.configId === "cfg-a")!;
    expect(a.latestStatus).toBe("PASS");
  });
});

describe("buildViewModel regression", () => {
  it("is empty when no regression results are supplied", () => {
    expect(buildViewModel([evt("cfg-a", "PASS", 1)]).regressions).toEqual([]);
  });

  it("maps each regression result to a status plus its diff count", () => {
    const results: RegressionResult[] = [
      { goldenId: "g-1", status: "MATCH", diffs: [] },
      {
        goldenId: "g-2",
        status: "REGRESSION",
        diffs: [{ field: "output", golden: "a", actual: "b" }],
      },
    ];
    const vm = buildViewModel([], { regressions: results });
    expect(vm.regressions).toEqual([
      { goldenId: "g-1", status: "MATCH", diffCount: 0 },
      { goldenId: "g-2", status: "REGRESSION", diffCount: 1 },
    ]);
  });
});
