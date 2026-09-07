// Outbound (cold email) archetype rules. Pure functions over AgentRun.output.
// The headline footgun is fabricated personalization: a merge token that never
// got filled ships "[company]" straight to a prospect, so no-unfilled-placeholder
// blocks. required-cta blocks a send with no ask. length-cap warns on bloat.

import type { AgentRun, RuleFn, Violation } from "../../types.js";

// Merge-tag styles seen across outbound tools: {{firstName}}, {role}, [company],
// <company>. Applied in order, consuming each matched region so the nested
// {{...}} form is not double-counted by the single-brace pattern.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{[^}]+\}\}/g, // {{firstName}} (Handlebars/HeyReach)
  /\{[^}{]+\}/g, // {role}
  /\[[^\]]+\]/g, // [company]
  /<[a-zA-Z][^>]*>/g, // <company>
  /%[a-zA-Z][^%]*%/g, // %firstName% (Outreach/Salesloft) — not "30%"
  /\(\([^)]+\)\)/g, // ((company))
  /\$[a-zA-Z][^$]*\$/g, // $role$ — not a "$4.2M" figure
];

/** Flags any unfilled merge token left in the output. */
export const noUnfilledPlaceholder: RuleFn = (run: AgentRun): Violation[] => {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  let working = run.output;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = working.match(pattern);
    if (!matches) continue;
    working = working.replace(pattern, " "); // consume so inner forms don't rematch
    for (const m of matches) {
      if (seen.has(m)) continue;
      seen.add(m);
      violations.push({
        rule: "no-unfilled-placeholder",
        message: `Unfilled personalization token left in output: "${m}". A send would ship this literally.`,
        severity: "block",
      });
    }
  }
  return violations;
};

// A real CTA is an explicit ask, not a loose substring. Two forms count:
//
//  (A) an imperative ask: a sentence/line that STARTS with a call-to-action verb
//      ("Reply if interested.", "Grab 15 minutes.", "Book a time."). Substrings
//      buried mid-sentence ("worth a read") do not count.
//  (B) an inviting question: the output asks a question AND carries a
//      meeting/response marker ("Worth a quick call next week?").
//
// Both lists are overridable via params. Detection is deliberately conservative:
// a genuine no-CTA send must never clear this block rule, which is the failure
// the substring version allowed.

const DEFAULT_CTA_IMPERATIVES: string[] = [
  "reply",
  "book",
  "schedule",
  "grab",
  "hop on",
  "jump on",
  "join",
  "register",
  "download",
  "connect",
  "call me",
  "let's",
  "let us",
  "shall we",
];

const DEFAULT_CTA_QUESTION_MARKERS: string[] = [
  "worth a",
  "open to",
  "free to",
  "up for",
  "interested in",
  "can i",
  "could we",
  "would you",
  "make sense",
  "any interest",
  "have time",
  "a call",
  "a chat",
  "a demo",
  "grab time",
  "quick call",
  "catch up",
];

/** Blocks when the output carries no explicit call-to-action. */
export const requiredCTA: RuleFn = (
  run: AgentRun,
  params?: unknown,
): Violation[] => {
  const p = params as
    | { markers?: string[]; imperatives?: string[] }
    | undefined;
  const questionMarkers = p?.markers ?? DEFAULT_CTA_QUESTION_MARKERS;
  const imperatives = p?.imperatives ?? DEFAULT_CTA_IMPERATIVES;
  const lower = run.output.toLowerCase();

  // (A) imperative ask at the start of any line or sentence.
  const clauses = run.output
    .split(/(?<!\d)[.!?\n]+(?!\d)/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const hasImperative = clauses.some((c) =>
    imperatives.some(
      (verb) => c === verb || c.startsWith(verb + " ") || c.startsWith(verb + ","),
    ),
  );

  // (B) inviting question: a "?" plus a meeting/response marker.
  const hasInvitingQuestion =
    lower.includes("?") &&
    questionMarkers.some((m) => lower.includes(m.toLowerCase()));

  if (hasImperative || hasInvitingQuestion) return [];
  return [
    {
      rule: "required-cta",
      message:
        "No explicit call-to-action found. A cold email needs a concrete ask (an imperative like \"Reply\"/\"Book a time\", or a question inviting a call).",
      severity: "block",
    },
  ];
};

/** Warns when the output exceeds the word cap. Default 150 words. */
export const lengthCap: RuleFn = (
  run: AgentRun,
  params?: unknown,
): Violation[] => {
  const maxWords =
    (params as { maxWords?: number } | undefined)?.maxWords ?? 150;
  const words = run.output.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [];
  return [
    {
      rule: "length-cap",
      message: `Output is ${words.length} words, over the ${maxWords}-word cap. Cold emails convert shorter.`,
      severity: "warn",
    },
  ];
};
