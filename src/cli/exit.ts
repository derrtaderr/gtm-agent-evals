// Machine-safe exit codes. These are a contract CI keys on, so they are pinned
// here and documented in WIRING.md. Never renumber without a SPEC change.
//
//   0 PASS        the run cleared the gate
//   1 USAGE       the operator called the CLI wrong (bad/missing flags, command)
//   2 INPUT       a file was unreadable, or a config/run was malformed (fail closed)
//   3 BLOCK       the gate BLOCKed the run (a rule or the rubric failed)
//   4 REGRESSION  a golden regressed on replay
//   5 AUTONOMY    an autonomy grant is not VALID, or a grant was refused for
//                 lack of evidence
//
// USAGE and INPUT are kept distinct: a usage error is the operator's fault and a
// help nudge fixes it; an input error means a supplied artifact is malformed, and
// per the fail-closed thesis a malformed config is a refusal, never a silent pass.
//
// AUTONOMY (5) was ADDED for the ledger; no existing code was renumbered. It is
// deliberately one code for two situations that are the same sentence — "this
// agent has not earned this" — whether it is said at grant time or on a later
// re-check.

import { GrantRefused, InsufficientEvidence, ReviewRefused } from "../ledger/errors.js";

export const EXIT = {
  PASS: 0,
  USAGE: 1,
  INPUT: 2,
  BLOCK: 3,
  REGRESSION: 4,
  AUTONOMY: 5,
} as const;

/** The operator invoked the CLI wrong: unknown command, missing required flag. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** A supplied file was unreadable, or a config/run/store was malformed. This is
 *  the fail-closed boundary: a malformed config is a refusal (exit 2), never a
 *  silent pass. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** Map a thrown error to its exit code. A UsageError (or the ledger's
 *  GrantRefused, which is the same thing said about a grant) is exit 1; an
 *  InsufficientEvidence refusal is exit 5; anything else (InputError or an
 *  unexpected I/O error) fails closed to exit 2 — an unreadable input is never
 *  allowed to look like a PASS. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError || err instanceof GrantRefused || err instanceof ReviewRefused)
    return EXIT.USAGE;
  if (err instanceof InsufficientEvidence) return EXIT.AUTONOMY;
  return EXIT.INPUT;
}
