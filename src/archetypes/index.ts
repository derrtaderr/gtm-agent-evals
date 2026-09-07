// Archetype barrel. Lane A's registry and the CLI import from here to discover
// the three worked archetypes at once: each entry pairs a name->RuleFn registry
// with a default EvalConfig and Rubric. `allArchetypeRules` is the flat merge the
// engine can spread into `buildRuleRegistry`.

import type { EvalConfig, RuleFn, Rubric } from "../types.js";
import {
  contentRules,
  contentConfig,
  contentRubric,
} from "./content/index.js";
import {
  outboundRules,
  outboundConfig,
  outboundRubric,
} from "./outbound/index.js";
import {
  researchRules,
  researchConfig,
  researchRubric,
} from "./research/index.js";

export * as content from "./content/index.js";
export * as outbound from "./outbound/index.js";
export * as research from "./research/index.js";

export type ArchetypeEntry = {
  /** name -> RuleFn for this archetype */
  rules: Record<string, RuleFn>;
  config: EvalConfig;
  rubric: Rubric;
};

/** The three worked archetypes, keyed by their id. */
export const archetypes: Record<string, ArchetypeEntry> = {
  content: { rules: contentRules, config: contentConfig, rubric: contentRubric },
  outbound: {
    rules: outboundRules,
    config: outboundConfig,
    rubric: outboundRubric,
  },
  research: {
    rules: researchRules,
    config: researchConfig,
    rubric: researchRubric,
  },
};

/** Every archetype's rules flattened into one name->RuleFn registry. Rule names
 *  are unique across archetypes, so the merge is collision-free. */
export const allArchetypeRules: Record<string, RuleFn> = {
  ...contentRules,
  ...outboundRules,
  ...researchRules,
};
