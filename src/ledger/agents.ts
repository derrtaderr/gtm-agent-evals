// The agent registry: the platform's first durable subject. One JSONL file, one
// AgentRecord per line, upsert by id — the same store shape as the golden store
// and the telemetry sink, so the whole ledger is files an operator can cat, diff
// and commit.
//
// Reading is fail-loud: a corrupt or wrong-shaped line throws naming the line
// number. A skipped agent line would make that agent's grants unevaluable at
// best and invisible at worst, and an invisible grant is a grant nobody can
// revoke.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentRecord } from "../types.js";

/** The clean-run bar an agent must clear before it is eligible for a higher
 *  tier, when the operator does not set one. Matches the `gateN` in the shipped
 *  example configs so the two surfaces do not disagree by default. */
export const DEFAULT_GATE_N = 5;

export type RegisterAgentInput = {
  id: string;
  name: string;
  description?: string;
  configHash: string;
  modelId: string;
  gateN?: number;
  configIds?: string[];
};

export type RegisterAgentOptions = {
  /** Injectable clock (ISO 8601); defaults to now. */
  registeredAt?: string;
  /** The record already in the store, when re-registering. Supplying it is what
   *  lets the ledger tell a config ROTATION from a first registration: first-seen
   *  is carried forward, and `configSince` moves only when the hash actually
   *  changes. Omitting it makes every re-registration look like a fresh agent. */
  previous?: AgentRecord;
};

/** Build an AgentRecord, refusing anything missing the fields the falsifiers
 *  read. A registry entry with no configHash or modelId cannot support a grant
 *  at all — the two identity falsifiers would be permanently unevaluable — so
 *  it is refused at the door rather than stored as a trap. */
export function registerAgent(
  input: RegisterAgentInput,
  options: RegisterAgentOptions = {},
): AgentRecord {
  requireNonEmpty(input.id, "id");
  requireNonEmpty(input.name, "name");
  requireNonEmpty(input.configHash, "configHash");
  requireNonEmpty(input.modelId, "modelId");
  const now = options.registeredAt ?? new Date().toISOString();
  const prev = options.previous;
  const rotated = prev !== undefined && prev.configHash !== input.configHash;
  return {
    id: input.id,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    configHash: input.configHash,
    modelId: input.modelId,
    gateN: input.gateN ?? DEFAULT_GATE_N,
    configIds: input.configIds ?? [],
    // First-seen never moves; re-registering an agent does not make it new.
    registeredAt: prev?.registeredAt ?? now,
    // The current config's own age. Unchanged when the hash is unchanged, so
    // re-registering to fix a typo in the NAME does not read as a rotation.
    configSince: rotated ? now : (prev?.configSince ?? now),
  };
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`agent registration: "${field}" must be a non-empty string.`);
  }
}

/** Read the whole registry. A missing file is an empty registry, not an error —
 *  an operator who has registered nothing yet is a normal state. */
export function loadAgents(path: string): AgentRecord[] {
  return readJsonlStrict(path, isAgentRecord, "an AgentRecord");
}

/** One agent by id, or undefined when the agent is unknown. Callers must treat
 *  undefined as "unknown agent", never as "agent unchanged". */
export function loadAgent(path: string, id: string): AgentRecord | undefined {
  return loadAgents(path).find((a) => a.id === id);
}

/** Upsert by id. Re-registering an agent whose config hash rotated replaces the
 *  entry, which is exactly what breaks the `config_hash_unchanged` falsifier on
 *  its existing grants — the demotion is the point, not a side effect. */
export function saveAgent(agent: AgentRecord, path: string): void {
  const rest = loadAgents(path).filter((a) => a.id !== agent.id);
  rest.push(agent);
  writeJsonlAtomic(path, rest);
}

function isAgentRecord(v: Record<string, unknown>): boolean {
  return (
    nonEmpty(v.id) &&
    nonEmpty(v.name) &&
    nonEmpty(v.configHash) &&
    nonEmpty(v.modelId) &&
    nonEmpty(v.registeredAt) &&
    nonEmpty(v.configSince) &&
    typeof v.gateN === "number" &&
    Number.isFinite(v.gateN) &&
    Array.isArray(v.configIds)
  );
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Read a JSONL file, validating every line. Blank lines are skipped; a line
 *  that will not parse, or parses into the wrong shape, throws naming the
 *  1-based line number. Shared by the agent and grant stores. */
export function readJsonlStrict<T>(
  path: string,
  isValid: (v: Record<string, unknown>) => boolean,
  what: string,
): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(
        `ledger: malformed JSON on line ${i + 1} of ${path}: ${(e as Error).message}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`ledger: line ${i + 1} of ${path} is not ${what}.`);
    }
    if (!isValid(parsed as Record<string, unknown>)) {
      throw new Error(
        `ledger: line ${i + 1} of ${path} parsed but is not ${what} (missing or wrong-typed required fields).`,
      );
    }
    out.push(parsed as T);
  }
  return out;
}

/** Overwrite a JSONL file atomically: write a sibling temp file, then rename.
 *  A torn ledger is worse than a stale one — half a grant store reads as an
 *  agent having fewer grants than it has. */
export function writeJsonlAtomic(path: string, records: unknown[]): void {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}
