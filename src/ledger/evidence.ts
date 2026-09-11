// The evidence stream, read per AGENT rather than per config. Telemetry is
// keyed by configId; an agent may own several configs, so every question the
// ledger asks ("what is this agent's streak", "has it blocked since the grant")
// is the existing per-config question widened by the agent's configIds mapping.
//
// The widening is not cosmetic. An agent whose outbound config blocked while its
// research config kept passing has NOT got a clean streak, and a per-config
// reading would say it did. The streak is the agent's, so a BLOCK anywhere in
// the agent's evidence resets it.

import { chronologicalEvents } from "../telemetry/query.js";
import type { AgentRecord, TelemetryEvent } from "../types.js";

/** Every telemetry event attributable to this agent, oldest first. An agent
 *  with no configIds has no attributable evidence — that is the honest empty,
 *  not a reason to fall back to "all events". */
export function agentEvents(events: TelemetryEvent[], agent: AgentRecord): TelemetryEvent[] {
  return chronologicalEvents(events.filter((e) => agent.configIds.includes(e.configId)));
}

/** The agent's consecutive-clean-run streak: the existing N-clean-runs gate,
 *  counted across the agent's whole evidence stream. A BLOCK in ANY of its
 *  configs resets it. */
export function agentStreak(events: TelemetryEvent[], agent: AgentRecord): number {
  const own = agentEvents(events, agent);
  let streak = 0;
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i].verdict.status === "PASS") streak++;
    else break;
  }
  return streak;
}

/** The agent's newest run, or undefined when it has none. */
export function lastEvent(
  events: TelemetryEvent[],
  agent: AgentRecord,
): TelemetryEvent | undefined {
  const own = agentEvents(events, agent);
  return own.length > 0 ? own[own.length - 1] : undefined;
}
