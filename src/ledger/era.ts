// Run eras — which version of an agent produced a given run.
//
// This module is the session-2 fix for the hole session 1 could only warn about.
// The old eligibility streak had no config scope, so rotating an agent's
// configuration correctly REVOKED its grant and then let the operator re-grant
// immediately on a streak earned entirely by the previous version. The streak
// was a true number answering the wrong question.
//
// Three rules govern everything below:
//
//   1. ATTRIBUTION IS PROOF. When a run carries an `agentConfigHash`, that hash
//      decides its era and the clock is never consulted. An attributed run from
//      a retired config is prior-era no matter how recent it is.
//   2. THE CLOCK IS INFERENCE, NOT PROOF. An unattributed run (every event
//      written before this version existed) is placed against the agent's
//      `configSince`. A run recorded before the current configuration was
//      registered provably did not come from it. A run recorded after it is
//      counted, but reported as UNVERIFIED everywhere it is counted — see the
//      UNKNOWN-era decision in SPEC.md, Lane G session 2.
//   3. THE WALK IS A TAIL, AND ANYTHING FOREIGN ENDS IT. The streak is the run
//      of eligibility-counting clean runs at the END of the agent's evidence.
//      A BLOCK from any era ends it, and so does a prior-era run — reaching past
//      one would let a retired version of the agent prop up the tail of a
//      current-era streak.
//
// Why not simply exclude every unattributed run: that would zero the streak of
// every operator with an existing telemetry store the moment they upgrade, so
// the tool's first act after an install would be a false claim about their
// fleet. The rotation exploit closes either way, because rotating moves
// `configSince` past every run already on disk.

import { agentEvents } from "./evidence.js";
import type { AgentRecord, TelemetryEvent } from "../types.js";

/** Where a run sits relative to the agent's CURRENT configuration. */
export type RunEra =
  /** Attributed to the config now on file. Verified evidence. */
  | "current"
  /** Attributed to a different config. Authoritatively not current. */
  | "prior"
  /** Unattributed, recorded at or after `configSince`. Counted, unverified. */
  | "unknown-in-window"
  /** Unattributed, recorded before `configSince`. Provably not current. */
  | "unknown-pre-config";

/** Classify one run against one agent. */
export function runEra(event: TelemetryEvent, agent: AgentRecord): RunEra {
  // Rule 1: an attributed run is never second-guessed by the clock.
  if (event.agentConfigHash !== undefined) {
    return event.agentConfigHash === agent.configHash ? "current" : "prior";
  }
  // Rule 2: place it with the only lineage signal the registry carries.
  const boundary = Date.parse(agent.configSince);
  if (Number.isNaN(boundary)) return "unknown-in-window";
  return Date.parse(event.timestamp) < boundary ? "unknown-pre-config" : "unknown-in-window";
}

/** May a run of this era count toward a grant? Only the two eras that are not
 *  provably from a retired configuration. */
export function countsTowardEligibility(era: RunEra): boolean {
  return era === "current" || era === "unknown-in-window";
}

/** Why the eligibility walk stopped, so a refusal can point somewhere. */
export type StreakBoundary = {
  runId: string;
  /** `BLOCK`, or the era of the run that ended the walk. */
  reason: "BLOCK" | RunEra;
};

/** Everything the grant surfaces need to explain what they counted and what they
 *  refused to count. The counts are separated because "3 clean runs" and
 *  "3 clean runs, 2 of which we are taking on trust" are different sentences and
 *  an operator typing a confirmation phrase deserves the second one. */
export type EligibilityEvidence = {
  /** The config-scoped streak — what `eligible` is computed from. */
  streak: number;
  /** The runs making up that streak, oldest first. */
  runIds: string[];
  /** Streak runs carrying the current config hash. Proven. */
  verified: number;
  /** Streak runs counted on the registry's word. Inferred. */
  unverified: number;
  /** Every run in the agent's stream that could not count, whatever its
   *  position — the evidence a refusal names. */
  excluded: TelemetryEvent[];
  /** What ended the walk; absent when the whole stream counted. */
  endedBy?: StreakBoundary;
};

/** Walk the agent's evidence backward from the newest run, counting the clean
 *  current-era tail. */
export function eligibilityEvidence(
  events: TelemetryEvent[],
  agent: AgentRecord,
): EligibilityEvidence {
  const own = agentEvents(events, agent);
  const streakRuns: TelemetryEvent[] = [];
  let verified = 0;
  let unverified = 0;
  let endedBy: StreakBoundary | undefined;

  for (let i = own.length - 1; i >= 0; i--) {
    const e = own[i];
    if (e.verdict.status !== "PASS") {
      endedBy = { runId: e.runId, reason: "BLOCK" };
      break;
    }
    const era = runEra(e, agent);
    if (!countsTowardEligibility(era)) {
      endedBy = { runId: e.runId, reason: era };
      break;
    }
    streakRuns.push(e);
    if (era === "current") verified++;
    else unverified++;
  }

  streakRuns.reverse();
  const counted = new Set(streakRuns.map((e) => e.runId));

  return {
    streak: streakRuns.length,
    runIds: streakRuns.map((e) => e.runId),
    verified,
    unverified,
    excluded: own.filter(
      (e) => !counted.has(e.runId) && !countsTowardEligibility(runEra(e, agent)),
    ),
    ...(endedBy ? { endedBy } : {}),
  };
}

/** The agent's config-scoped clean-run streak. This is the number `eligible` is
 *  computed from and the number `grant` refuses against. */
export function currentEraStreak(events: TelemetryEvent[], agent: AgentRecord): number {
  return eligibilityEvidence(events, agent).streak;
}
