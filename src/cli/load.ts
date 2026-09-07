// Loading and FAIL-CLOSED validation of the JSON that enters the CLI at runtime.
// This is the engine review's carried finding, landed here because this is where
// untrusted JSON crosses into the platform: a malformed config is a refusal
// (InputError -> exit 2), never a silent pass, and a rule config carrying an
// unrecognized `severity` is coerced UP to `block` (the safe direction) rather
// than silently downgraded to a non-blocking warn.

import { readFileSync } from "node:fs";
import type {
  AgentRun,
  EvalConfig,
  RuleConfig,
  Verdict,
} from "../types.js";
import { InputError } from "./exit.js";

/** Read a UTF-8 JSON file. A missing/unreadable file or malformed JSON is an
 *  InputError (exit 2), so unreadable input can never look like a PASS. */
export function readJsonFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new InputError(`cannot read file "${path}": ${msg}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new InputError(`file "${path}" is not valid JSON: ${msg}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

const VALID_SEVERITIES = new Set(["block", "warn"]);

/** Validate an untrusted config into an EvalConfig, or throw InputError.
 *
 *  Fail-closed rules:
 *  - not an object, missing/empty `archetype`, missing/non-array `rules`, a rule
 *    element with no `name`, a rule name absent from `knownRuleNames`,
 *    missing/non-number `gateN`, or a malformed `rubric` -> InputError (exit 2).
 *  - a rule whose `params.severity` is present but not "block"/"warn" is coerced
 *    to "block" (never silently to "warn"); `onWarn` is notified so the CLI can
 *    surface the coercion. */
export function validateConfig(
  raw: unknown,
  knownRuleNames: string[],
  onWarn: (message: string) => void = () => {},
): EvalConfig {
  if (!isObject(raw)) {
    throw new InputError("config must be a JSON object.");
  }
  if (!nonEmptyString(raw.archetype)) {
    throw new InputError('config is missing a non-empty "archetype" string.');
  }
  if (!Array.isArray(raw.rules)) {
    throw new InputError('config is missing a "rules" array.');
  }
  if (typeof raw.gateN !== "number" || !Number.isFinite(raw.gateN)) {
    throw new InputError('config is missing a numeric "gateN".');
  }

  const known = new Set(knownRuleNames);
  const rules: RuleConfig[] = raw.rules.map((r, i) => {
    if (!isObject(r) || !nonEmptyString(r.name)) {
      throw new InputError(`config rule #${i} is missing a non-empty "name".`);
    }
    if (!known.has(r.name)) {
      throw new InputError(
        `config rule #${i} names an unknown rule "${r.name}" (not in the registry).`,
      );
    }
    let params = r.params;
    if (isObject(params) && "severity" in params) {
      const sev = params.severity;
      if (!VALID_SEVERITIES.has(sev as string)) {
        params = { ...params, severity: "block" };
        onWarn(
          `rule "${r.name}": unrecognized severity ${JSON.stringify(sev)} ` +
            `coerced to "block" (fail closed).`,
        );
      }
    }
    return { name: r.name, ...(params !== undefined ? { params } : {}) };
  });

  let rubric: EvalConfig["rubric"];
  if (raw.rubric !== undefined) {
    if (!isObject(raw.rubric) || !Array.isArray(raw.rubric.dimensions)) {
      throw new InputError('config "rubric" must have a "dimensions" array.');
    }
    rubric = {
      dimensions: raw.rubric.dimensions.map((d, i) => {
        if (!isObject(d) || !nonEmptyString(d.name) || typeof d.threshold !== "number") {
          throw new InputError(
            `config rubric dimension #${i} needs a "name" string and a numeric "threshold".`,
          );
        }
        return { name: d.name, threshold: d.threshold };
      }),
    };
  }

  return {
    ...(nonEmptyString(raw.id) ? { id: raw.id } : {}),
    archetype: raw.archetype,
    rules,
    ...(rubric ? { rubric } : {}),
    gateN: raw.gateN,
  };
}

/** Validate an untrusted AgentRun, or throw InputError. */
export function validateRun(raw: unknown): AgentRun {
  if (!isObject(raw)) {
    throw new InputError("run must be a JSON object.");
  }
  if (!nonEmptyString(raw.archetype)) {
    throw new InputError('run is missing a non-empty "archetype" string.');
  }
  if (typeof raw.input !== "string") {
    throw new InputError('run is missing an "input" string.');
  }
  if (typeof raw.output !== "string") {
    throw new InputError('run is missing an "output" string.');
  }
  if (raw.steps !== undefined && !Array.isArray(raw.steps)) {
    throw new InputError('run "steps" must be an array when present.');
  }
  return raw as unknown as AgentRun;
}

function validateVerdict(raw: unknown, where: string): Verdict {
  if (!isObject(raw)) {
    throw new InputError(`${where}: verdict must be an object.`);
  }
  if (raw.status !== "PASS" && raw.status !== "BLOCK") {
    throw new InputError(
      `${where}: verdict.status must be exactly "PASS" or "BLOCK".`,
    );
  }
  return raw as unknown as Verdict;
}

/** Validate the `--runs` file for the `regress` command: an array of already
 *  evaluated `{ run, verdict }` pairs. Kept pre-evaluated so `regress` is
 *  deterministic and needs no API key in CI. */
export function validateFreshPairs(
  raw: unknown,
): { run: AgentRun; verdict: Verdict }[] {
  if (!Array.isArray(raw)) {
    throw new InputError(
      "fresh-runs file must be a JSON array of { run, verdict } pairs.",
    );
  }
  return raw.map((p, i) => {
    if (!isObject(p)) {
      throw new InputError(`fresh-runs #${i} must be an object.`);
    }
    return {
      run: validateRun(p.run),
      verdict: validateVerdict(p.verdict, `fresh-runs #${i}`),
    };
  });
}
