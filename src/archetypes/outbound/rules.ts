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

// required-cta stays a BLOCK: for cold email "did the writer ask for a next
// step" is a tractable, decidable-enough gate (unlike numeric grounding). A real
// CTA is an explicit ask, not a loose substring. Three forms count:
//
//  (A) an imperative ASK: a clause that STARTS with a CTA verb AND carries an
//      ask signal directed at the reader (a pronoun like "you/your", a time
//      token, "here/link", or a conditional "if ..."). This distinguishes
//      "Reply if interested." / "Grab 15 minutes on my calendar." (asks) from
//      "Download volumes tripled." / "Schedule slippage was the theme."
//      (verb-initial statements, verb used as a noun — NOT asks).
//  (B) an inviting QUESTION: a "?"-bearing sentence carrying a time/meeting/
//      response marker ("Would 15 minutes Thursday work?").
//  (C) an explicit caller-supplied marker: when the caller passes params.markers,
//      those are trusted as sufficient substrings (they opted in).
//
// Both default lists are overridable via params.

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
  "minutes",
  "min ",
  "work for you",
  "works for you",
  "work?",
  "chance",
  "right place",
  "send",
  "overview",
  "call",
  "chat",
  "demo",
  "next week",
  "this week",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

// A reader-directed ask signal in the REST of an imperative clause (after the
// verb). Its presence is what separates a real ask from a verb-initial noun
// phrase.
const ASK_SIGNAL =
  /\b(me|my|us|our|you|your|minutes?|\d+\s*min|calendar|link|here|below|back|call|chat|demo|time|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;

/** Blocks when the output carries no explicit call-to-action. */
export const requiredCTA: RuleFn = (
  run: AgentRun,
  params?: unknown,
): Violation[] => {
  const p = params as
    | { markers?: string[]; imperatives?: string[] }
    | undefined;
  const suppliedMarkers = p?.markers;
  const questionMarkers = suppliedMarkers ?? DEFAULT_CTA_QUESTION_MARKERS;
  const imperatives = p?.imperatives ?? DEFAULT_CTA_IMPERATIVES;
  const lower = run.output.toLowerCase();

  // (C) explicit caller-supplied markers are trusted substrings.
  if (suppliedMarkers && suppliedMarkers.some((m) => lower.includes(m.toLowerCase()))) {
    return [];
  }

  // (A) imperative ASK: verb at the clause start PLUS a reader-directed signal
  // (or a conditional "if ...") in the remainder.
  const clauses = run.output
    .split(/(?<!\d)[.!?\n]+(?!\d)/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const hasImperativeAsk = clauses.some((c) =>
    imperatives.some((verb) => {
      const starts =
        c === verb || c.startsWith(verb + " ") || c.startsWith(verb + ",");
      if (!starts) return false;
      const rest = c.slice(verb.length).trim();
      return rest === "" || rest.startsWith("if ") || ASK_SIGNAL.test(rest);
    }),
  );

  // (B) inviting question: a "?"-bearing sentence carrying a meeting marker.
  const questionSentences = run.output.match(/[^.?!\n]*\?/g) ?? [];
  const hasInvitingQuestion = questionSentences.some((s) => {
    const sl = s.toLowerCase();
    return questionMarkers.some((m) => sl.includes(m.toLowerCase()));
  });

  if (hasImperativeAsk || hasInvitingQuestion) return [];
  return [
    {
      rule: "required-cta",
      message:
        "No explicit call-to-action found. A cold email needs a concrete ask (an imperative like \"Reply if interested\"/\"Book a time\", or a question inviting a call).",
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
