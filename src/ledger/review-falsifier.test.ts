// `review_not_stale` — the falsifier that can lose a grant because nobody
// looked.
//
// Every session-1 falsifier reads machine evidence: a hash, a model id, a
// verdict stream, a clock. All four can hold perfectly while an agent drifts
// somewhere none of them look. This one encodes "somebody independent examined
// this recently" as a fact the grant can lose.

import { describe, it, expect } from "vitest";
import { CHECKS, runFalsifier, loadFalsifierRegistry, DEFAULT_FALSIFIER_REGISTRY } from "./falsifiers.js";
import { recordReview } from "./reviews.js";
import { checkGrant } from "./check.js";
import { registerAgent } from "./agents.js";
import type { AutonomyGrant, FalsifierSpec, ReviewRecord } from "../types.js";

const agent = registerAgent(
  {
    id: "example-enricher",
    name: "Example Enricher",
    configHash: "sha256:v2",
    modelId: "example-model-v1",
    configIds: ["research-default"],
    gateN: 3,
  },
  { registeredAt: "2026-09-01T00:00:00.000Z" },
);

const grant: AutonomyGrant = {
  id: "example-enricher-auto-abc123",
  agentId: "example-enricher",
  tier: "auto",
  grantedAt: "2026-09-06T00:00:00.000Z",
  grantedBy: "dana",
  evidence: {
    configHash: "sha256:v2",
    modelId: "example-model-v1",
    streak: 3,
    gateN: 3,
    runIds: ["r-3", "r-4", "r-5"],
  },
  falsifiers: ["review_not_stale"],
};

const spec: FalsifierSpec = {
  id: "review_not_stale",
  check: "review_freshness",
  statement: "An independent reviewer has examined this agent recently enough.",
  params: { maxReviewAgeDays: 30 },
};

function review(day: number, verdict: "BLESS" | "BLOCK" = "BLESS", reviewerId = "priya"): ReviewRecord {
  return recordReview(
    { agentId: "example-enricher", reviewerId, verdict, evidence: "https://example.invalid/r" },
    { timestamp: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z` },
  );
}

const ctx = (reviews: ReviewRecord[] | undefined, asOf = "2026-09-20T00:00:00.000Z") => ({
  grant,
  agent,
  events: [],
  reviews,
  asOf,
});

describe("review_freshness", () => {
  it("HOLDS on a recent BLESS since the grant", () => {
    expect(CHECKS.review_freshness(spec, ctx([review(10)])).status).toBe("HOLDS");
  });

  it("is UNEVALUABLE with no reviews source — never a silent pass", () => {
    const r = CHECKS.review_freshness(spec, ctx(undefined));
    expect(r.status).toBe("UNEVALUABLE");
    expect(r.evidence).toMatch(/no review/i);
  });

  it("DEGRADES when a source exists but nobody has reviewed since the grant", () => {
    expect(CHECKS.review_freshness(spec, ctx([])).status).toBe("DEGRADED");
  });

  it("ignores a BLESS recorded BEFORE the grant — it reviewed a different decision", () => {
    expect(CHECKS.review_freshness(spec, ctx([review(2)])).status).toBe("DEGRADED");
  });

  it("DEGRADES when the newest BLESS has aged past the window", () => {
    const r = CHECKS.review_freshness(spec, ctx([review(7)], "2026-10-20T00:00:00.000Z"));
    expect(r.status).toBe("DEGRADED");
    expect(r.evidence).toMatch(/30-day|window/);
  });

  it("BREAKS on a BLOCK review recorded since the grant", () => {
    const r = CHECKS.review_freshness(spec, ctx([review(10, "BLOCK")]));
    expect(r.status).toBe("BROKEN");
    expect(r.evidence).toMatch(/BLOCK/);
  });

  it("lets a BLOCK outweigh a later BLESS — a refutation is not aged out", () => {
    // Somebody said stop. A later thumbs-up from a different reviewer does not
    // erase that; a human resolves it by archiving and re-granting.
    const r = CHECKS.review_freshness(spec, ctx([review(10, "BLOCK"), review(12, "BLESS", "sam")]));
    expect(r.status).toBe("BROKEN");
  });

  it("names the reviewer and the evidence pointer so the verdict can be argued with", () => {
    const r = CHECKS.review_freshness(spec, ctx([review(10, "BLOCK")]));
    expect(r.evidence).toMatch(/priya/);
    expect(r.evidence).toMatch(/example.invalid/);
  });

  it("reads its window from the registry, so retuning is a data edit", () => {
    const tight: FalsifierSpec = { ...spec, params: { maxReviewAgeDays: 1 } };
    expect(CHECKS.review_freshness(tight, ctx([review(10)])).status).toBe("DEGRADED");
  });
});

describe("worst-wins carries a review BLOCK through to the grant", () => {
  it("REVOKES the grant on a BLOCK review", () => {
    const check = checkGrant(grant, {
      agents: [agent],
      events: [],
      reviews: [review(10, "BLOCK")],
      registry: { falsifiers: [spec] },
      asOf: "2026-09-20T00:00:00.000Z",
    });
    expect(check.status).toBe("REVOKED");
  });

  it("makes the grant SUSPECT when no reviews source is configured", () => {
    const check = checkGrant(grant, {
      agents: [agent],
      events: [],
      registry: { falsifiers: [spec] },
      asOf: "2026-09-20T00:00:00.000Z",
    });
    expect(check.status).toBe("SUSPECT");
  });
});

describe("the falsifier ships opt-in, not as a default", () => {
  it("is NOT in the default registry", () => {
    // A fifth default would flip every grant already on disk to SUSPECT the
    // moment this version installs, for want of a reviews file nobody has
    // written yet — the alarm-fatigue failure `archive` exists to prevent.
    expect(DEFAULT_FALSIFIER_REGISTRY.falsifiers.map((f) => f.id)).not.toContain(
      "review_not_stale",
    );
  });

  it("is registered as a check, so an operator's registry can name it", () => {
    expect(CHECKS.review_freshness).toBeDefined();
    const loaded = loadFalsifierRegistry({ falsifiers: [spec] });
    expect(loaded.falsifiers[0].check).toBe("review_freshness");
  });

  it("runs through runFalsifier with its registry statement attached", () => {
    const r = runFalsifier(spec, ctx([review(10)]));
    expect(r.falsifier).toBe("review_not_stale");
    expect(r.statement).toBe("An independent reviewer has examined this agent recently enough.");
  });
});
