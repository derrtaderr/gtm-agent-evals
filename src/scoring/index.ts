import type { AgentRun, LLMProvider, Rubric, Scores } from "../types.js";

export { makeClaudeProvider } from "./claude-provider.js";
export type { ClaudeSend, ClaudeProviderOpts } from "./claude-provider.js";

/** Score a run on the rubric's dimensions via the provider. Returns {} without
 *  touching the provider when there is no rubric or it has no dimensions. Any
 *  provider rejection propagates unchanged so the gate fails closed. */
export async function scoreRun(
  run: AgentRun,
  rubric: Rubric | undefined,
  provider: LLMProvider,
): Promise<Scores> {
  if (!rubric || rubric.dimensions.length === 0) return {};
  return provider(
    run,
    rubric.dimensions.map((d) => d.name),
  );
}

/** Pure parser for an LLM scoring reply. Fails CLOSED: throws (never returns a
 *  partial or a zero) when the reply has no JSON object, a non-numeric score, or
 *  is missing any requested dimension. */
export function parseScores(text: string, dimensions: string[]): Scores {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Provider returned no JSON scores.");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const scores: Scores = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Non-numeric score for "${k}": ${JSON.stringify(v)}`);
    }
    scores[k] = v;
  }
  for (const d of dimensions) {
    if (!(d in scores)) {
      throw new Error(`Provider reply is missing requested dimension "${d}".`);
    }
  }
  return scores;
}

/** A deterministic fake provider for tests. Returns the fixed scores it was
 *  given; if a requested dimension has no configured score it throws, so tests
 *  exercise the same fail-closed contract the real provider must honor. */
export function makeFakeProvider(scores: Scores): LLMProvider {
  return async (_run: AgentRun, dimensions: string[]): Promise<Scores> => {
    const out: Scores = {};
    for (const d of dimensions) {
      if (!(d in scores)) {
        throw new Error(`Fake provider has no score for dimension "${d}".`);
      }
      out[d] = scores[d];
    }
    return out;
  };
}
