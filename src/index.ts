// Public entry point. One package, four lanes' surfaces folded in at integration.
// A consumer imports everything from "gtm-agent-evals".
export * from "./types.js";

// Lane A — engine spine
export { evaluate } from "./evaluate.js";
export type { EvaluateDeps } from "./evaluate.js";
export { buildRuleRegistry, runRules } from "./rules/index.js";
export type { RuleRegistryDeps } from "./rules/index.js";
export { maxOutputLength } from "./rules/max-output-length.js";
export { requiredMetadataField } from "./rules/required-metadata-field.js";
export { forbiddenSubstring } from "./rules/forbidden-substring.js";
export { scoreRun, parseScores, makeFakeProvider, makeClaudeProvider } from "./scoring/index.js";
export type { ClaudeSend, ClaudeProviderOpts } from "./scoring/index.js";
export { evaluateGate } from "./gate/index.js";
export { computeStreak, clearedForAutonomy, readRuns, appendRun } from "./runlog/index.js";

// Lane C — three worked GTM archetypes (content, outbound, research)
export * from "./archetypes/index.js";

// Lane B — golden-trajectory regression
export * from "./regression/index.js";

// Lane D — vendor-agnostic telemetry
export * from "./telemetry/index.js";
