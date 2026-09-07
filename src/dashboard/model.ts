// Lane F — dashboard data layer. Pure functions that turn the telemetry the
// sink persisted (plus an optional set of regression results) into a view model
// the render layer serializes to HTML. No IO here; this is unit-testable in
// isolation. Streak/history logic is NOT reimplemented — it is Lane D's query
// API (`verdictHistory`, `autonomyStreak`, `eventsByConfig`), and the gate
// decision is Lane A's `clearedForAutonomy`.

import type {
  TelemetryEvent,
  VerdictStatus,
  RegressionResult,
  RegressionStatus,
} from "../types.js";
import { verdictHistory, autonomyStreak, eventsByConfig } from "../telemetry/query.js";
import { clearedForAutonomy } from "../runlog/index.js";

/** One config's row on the dashboard. */
export type ConfigView = {
  configId: string;
  archetype: string;
  /** chronological PASS/BLOCK list (Lane D verdictHistory) */
  history: VerdictStatus[];
  total: number;
  passCount: number;
  /** current consecutive-PASS tail (Lane D autonomyStreak) */
  streak: number;
  /** the config's N-clean-runs gate, when the caller supplied it */
  gateN?: number;
  /** whether the streak has cleared gateN; undefined when gateN is unknown */
  clearedForAutonomy?: boolean;
  /** the chronologically-latest run's status for this config */
  latestStatus?: VerdictStatus;
  /** the latest run's reasons, joined; shown when the config is currently blocked */
  latestReason?: string;
};

export type RegressionView = {
  goldenId: string;
  status: RegressionStatus;
  diffCount: number;
};

export type DashboardSummary = {
  totalRuns: number;
  passCount: number;
  blockCount: number;
  /** fraction of runs that PASSed, 0..1; 0 on an empty store */
  passRate: number;
  configCount: number;
};

export type DashboardViewModel = {
  summary: DashboardSummary;
  configs: ConfigView[];
  regressions: RegressionView[];
};

export type BuildViewModelOptions = {
  /** regression results to show per golden; omitted -> no regression section */
  regressions?: RegressionResult[];
  /** per-config gateN so the model can report cleared-for-autonomy */
  gateNByConfig?: Record<string, number>;
};

export function buildViewModel(
  events: TelemetryEvent[],
  options: BuildViewModelOptions = {},
): DashboardViewModel {
  const gateNByConfig = options.gateNByConfig ?? {};

  const passCount = events.filter((e) => e.verdict.status === "PASS").length;
  const totalRuns = events.length;

  const configIds = [...new Set(events.map((e) => e.configId))].sort();

  const configs: ConfigView[] = configIds.map((configId) => {
    const own = eventsByConfig(events, configId);
    const history = verdictHistory(events, configId); // chronological (Lane D), also validates timestamps
    const streak = autonomyStreak(events, configId);
    const gateN = gateNByConfig[configId];
    // Newest event for this config, by parsed time. This is a max-by selection,
    // not a reimplementation of streak/history (those come from Lane D above);
    // the timestamps were already validated by the verdictHistory call.
    const newest = own.reduce<TelemetryEvent | undefined>((latest, e) => {
      if (!latest) return e;
      return Date.parse(e.timestamp) >= Date.parse(latest.timestamp) ? e : latest;
    }, undefined);
    const latestStatus = history[history.length - 1];
    return {
      configId,
      archetype: own[0]?.archetype ?? "",
      history,
      total: own.length,
      passCount: history.filter((s) => s === "PASS").length,
      streak,
      gateN,
      clearedForAutonomy:
        gateN === undefined ? undefined : clearedForAutonomy(streak, gateN),
      latestStatus,
      latestReason: newest ? newest.verdict.reasons.join("; ") : undefined,
    };
  });

  const regressions: RegressionView[] = (options.regressions ?? []).map((r) => ({
    goldenId: r.goldenId,
    status: r.status,
    diffCount: r.diffs.length,
  }));

  return {
    summary: {
      totalRuns,
      passCount,
      blockCount: totalRuns - passCount,
      passRate: totalRuns === 0 ? 0 : passCount / totalRuns,
      configCount: configIds.length,
    },
    configs,
    regressions,
  };
}
