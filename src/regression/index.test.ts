import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("public regression surface (re-exported from package root)", () => {
  it("exports the Lane B functions", () => {
    for (const name of [
      "record",
      "goldenId",
      "diffTrajectory",
      "classify",
      "regressAll",
      "saveGolden",
      "loadGoldens",
      "loadGolden",
    ]) {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exports DEFAULT_SCORE_TOLERANCE as a number", () => {
    expect(typeof (pkg as Record<string, unknown>).DEFAULT_SCORE_TOLERANCE).toBe("number");
  });
});
