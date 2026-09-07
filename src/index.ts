// Public entry point. Each lane re-exports its surface from here as it lands, so
// a consumer imports one package. Lane A (engine) exports the spine below;
// regression / archetypes / telemetry / CLI lanes extend this file.
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
