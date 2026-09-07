import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EvalConfig } from "../types.js";
import { archetypes, allArchetypeRules } from "./index.js";

function loadExample(name: string): EvalConfig {
  const path = fileURLToPath(
    new URL(`../../examples/${name}.config.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as EvalConfig;
}

describe("archetypes barrel", () => {
  it("registers content, outbound, and research", () => {
    expect(Object.keys(archetypes).sort()).toEqual([
      "content",
      "outbound",
      "research",
    ]);
  });

  it("each entry carries rules, a config, and a rubric", () => {
    for (const [id, entry] of Object.entries(archetypes)) {
      expect(entry.config.archetype).toBe(id);
      expect(entry.rules).toBe(entry.config.rubric ? entry.rules : entry.rules);
      expect(Object.keys(entry.rules).length).toBeGreaterThan(0);
      expect(entry.rubric.dimensions.length).toBeGreaterThan(0);
      expect(entry.config.rubric).toBe(entry.rubric);
    }
  });

  it("allArchetypeRules merges every archetype's rules with no name collisions", () => {
    const totalNamed = Object.values(archetypes).reduce(
      (n, e) => n + Object.keys(e.rules).length,
      0,
    );
    expect(Object.keys(allArchetypeRules)).toHaveLength(totalNamed);
  });

  it("every config rule name resolves to a RuleFn in its archetype registry", () => {
    for (const entry of Object.values(archetypes)) {
      for (const rc of entry.config.rules) {
        expect(typeof entry.rules[rc.name]).toBe("function");
      }
    }
  });
});

describe("example configs do not drift from the archetype defaults", () => {
  for (const name of ["content", "outbound", "research"] as const) {
    it(`${name} example matches its default config rules and rubric`, () => {
      const example = loadExample(name);
      const entry = archetypes[name];
      expect(example.archetype).toBe(name);
      expect(example.gateN).toBe(entry.config.gateN);
      expect(example.rules.map((r) => r.name).sort()).toEqual(
        entry.config.rules.map((r) => r.name).sort(),
      );
      expect(example.rubric?.dimensions.map((d) => d.name).sort()).toEqual(
        entry.rubric.dimensions.map((d) => d.name).sort(),
      );
    });

    it(`${name} example rule names all resolve to a RuleFn`, () => {
      const example = loadExample(name);
      const entry = archetypes[name];
      for (const rc of example.rules) {
        expect(typeof entry.rules[rc.name]).toBe("function");
      }
    });
  }
});
