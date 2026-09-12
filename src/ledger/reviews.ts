// Independent review as a recorded, falsifiable fact.
//
// Every falsifier session 1 shipped reads MACHINE evidence: a config hash, a
// model id, a verdict stream, a clock. All four can hold perfectly while an
// agent quietly drifts somewhere none of them look. This is the input that
// makes a human's attention a fact the ledger can lose: a grant can require
// that somebody independent looked recently, and go SUSPECT when nobody has.
//
// The pattern is ship-check's CONTRACT — independent adversarial review as a
// scheduled input rather than a one-time blessing — cited and reimplemented
// here. This repo stays self-contained; nothing imports from that one.
//
// Independence is enforced at RECORD time, which is the design decision worth
// arguing with. Checking it at read time would be easier and would leave a file
// full of reviews that look authoritative and are not. Refusing at the door
// means the file only ever holds reviews a reader can trust without knowing
// this rule exists.

import { createHash } from "node:crypto";
import { readJsonlStrict, writeJsonlAtomic } from "./agents.js";
import { ReviewRefused } from "./errors.js";
import type { AutonomyGrant, ReviewRecord, ReviewVerdict } from "../types.js";

const VERDICTS: readonly ReviewVerdict[] = ["BLESS", "BLOCK"];

/** Compare identities the way a human reads them: `Jane`, `jane` and ` jane `
 *  are one person. Exact-string matching let a granter clear their own conflict
 *  by changing the case of their own name, which is not a defence.
 *
 *  What this catches: the same identifier written differently. What it cannot
 *  catch: two genuinely different identifiers belonging to one human — an alias,
 *  a second account, a personal address beside a work one. That limit is real
 *  and is stated in the README; the check is a guardrail against the accidental
 *  and the lazy, not an identity system. */
function sameIdentity(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type RecordReviewInput = {
  agentId: string;
  reviewerId: string;
  verdict: ReviewVerdict;
  /** A pointer to the review itself. Required. */
  evidence: string;
  note?: string;
};

export type RecordReviewOptions = {
  /** Injectable clock (ISO 8601); defaults to now. */
  timestamp?: string;
  /** The grant store, so the granter-cannot-review rule can be enforced.
   *
   *  The CLI ALWAYS supplies this — `--grants` is required on `review`
   *  precisely so the rule cannot be skipped by leaving a flag off. It stays
   *  optional in this signature for library callers constructing a review
   *  before any grant store exists; omitting it checks strictly less, and a
   *  caller who omits it is choosing that. */
  grants?: AutonomyGrant[];
};

/** Stable id: one reviewer's call on one agent at one instant. Re-recording the
 *  same review at the same instant upserts rather than duplicating, so a retried
 *  command does not inflate a review history. */
export function reviewId(agentId: string, reviewerId: string, timestamp: string): string {
  const hash = createHash("sha256")
    .update(agentId)
    .update("\0")
    .update(reviewerId)
    .update("\0")
    .update(timestamp)
    .digest("hex")
    .slice(0, 12);
  return `review-${agentId}-${hash}`;
}

/** Build a review, or refuse with the reason. */
export function recordReview(
  input: RecordReviewInput,
  options: RecordReviewOptions = {},
): ReviewRecord {
  const { agentId, reviewerId, verdict, evidence } = input;

  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new ReviewRefused("review: --agent <id> is required; a review of nothing is not a review.");
  }
  if (typeof reviewerId !== "string" || reviewerId.trim().length === 0) {
    throw new ReviewRefused(
      "review: --reviewer <who> is required. An anonymous review cannot be checked for " +
        "independence, which is the only property that makes it worth recording.",
    );
  }
  if (!VERDICTS.includes(verdict)) {
    throw new ReviewRefused(
      `review: "${String(verdict)}" is not a review verdict (${VERDICTS.join(", ")}). ` +
        `A verdict that does not commit cannot move a grant.`,
    );
  }
  if (typeof evidence !== "string" || evidence.length === 0) {
    throw new ReviewRefused(
      "review: --evidence <pointer> is required — a URL, a path, a commit. An unsourced review " +
        "is an opinion, and a falsifier that moves a grant on an opinion is exactly what this " +
        "platform exists to prevent.",
    );
  }

  // Independence rule 1: an agent cannot certify itself.
  if (sameIdentity(reviewerId, agentId)) {
    throw new ReviewRefused(
      `review: ${reviewerId} cannot review itself. The whole value of this falsifier is that ` +
        `somebody OTHER than the subject looked.`,
    );
  }

  // Independence rule 2: the human who granted the autonomy cannot be the one
  // certifying it still deserves it. Archived grants count — the conflict is
  // historical, and archiving resolves an alarm, not a relationship.
  const conflict = (options.grants ?? []).find(
    (g) => g.agentId === agentId && sameIdentity(g.grantedBy, reviewerId),
  );
  if (conflict) {
    throw new ReviewRefused(
      `review: ${reviewerId} granted ${agentId} its ${conflict.tier} tier (grant ${conflict.id}), ` +
        `so they are not an independent reviewer of it. Review by somebody who did not make the ` +
        `decision being re-examined.`,
    );
  }

  const timestamp = options.timestamp ?? new Date().toISOString();
  // Stored trimmed so the file does not carry stray whitespace; case is
  // preserved, because how somebody writes their own name is theirs.
  const storedReviewer = reviewerId.trim();
  return {
    id: reviewId(agentId, storedReviewer, timestamp),
    agentId,
    reviewerId: storedReviewer,
    verdict,
    timestamp,
    evidence,
    ...(input.note ? { note: input.note } : {}),
  };
}

/** Read the review log. A corrupt or wrong-shaped line throws naming the line
 *  number, for the same reason the other stores do: a silently skipped review is
 *  a grant that looks reviewed and is not. */
export function loadReviews(path: string): ReviewRecord[] {
  return readJsonlStrict<ReviewRecord>(path, isReviewShape, "a ReviewRecord");
}

/** Upsert by review id. */
export function saveReview(review: ReviewRecord, path: string): void {
  const rest = loadReviews(path).filter((r) => r.id !== review.id);
  rest.push(review);
  writeJsonlAtomic(path, rest);
}

export function reviewsForAgent(reviews: ReviewRecord[], agentId: string): ReviewRecord[] {
  return reviews.filter((r) => r.agentId === agentId);
}

/** The newest review of an agent at or before `asOf`, or undefined. */
export function latestReview(
  reviews: ReviewRecord[],
  agentId: string,
  asOf?: string,
): ReviewRecord | undefined {
  const cutoff = asOf === undefined ? undefined : Date.parse(asOf);
  const own = reviewsForAgent(reviews, agentId)
    .filter((r) => cutoff === undefined || Date.parse(r.timestamp) <= cutoff)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return own[own.length - 1];
}

function isReviewShape(v: Record<string, unknown>): boolean {
  const s = (x: unknown): x is string => typeof x === "string" && x.length > 0;
  return (
    s(v.id) &&
    s(v.agentId) &&
    s(v.reviewerId) &&
    s(v.timestamp) &&
    s(v.evidence) &&
    VERDICTS.includes(v.verdict as ReviewVerdict)
  );
}
