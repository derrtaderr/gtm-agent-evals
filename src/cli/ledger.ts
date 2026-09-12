// The autonomy-ledger commands: register, grant, check, status.
//
// Kept out of run.ts so the dispatcher stays readable; run.ts owns the switch
// and the exit-code contract, this file owns what each ledger command does.
//
// Every input is an argument. No path, agent id, or threshold is baked in
// anywhere, which is what lets one install serve several fleets and lets every
// test run against a temp directory. `--as-of` pins the clock so a run is
// reproducible; a ledger whose verdicts move because the wall clock moved is a
// ledger nobody can audit.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  loadAgents,
  loadGrants,
  saveAgent,
  saveGrant,
  registerAgent,
  createGrant,
  confirmationPhrase,
  buildLedger,
  ledgerEntry,
  checkGrants,
  grantsForAgent,
  DEFAULT_FALSIFIER_REGISTRY,
  loadFalsifierRegistry,
  renderLedgerTable,
  renderAgentDetail,
  renderCheckReport,
  isTier,
  TIERS,
} from "../ledger/index.js";
import { readEvents } from "../telemetry/jsonl.js";
import type { FalsifierRegistry, Ledger, TelemetryEvent } from "../types.js";
import { EXIT, UsageError, InputError } from "./exit.js";
import { InsufficientEvidence } from "../ledger/errors.js";
import { readJsonFile } from "./load.js";
import type { CliIo } from "./io.js";

type Options = Record<string, string | boolean>;

/** The flags each ledger command accepts. An unrecognized flag is a usage
 *  error, never a silently-ignored token: in a scheduled re-check a typo'd flag
 *  must fail rather than quietly check less than the operator thinks. */
export const LEDGER_OPTIONS: Record<string, readonly string[]> = {
  register: [
    "agents", "id", "name", "description", "model", "config-hash", "eval-configs",
    "gate-n", "as-of",
  ],
  grant: [
    "agents", "grants", "telemetry", "agent", "tier", "confirm", "granted-by",
    "note", "falsifiers", "as-of",
  ],
  check: ["agents", "grants", "telemetry", "falsifiers", "as-of", "out"],
  status: ["agents", "grants", "telemetry", "falsifiers", "agent", "as-of", "out"],
};

// Strict ISO-8601 with an explicit timezone, the same bar telemetry holds its
// timestamps to. A timezone-less --as-of would be read as machine-local time,
// which makes a staleness verdict depend on who ran the check.
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function required(options: Options, key: string, command: string): string {
  const v = options[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new UsageError(`${command}: missing required --${key} <value>`);
  }
  return v;
}

function optional(options: Options, key: string): string | undefined {
  const v = options[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asOf(options: Options): string {
  const raw = optional(options, "as-of");
  if (raw === undefined) return new Date().toISOString();
  if (!ISO_WITH_TZ.test(raw)) {
    throw new InputError(
      `--as-of "${raw}" is not strict ISO-8601 with an explicit timezone ` +
        `(needs a trailing Z or ±HH:MM). Without one it would be read as this ` +
        `machine's local time, and every staleness verdict would depend on who ran the check.`,
    );
  }
  return raw;
}

/** undefined when no --telemetry flag was given, which the falsifiers treat as
 *  "no evidence source configured" and never as "no runs blocked". */
function readTelemetry(options: Options): TelemetryEvent[] | undefined {
  const path = optional(options, "telemetry");
  return path === undefined ? undefined : readEvents(path);
}

function readRegistry(options: Options): FalsifierRegistry {
  const path = optional(options, "falsifiers");
  return path === undefined
    ? DEFAULT_FALSIFIER_REGISTRY
    : loadFalsifierRegistry(readJsonFile(path));
}

function writeLedger(options: Options, ledger: Ledger): void {
  const path = optional(options, "out");
  if (!path) return;
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

export function cmdRegister(options: Options, io: CliIo): number {
  const store = required(options, "agents", "register");
  const agentId = required(options, "id", "register");
  // Read the existing record first. Without it a re-registration looks like a
  // brand-new agent, first-seen resets, and a config ROTATION becomes
  // indistinguishable from an agent nobody had registered yet — which is
  // exactly the distinction the prior-era warning rests on.
  const previous = loadAgents(store).find((a) => a.id === agentId);
  const gateNRaw = optional(options, "gate-n");
  let gateN: number | undefined;
  if (gateNRaw !== undefined) {
    gateN = Number(gateNRaw);
    if (!Number.isFinite(gateN)) {
      throw new UsageError(`register: --gate-n "${gateNRaw}" is not a number.`);
    }
  }

  const configIds = (optional(options, "eval-configs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const agent = registerAgent(
    {
      id: agentId,
      name: required(options, "name", "register"),
      ...(optional(options, "description") ? { description: optional(options, "description") } : {}),
      configHash: required(options, "config-hash", "register"),
      modelId: required(options, "model", "register"),
      ...(gateN !== undefined ? { gateN } : {}),
      configIds,
    },
    { registeredAt: asOf(options), previous },
  );
  saveAgent(agent, store);

  io.out(`registered ${agent.id} (${agent.name}) -> ${store}`);
  io.out(`  model ${agent.modelId}, config ${agent.configHash}, gateN ${agent.gateN}`);
  if (previous && previous.configHash !== agent.configHash) {
    io.out(
      `  config ROTATED from ${previous.configHash} (in place since ${previous.configSince}). ` +
        `Any grant earned on the old hash will be REVOKED by the next \`check\`.`,
    );
  }
  io.out(`  eval configs: ${configIds.length > 0 ? configIds.join(", ") : "(none)"}`);
  if (configIds.length === 0) {
    io.err(
      `warning: ${agent.id} has no eval configs associated (--eval-configs), so no telemetry ` +
        `can be attributed to it. Its streak stays 0 and every evidence falsifier is unevaluable.`,
    );
  }
  return EXIT.PASS;
}

export function cmdGrant(options: Options, io: CliIo): number {
  const agentsPath = required(options, "agents", "grant");
  const grantsPath = required(options, "grants", "grant");
  const agentId = required(options, "agent", "grant");
  const tierRaw = required(options, "tier", "grant");

  if (!isTier(tierRaw)) {
    throw new UsageError(
      `grant: "${tierRaw}" is not an autonomy tier (${TIERS.join(", ")}).`,
    );
  }

  const agent = loadAgents(agentsPath).find((a) => a.id === agentId);
  if (!agent) {
    throw new UsageError(
      `grant: no agent "${agentId}" in ${agentsPath}. Register it first — a grant for an ` +
        `agent nobody registered can never be checked against anything.`,
    );
  }

  // Fail closed on a missing evidence source. Defaulting to [] would produce
  // "streak of 0, short of gateN" — a true sentence that names the wrong cause
  // and sends the operator to look at the agent instead of at their command.
  const events = readTelemetry(options);
  if (events === undefined) {
    throw new InsufficientEvidence(
      `grant: no --telemetry <events.jsonl> supplied, so no evidence could be read for ` +
        `${agent.id}. A grant is a decision about evidence; without a source there is nothing ` +
        `to decide on. This is not the same as the agent having no clean runs.`,
    );
  }

  const grant = createGrant(
    {
      agent,
      tier: tierRaw,
      events,
      confirm: optional(options, "confirm") ?? "",
      grantedBy: optional(options, "granted-by") ?? "",
      registry: readRegistry(options),
    },
    { grantedAt: asOf(options), onWarn: (w) => io.err(`warning: ${w}`) },
  );
  const note = optional(options, "note");
  if (note) grant.evidence.note = note;
  saveGrant(grant, grantsPath);

  io.out(`granted ${grant.tier} to ${grant.agentId}`);
  io.out(`  grant ${grant.id}, by ${grant.grantedBy} at ${grant.grantedAt}`);
  // Two separate facts, printed separately. The runs are what was observed; the
  // config and model are what the agent IS at this instant and what the
  // falsifiers will measure drift against. The old single line ("earned on:
  // streak 3/3, config <hash>") fused them and so asserted a lineage this
  // platform cannot establish — a TelemetryEvent carries no config hash.
  io.out(
    `  evidence: a streak of ${grant.evidence.streak}/${grant.evidence.gateN} clean runs` +
      (grant.evidence.runIds.length > 0 ? ` — ${grant.evidence.runIds.join(" ")}` : ""),
  );
  io.out(
    `  agent at grant time: config ${grant.evidence.configHash}, model ${grant.evidence.modelId} ` +
      `(the baseline the falsifiers compare against)`,
  );
  io.out(
    `  note: run-era config lineage is not tracked yet, so those runs are not proven to have ` +
      `been produced by that config. See "What the ledger does not know yet" in the README.`,
  );
  io.out(`  falsifiers: ${grant.falsifiers.join(", ")}`);
  io.out(`  this grant holds only while those stay true — re-check with \`check\`.`);
  return EXIT.PASS;
}

export function cmdCheck(options: Options, io: CliIo): number {
  const agents = loadAgents(required(options, "agents", "check"));
  const grants = loadGrants(required(options, "grants", "check"));
  const deps = {
    agents,
    events: readTelemetry(options),
    registry: readRegistry(options),
    asOf: asOf(options),
  };

  const checks = checkGrants(grants, deps);
  renderCheckReport(io, checks);
  writeLedger(options, buildLedger(agents, grants, deps));

  return checks.some((c) => c.status !== "VALID") ? EXIT.AUTONOMY : EXIT.PASS;
}

export function cmdStatus(options: Options, io: CliIo): number {
  const agents = loadAgents(required(options, "agents", "status"));
  const grants = loadGrants(required(options, "grants", "status"));
  const deps = {
    events: readTelemetry(options),
    registry: readRegistry(options),
    asOf: asOf(options),
  };

  const ledger = buildLedger(agents, grants, deps);
  const only = optional(options, "agent");
  if (only) {
    const agent = agents.find((a) => a.id === only);
    if (!agent) {
      throw new UsageError(
        `status: no agent "${only}" in the registry ` +
          `(registered: ${agents.map((a) => a.id).join(", ") || "none"}).`,
      );
    }
    renderAgentDetail(io, ledgerEntry(agent, grants, deps), grantsForAgent(grants, only));
  } else {
    renderLedgerTable(io, ledger);
  }
  writeLedger(options, ledger);

  // status REPORTS, it never gates. A revoked grant is news, not a failure of
  // this command, and a human running `status` should not have their shell
  // painted red for looking.
  return EXIT.PASS;
}
