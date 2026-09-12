// The status surface's model: one row per agent answering "what may this agent
// do unattended right now, and what is the evidence."
//
// The effective tier is computed, never stored. A stored tier is a claim that
// drifts from its evidence the moment the evidence moves, which is the failure
// this whole lane exists to fix. It is derived fresh on every read: the highest
// tier whose grant checks VALID, falling back through the lower grants that
// still hold, and to the supervised floor when none does.
//
// SUSPECT does not count as holding. Suspect autonomy is not autonomy — an
// agent whose evidence cannot be evaluated is exactly the agent a human should
// be watching.

import { checkGrant } from "./check.js";
import { agentStreak, lastEvent } from "./evidence.js";
import { grantsForAgent } from "./grants.js";
import { highestTier, SUPERVISED, tierRank } from "./tiers.js";
import { clearedForAutonomy } from "../runlog/index.js";
import type {
  AgentLedgerEntry,
  AgentRecord,
  AutonomyGrant,
  FalsifierRegistry,
  Ledger,
  TelemetryEvent,
} from "../types.js";

export type LedgerDeps = {
  /** undefined means no telemetry source was configured — distinct from an
   *  empty array. With no source the streak is 0 and nothing is eligible,
   *  because an unread evidence stream is not a clean one. */
  events?: TelemetryEvent[];
  registry: FalsifierRegistry;
  asOf: string;
};

/** One agent's row, with the whole evidence chain behind it. */
export function ledgerEntry(
  agent: AgentRecord,
  grants: AutonomyGrant[],
  deps: LedgerDeps,
): AgentLedgerEntry {
  const own = grantsForAgent(grants, agent.id);
  const checks = own.map((g) => checkGrant(g, { ...deps, agents: [agent] }));

  // An archived grant confers nothing. That makes archiving the manual-revoke
  // path as well as the incident-resolution path: retiring a grant that still
  // holds is a deliberate demotion, recorded rather than deleted.
  const holding = checks
    .filter((c) => c.status === "VALID" && !c.archived)
    .map((c) => c.tier);
  const events = deps.events ?? [];
  const streak = deps.events === undefined ? 0 : agentStreak(events, agent);
  const last = deps.events === undefined ? undefined : lastEvent(events, agent);

  const grantedTiers = [...new Set(own.map((g) => g.tier))].sort(
    (a, b) => tierRank(a) - tierRank(b),
  );

  return {
    agentId: agent.id,
    name: agent.name,
    effectiveTier: holding.length > 0 ? highestTier(holding) : SUPERVISED,
    grantedTiers,
    checks,
    streak,
    gateN: agent.gateN,
    eligible: clearedForAutonomy(streak, agent.gateN),
    ...(last ? { lastVerdict: last.verdict.status, lastRunAt: last.timestamp } : {}),
  };
}

/** The whole ledger. Rows follow registry order so the surface is stable across
 *  runs; grants naming an unregistered agent are surfaced as orphans rather than
 *  dropped, because a grant nobody can see is a grant nobody can revoke. */
export function buildLedger(
  agents: AgentRecord[],
  grants: AutonomyGrant[],
  deps: LedgerDeps,
): Ledger {
  const known = new Set(agents.map((a) => a.id));
  return {
    generatedAt: deps.asOf,
    agents: agents.map((a) => ledgerEntry(a, grants, deps)),
    orphanGrants: grants
      .filter((g) => !known.has(g.agentId))
      .map((g) => checkGrant(g, { ...deps, agents })),
  };
}
