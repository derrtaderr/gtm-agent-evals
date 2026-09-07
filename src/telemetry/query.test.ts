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

// Build an event with an explicit timestamp string, for time-ordering tests.
function evtTs(configId: string, status: VerdictStatus, ts: string, runId = ts): TelemetryEvent {
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

describe("time ordering (parsed time, not lexical string sort)", () => {
  it("orders a +offset PASS after a Z BLOCK by actual UTC time (streak 1, not 0)", () => {
    // P is the true-latest event: 05:00-05:00 == 10:00Z, PASS.
    // B is 09:00Z, earlier. But P's string ("...T05:00...") lexically sorts
    // BEFORE B's ("...T09:00...Z"), so a string sort makes BLOCK look most recent
    // and returns streak 0. Parsed-time ordering must return 1.
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T05:00:00-05:00", "P"),
      evtTs("cfg-a", "BLOCK", "2026-09-06T09:00:00Z", "B"),
    ];
    expect(autonomyStreak(events, "cfg-a")).toBe(1);
  });

  it("orders mixed fractional precision by actual time (streak 1, not 0)", () => {
    // A is 10:00:00.500Z (later), PASS. B is 10:00:00Z (earlier), BLOCK.
    // Lexically "...00.500Z" < "...00Z" ('.' < 'Z'), so a string sort puts the
    // PASS first and the BLOCK last, wrongly yielding streak 0.
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T10:00:00.500Z", "A"),
      evtTs("cfg-a", "BLOCK", "2026-09-06T10:00:00Z", "B"),
    ];
    expect(autonomyStreak(events, "cfg-a")).toBe(1);
  });

  it("gives the same chronological verdictHistory under offset timestamps", () => {
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T05:00:00-05:00", "P"), // 10:00Z, latest
      evtTs("cfg-a", "BLOCK", "2026-09-06T09:00:00Z", "B"), // 09:00Z, earlier
    ];
    expect(verdictHistory(events, "cfg-a")).toEqual(["BLOCK", "PASS"]);
  });

  it("throws naming an unparseable timestamp rather than silently mis-sorting", () => {
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T10:00:00Z", "ok"),
      evtTs("cfg-a", "PASS", "not-a-date", "bad"),
    ];
    expect(() => autonomyStreak(events, "cfg-a")).toThrowError(/not-a-date/);
    expect(() => verdictHistory(events, "cfg-a")).toThrowError(/not-a-date/);
  });

  it("throws on a timezone-LESS timestamp (would parse as machine-local time)", () => {
    // No Z, no offset. Date.parse reads this as LOCAL time per the ES spec, so
    // the streak would differ by the reader's timezone. Must be refused, not parsed.
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T10:00:00Z", "ok"),
      evtTs("cfg-a", "PASS", "2026-09-06T00:00:00", "tzless"),
    ];
    expect(() => autonomyStreak(events, "cfg-a")).toThrowError(/2026-09-06T00:00:00/);
    expect(() => verdictHistory(events, "cfg-a")).toThrowError(/2026-09-06T00:00:00/);
  });

  it("throws on over-permissive non-ISO strings Date.parse would otherwise accept", () => {
    for (const bad of ["0", "Sept 6 2026", "2026-02-30"]) {
      const events = [
        evtTs("cfg-a", "PASS", "2026-09-06T10:00:00Z", "ok"),
        evtTs("cfg-a", "PASS", bad, "bad"),
      ];
      expect(() => autonomyStreak(events, "cfg-a"), `expected "${bad}" to throw`).toThrowError();
    }
  });

  it("still accepts a real ISO Z timestamp from new Date().toISOString()", () => {
    const iso = new Date().toISOString(); // always ...Z
    const events = [evtTs("cfg-a", "PASS", iso, "now")];
    expect(() => autonomyStreak(events, "cfg-a")).not.toThrow();
    expect(autonomyStreak(events, "cfg-a")).toBe(1);
  });

  it("still orders a valid Z and +05:00 pair by true time", () => {
    // +05:00 event is truly latest (10:00Z) and PASS; keep the offset fix green.
    const events = [
      evtTs("cfg-a", "PASS", "2026-09-06T15:00:00+05:00", "P"), // 10:00Z
      evtTs("cfg-a", "BLOCK", "2026-09-06T09:00:00Z", "B"), // 09:00Z
    ];
    expect(autonomyStreak(events, "cfg-a")).toBe(1);
    expect(verdictHistory(events, "cfg-a")).toEqual(["BLOCK", "PASS"]);
  });
});
