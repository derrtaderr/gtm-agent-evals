// Granting autonomy. The one place in this platform where a human decision is
// written down, and the one place that refuses to act on its own.
//
// The division of labor matters more than the code: the N-clean-runs gate makes
// an agent ELIGIBLE, and nothing else. A streak is a counter; a grant is a
// decision. createGrant therefore refuses twice — once if the evidence is not
// there, and once if a human has not typed a phrase naming this exact agent and
// this exact tier. A gate that promotes itself has not decided anything.

import { createHash } from "node:crypto";
import { readJsonlStrict, writeJsonlAtomic } from "./agents.js";
import { agentEvents, agentStreak } from "./evidence.js";
import { DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import { isTier, SUPERVISED } from "./tiers.js";
import { clearedForAutonomy } from "../runlog/index.js";
import type {
  AgentRecord,
  AutonomyGrant,
  AutonomyTier,
  FalsifierRegistry,
  TelemetryEvent,
} from "../types.js";

/** The exact sentence a human must type to grant. It names the agent AND the
 *  tier so a phrase copied from one promotion cannot be replayed to promote a
 *  different agent, or the same agent further than intended. */
export function confirmationPhrase(agentId: string, tier: AutonomyTier): string {
  return `grant ${tier} to ${agentId}`;
}

/** Stable id, readable at a glance as agent-tier, unique per grant instant so a
 *  re-earned grant after a revocation is a new row rather than an overwrite. */
export function grantId(agentId: string, tier: AutonomyTier, grantedAt: string): string {
  const hash = createHash("sha256")
    .update(agentId)
    .update("\0")
    .update(tier)
    .update("\0")
    .update(grantedAt)
    .digest("hex")
    .slice(0, 12);
  return `${agentId}-${tier}-${hash}`;
}

export type CreateGrantInput = {
  agent: AgentRecord;
  tier: AutonomyTier;
  /** The evidence stream. Required: a grant with no evidence is not a grant. */
  events: TelemetryEvent[];
  /** Must equal confirmationPhrase(agent.id, tier) exactly. */
  confirm: string;
  grantedBy: string;
  registry?: FalsifierRegistry;
};

export type CreateGrantOptions = {
  /** Injectable clock (ISO 8601); defaults to now. */
  grantedAt?: string;
};

/** Build a grant, or refuse with the reason. Every refusal names what would fix
 *  it, because the operator reading it is mid-promotion and the alternative is
 *  guessing. */
export function createGrant(
  input: CreateGrantInput,
  options: CreateGrantOptions = {},
): AutonomyGrant {
  const { agent, tier, events, confirm, grantedBy } = input;

  if (tier === SUPERVISED) {
    throw new Error(
      `"${SUPERVISED}" is the floor every agent already has, not a tier to grant. ` +
        `Grant "advisory" or "auto".`,
    );
  }
  if (typeof grantedBy !== "string" || grantedBy.length === 0) {
    throw new Error("grant: --granted-by is required; a grant with no human on it is not a grant.");
  }

  const required = confirmationPhrase(agent.id, tier);
  if (confirm !== required) {
    throw new Error(
      `grant: confirmation does not match. Re-run with --confirm "${required}" ` +
        `(typed exactly) to promote ${agent.id} to ${tier}.`,
    );
  }

  const streak = agentStreak(events, agent);
  if (!clearedForAutonomy(streak, agent.gateN)) {
    const why =
      agent.configIds.length === 0
        ? ` The agent has no eval configs associated, so no run can be attributed to it.`
        : "";
    throw new Error(
      `grant: ${agent.id} has a clean-run streak of ${streak}, short of its gateN of ` +
        `${agent.gateN}.${why} The streak is what makes an agent eligible; it is not granted around.`,
    );
  }

  const grantedAt = options.grantedAt ?? new Date().toISOString();
  const own = agentEvents(events, agent);
  const runIds = own.slice(own.length - streak).map((e) => e.runId);

  return {
    id: grantId(agent.id, tier, grantedAt),
    agentId: agent.id,
    tier,
    grantedAt,
    grantedBy,
    evidence: {
      configHash: agent.configHash,
      modelId: agent.modelId,
      streak,
      gateN: agent.gateN,
      runIds,
    },
    falsifiers: (input.registry ?? DEFAULT_FALSIFIER_REGISTRY).falsifiers.map((f) => f.id),
  };
}

/** Read the grant ledger. A corrupt or wrong-shaped line throws naming the line
 *  number — including a line whose `tier` is outside the vocabulary, because an
 *  unrecognized tier is exactly the value that must never be read leniently. */
export function loadGrants(path: string): AutonomyGrant[] {
  return readJsonlStrict<AutonomyGrant>(path, isGrantShape, "an AutonomyGrant");
}

/** Upsert by grant id. Grants are never deleted on revocation: "this agent held
 *  auto and lost it on the 14th" is the most useful line in the file. */
export function saveGrant(grant: AutonomyGrant, path: string): void {
  const rest = loadGrants(path).filter((g) => g.id !== grant.id);
  rest.push(grant);
  writeJsonlAtomic(path, rest);
}

export function grantsForAgent(grants: AutonomyGrant[], agentId: string): AutonomyGrant[] {
  return grants.filter((g) => g.agentId === agentId);
}

function isGrantShape(v: Record<string, unknown>): boolean {
  const s = (x: unknown): x is string => typeof x === "string" && x.length > 0;
  if (!s(v.id) || !s(v.agentId) || !s(v.grantedAt) || !s(v.grantedBy)) return false;
  if (!isTier(v.tier)) return false;
  if (!Array.isArray(v.falsifiers)) return false;
  const e = v.evidence;
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  const ev = e as Record<string, unknown>;
  return (
    s(ev.configHash) &&
    s(ev.modelId) &&
    typeof ev.streak === "number" &&
    typeof ev.gateN === "number" &&
    Array.isArray(ev.runIds)
  );
}
