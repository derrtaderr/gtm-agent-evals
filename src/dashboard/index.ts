// Lane F — dashboard public surface. Folded into the package root (src/index.ts)
// with `export * from "./dashboard/index.js";`. See WIRING.md.

export { buildViewModel, agentView } from "./model.js";
export type {
  DashboardViewModel,
  DashboardSummary,
  ConfigView,
  RegressionView,
  AgentView,
  BuildViewModelOptions,
} from "./model.js";
export { renderDashboard } from "./render.js";
export { escapeHtml } from "./escape.js";
export { generateDashboard, readRegressionResults, readLedgerFile } from "./generate.js";
export type { GenerateOptions } from "./generate.js";
export { parseDashboardArgs } from "./cli.js";
export type { DashboardArgs } from "./cli.js";
