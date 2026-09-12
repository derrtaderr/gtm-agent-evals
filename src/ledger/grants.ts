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
import { GrantRefused, InsufficientEvidence } from "./errors.js";
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
  /** Surfaced to the operator BEFORE they type the confirmation. Warnings never
   *  block — they exist so the confirmation is informed. */
  onWarn?: (message: string) => void;
};

/** The runs a grant rests on that were recorded BEFORE the agent's current
 *  registration — that is, before the config now on file existed.
 *
 *  This is the honest half of a known hole (README, "What the ledger does not
 *  know yet"). A TelemetryEvent carries no config hash, so the platform cannot
 *  say which configuration produced a given run. What it CAN say, with data
 *  already in the store, is that a run predates the current registration, which
 *  makes it prior-era evidence by definition: whatever produced it, it was not
 *  the config on file now. */
export function priorEraRuns(
  agent: AgentRecord,
  events: TelemetryEvent[],
  runIds: string[],
): TelemetryEvent[] {
  // Only meaningful once a rotation has actually happened. On a FIRST
  // registration `configSince === registeredAt`, and an agent's runs almost
  // always predate the day somebody got around to registering it — warning
  // there would fire on every first grant and teach operators to ignore the
  // warning, which costs more than it buys.
  if (agent.configSince === agent.registeredAt) return [];
  const boundary = Date.parse(agent.configSince);
  if (Number.isNaN(boundary)) return [];
  return events.filter(
    (e) => runIds.includes(e.runId) && Date.parse(e.timestamp) < boundary,
  );
}

/** Build a grant, or refuse with the reason. Every refusal names what would fix
 *  it, because the operator reading it is mid-promotion and the alternative is
 *  guessing. */
/** Emit the prior-era caveat, if there is one. Called before every refusal path
 *  in createGrant, so the caveat reaches the operator while the decision is
 *  still theirs to make. */
function warnOnPriorEraEvidence(
  agent: AgentRecord,
  events: TelemetryEvent[],
  runIds: string[],
  onWarn: ((message: string) => void) | undefined,
): void {
  if (!onWarn) return;
  const priorEra = priorEraRuns(agent, events, runIds);
  if (priorEra.length === 0) return;
  onWarn(
    `${priorEra.length} of the ${runIds.length} runs this grant rests on were recorded BEFORE ` +
      `${agent.id}'s current config was registered (${agent.configSince}), so they were not produced by ` +
      `the configuration now on file (${agent.configHash}): ` +
      `${priorEra.map((e) => e.runId).join(" ")}. ` +
      `The platform cannot yet tell which config produced a run — see the config-lineage ` +
      `limitation in the README. Confirm only if you know those runs still represent this agent.`,
  );
}

export function createGrant(
  input: CreateGrantInput,
  options: CreateGrantOptions = {},
): AutonomyGrant {
  const { agent, tier, events, confirm, grantedBy } = input;

  if (tier === SUPERVISED) {
    throw new GrantRefused(
      `"${SUPERVISED}" is the floor every agent already has, not a tier to grant. ` +
        `Grant "advisory" or "auto".`,
    );
  }
  // The evidence is read and any caveat about it is emitted BEFORE the first
  // refusal, because a warning that arrives after the decision is not a warning.
  // In the one-command flow the operator types the confirmation phrase and the
  // tool answers; if the caveat only printed on the success path, the phrase
  // would have been typed uninformed, and a refused or dry attempt — exactly the
  // attempt somebody makes while deciding — would print nothing at all.
  const streak = agentStreak(events, agent);
  const own = agentEvents(events, agent);
  const runIds = own.slice(own.length - streak).map((e) => e.runId);
  warnOnPriorEraEvidence(agent, events, runIds, options.onWarn);

  if (typeof grantedBy !== "string" || grantedBy.length === 0) {
    throw new GrantRefused("grant: --granted-by is required; a grant with no human on it is not a grant.");
  }

  const required = confirmationPhrase(agent.id, tier);
  if (confirm !== required) {
    throw new GrantRefused(
      `grant: confirmation does not match. Re-run with --confirm "${required}" ` +
        `(typed exactly) to promote ${agent.id} to ${tier}.`,
    );
  }

  if (!clearedForAutonomy(streak, agent.gateN)) {
    const why =
      agent.configIds.length === 0
        ? ` The agent has no eval configs associated, so no run can be attributed to it.`
        : "";
    throw new InsufficientEvidence(
      `grant: ${agent.id} has a clean-run streak of ${streak}, short of its gateN of ` +
        `${agent.gateN}.${why} The streak is what makes an agent eligible; it is not granted around.`,
    );
  }

  const grantedAt = options.grantedAt ?? new Date().toISOString();

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

/** The exact sentence a human must type to archive one grant. Names the grant
 *  id so a phrase cannot be replayed against a different row. */
export function archiveConfirmationPhrase(id: string): string {
  return `archive ${id}`;
}

export type ArchiveGrantInput = {
  /** Must equal archiveConfirmationPhrase(grant.id) exactly. */
  confirm: string;
  archivedBy: string;
};

export type ArchiveGrantOptions = { archivedAt?: string };

/** Resolve a grant: mark it handled so it stops driving `check`'s exit code.
 *
 *  This is the answer to a revoked grant alarming forever. Deleting the row
 *  would work too and would be much worse — the ledger's whole value is that
 *  "this agent held auto and lost it on the 14th" survives. So archiving
 *  annotates: every field is preserved, the grant stays in every detail view,
 *  and the operator's name and the date go on the record beside it.
 *
 *  An archived grant also confers no tier, which makes this the manual revoke
 *  path as well: archiving a grant that still holds retires it deliberately. */
export function archiveGrant(
  grant: AutonomyGrant,
  input: ArchiveGrantInput,
  options: ArchiveGrantOptions = {},
): AutonomyGrant {
  if (grant.archivedAt) {
    throw new GrantRefused(
      `archive: grant ${grant.id} is already archived (by ${grant.archivedBy ?? "unknown"} ` +
        `on ${grant.archivedAt}).`,
    );
  }
  if (typeof input.archivedBy !== "string" || input.archivedBy.length === 0) {
    throw new GrantRefused(
      "archive: --archived-by is required. Resolving an incident is a human act too, and an " +
        "anonymous resolution is indistinguishable from the alarm never having fired.",
    );
  }
  const required = archiveConfirmationPhrase(grant.id);
  if (input.confirm !== required) {
    throw new GrantRefused(
      `archive: confirmation does not match. Re-run with --confirm "${required}" (typed exactly).`,
    );
  }
  return {
    ...grant,
    archivedAt: options.archivedAt ?? new Date().toISOString(),
    archivedBy: input.archivedBy,
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
