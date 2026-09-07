import type { AgentRun, RuleConfig, RuleFn, Violation } from "../types.js";
import { maxOutputLength } from "./max-output-length.js";
import { requiredMetadataField } from "./required-metadata-field.js";
import { forbiddenSubstring } from "./forbidden-substring.js";

/** Dependencies a rule set may need injected. Generic rules need none today, but
 *  the seam stays open (a link checker, a fetcher) for future generic rules and
 *  mirrors the reference registry. */
export type RuleRegistryDeps = Record<string, never>;

/** The rule REGISTRY: name -> RuleFn. Generic, cross-archetype rules only.
 *  Archetype-specific rule sets (content/outbound/research) are Lane C's and
 *  layer their own entries on top of this map. */
export function buildRuleRegistry(_deps: RuleRegistryDeps = {}): Record<string, RuleFn> {
  return {
    "max-output-length": maxOutputLength,
    "required-metadata-field": requiredMetadataField,
    "forbidden-substring": forbiddenSubstring,
  };
}

/** Run every configured rule against the run and aggregate violations. An
 *  unknown rule name is a refusal (throws), never a silent skip. */
export async function runRules(
  run: AgentRun,
  ruleConfigs: RuleConfig[],
  registry: Record<string, RuleFn>,
): Promise<Violation[]> {
  const out: Violation[] = [];
  for (const rc of ruleConfigs) {
    const fn = registry[rc.name];
    if (!fn) throw new Error(`Unknown rule: ${rc.name}`);
    out.push(...(await fn(run, rc.params)));
  }
  return out;
}
