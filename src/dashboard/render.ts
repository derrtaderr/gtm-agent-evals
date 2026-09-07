// Lane F — render layer. Turns a DashboardViewModel into a single self-contained
// HTML document string: inline CSS, inline JS, no external stylesheet, script,
// image, or network reference, so a stranger opens the file in a browser with no
// server. Every value that originates in event data (config ids, golden ids) is
// run through escapeHtml before it enters the markup — a reason or id carrying
// "<script>" renders as inert text, never live markup.

import type { DashboardViewModel, ConfigView, RegressionView } from "./model.js";
import { escapeHtml } from "./escape.js";

export function renderDashboard(vm: DashboardViewModel): string {
  const { summary } = vm;
  const passPct = Math.round(summary.passRate * 100);

  const summaryCards = [
    card("Total runs", String(summary.totalRuns)),
    card("Pass rate", `${passPct}%`),
    card("Configs tracked", String(summary.configCount)),
    card("Blocked", String(summary.blockCount)),
  ].join("\n");

  const configSection =
    vm.configs.length === 0
      ? `<p class="empty">No runs recorded yet. Point the generator at a telemetry JSONL file the sink wrote.</p>`
      : `<table class="grid">
          <thead>
            <tr>
              <th>Config</th><th>Archetype</th><th>Runs</th>
              <th>Autonomy streak</th><th>Gate</th><th>History</th>
            </tr>
          </thead>
          <tbody>
            ${vm.configs.map(configRow).join("\n")}
          </tbody>
        </table>`;

  const regressionSection =
    vm.regressions.length === 0
      ? `<p class="empty">No regression results supplied.</p>`
      : `<table class="grid">
          <thead><tr><th>Golden</th><th>Status</th><th>Diffs</th></tr></thead>
          <tbody>
            ${vm.regressions.map(regressionRow).join("\n")}
          </tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GTM Agent Evals — Dashboard</title>
<style>
${STYLE}
</style>
</head>
<body>
<main class="wrap">
  <header class="head">
    <h1>GTM Agent Evals</h1>
    <p class="sub">Verdict history, autonomy streaks, and golden regression — read from telemetry, no server required.</p>
  </header>

  <section class="cards">
${summaryCards}
  </section>

  <section>
    <h2>Configs</h2>
    ${configSection}
  </section>

  <section>
    <h2>Regression</h2>
    ${regressionSection}
  </section>

  <footer class="foot">Static dashboard over the telemetry JSONL. Distribute, don't host.</footer>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>`;
}

function card(label: string, value: string): string {
  return `    <div class="cardbox"><div class="cardval">${escapeHtml(value)}</div><div class="cardlabel">${escapeHtml(label)}</div></div>`;
}

function configRow(c: ConfigView): string {
  const gateCell =
    c.gateN === undefined
      ? `<span class="muted">—</span>`
      : c.clearedForAutonomy
        ? `<span class="badge cleared">cleared (${escapeHtml(String(c.streak))}/${escapeHtml(String(c.gateN))})</span>`
        : `<span class="badge pending">not cleared (${escapeHtml(String(c.streak))}/${escapeHtml(String(c.gateN))})</span>`;

  const history = c.history
    .map((s) => `<span class="chip ${s === "PASS" ? "pass" : "block"}">${s}</span>`)
    .join(" ");

  return `<tr>
    <td class="mono">${escapeHtml(c.configId)}</td>
    <td>${escapeHtml(c.archetype)}</td>
    <td>${escapeHtml(String(c.passCount))}/${escapeHtml(String(c.total))} PASS</td>
    <td class="mono">${escapeHtml(String(c.streak))}</td>
    <td>${gateCell}</td>
    <td class="history">${history}</td>
  </tr>`;
}

function regressionRow(r: RegressionView): string {
  const cls = r.status === "MATCH" ? "pass" : r.status === "DRIFT" ? "warn" : "block";
  return `<tr>
    <td class="mono">${escapeHtml(r.goldenId)}</td>
    <td><span class="chip ${cls}">${escapeHtml(r.status)}</span></td>
    <td>${escapeHtml(String(r.diffCount))}</td>
  </tr>`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0f1115; color: #e7e9ee; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }
  .head h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.02em; }
  .sub { margin: 0; color: #99a0ad; }
  h2 { margin: 32px 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: #99a0ad; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 20px; }
  .cardbox { background: #171a21; border: 1px solid #262b36; border-radius: 12px; padding: 16px; }
  .cardval { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; }
  .cardlabel { color: #99a0ad; font-size: 13px; margin-top: 2px; }
  table.grid { width: 100%; border-collapse: collapse; overflow-x: auto; display: block; }
  .grid th, .grid td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #262b36; white-space: nowrap; }
  .grid th { color: #99a0ad; font-weight: 550; font-size: 13px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: #5b6472; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .chip.pass { background: #12351f; color: #74e0a0; }
  .chip.block { background: #3a1618; color: #f28b8b; }
  .chip.warn { background: #3a2f12; color: #f0cf7a; }
  .badge { font-size: 12px; font-weight: 600; }
  .badge.cleared { color: #74e0a0; }
  .badge.pending { color: #f0cf7a; }
  .history { white-space: normal; }
  .empty { color: #99a0ad; font-style: italic; }
  .foot { margin-top: 40px; color: #5b6472; font-size: 13px; }
`;

// Tiny inline behavior: dim a config row on click so a reader can mark rows they
// have reviewed. Purely local, no network, no external asset.
const SCRIPT = `
  document.querySelectorAll("table.grid tbody tr").forEach(function (row) {
    row.addEventListener("click", function () { row.style.opacity = row.style.opacity === "0.45" ? "1" : "0.45"; });
  });
`;
