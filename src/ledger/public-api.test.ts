// The documented consumer path is `import { ... } from "gtm-agent-evals"`. A
// lane that ships a barrel but never wires it into src/index.ts is invisible to
// every consumer who is not reading the source tree, so the entry point gets a
// test of its own.

import { describe, it, expect } from "vitest";
import * as pkg from "../index.js";

describe("the package entry point exposes the autonomy ledger", () => {
  it("exports the decision surface a consumer needs", () => {
    for (const name of [
      "registerAgent",
      "createGrant",
      "confirmationPhrase",
      "checkGrants",
      "buildLedger",
      "DEFAULT_FALSIFIER_REGISTRY",
      "loadFalsifierRegistry",
      "highestTier",
    ]) {
      expect(pkg).toHaveProperty(name);
    }
  });

  it("still exports every surface the earlier lanes shipped", () => {
    for (const name of ["evaluate", "evaluateGate", "computeStreak", "regressAll", "readEvents"]) {
      expect(pkg).toHaveProperty(name);
    }
  });
});
