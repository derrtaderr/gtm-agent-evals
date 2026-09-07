import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readJsonFile,
  validateConfig,
  validateRun,
  validateFreshPairs,
} from "./load.js";
import { InputError } from "./exit.js";
import type { EvalConfig } from "../types.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gae-cli-load-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const KNOWN = ["required-cta", "no-em-dash", "length-cap"];

function goodConfig(): unknown {
  return {
    id: "outbound-default",
    archetype: "outbound",
    rules: [{ name: "required-cta" }],
    gateN: 5,
  };
}

describe("readJsonFile", () => {
  it("reads and parses a JSON file", () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify({ a: 1 }));
    expect(readJsonFile(p)).toEqual({ a: 1 });
  });

  it("throws InputError for a missing file", () => {
    expect(() => readJsonFile(join(dir, "nope.json"))).toThrow(InputError);
  });

  it("throws InputError for malformed JSON", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ not json ");
    expect(() => readJsonFile(p)).toThrow(InputError);
  });
});

describe("validateConfig — accepts a well-formed config", () => {
  it("returns the config unchanged when valid", () => {
    const cfg = validateConfig(goodConfig(), KNOWN);
    expect(cfg.archetype).toBe("outbound");
    expect(cfg.gateN).toBe(5);
    expect(cfg.rules[0].name).toBe("required-cta");
  });
});

describe("validateConfig — fails closed on malformed input (exit 2)", () => {
  it("rejects a non-object", () => {
    expect(() => validateConfig("nope", KNOWN)).toThrow(InputError);
  });

  it("rejects a missing archetype", () => {
    const raw = goodConfig() as Record<string, unknown>;
    delete raw.archetype;
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a missing rules array", () => {
    const raw = goodConfig() as Record<string, unknown>;
    delete raw.rules;
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects rules that is not an array", () => {
    const raw = { ...(goodConfig() as object), rules: {} };
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a rule element with no name", () => {
    const raw = { ...(goodConfig() as object), rules: [{ params: {} }] };
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a missing gateN", () => {
    const raw = goodConfig() as Record<string, unknown>;
    delete raw.gateN;
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a non-numeric gateN", () => {
    const raw = { ...(goodConfig() as object), gateN: "5" };
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a rule name absent from the registry", () => {
    const raw = { ...(goodConfig() as object), rules: [{ name: "no-such-rule" }] };
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });

  it("rejects a rubric dimension missing its threshold", () => {
    const raw = {
      ...(goodConfig() as object),
      rubric: { dimensions: [{ name: "relevance" }] },
    };
    expect(() => validateConfig(raw, KNOWN)).toThrow(InputError);
  });
});

describe("validateConfig — unknown severity coerces to block (never silently warn)", () => {
  it("rewrites an unrecognized severity string to block", () => {
    const raw = {
      ...(goodConfig() as object),
      rules: [{ name: "length-cap", params: { maxWords: 10, severity: "info" } }],
    };
    const cfg: EvalConfig = validateConfig(raw, KNOWN);
    const params = cfg.rules[0].params as { severity: string };
    expect(params.severity).toBe("block");
  });

  it("emits a warning naming the coerced rule", () => {
    const warnings: string[] = [];
    const raw = {
      ...(goodConfig() as object),
      rules: [{ name: "length-cap", params: { severity: "whatever" } }],
    };
    validateConfig(raw, KNOWN, (w) => warnings.push(w));
    expect(warnings.some((w) => w.includes("length-cap") && w.includes("block"))).toBe(true);
  });

  it("leaves a recognized severity untouched", () => {
    const raw = {
      ...(goodConfig() as object),
      rules: [{ name: "length-cap", params: { severity: "warn" } }],
    };
    const cfg = validateConfig(raw, KNOWN);
    expect((cfg.rules[0].params as { severity: string }).severity).toBe("warn");
  });
});

describe("validateRun", () => {
  it("accepts a well-formed AgentRun", () => {
    const run = validateRun({ archetype: "outbound", input: "hi", output: "there" });
    expect(run.output).toBe("there");
  });

  it("rejects a run missing output", () => {
    expect(() => validateRun({ archetype: "outbound", input: "hi" })).toThrow(InputError);
  });

  it("rejects a run whose steps is not an array", () => {
    expect(() =>
      validateRun({ archetype: "x", input: "i", output: "o", steps: "nope" }),
    ).toThrow(InputError);
  });
});

describe("validateFreshPairs", () => {
  it("accepts an array of {run, verdict} pairs", () => {
    const pairs = validateFreshPairs([
      {
        run: { archetype: "outbound", input: "i", output: "o" },
        verdict: { status: "PASS", violations: [], reasons: [] },
      },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].verdict.status).toBe("PASS");
  });

  it("rejects a non-array", () => {
    expect(() => validateFreshPairs({})).toThrow(InputError);
  });

  it("rejects a pair whose verdict status is not PASS/BLOCK", () => {
    expect(() =>
      validateFreshPairs([
        {
          run: { archetype: "x", input: "i", output: "o" },
          verdict: { status: "MAYBE", violations: [], reasons: [] },
        },
      ]),
    ).toThrow(InputError);
  });
});
