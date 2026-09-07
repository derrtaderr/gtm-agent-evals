// Human-readable rendering of verdicts and regression results. Kept separate
// from the command logic so the wording is easy to read and adjust without
// touching control flow. The CLI prints for a human; the exit code is the
// machine-safe channel.

import type { EvalConfig, RegressionResult, Verdict } from "../types.js";
import type { CliIo } from "./io.js";

export function printVerdict(
  io: CliIo,
  config: EvalConfig,
  verdict: Verdict,
  mode: "full" | "rules-only",
): void {
  const id = config.id ?? config.archetype;
  io.out(`${id} [${config.archetype}]  ->  ${verdict.status}`);
  io.out(`  mode: ${mode}`);

  const blocking = verdict.violations.filter((v) => v.severity === "block").length;
  io.out(`  rules: ${config.rules.length} checked, ${blocking} blocking`);

  if (verdict.scores && Object.keys(verdict.scores).length > 0) {
    const pairs = Object.entries(verdict.scores)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    io.out(`  rubric: ${pairs}`);
  } else if (mode === "rules-only") {
    io.out("  rubric: skipped (--rules-only)");
  } else {
    io.out("  rubric: not scored");
  }

  if (verdict.reasons.length > 0) {
    io.out("  reasons:");
    for (const r of verdict.reasons) io.out(`    - ${r}`);
  }
}

export function printRegression(io: CliIo, results: RegressionResult[]): void {
  for (const r of results) {
    io.out(`${r.goldenId}  ->  ${r.status}`);
    for (const d of r.diffs) {
      io.out(`    ~ ${d.field}`);
    }
  }
  const regressed = results.filter((r) => r.status === "REGRESSION").length;
  const drifted = results.filter((r) => r.status === "DRIFT").length;
  const matched = results.filter((r) => r.status === "MATCH").length;
  io.out(
    `summary: ${results.length} golden(s) — ${matched} MATCH, ${drifted} DRIFT, ${regressed} REGRESSION`,
  );
}
