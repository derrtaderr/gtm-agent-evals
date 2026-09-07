import { createHash } from "node:crypto";
import type { AgentRun, GoldenRecord, Verdict } from "../types.js";

export type RecordOptions = {
  /** Override the derived id. */
  id?: string;
  /** Injectable timestamp; defaults to now (ISO 8601). */
  recordedAt?: string;
};

/** Stable id from archetype + input, so re-recording the same case is idempotent. */
export function goldenId(archetype: string, input: string): string {
  const hash = createHash("sha256")
    .update(archetype)
    .update("\0")
    .update(input)
    .digest("hex")
    .slice(0, 16);
  return `${archetype}-${hash}`;
}

/** Turn a known-good run and its verdict into a GoldenRecord. */
export function record(
  run: AgentRun,
  verdict: Verdict,
  options: RecordOptions = {},
): GoldenRecord {
  return {
    id: options.id ?? goldenId(run.archetype, run.input),
    archetype: run.archetype,
    input: run.input,
    run,
    verdict,
    recordedAt: options.recordedAt ?? new Date().toISOString(),
  };
}
