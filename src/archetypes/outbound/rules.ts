// Outbound (cold email) archetype rules. Pure functions over AgentRun.output.
// The headline footgun is fabricated personalization: a merge token that never
// got filled ships "[company]" straight to a prospect, so no-unfilled-placeholder
// blocks. required-cta blocks a send with no ask. length-cap warns on bloat.

import type { AgentRun, RuleFn, Violation } from "../../types.js";

// Merge-tag styles seen across outbound tools: {{firstName}}, {role}, [company],
// <company>. Applied in order, consuming each matched region so the nested
// {{...}} form is not double-counted by the single-brace pattern.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{[^}]+\}\}/g,
  /\{[^}{]+\}/g,
  /\[[^\]]+\]/g,
  /<[a-zA-Z][^>]*>/g,
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

// Default markers that signal a concrete next step. Overridable via params.
const DEFAULT_CTA_MARKERS: string[] = [
  "worth a",
  "open to",
  "book a",
  "schedule a",
  "grab 15",
  "grab time",
  "quick call",
  "hop on a call",
  "jump on a call",
  "free to chat",
  "up for a",
  "interested in a call",
  "see a demo",
  "can i send",
];

/** Blocks when no call-to-action marker is present in the output. */
export const requiredCTA: RuleFn = (
  run: AgentRun,
  params?: unknown,
): Violation[] => {
  const markers =
    (params as { markers?: string[] } | undefined)?.markers ??
    DEFAULT_CTA_MARKERS;
  const lower = run.output.toLowerCase();
  if (markers.some((m) => lower.includes(m.toLowerCase()))) return [];
  return [
    {
      rule: "required-cta",
      message:
        "No call-to-action found. A cold email needs a concrete next step (a call, a demo, a reply).",
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
