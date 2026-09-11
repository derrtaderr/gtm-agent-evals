// The autonomy tier vocabulary. Three tiers, strictly ordered, defined by where
// the human sits (SPEC.md, Lane G). Deliberately tiny and deliberately data:
// the ordering is the only thing the rest of the ledger needs, and every other
// module asks this one rather than re-deciding what "higher" means.

import type { AutonomyTier } from "../types.js";

/** Every tier, lowest first. Index is the rank. */
export const TIERS: readonly AutonomyTier[] = ["supervised", "advisory", "auto"];

/** The floor. Never granted and never revoked — it is what an agent has when no
 *  grant holds, which is also the safe answer whenever anything is unknown. */
export const SUPERVISED: AutonomyTier = "supervised";

/** Position in the ordering; supervised is 0. */
export function tierRank(tier: AutonomyTier): number {
  return TIERS.indexOf(tier);
}

/** Is this untrusted string exactly one of the tiers? Case-sensitive on
 *  purpose: "AUTO" is a typo, and quietly accepting a typo that lands on the
 *  most permissive tier is the worst possible leniency. */
export function isTier(value: unknown): value is AutonomyTier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The highest tier in the list, or the supervised floor when the list is
 *  empty — which is the case for an agent whose every grant has stopped
 *  holding. */
export function highestTier(tiers: AutonomyTier[]): AutonomyTier {
  let best: AutonomyTier = SUPERVISED;
  for (const t of tiers) {
    if (tierRank(t) > tierRank(best)) best = t;
  }
  return best;
}
