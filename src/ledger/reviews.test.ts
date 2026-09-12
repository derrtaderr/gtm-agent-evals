// Independent review as a recorded fact.
//
// A grant rests on runs the agent produced. Nothing in it rests on a PERSON
// having looked. This is that input — and the reason independence is enforced
// when the review is WRITTEN rather than when it is read: a reviews file should
// never hold a review that cannot be trusted, so a reader does not have to know
// the rule to read the file safely.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordReview,
  reviewId,
  saveReview,
  loadReviews,
  reviewsForAgent,
} from "./reviews.js";
import { ReviewRefused } from "./errors.js";
import type { AutonomyGrant, ReviewRecord } from "../types.js";

const at = { timestamp: "2026-09-10T00:00:00.000Z" };

const grant: AutonomyGrant = {
  id: "example-enricher-auto-abc123",
  agentId: "example-enricher",
  tier: "auto",
  grantedAt: "2026-09-06T12:00:00.000Z",
  grantedBy: "dana",
  evidence: {
    configHash: "sha256:v2",
    modelId: "example-model-v1",
    streak: 3,
    gateN: 3,
    runIds: ["r-3", "r-4", "r-5"],
  },
  falsifiers: ["config_hash_unchanged"],
};

function input(over: Record<string, unknown> = {}) {
  return {
    agentId: "example-enricher",
    reviewerId: "priya",
    verdict: "BLESS" as const,
    evidence: "https://example.invalid/reviews/17",
    ...over,
  };
}

describe("recordReview writes the fact down", () => {
  it("records the reviewer, the subject, the verdict and the evidence pointer", () => {
    const r = recordReview(input(), at);
    expect(r.agentId).toBe("example-enricher");
    expect(r.reviewerId).toBe("priya");
    expect(r.verdict).toBe("BLESS");
    expect(r.evidence).toBe("https://example.invalid/reviews/17");
    expect(r.timestamp).toBe("2026-09-10T00:00:00.000Z");
  });

  it("records a BLOCK verdict as readily as a BLESS", () => {
    expect(recordReview(input({ verdict: "BLOCK" }), at).verdict).toBe("BLOCK");
  });

  it("gives each review a stable id derived from its own fields", () => {
    expect(recordReview(input(), at).id).toBe(
      reviewId("example-enricher", "priya", "2026-09-10T00:00:00.000Z"),
    );
  });

  it("refuses a review with no evidence pointer — an unsourced review is an opinion", () => {
    expect(() => recordReview(input({ evidence: "" }), at)).toThrow(ReviewRefused);
  });

  it("refuses a verdict outside the vocabulary", () => {
    expect(() => recordReview(input({ verdict: "LGTM" }), at)).toThrow(ReviewRefused);
  });
});

describe("reviewer independence, enforced at record time", () => {
  it("REFUSES a review whose reviewer is the agent itself", () => {
    expect(() => recordReview(input({ reviewerId: "example-enricher" }), at)).toThrow(
      ReviewRefused,
    );
  });

  it("says plainly why an agent may not review itself", () => {
    expect(() => recordReview(input({ reviewerId: "example-enricher" }), at)).toThrow(
      /itself|its own/i,
    );
  });

  it("REFUSES a review by the person who granted the agent's autonomy", () => {
    expect(() =>
      recordReview(input({ reviewerId: "dana" }), { ...at, grants: [grant] }),
    ).toThrow(ReviewRefused);
  });

  it("names the grant that makes that reviewer non-independent", () => {
    expect(() =>
      recordReview(input({ reviewerId: "dana" }), { ...at, grants: [grant] }),
    ).toThrow(/example-enricher-auto-abc123|granted/i);
  });

  it("allows the granter of a DIFFERENT agent to review this one", () => {
    const other: AutonomyGrant = { ...grant, agentId: "example-drafter", grantedBy: "dana" };
    const r = recordReview(input({ reviewerId: "dana" }), { ...at, grants: [other] });
    expect(r.reviewerId).toBe("dana");
  });

  it("checks archived grants too — the conflict is historical, not current", () => {
    const retired: AutonomyGrant = {
      ...grant,
      archivedAt: "2026-09-09T00:00:00.000Z",
      archivedBy: "dana",
    };
    expect(() =>
      recordReview(input({ reviewerId: "dana" }), { ...at, grants: [retired] }),
    ).toThrow(ReviewRefused);
  });

  it("allows an independent reviewer when grants are supplied", () => {
    expect(recordReview(input(), { ...at, grants: [grant] }).reviewerId).toBe("priya");
  });
});

describe("the reviews store", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gae-reviews-"));
    path = join(dir, "reviews.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is an empty list before anything is written", () => {
    expect(loadReviews(path)).toEqual([]);
  });

  it("round-trips a review through the file", () => {
    saveReview(recordReview(input(), at), path);
    const [r] = loadReviews(path);
    expect(r.reviewerId).toBe("priya");
  });

  it("APPENDS rather than replacing — a review history is the point", () => {
    saveReview(recordReview(input(), at), path);
    saveReview(recordReview(input({ reviewerId: "sam" }), at), path);
    expect(loadReviews(path)).toHaveLength(2);
  });

  it("upserts on a repeat of the same review id", () => {
    saveReview(recordReview(input(), at), path);
    saveReview(recordReview(input({ verdict: "BLOCK" }), at), path);
    const all = loadReviews(path);
    expect(all).toHaveLength(1);
    expect(all[0].verdict).toBe("BLOCK");
  });

  it("throws naming the line number on a corrupt row, never skipping it", () => {
    saveReview(recordReview(input(), at), path);
    const good = readFileSync(path, "utf8");
    require("node:fs").writeFileSync(path, good + '{"id":"broken"}\n');
    expect(() => loadReviews(path)).toThrow(/line 2/);
  });

  it("selects one agent's reviews", () => {
    const mine = recordReview(input(), at);
    const theirs = recordReview(input({ agentId: "example-drafter" }), at);
    expect(reviewsForAgent([mine, theirs], "example-enricher")).toEqual([mine]);
  });
});
