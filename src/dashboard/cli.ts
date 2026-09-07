#!/usr/bin/env node
// Lane F — a small CLI entry, kept separate from Lane E's src/cli. A stranger
// runs it to turn a telemetry JSONL into a standalone HTML dashboard:
//
//   node dist/dashboard/cli.js telemetry/events.jsonl dashboard.html
//   node dist/dashboard/cli.js telemetry/events.jsonl dashboard.html --regression regression.json
//
// The arg parser is pure and unit-tested; main() wires it to generateDashboard.

import { generateDashboard } from "./generate.js";

export type DashboardArgs = {
  telemetryPath: string;
  outPath: string;
  regressionPath?: string;
};

const USAGE =
  "usage: gtm-evals-dashboard <telemetry.jsonl> <out.html> [--regression <results.json>]";

export function parseDashboardArgs(argv: string[]): DashboardArgs {
  const positionals: string[] = [];
  let regressionPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--regression") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`--regression needs a file path\n${USAGE}`);
      }
      regressionPath = value;
      i++;
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length < 2) {
    throw new Error(`missing telemetry and/or output path\n${USAGE}`);
  }

  return { telemetryPath: positionals[0], outPath: positionals[1], regressionPath };
}

export function main(argv: string[]): void {
  const args = parseDashboardArgs(argv);
  const out = generateDashboard(args.telemetryPath, args.outPath, args.regressionPath);
  process.stdout.write(`wrote ${out}\n`);
}

// Run only when invoked directly, never on import (keeps the module test-safe).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
