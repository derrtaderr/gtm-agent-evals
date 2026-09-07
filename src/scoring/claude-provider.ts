import Anthropic from "@anthropic-ai/sdk";
import type { AgentRun, LLMProvider, Scores } from "../types.js";
import { parseScores } from "./index.js";

/** Sends the scoring prompt to the model and returns the raw reply text.
 *  Injectable so tests exercise parse + fail-closed paths without the network. */
export type ClaudeSend = (prompt: string) => Promise<string>;

export type ClaudeProviderOpts = {
  /** Model id; defaults to claude-opus-5. */
  model?: string;
  /** Override the transport (tests inject a fake; real path builds one from the key). */
  send?: ClaudeSend;
};

function buildPrompt(run: AgentRun, dimensions: string[]): string {
  const trajectory =
    run.steps && run.steps.length > 0
      ? "\n\nTRAJECTORY:\n" +
        run.steps
          .map((s) => `- ${s.kind}${s.name ? `(${s.name})` : ""}: ${s.content}`)
          .join("\n")
      : "";
  return (
    `You are grading a GTM agent run of archetype "${run.archetype}".\n` +
    `Score it 1-10 on each of these dimensions: ${dimensions.join(", ")}.\n` +
    `Reply with ONLY a JSON object mapping each dimension name to its number.\n\n` +
    `TASK:\n${run.input}\n\nOUTPUT:\n${run.output}${trajectory}`
  );
}

function defaultSend(apiKey: string, model: string): ClaudeSend {
  return async (prompt: string): Promise<string> => {
    if (!apiKey) {
      throw new Error("No Anthropic API key: cannot score (failing closed).");
    }
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  };
}

/** A real LLM scorer. Fails CLOSED: a missing key, a transport error, or an
 *  unparseable reply all REJECT — the provider never returns a partial or a zero,
 *  so the gate can BLOCK. */
export function makeClaudeProvider(apiKey: string, opts: ClaudeProviderOpts = {}): LLMProvider {
  const model = opts.model ?? "claude-opus-5";
  const send = opts.send ?? defaultSend(apiKey, model);
  return async (run: AgentRun, dimensions: string[]): Promise<Scores> => {
    const text = await send(buildPrompt(run, dimensions));
    return parseScores(text, dimensions);
  };
}
