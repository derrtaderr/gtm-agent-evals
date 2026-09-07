import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentRun } from "../../types.js";
import {
  noUnfilledPlaceholder,
  requiredCTA,
  lengthCap,
  outboundRuleFns,
  outboundRules,
  outboundConfig,
  outboundRubric,
} from "./index.js";

function loadFixture(name: string): AgentRun {
  const path = fileURLToPath(
    new URL(`../../../fixtures/outbound/${name}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as AgentRun;
}

const passing = loadFixture("passing");
const failing = loadFixture("failing");

function run(output: string): AgentRun {
  return { archetype: "outbound", input: "x", output };
}

describe("noUnfilledPlaceholder", () => {
  it("flags a leftover {{merge}} token with block severity", async () => {
    const v = await noUnfilledPlaceholder(run("Hi {{firstName}}, quick thought."));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-unfilled-placeholder");
    expect(v[0].severity).toBe("block");
  });
  it("flags a leftover [square] token", async () => {
    const v = await noUnfilledPlaceholder(run("I loved what [company] is doing."));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-unfilled-placeholder");
  });
  it("flags every distinct leftover token", async () => {
    const v = await noUnfilledPlaceholder(
      run("Hi {{firstName}}, [company] and {role} caught my eye."),
    );
    expect(v).toHaveLength(3);
  });
  it("passes a fully-rendered email", async () => {
    expect(
      await noUnfilledPlaceholder(run("Hi Dana, Northwind Robotics caught my eye.")),
    ).toEqual([]);
  });
  it("flags Outreach/Salesloft %field%, (( )) and $field$ merge styles", async () => {
    const v = await noUnfilledPlaceholder(
      run("Hi %firstName%, saw ((company)) is hiring a $role$."),
    );
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.rule === "no-unfilled-placeholder")).toBe(true);
  });
  it("does not mistake a real dollar figure or percentage for a token", async () => {
    expect(
      await noUnfilledPlaceholder(
        run("You raised $4.2M and grew 30% last year."),
      ),
    ).toEqual([]);
  });
});

describe("requiredCTA", () => {
  it("passes when a call-to-action is present", async () => {
    expect(await requiredCTA(run("Worth a quick call next week?"))).toEqual([]);
  });
  it("flags an email with no CTA, block severity", async () => {
    const v = await requiredCTA(run("Thought you would find this interesting."));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("required-cta");
    expect(v[0].severity).toBe("block");
  });
  it("honors caller-supplied CTA markers", async () => {
    expect(
      await requiredCTA(run("Reply STOP to opt out."), { markers: ["reply stop"] }),
    ).toEqual([]);
  });
  it("blocks a no-CTA email that merely contains a marker substring", async () => {
    const v = await requiredCTA(run("This is worth a read for your team."));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("required-cta");
    expect(v[0].severity).toBe("block");
  });
  it("passes an explicit imperative ask", async () => {
    expect(await requiredCTA(run("Reply if interested."))).toEqual([]);
  });
  it("passes an imperative booking ask", async () => {
    expect(await requiredCTA(run("Grab 15 minutes on my calendar here."))).toEqual(
      [],
    );
  });

  // Fix wave 2 FIX 2 — soft-question asks must PASS. A "?"-bearing sentence
  // carrying a time/meeting/response marker is a real CTA.
  const softAsks = [
    "Would 15 minutes Thursday work?",
    "Thursday at 2 work for you?",
    "Any chance you're around Thursday?",
    "Mind if I send a quick overview?",
    "Is your team the right place to start?",
  ];
  for (const ask of softAsks) {
    it(`passes the soft-question ask: "${ask}"`, async () => {
      expect(await requiredCTA(run(ask))).toEqual([]);
    });
  }

  // Fix wave 2 FIX 2 — verb-initial homographs (verb used as a noun/statement,
  // no ask directed at the reader) must FLAG.
  const verbInitialStatements = [
    "Download volumes tripled last quarter.",
    "Connect the two systems and errors dropped.",
    "Schedule slippage was the theme.",
    "Register growth was flat.",
  ];
  for (const s of verbInitialStatements) {
    it(`flags the verb-initial statement (no ask): "${s}"`, async () => {
      const v = await requiredCTA(run(s));
      expect(v).toHaveLength(1);
      expect(v[0].rule).toBe("required-cta");
      expect(v[0].severity).toBe("block");
    });
  }

  // Fix wave 2 FIX 3 — pin "imperative at the clause start, not a loose
  // substring" so a future refactor to .includes() cannot silently regress.
  it("does not accept an imperative verb used mid-sentence as a noun", async () => {
    const v = await requiredCTA(run("Our reply rates doubled after the change."));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("required-cta");
  });
  it("accepts an imperative ask only when it leads the clause", async () => {
    expect(await requiredCTA(run("Reply with a time that works for you."))).toEqual(
      [],
    );
  });
});

describe("lengthCap", () => {
  it("flags output over the word cap with warn severity", async () => {
    const v = await lengthCap(run("one two three four five six seven eight"), {
      maxWords: 5,
    });
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("length-cap");
    expect(v[0].severity).toBe("warn");
  });
  it("passes output within the cap", async () => {
    expect(
      await lengthCap(run("one two three"), { maxWords: 5 }),
    ).toEqual([]);
  });
});

describe("outbound archetype exports", () => {
  it("exports the three rule functions as an array", () => {
    expect(outboundRuleFns).toHaveLength(3);
    expect(outboundRuleFns.every((f) => typeof f === "function")).toBe(true);
  });
  it("exposes a name->RuleFn registry", () => {
    expect(Object.keys(outboundRules).sort()).toEqual([
      "length-cap",
      "no-unfilled-placeholder",
      "required-cta",
    ]);
  });
  it("default config names the archetype, rules, rubric, gateN", () => {
    expect(outboundConfig.archetype).toBe("outbound");
    expect(outboundConfig.gateN).toBeGreaterThan(0);
    expect(outboundConfig.rubric).toBe(outboundRubric);
    expect(outboundConfig.rules.map((r) => r.name).sort()).toEqual([
      "length-cap",
      "no-unfilled-placeholder",
      "required-cta",
    ]);
  });
  it("rubric carries relevance and specificity", () => {
    const names = outboundRubric.dimensions.map((d) => d.name);
    expect(names).toContain("relevance");
    expect(names).toContain("specificity");
  });
});

describe("outbound fixtures", () => {
  async function allViolations(r: AgentRun) {
    const out = [];
    for (const fn of outboundRuleFns) out.push(...(await fn(r)));
    return out;
  }
  it("passing fixture produces no violations", async () => {
    expect(await allViolations(passing)).toEqual([]);
  });
  it("failing fixture trips a placeholder block", async () => {
    const v = await allViolations(failing);
    expect(v.some((x) => x.rule === "no-unfilled-placeholder")).toBe(true);
    expect(v.some((x) => x.severity === "block")).toBe(true);
  });
});
