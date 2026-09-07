// The CLI dispatcher. Exports `run(argv, io)` returning an exit code so the
// commands are unit-testable without spawning a process; the bin shim
// (index.ts) is the only place that touches process.argv/process.exit.
//
// Exit codes (see exit.ts, WIRING.md): 0 PASS, 1 usage, 2 unreadable/malformed
// input, 3 BLOCK, 4 REGRESSION. A thrown UsageError is exit 1; any other throw
// fails closed to exit 2 — an unreadable input never looks like a PASS.

import { randomUUID } from "node:crypto";
import {
  evaluate,
  buildRuleRegistry,
  allArchetypeRules,
  makeClaudeProvider,
  record,
  saveGolden,
  loadGoldens,
  regressAll,
  makeJsonlSink,
  readEvents,
  verdictHistory,
  autonomyStreak,
} from "../index.js";
import type {
  AgentRun,
  EvalConfig,
  LLMProvider,
  RuleFn,
  Scores,
  TelemetryEvent,
  Verdict,
} from "../types.js";
import { EXIT, UsageError, exitCodeFor } from "./exit.js";
import { parseArgs } from "./args.js";
import {
  readJsonFile,
  validateConfig,
  validateRun,
  validateFreshPairs,
} from "./load.js";
import { printVerdict, printRegression } from "./print.js";
import { defaultIo, type CliIo } from "./io.js";

export type { CliIo } from "./io.js";

/** Merge the generic engine registry with every archetype's rules so a config's
 *  archetype-specific rule names (`required-cta`, `no-em-dash`, …) resolve. */
function fullRegistry(): Record<string, RuleFn> {
  return { ...buildRuleRegistry(), ...allArchetypeRules };
}

/** A provider that must never run — used in --rules-only mode where the rubric
 *  is stripped, so scoreRun returns {} without touching a provider. If it is
 *  ever called, that is a bug, and throwing fails closed. */
const unusedProvider: LLMProvider = async (): Promise<Scores> => {
  throw new Error("provider invoked in rules-only mode (should be unreachable)");
};

function requireOption(
  options: Record<string, string | boolean>,
  key: string,
  command: string,
): string {
  const v = options[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new UsageError(`${command}: missing required --${key} <path>`);
  }
  return v;
}

/** Load + validate config and run, apply --rules-only, and evaluate. Shared by
 *  the eval and record commands. */
async function evaluateFrom(
  options: Record<string, string | boolean>,
  io: CliIo,
  command: string,
): Promise<{ run: AgentRun; config: EvalConfig; verdict: Verdict; mode: "full" | "rules-only" }> {
  const configPath = requireOption(options, "config", command);
  const runPath = requireOption(options, "run", command);
  const registry = fullRegistry();

  let config = validateConfig(readJsonFile(configPath), Object.keys(registry), (w) =>
    io.err(`warning: ${w}`),
  );
  const run = validateRun(readJsonFile(runPath));

  const rulesOnly = options["rules-only"] === true;
  let provider: LLMProvider;
  if (rulesOnly) {
    config = { ...config, rubric: undefined };
    provider = unusedProvider;
  } else {
    // Keyless is fine: makeClaudeProvider("") rejects at call time, evaluate
    // catches it, and the gate fails closed to BLOCK. The key is read here and
    // never printed or logged.
    provider = makeClaudeProvider(io.env.ANTHROPIC_API_KEY ?? "");
  }

  const verdict = await evaluate(run, config, { registry, provider });
  return { run, config, verdict, mode: rulesOnly ? "rules-only" : "full" };
}

function emitTelemetry(
  options: Record<string, string | boolean>,
  config: EvalConfig,
  run: AgentRun,
  verdict: Verdict,
  durationMs: number,
): void {
  const path = options.telemetry;
  if (typeof path !== "string" || path.length === 0) return;
  const event: TelemetryEvent = {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    configId: config.id ?? config.archetype,
    archetype: config.archetype,
    verdict,
    durationMs,
  };
  void makeJsonlSink(path)(event);
}

async function cmdEval(
  options: Record<string, string | boolean>,
  io: CliIo,
): Promise<number> {
  const start = Date.now();
  const { run, config, verdict, mode } = await evaluateFrom(options, io, "eval");
  emitTelemetry(options, config, run, verdict, Date.now() - start);
  printVerdict(io, config, verdict, mode);
  return verdict.status === "PASS" ? EXIT.PASS : EXIT.BLOCK;
}

async function cmdRecord(
  options: Record<string, string | boolean>,
  io: CliIo,
): Promise<number> {
  const store = requireOption(options, "store", "record");
  const start = Date.now();
  const { run, config, verdict, mode } = await evaluateFrom(options, io, "record");
  emitTelemetry(options, config, run, verdict, Date.now() - start);

  const golden = record(run, verdict);
  saveGolden(golden, store);
  printVerdict(io, config, verdict, mode);
  io.out(`recorded golden ${golden.id} -> ${store}`);
  if (verdict.status !== "PASS") {
    io.err(
      `warning: recorded a non-passing (${verdict.status}) run as a golden — ` +
        `a golden is meant to be a known-good trajectory.`,
    );
  }
  return verdict.status === "PASS" ? EXIT.PASS : EXIT.BLOCK;
}

function cmdRegress(
  options: Record<string, string | boolean>,
  io: CliIo,
): number {
  const store = requireOption(options, "store", "regress");
  const runsPath = requireOption(options, "runs", "regress");

  const goldens = loadGoldens(store);
  const pairs = validateFreshPairs(readJsonFile(runsPath));
  const results = regressAll(
    goldens,
    pairs.map((p) => p.run),
    pairs.map((p) => p.verdict),
  );
  printRegression(io, results);
  return results.some((r) => r.status === "REGRESSION")
    ? EXIT.REGRESSION
    : EXIT.PASS;
}

function cmdReport(
  options: Record<string, string | boolean>,
  io: CliIo,
): number {
  const telemetry = requireOption(options, "telemetry", "report");
  const events = readEvents(telemetry);

  const configIds: string[] = [];
  for (const e of events) {
    if (!configIds.includes(e.configId)) configIds.push(e.configId);
  }

  io.out(`telemetry: ${events.length} event(s) across ${configIds.length} config(s)`);
  for (const id of configIds) {
    const history = verdictHistory(events, id);
    const streak = autonomyStreak(events, id);
    io.out(`${id}`);
    io.out(`  history: ${history.join(" ")}`);
    io.out(`  autonomy streak: ${streak}`);
  }
  return EXIT.PASS;
}

const USAGE = `gtm-agent-evals — eval + regression gate for GTM agents

Commands:
  eval    --config <cfg.json> --run <run.json> [--rules-only] [--telemetry <events.jsonl>]
  record  --config <cfg.json> --run <run.json> --store <goldens.jsonl> [--rules-only] [--telemetry <p>]
  regress --store <goldens.jsonl> --runs <fresh-runs.json>
  report  --telemetry <events.jsonl>

Exit codes: 0 PASS, 1 usage, 2 unreadable/malformed input, 3 BLOCK, 4 REGRESSION.
Full eval needs ANTHROPIC_API_KEY for the rubric; --rules-only runs deterministic rules keylessly.`;

export async function run(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const { command, options } = parseArgs(argv);
  try {
    switch (command) {
      case "eval":
        return await cmdEval(options, io);
      case "record":
        return await cmdRecord(options, io);
      case "regress":
        return cmdRegress(options, io);
      case "report":
        return cmdReport(options, io);
      case "help":
      case "--help":
      case "-h":
        io.out(USAGE);
        return EXIT.PASS;
      default:
        io.err(command ? `unknown command: ${command}` : "no command given");
        io.err(USAGE);
        return EXIT.USAGE;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    io.err(`error: ${msg}`);
    return exitCodeFor(e);
  }
}
