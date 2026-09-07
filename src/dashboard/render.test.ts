import { describe, it, expect } from "vitest";
import { renderDashboard } from "./render.js";
import type { DashboardViewModel } from "./model.js";

function vm(overrides: Partial<DashboardViewModel> = {}): DashboardViewModel {
  return {
    summary: { totalRuns: 3, passCount: 2, blockCount: 1, passRate: 2 / 3, configCount: 1 },
    configs: [
      {
        configId: "cfg-outbound-demo",
        archetype: "outbound",
        history: ["PASS", "BLOCK", "PASS"],
        total: 3,
        passCount: 2,
        streak: 1,
        gateN: 3,
        clearedForAutonomy: false,
      },
    ],
    regressions: [],
    ...overrides,
  };
}

describe("renderDashboard document", () => {
  it("returns a full standalone HTML document", () => {
    const html = renderDashboard(vm());
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain("</html>");
  });

  it("is self-contained: no external stylesheet, script, image, or http(s) references", () => {
    const html = renderDashboard(vm());
    expect(html).not.toMatch(/src\s*=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("inlines its own CSS and JS rather than linking them", () => {
    const html = renderDashboard(vm());
    expect(html).toMatch(/<style\b/i);
  });
});

describe("renderDashboard content", () => {
  it("shows the summary numbers: total runs, pass rate, configs tracked", () => {
    const html = renderDashboard(vm());
    expect(html).toContain("3"); // total runs
    expect(html).toContain("67%"); // pass rate rounded
    expect(html).toMatch(/configs?\s*tracked/i);
  });

  it("renders each config id and its verdict history", () => {
    const html = renderDashboard(vm());
    expect(html).toContain("cfg-outbound-demo");
    // three verdict cells in history
    expect((html.match(/PASS|BLOCK/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("shows the streak and whether the config cleared its gate", () => {
    const cleared = renderDashboard(
      vm({
        configs: [
          {
            configId: "cfg-a",
            archetype: "content",
            history: ["PASS", "PASS", "PASS"],
            total: 3,
            passCount: 3,
            streak: 3,
            gateN: 3,
            clearedForAutonomy: true,
          },
        ],
      }),
    );
    expect(cleared).toMatch(/cleared/i);
    expect(cleared).toContain("3"); // streak / gateN
  });

  it("renders a regression row per golden with its status", () => {
    const html = renderDashboard(
      vm({
        regressions: [
          { goldenId: "golden-1", status: "REGRESSION", diffCount: 2 },
          { goldenId: "golden-2", status: "MATCH", diffCount: 0 },
        ],
      }),
    );
    expect(html).toContain("golden-1");
    expect(html).toContain("REGRESSION");
    expect(html).toContain("golden-2");
    expect(html).toContain("MATCH");
  });

  it("says so when there are no runs yet", () => {
    const html = renderDashboard({
      summary: { totalRuns: 0, passCount: 0, blockCount: 0, passRate: 0, configCount: 0 },
      configs: [],
      regressions: [],
    });
    expect(html).toMatch(/no (runs|telemetry|events)/i);
  });
});

describe("renderDashboard reasons", () => {
  it("shows the latest reason when a config is currently blocked", () => {
    const html = renderDashboard(
      vm({
        configs: [
          {
            configId: "cfg-a",
            archetype: "outbound",
            history: ["PASS", "BLOCK"],
            total: 2,
            passCount: 1,
            streak: 0,
            latestStatus: "BLOCK",
            latestReason: "blocked: no CTA present",
          },
        ],
      }),
    );
    expect(html).toContain("blocked: no CTA present");
  });

  it("escapes a reason that carries a script tag so it cannot inject (required test)", () => {
    const html = renderDashboard(
      vm({
        configs: [
          {
            configId: "cfg-a",
            archetype: "outbound",
            history: ["BLOCK"],
            total: 1,
            passCount: 0,
            streak: 0,
            latestStatus: "BLOCK",
            latestReason: "blocked: <script>alert(1)</script>",
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("renderDashboard escaping", () => {
  it("escapes a config id so it cannot inject markup", () => {
    const html = renderDashboard(
      vm({
        summary: { totalRuns: 1, passCount: 1, blockCount: 0, passRate: 1, configCount: 1 },
        configs: [
          {
            configId: "<script>alert(1)</script>",
            archetype: "outbound",
            history: ["PASS"],
            total: 1,
            passCount: 1,
            streak: 1,
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a regression golden id carrying an angle bracket", () => {
    const html = renderDashboard(
      vm({
        regressions: [{ goldenId: "<img src=x>", status: "DRIFT", diffCount: 0 }],
      }),
    );
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });
});
