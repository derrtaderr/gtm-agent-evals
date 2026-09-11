// The re-check: does this grant still hold?
//
// Every falsifier on the grant is evaluated against today's registry and today's
// telemetry, and the grant takes the WORST answer. Worst-wins is the only
// aggregation that is safe here: averaging, majority, or "most falsifiers still
// hold" all produce a VALID grant with a broken premise underneath it, which is
// the failure the ledger exists to catch.
//
// The ordering, strictest first:
//
//   BROKEN       -> REVOKED   a fact the grant depended on was refuted
//   DEGRADED     -> SUSPECT   a fact is weakening
//   UNEVALUABLE  -> SUSPECT   the check could not run; NOT a pass
//   all HOLDS    -> VALID
//
// A grant carrying zero falsifiers is SUSPECT, not VALID. "Nothing to check"
// and "everything checks out" are the same sentence to a naive reducer and
// opposite facts to an operator.

import { runFalsifier, type FalsifierContext } from "./falsifiers.js";
import type {
  AgentRecord,
  AutonomyGrant,
  FalsifierRegistry,
  FalsifierResult,
  GrantCheck,
  GrantStatus,
  TelemetryEvent,
} from "../types.js";

export type CheckDeps = {
  agents: AgentRecord[];
  /** undefined means no telemetry source was configured — distinct from an
   *  empty array, which means a source was read and held no runs. */
  events?: TelemetryEvent[];
  registry: FalsifierRegistry;
  /** Evaluate as of this instant (ISO 8601). */
  asOf: string;
};

/** Worst falsifier wins. There is no path from UNEVALUABLE to VALID. */
export function worstStatus(results: FalsifierResult[]): GrantStatus {
  if (results.length === 0) return "SUSPECT";
  if (results.some((r) => r.status === "BROKEN")) return "REVOKED";
  if (results.some((r) => r.status === "DEGRADED" || r.status === "UNEVALUABLE")) return "SUSPECT";
  return "VALID";
}

/** Re-evaluate one grant. Falsifiers are reported in the order the GRANT lists
 *  them, not the registry's order, so the printed chain matches the decision as
 *  it was written down. */
export function checkGrant(grant: AutonomyGrant, deps: CheckDeps): GrantCheck {
  const ctx: FalsifierContext = {
    grant,
    agent: deps.agents.find((a) => a.id === grant.agentId),
    events: deps.events,
    asOf: deps.asOf,
  };

  const falsifiers: FalsifierResult[] = grant.falsifiers.map((id) => {
    const spec = deps.registry.falsifiers.find((f) => f.id === id);
    if (!spec) {
      // The grant depends on a fact the current registry no longer defines.
      // Dropping it would quietly shrink what the grant is checked against and
      // could turn a SUSPECT grant VALID by deletion, so it is surfaced instead.
      return {
        falsifier: id,
        statement: `(unknown falsifier "${id}")`,
        status: "UNEVALUABLE",
        evidence:
          `this grant depends on falsifier "${id}", which is not in the falsifier registry ` +
          `in use, so the fact it names cannot be checked`,
      };
    }
    return runFalsifier(spec, ctx);
  });

  return {
    grantId: grant.id,
    agentId: grant.agentId,
    tier: grant.tier,
    status: worstStatus(falsifiers),
    falsifiers,
    checkedAt: deps.asOf,
  };
}

/** Re-evaluate every grant in the ledger. */
export function checkGrants(grants: AutonomyGrant[], deps: CheckDeps): GrantCheck[] {
  return grants.map((g) => checkGrant(g, deps));
}
