// Lane F — generate. The only IO in this lane: read the telemetry JSONL (via
// Lane D's readEvents, which fails loud on a corrupt line), optionally read a
// regression-results JSON file, build the view model, render the HTML, and write
// the single self-contained file. A stranger runs this once and opens the output
// in a browser — no server, no build step.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger, RegressionResult } from "../types.js";
import { readEvents } from "../telemetry/jsonl.js";
import { buildViewModel } from "./model.js";
import { renderDashboard } from "./render.js";

export type GenerateOptions = {
  /** per-config gateN so the dashboard can report cleared-for-autonomy; the
   *  telemetry stream does not carry gateN, so the caller supplies it. */
  gateNByConfig?: Record<string, number>;
  /** the autonomy ledger JSON written by `check --out` / `status --out`;
   *  omitted -> no fleet section. */
  ledgerPath?: string;
};

/**
 * Read telemetry (+ optional regression results), render, and write the HTML.
 * Returns the output path written.
 */
export function generateDashboard(
  telemetryPath: string,
  outPath: string,
  regressionPath?: string,
  options: GenerateOptions = {},
): string {
  const events = readEvents(telemetryPath); // missing file -> []
  const regressions = regressionPath ? readRegressionResults(regressionPath) : undefined;

  const vm = buildViewModel(events, {
    regressions,
    gateNByConfig: options.gateNByConfig,
    ...(options.ledgerPath ? { ledger: readLedgerFile(options.ledgerPath) } : {}),
  });
  const html = renderDashboard(vm);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  return outPath;
}

/** Parse a regression-results JSON file into RegressionResult[]. Throws loudly
 *  (never silently drops the section) when the file is not a JSON array. */
export function readRegressionResults(path: string): RegressionResult[] {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `dashboard: regression results file "${path}" must be a JSON array of RegressionResult, ` +
        `got ${parsed === null ? "null" : typeof parsed}`,
    );
  }
  const VALID_STATUS = new Set(["MATCH", "DRIFT", "REGRESSION"]);
  parsed.forEach((item: unknown, i: number) => {
    const r = item as Record<string, unknown>;
    if (
      typeof item !== "object" ||
      item === null ||
      typeof r.goldenId !== "string" ||
      typeof r.status !== "string" ||
      !VALID_STATUS.has(r.status) ||
      !Array.isArray(r.diffs)
    ) {
      throw new Error(
        `dashboard: regression results file "${path}" item #${i} is not a valid RegressionResult ` +
          `(needs a goldenId string, a status of MATCH/DRIFT/REGRESSION, and a diffs array)`,
      );
    }
  });
  return parsed as RegressionResult[];
}

/** Parse a ledger JSON file. Throws loudly rather than rendering an empty fleet:
 *  a dashboard showing no agents because the file was the wrong shape is the
 *  same false-clean reading this repo exists to prevent. */
export function readLedgerFile(path: string): Ledger {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `dashboard: ledger file "${path}" must be a JSON object as written by \`check --out\`, ` +
        `got ${parsed === null ? "null" : typeof parsed}`,
    );
  }
  const l = parsed as Record<string, unknown>;
  if (!Array.isArray(l.agents)) {
    throw new Error(
      `dashboard: ledger file "${path}" has no "agents" array — it is not a ledger. ` +
        `Write one with \`check --out <ledger.json>\`.`,
    );
  }
  if (!Array.isArray(l.orphanGrants)) l.orphanGrants = [];
  return parsed as Ledger;
}
