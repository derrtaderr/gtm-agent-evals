// The ledger's two refusal kinds, separated because they mean different things
// to a script.
//
//   GrantRefused        the operator invoked the command wrong (bad tier, wrong
//                       confirmation phrase, missing granter) -> a help nudge
//                       fixes it. Exit 1.
//   InsufficientEvidence the command was invoked correctly and the answer is no:
//                       the evidence does not support this grant. Exit 5, the
//                       same code a non-VALID grant check reports, because both
//                       are the same sentence — this agent has not earned this.
//
// Collapsing them would make a CI job unable to tell "we typed the flag wrong"
// from "the agent is not ready", and those need opposite responses.

export class GrantRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantRefused";
  }
}

export class InsufficientEvidence extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientEvidence";
  }
}

/** A review was recorded wrong — a missing evidence pointer, a verdict outside
 *  the vocabulary, or a reviewer who is not independent of the agent. Exit 1,
 *  like GrantRefused: the operator's invocation is the problem, and refusing at
 *  write time is what keeps an untrustworthy review out of the file. */
export class ReviewRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewRefused";
  }
}
