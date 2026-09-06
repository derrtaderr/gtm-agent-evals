import type { RuleFn, Severity, Violation } from "../types.js";

type Params = { field: string; severity?: Severity };

/** Generic, cross-archetype: block when a required key is absent from the run's
 *  metadata (or metadata is missing entirely). Severity defaults to block. */
export const requiredMetadataField: RuleFn = (run, params): Violation[] => {
  const { field, severity = "block" } = (params as Params) ?? { field: "" };
  const present =
    run.metadata != null && Object.prototype.hasOwnProperty.call(run.metadata, field);
  if (present) return [];
  return [
    {
      rule: "required-metadata-field",
      message: `Required metadata field "${field}" is missing.`,
      severity,
    },
  ];
};
