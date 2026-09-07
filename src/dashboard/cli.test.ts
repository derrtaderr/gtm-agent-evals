import { describe, it, expect } from "vitest";
import { parseDashboardArgs } from "./cli.js";

describe("parseDashboardArgs", () => {
  it("reads the telemetry path and output path as the two positionals", () => {
    const a = parseDashboardArgs(["events.jsonl", "out.html"]);
    expect(a.telemetryPath).toBe("events.jsonl");
    expect(a.outPath).toBe("out.html");
    expect(a.regressionPath).toBeUndefined();
  });

  it("reads the optional --regression flag", () => {
    const a = parseDashboardArgs(["events.jsonl", "out.html", "--regression", "reg.json"]);
    expect(a.regressionPath).toBe("reg.json");
  });

  it("throws a usage error when the two required paths are missing", () => {
    expect(() => parseDashboardArgs(["events.jsonl"])).toThrow(/usage/i);
  });

  it("throws when --regression is given without a value", () => {
    expect(() => parseDashboardArgs(["e.jsonl", "o.html", "--regression"])).toThrow(/regression/i);
  });
});
