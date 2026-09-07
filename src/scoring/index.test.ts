import { describe, it, expect, vi } from "vitest";
import { scoreRun, parseScores, makeClaudeProvider, makeFakeProvider } from "./index.js";
import type { AgentRun } from "../types.js";

const run: AgentRun = {
  archetype: "content",
  input: "write a cold email",
  output: "Hi there, quick note about your workflow.",
};

const rubric = { dimensions: [{ name: "relevance", threshold: 7 }] };

describe("scoreRun", () => {
  it("passes the run and dimension names to the provider and returns its scores", async () => {
    const provider = vi.fn(async () => ({ relevance: 8 }));
    const scores = await scoreRun(run, rubric, provider);
    expect(provider).toHaveBeenCalledWith(run, ["relevance"]);
    expect(scores).toEqual({ relevance: 8 });
  });

  it("skips the provider when there is no rubric", async () => {
    const provider = vi.fn(async () => ({}));
    expect(await scoreRun(run, undefined, provider)).toEqual({});
    expect(provider).not.toHaveBeenCalled();
  });

  it("skips the provider when the rubric has zero dimensions", async () => {
    const provider = vi.fn(async () => ({}));
    expect(await scoreRun(run, { dimensions: [] }, provider)).toEqual({});
    expect(provider).not.toHaveBeenCalled();
  });

  it("propagates a provider rejection (fails closed, no swallowing)", async () => {
    const provider = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(scoreRun(run, rubric, provider)).rejects.toThrow(/network down/);
  });
});

describe("parseScores (fail closed)", () => {
  it("parses a clean JSON object of numeric scores", () => {
    expect(parseScores('{"relevance": 8, "specificity": 6}', ["relevance", "specificity"])).toEqual({
      relevance: 8,
      specificity: 6,
    });
  });

  it("throws when the response contains no JSON object", () => {
    expect(() => parseScores("I cannot score this.", ["relevance"])).toThrow(/no json/i);
  });

  it("throws on a non-numeric score", () => {
    expect(() => parseScores('{"relevance": "high"}', ["relevance"])).toThrow(/non-numeric/i);
  });

  it("throws when a requested dimension is missing from the response", () => {
    expect(() => parseScores('{"relevance": 8}', ["relevance", "specificity"])).toThrow(/specificity/i);
  });
});

describe("makeFakeProvider", () => {
  it("returns the fixed scores it was configured with", async () => {
    const p = makeFakeProvider({ relevance: 9 });
    expect(await p(run, ["relevance"])).toEqual({ relevance: 9 });
  });

  it("throws for a requested dimension it has no score for (deterministic fail closed)", async () => {
    const p = makeFakeProvider({ relevance: 9 });
    await expect(p(run, ["specificity"])).rejects.toThrow(/specificity/i);
  });
});

describe("makeClaudeProvider (fail closed)", () => {
  it("rejects when no API key is available, never returning a partial or zero", async () => {
    const provider = makeClaudeProvider("");
    await expect(provider(run, ["relevance"])).rejects.toThrow(/api key/i);
  });

  it("propagates a transport error as a rejection (fails closed)", async () => {
    const provider = makeClaudeProvider("sk-test", {
      send: async () => {
        throw new Error("503 upstream");
      },
    });
    await expect(provider(run, ["relevance"])).rejects.toThrow(/503 upstream/);
  });

  it("parses the model's JSON reply into scores on the happy path", async () => {
    const provider = makeClaudeProvider("sk-test", {
      send: async () => '{"relevance": 8}',
    });
    expect(await provider(run, ["relevance"])).toEqual({ relevance: 8 });
  });

  it("rejects when the model reply cannot be parsed (fails closed, not a zero)", async () => {
    const provider = makeClaudeProvider("sk-test", {
      send: async () => "sorry, no scores",
    });
    await expect(provider(run, ["relevance"])).rejects.toThrow(/no json/i);
  });
});
