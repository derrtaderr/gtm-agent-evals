// Lane G — the autonomy ledger. The layer that answers "what may this agent do
// unattended, and what is the evidence" as a durable, revocable decision rather
// than a per-run verdict.

export { TIERS, SUPERVISED, tierRank, isTier, highestTier } from "./tiers.js";
export {
  registerAgent,
  saveAgent,
  loadAgents,
  loadAgent,
  readJsonlStrict,
  writeJsonlAtomic,
  DEFAULT_GATE_N,
} from "./agents.js";
export type { RegisterAgentInput, RegisterAgentOptions } from "./agents.js";
export { agentEvents, agentStreak, lastEvent } from "./evidence.js";
export {
  runEra,
  countsTowardEligibility,
  currentEraStreak,
  eligibilityEvidence,
} from "./era.js";
export type { RunEra, StreakBoundary, EligibilityEvidence } from "./era.js";
export {
  CHECKS,
  DEFAULT_FALSIFIER_REGISTRY,
  loadFalsifierRegistry,
  runFalsifier,
} from "./falsifiers.js";
export type { FalsifierContext, FalsifierCheck, FalsifierOutcome } from "./falsifiers.js";
export {
  confirmationPhrase,
  createGrant,
  grantId,
  saveGrant,
  loadGrants,
  grantsForAgent,
  priorEraRuns,
  archiveGrant,
  archiveConfirmationPhrase,
} from "./grants.js";
export type {
  CreateGrantInput,
  CreateGrantOptions,
  ArchiveGrantInput,
  ArchiveGrantOptions,
} from "./grants.js";
export { GrantRefused, InsufficientEvidence } from "./errors.js";
export { checkGrant, checkGrants, worstStatus } from "./check.js";
export type { CheckDeps } from "./check.js";
export { buildLedger, ledgerEntry } from "./status.js";
export type { LedgerDeps } from "./status.js";
export { renderLedgerTable, renderAgentDetail, renderCheckReport } from "./render.js";
export type { LedgerIo } from "./render.js";
