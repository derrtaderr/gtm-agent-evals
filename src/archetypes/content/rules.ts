// Content archetype rules, ported from the public gtm-content-evals reference
// implementation and lifted from `text: string` to `AgentRun.output`. Each rule
// is a pure function over the run; none mutate it. Severity is `block` for every
// content rule — these are voice violations Jason will not ship over.

import type { AgentRun, RuleFn, Violation } from "../../types.js";

/** No em dashes. Use a period or comma instead. */
export const noEmDash: RuleFn = (run: AgentRun): Violation[] => {
  const matches = run.output.match(/—/g);
  if (!matches) return [];
  return [
    {
      rule: "no-em-dash",
      message: `Found ${matches.length} em dash(es). Use a period or comma.`,
      severity: "block",
    },
  ];
};

/** No colons in body copy. Headers, URLs, and clock times are exempt. */
export const noBodyColon: RuleFn = (run: AgentRun): Violation[] => {
  const violations: Violation[] = [];
  for (const line of run.output.split("\n")) {
    if (line.trimStart().startsWith("#")) continue; // header
    const cleaned = line
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\d:\d/g, "");
    if (cleaned.includes(":")) {
      violations.push({
        rule: "no-body-colon",
        message: `Colon in body line: "${line.trim()}"`,
        severity: "block",
      });
    }
  }
  return violations;
};

/** Flags any of the configured banned phrases, case-insensitively. */
export const bannedPhrases: RuleFn = (
  run: AgentRun,
  params?: unknown,
): Violation[] => {
  const phrases = (params as { phrases?: string[] } | undefined)?.phrases ?? [];
  const lower = run.output.toLowerCase();
  return phrases
    .filter((p) => lower.includes(p.toLowerCase()))
    .map((p) => ({
      rule: "banned-phrases",
      message: `Banned phrase found: "${p}"`,
      severity: "block" as const,
    }));
};

// Heuristic: catches the common "it's not X, it's Y" and "not X, it's Y" forms.
// Not exhaustive by design; the deterministic rules are a first-pass gate.
const binaryPatterns: RegExp[] = [
  /\bit'?s not\b[\s\S]{0,60}?,\s*it'?s\b/i,
  /\bnot\b[^.,\n]{0,40}?,\s*it'?s\b/i,
];

/** Flags the binary-corrective "not X, it's Y" rhetorical form. */
export const noBinaryCorrective: RuleFn = (run: AgentRun): Violation[] => {
  const normalized = run.output.replace(/’/g, "'");
  for (const p of binaryPatterns) {
    if (p.test(normalized)) {
      return [
        {
          rule: "no-binary-corrective",
          message:
            "Binary corrective (\"not X, it's Y\") detected. Lead with the positive path only.",
          severity: "block",
        },
      ];
    }
  }
  return [];
};
