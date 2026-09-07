import { describe, it, expect } from "vitest";
import type { TelemetryEvent, Verdict, VerdictStatus } from "../types.js";
import { eventsByConfig, verdictHistory, autonomyStreak } from "./query.js";

function verdict(status: VerdictStatus): Verdict {
  return { status, violations: [], reasons: [status] };
}

// Build an event; `t` is a minute offset so tests can control chronology.
function evt(configId: string, status: VerdictStatus, minute: number, runId = `r-${minute}`): TelemetryEvent {
  const ts = `2026-09-06T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return { runId, timestamp: ts, configId, archetype: "outbound", verdict: verdict(status) };
}

describe("eventsByConfig", () => {
  it("returns only events for the given config id", () => {
    const events = [evt("cfg-a", "PASS", 1), evt("cfg-b", "PASS", 2), evt("cfg-a", "BLOCK", 3)];
    expect(eventsByConfig(events, "cfg-a").map((e) => e.runId)).toEqual(["r-1", "r-3"]);
  });

  it("returns [] when no event matches", () => {
    expect(eventsByConfig([evt("cfg-a", "PASS", 1)], "cfg-missing")).toEqual([]);
  });
});

describe("verdictHistory", () => {
  it("returns the config's statuses in chronological order", () => {
    // deliberately out of file order to prove it sorts by timestamp
    const events = [evt("cfg-a", "BLOCK", 3), evt("cfg-a", "PASS", 1), evt("cfg-a", "PASS", 2)];
    expect(verdictHistory(events, "cfg-a")).toEqual(["PASS", "PASS", "BLOCK"]);
  });

  it("ignores other configs", () => {
    const events = [evt("cfg-a", "PASS", 1), evt("cfg-b", "BLOCK", 2), evt("cfg-a", "BLOCK", 3)];
    expect(verdictHistory(events, "cfg-a")).toEqual(["PASS", "BLOCK"]);
  });

  it("returns [] for an unknown config", () => {
    expect(verdictHistory([evt("cfg-a", "PASS", 1)], "cfg-x")).toEqual([]);
  });
});

describe("autonomyStreak", () => {
  it("counts consecutive PASS runs from the most recent tail", () => {
    const events = [evt("cfg-a", "PASS", 1), evt("cfg-a", "PASS", 2), evt("cfg-a", "PASS", 3)];
    expect(autonomyStreak(events, "cfg-a")).toBe(3);
  });

  it("resets to zero when the most recent run is a BLOCK", () => {
    const events = [evt("cfg-a", "PASS", 1), evt("cfg-a", "PASS", 2), evt("cfg-a", "BLOCK", 3)];
    expect(autonomyStreak(events, "cfg-a")).toBe(0);
  });

  it("counts only the tail streak after the last BLOCK", () => {
    const events = [
      evt("cfg-a", "PASS", 1),
      evt("cfg-a", "BLOCK", 2),
      evt("cfg-a", "PASS", 3),
      evt("cfg-a", "PASS", 4),
    ];
    expect(autonomyStreak(events, "cfg-a")).toBe(2);
  });

  it("uses chronology, not file order", () => {
    // newest (minute 4) is a PASS, but appears first in the array
    const events = [
      evt("cfg-a", "PASS", 4),
      evt("cfg-a", "BLOCK", 1),
      evt("cfg-a", "PASS", 2),
      evt("cfg-a", "PASS", 3),
    ];
    expect(autonomyStreak(events, "cfg-a")).toBe(3);
  });

  it("is zero for a config with no events", () => {
    expect(autonomyStreak([evt("cfg-a", "PASS", 1)], "cfg-x")).toBe(0);
  });
});
