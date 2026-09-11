import { describe, it, expect } from "vitest";
import { TIERS, SUPERVISED, tierRank, isTier, highestTier } from "./tiers.js";

describe("autonomy tier vocabulary", () => {
  it("orders supervised below advisory below auto", () => {
    expect(tierRank("supervised")).toBeLessThan(tierRank("advisory"));
    expect(tierRank("advisory")).toBeLessThan(tierRank("auto"));
  });

  it("names supervised as the floor every agent starts at", () => {
    expect(SUPERVISED).toBe("supervised");
    expect(tierRank(SUPERVISED)).toBe(0);
  });

  it("lists exactly the three v1 tiers, lowest first", () => {
    expect(TIERS).toEqual(["supervised", "advisory", "auto"]);
  });

  it("recognizes a valid tier string and rejects anything else", () => {
    expect(isTier("auto")).toBe(true);
    expect(isTier("AUTO")).toBe(false);
    expect(isTier("autonomous")).toBe(false);
    expect(isTier("")).toBe(false);
  });

  it("picks the highest tier from a list", () => {
    expect(highestTier(["advisory", "auto", "supervised"])).toBe("auto");
    expect(highestTier(["advisory", "supervised"])).toBe("advisory");
  });

  it("falls back to the supervised floor when no tier holds", () => {
    expect(highestTier([])).toBe("supervised");
  });
});
