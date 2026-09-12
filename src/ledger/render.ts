// Human-readable rendering of the ledger. Kept out of src/cli/ so the ledger
// does not depend on the CLI; `LedgerIo` is structurally satisfied by the CLI's
// CliIo, which is all the coupling either side needs.
//
// One rule governs every surface here, borrowed from the falsifier pattern this
// lane reimplements: a non-holding verdict always prints the falsifier's
// STATEMENT and then the EVIDENCE that moved it. An operator must be able to
// disagree with a revocation by reading two lines, rather than by re-deriving
// the check. A verdict you cannot argue with is a verdict nobody trusts.

import type { AgentLedgerEntry, AutonomyGrant, FalsifierResult, GrantCheck, Ledger } from "../types.js";

/** The narrow slice of the CLI's io this module needs. */
export type LedgerIo = { out: (line: string) => void };

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function falsifierSummary(check: GrantCheck): string {
  const holding = check.falsifiers.filter((f) => f.status === "HOLDS").length;
  return `${holding}/${check.falsifiers.length} holding`;
}

/** The `status` surface: one table, one row per agent. */
export function renderLedgerTable(io: LedgerIo, ledger: Ledger): void {
  io.out(`autonomy ledger — ${ledger.generatedAt}`);

  if (ledger.agents.length === 0) {
    io.out("no agents registered.");
  } else {
    const rows = ledger.agents.map((a) => {
      const top = topCheck(a);
      return [
        a.agentId,
        a.effectiveTier,
        top ? top.status : "—",
        `${a.streak}/${a.gateN}${a.eligible ? " *" : ""}`,
        a.lastVerdict ?? "—",
        top ? falsifierSummary(top) : "—",
      ];
    });
    const header = ["AGENT", "TIER", "GRANT", "STREAK", "LAST", "FALSIFIERS"];
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i].length)),
    );
    io.out(header.map((h, i) => pad(h, widths[i])).join("  ").trimEnd());
    for (const r of rows) {
      io.out(r.map((cell, i) => pad(cell, widths[i])).join("  ").trimEnd());
    }
    io.out("");
    io.out("STREAK is clean runs against the agent's gateN; * marks an agent eligible for a grant.");
    io.out("Eligibility is not autonomy — a grant is a human decision (see the `grant` command).");
  }

  if (ledger.orphanGrants.length > 0) {
    io.out("");
    io.out(
      `${ledger.orphanGrants.length} grant(s) name an unknown agent — not in the registry, so nothing about them can be verified:`,
    );
    for (const c of ledger.orphanGrants) {
      io.out(`  ${c.grantId}  (agent ${c.agentId})  ->  ${c.status}`);
    }
  }
}

/** The highest-tier check on an agent's row — the one whose status explains the
 *  effective tier. */
function topCheck(entry: AgentLedgerEntry): GrantCheck | undefined {
  const valid = entry.checks.find((c) => c.tier === entry.effectiveTier && c.status === "VALID");
  if (valid) return valid;
  return entry.checks[entry.checks.length - 1];
}

/** The `check` surface: every grant's current verdict, with the statement and
 *  evidence printed under each falsifier that is not holding. */
export function renderCheckReport(io: LedgerIo, checks: GrantCheck[]): void {
  if (checks.length === 0) {
    io.out("no grants in the ledger — every agent is at the supervised floor.");
    return;
  }
  for (const c of checks) {
    io.out(`${c.grantId}  [${c.tier}]  ->  ${c.status}`);
    for (const f of c.falsifiers) {
      if (f.status === "HOLDS") continue;
      // The id as well as the statement: the statement is what a reader argues
      // with, the id is what they grep the ledger for and edit in the registry.
      io.out(`    ${f.status} [${f.falsifier}]: ${f.statement}`);
      io.out(`      ${f.evidence}`);
    }
  }
  const count = (s: GrantCheck["status"]): number => checks.filter((c) => c.status === s).length;
  io.out(
    `summary: ${checks.length} grant(s) — ${count("VALID")} VALID, ` +
      `${count("SUSPECT")} SUSPECT, ${count("REVOKED")} REVOKED`,
  );
}

/** The per-agent detail: the full chain from the effective tier back to the runs
 *  that earned it. Every falsifier prints here, holding ones included — this is
 *  the view an operator opens to decide whether they agree. */
export function renderAgentDetail(
  io: LedgerIo,
  entry: AgentLedgerEntry,
  grants: AutonomyGrant[],
): void {
  io.out(`${entry.agentId} — ${entry.name}`);
  io.out(`  effective tier: ${entry.effectiveTier}`);
  io.out(
    `  clean-run streak: ${entry.streak}/${entry.gateN}` +
      (entry.eligible ? " (eligible for a grant)" : " (not yet eligible)"),
  );
  io.out(
    entry.lastVerdict
      ? `  last run: ${entry.lastVerdict} at ${entry.lastRunAt}`
      : "  last run: none recorded",
  );

  if (entry.checks.length === 0) {
    io.out("  grants: none — this agent holds no grants, so it sits at the supervised floor.");
    return;
  }

  io.out("  grants:");
  for (const c of entry.checks) {
    const g = grants.find((x) => x.id === c.grantId);
    io.out(`    ${c.grantId}  [${c.tier}]  ->  ${c.status}`);
    if (g) {
      io.out(`      granted ${g.grantedAt} by ${g.grantedBy}`);
      // Observed runs and the agent's identity at grant time are printed as two
      // separate facts. Fusing them into one "earned on" line asserts that those
      // runs were produced by that config, which the platform cannot establish.
      io.out(`      evidence: a streak of ${g.evidence.streak}/${g.evidence.gateN} clean runs`);
      if (g.evidence.runIds.length > 0) {
        io.out(`      runs: ${g.evidence.runIds.join(" ")}`);
      }
      io.out(
        `      agent at grant time: config ${g.evidence.configHash}, model ${g.evidence.modelId} ` +
          `(the falsifier baseline; run-era config lineage is not tracked)`,
      );
      if (g.evidence.note) io.out(`      note: ${g.evidence.note}`);
    }
    io.out("      falsifiers:");
    for (const f of c.falsifiers) renderFalsifier(io, f);
  }
}

function renderFalsifier(io: LedgerIo, f: FalsifierResult): void {
  io.out(`        [${f.status}] ${f.falsifier}`);
  io.out(`            ${f.statement}`);
  io.out(`            ${f.evidence}`);
}
