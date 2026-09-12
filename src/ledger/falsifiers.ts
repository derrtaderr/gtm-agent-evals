// The falsifier registry: the facts that must stay true for an autonomy grant to
// stay valid.
//
// The design rule the rest of this module exists to enforce: a falsifier is
// DATA. A registry entry names an id, a human-readable statement, a `check`
// function by id, and that check's thresholds. Retuning "how stale is too stale"
// is an edit to a JSON file. Teaching the ledger a genuinely new KIND of fact is
// a function here plus a registry entry naming it.
//
// Two fail-closed rules, both tested:
//
//   1. A registry naming a check id that does not exist is a load-time REFUSAL.
//      A skipped check reads as VALID downstream, and a grant that is valid
//      because nobody looked is the exact false pass this platform exists to
//      prevent.
//   2. A check that cannot run — agent missing from the registry, no telemetry
//      supplied, no configs to attribute runs to, or the check itself throwing —
//      returns UNEVALUABLE. Nothing anywhere converts UNEVALUABLE into HOLDS.

import { agentEvents } from "./evidence.js";
import type {
  AgentRecord,
  AutonomyGrant,
  FalsifierRegistry,
  FalsifierResult,
  FalsifierSpec,
  FalsifierStatus,
  ReviewRecord,
  TelemetryEvent,
} from "../types.js";

/** Everything a check is allowed to look at. `agent` undefined means the grant
 *  names an agent the registry does not have; `events` undefined means no
 *  telemetry source was configured at all. Those two are deliberately distinct
 *  from "the agent exists and has no runs" — collapsing them is how a grant
 *  nobody has evidence for comes to look healthy. */
export type FalsifierContext = {
  grant: AutonomyGrant;
  agent?: AgentRecord;
  events?: TelemetryEvent[];
  /** The review log. `undefined` means no reviews source was configured, which
   *  is distinct from "a source was read and holds no reviews" for exactly the
   *  same reason `events` makes that distinction: the first is a check that
   *  could not run, the second is a fact. */
  reviews?: ReviewRecord[];
  /** Evaluate as of this instant (ISO 8601), so runs are reproducible. */
  asOf: string;
};

/** A check answers only "what is the status, and what moved it". The id and the
 *  statement come from the registry entry, never from the code, so the sentence
 *  an operator reads is the sentence they can edit. */
export type FalsifierOutcome = { status: FalsifierStatus; evidence: string };
export type FalsifierCheck = (spec: FalsifierSpec, ctx: FalsifierContext) => FalsifierOutcome;

const DAY_MS = 86_400_000;

function unevaluableIdentity(ctx: FalsifierContext): FalsifierOutcome | undefined {
  if (!ctx.agent) {
    return {
      status: "UNEVALUABLE",
      evidence: `agent "${ctx.grant.agentId}" is not in the agent registry, so what it is today cannot be compared to what it was at grant time`,
    };
  }
  return undefined;
}

function unevaluableEvidence(ctx: FalsifierContext): FalsifierOutcome | undefined {
  const identity = unevaluableIdentity(ctx);
  if (identity) return identity;
  if (ctx.events === undefined) {
    return {
      status: "UNEVALUABLE",
      evidence: "no telemetry source was supplied, so no run evidence could be read",
    };
  }
  if (ctx.agent!.configIds.length === 0) {
    return {
      status: "UNEVALUABLE",
      evidence: `agent "${ctx.grant.agentId}" has no eval configs associated, so no run can be attributed to it`,
    };
  }
  return undefined;
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}

function numberParam(spec: FalsifierSpec, key: string, fallback: number): number {
  const v = spec.params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The check table. A registry entry's `check` field indexes into this. */
export const CHECKS: Record<string, FalsifierCheck> = {
  /** Identity: is this still the agent the grant was earned on? */
  config_hash: (_spec, ctx) => {
    const blocked = unevaluableIdentity(ctx);
    if (blocked) return blocked;
    const granted = ctx.grant.evidence.configHash;
    const current = ctx.agent!.configHash;
    if (current === granted) {
      return { status: "HOLDS", evidence: `config hash is still ${granted}` };
    }
    return {
      status: "BROKEN",
      evidence: `config hash is ${current}; the grant was earned on ${granted}`,
    };
  },

  model_id: (_spec, ctx) => {
    const blocked = unevaluableIdentity(ctx);
    if (blocked) return blocked;
    const granted = ctx.grant.evidence.modelId;
    const current = ctx.agent!.modelId;
    if (current === granted) {
      return { status: "HOLDS", evidence: `model is still ${granted}` };
    }
    return {
      status: "BROKEN",
      evidence: `model is ${current}; the grant was earned on ${granted}`,
    };
  },

  /** Behavior: has the gate blocked this agent since the grant? A BLOCK from
   *  before the grant is already priced into the evidence and is not a break. */
  no_block_since: (_spec, ctx) => {
    const blocked = unevaluableEvidence(ctx);
    if (blocked) return blocked;
    const since = Date.parse(ctx.grant.grantedAt);
    const offenders = agentEvents(ctx.events!, ctx.agent!).filter(
      (e) => e.verdict.status === "BLOCK" && Date.parse(e.timestamp) >= since,
    );
    if (offenders.length === 0) {
      return {
        status: "HOLDS",
        evidence: `no BLOCK recorded for this agent since the grant on ${ctx.grant.grantedAt}`,
      };
    }
    const first = offenders[0];
    return {
      status: "BROKEN",
      evidence:
        `run ${first.runId} (config ${first.configId}) BLOCKed on ${first.timestamp}, ` +
        `after the grant on ${ctx.grant.grantedAt}` +
        (offenders.length > 1 ? `; ${offenders.length} BLOCKs in total since` : ""),
    };
  },

  /** Decay: does a clean run recent enough to still describe this agent exist?
   *  This one never BREAKS. Silence is a reason to re-check, not proof of a
   *  failure, and treating it as proof would revoke grants for agents that
   *  simply had a quiet week. */
  evidence_freshness: (spec, ctx) => {
    const blocked = unevaluableEvidence(ctx);
    if (blocked) return blocked;
    const window = numberParam(spec, "suspectAfterDays", 14);
    const passes = agentEvents(ctx.events!, ctx.agent!).filter(
      (e) => e.verdict.status === "PASS" && Date.parse(e.timestamp) >= Date.parse(ctx.grant.grantedAt),
    );
    const newest = passes[passes.length - 1];
    if (newest) {
      const age = daysBetween(newest.timestamp, ctx.asOf);
      if (age > window) {
        return {
          status: "DEGRADED",
          evidence: `newest clean run is ${age.toFixed(1)} days old, past the ${window}-day freshness window`,
        };
      }
      return {
        status: "HOLDS",
        evidence: `newest clean run is ${age.toFixed(1)} days old, inside the ${window}-day window`,
      };
    }
    const sinceGrant = daysBetween(ctx.grant.grantedAt, ctx.asOf);
    if (sinceGrant > window) {
      return {
        status: "DEGRADED",
        evidence: `no clean run recorded in the ${sinceGrant.toFixed(1)} days since the grant, past the ${window}-day window`,
      };
    }
    return {
      status: "HOLDS",
      evidence: `grant is ${sinceGrant.toFixed(1)} days old; the ${window}-day window has not elapsed`,
    };
  },

  /** Attention: has somebody INDEPENDENT examined this agent since the grant,
   *  recently enough to still mean something?
   *
   *  The only falsifier here whose evidence is a person rather than a machine.
   *  The other four can all hold while an agent drifts somewhere none of them
   *  look. A BLOCK review BREAKS the grant outright — a human saying "this
   *  should not be running unattended" is the strongest evidence the ledger can
   *  hold, and a later BLESS from somebody else does not age it out. Clearing a
   *  BLOCK is a human act: archive the grant, then re-grant it. */
  review_freshness: (spec, ctx) => {
    const blocked = unevaluableIdentity(ctx);
    if (blocked) return blocked;
    if (ctx.reviews === undefined) {
      return {
        status: "UNEVALUABLE",
        evidence:
          "no reviews source was supplied, so no independent review could be read — " +
          "this is not the same as nobody having reviewed",
      };
    }
    const window = numberParam(spec, "maxReviewAgeDays", 30);
    const since = Date.parse(ctx.grant.grantedAt);
    // Reviews of THIS grant's era only. A blessing recorded before the grant
    // examined a different decision and cannot vouch for this one.
    const own = ctx.reviews
      .filter((r) => r.agentId === ctx.grant.agentId && Date.parse(r.timestamp) >= since)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const blocking = own.find((r) => r.verdict === "BLOCK");
    if (blocking) {
      return {
        status: "BROKEN",
        evidence:
          `${blocking.reviewerId} recorded a BLOCK review on ${blocking.timestamp} ` +
          `(${blocking.evidence})${blocking.note ? `: ${blocking.note}` : ""}`,
      };
    }

    const newest = own[own.length - 1];
    if (!newest) {
      return {
        status: "DEGRADED",
        evidence:
          `no independent review recorded since the grant on ${ctx.grant.grantedAt}; ` +
          `this grant rests on machine evidence alone`,
      };
    }
    const age = daysBetween(newest.timestamp, ctx.asOf);
    if (age > window) {
      return {
        status: "DEGRADED",
        evidence:
          `newest review (${newest.reviewerId}, ${newest.evidence}) is ${age.toFixed(1)} days ` +
          `old, past the ${window}-day window`,
      };
    }
    return {
      status: "HOLDS",
      evidence:
        `${newest.reviewerId} blessed this agent ${age.toFixed(1)} days ago ` +
        `(${newest.evidence}), inside the ${window}-day window`,
    };
  },
};

/** The four falsifiers a grant carries unless the operator supplies their own
 *  registry. Statements are written for the operator reading a REVOKED line at
 *  8am, not for the function below them. */
export const DEFAULT_FALSIFIER_REGISTRY: FalsifierRegistry = {
  falsifiers: [
    {
      id: "config_hash_unchanged",
      check: "config_hash",
      statement: "The agent's configuration is still the one this grant was earned on.",
    },
    {
      id: "model_unchanged",
      check: "model_id",
      statement: "The agent is still running on the model this grant was earned on.",
    },
    {
      id: "no_block_since_grant",
      check: "no_block_since",
      statement: "No run by this agent has been BLOCKed since the grant.",
    },
    {
      id: "evidence_not_stale",
      check: "evidence_freshness",
      statement:
        "A clean run is recent enough that this grant's evidence still describes the agent.",
      params: { suspectAfterDays: 14 },
    },
  ],
};

/** Validate an untrusted registry. Every failure here is a refusal: an
 *  unloadable registry must stop the run, because the alternative is checking
 *  fewer facts than the operator thinks are being checked. */
export function loadFalsifierRegistry(raw: unknown): FalsifierRegistry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('falsifier registry must be a JSON object with a "falsifiers" array.');
  }
  const list = (raw as Record<string, unknown>).falsifiers;
  if (!Array.isArray(list)) {
    throw new Error('falsifier registry is missing a "falsifiers" array.');
  }
  const seen = new Set<string>();
  const falsifiers: FalsifierSpec[] = list.map((f, i) => {
    if (typeof f !== "object" || f === null || Array.isArray(f)) {
      throw new Error(`falsifier #${i} must be an object.`);
    }
    const spec = f as Record<string, unknown>;
    if (typeof spec.id !== "string" || spec.id.length === 0) {
      throw new Error(`falsifier #${i} is missing a non-empty "id".`);
    }
    if (typeof spec.statement !== "string" || spec.statement.length === 0) {
      throw new Error(`falsifier "${spec.id}" is missing a non-empty "statement".`);
    }
    if (typeof spec.check !== "string" || !CHECKS[spec.check]) {
      throw new Error(
        `falsifier "${spec.id}" names check "${String(spec.check)}", which is not registered ` +
          `(known: ${Object.keys(CHECKS).join(", ")}). A check that does not exist would be ` +
          `skipped, and a skipped check reads as VALID.`,
      );
    }
    if (seen.has(spec.id)) {
      throw new Error(`falsifier id "${spec.id}" appears twice; one would silently shadow the other.`);
    }
    seen.add(spec.id);
    return {
      id: spec.id,
      check: spec.check,
      statement: spec.statement,
      ...(spec.params !== undefined ? { params: spec.params as Record<string, unknown> } : {}),
    };
  });
  return { falsifiers };
}

/** Run one falsifier and attach its id and statement. A check that throws is
 *  reported as UNEVALUABLE carrying the message — never dropped, and never
 *  allowed to look like a pass. An UNREGISTERED check id throws instead, because
 *  that is an operator configuration error the run must stop on. */
export function runFalsifier(spec: FalsifierSpec, ctx: FalsifierContext): FalsifierResult {
  const check = CHECKS[spec.check];
  if (!check) {
    throw new Error(
      `falsifier "${spec.id}" names check "${spec.check}", which is not registered.`,
    );
  }
  let outcome: FalsifierOutcome;
  try {
    outcome = check(spec, ctx);
  } catch (e) {
    outcome = {
      status: "UNEVALUABLE",
      evidence: `check raised: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { falsifier: spec.id, statement: spec.statement, ...outcome };
}
