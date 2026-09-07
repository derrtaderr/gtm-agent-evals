import type { AgentRun, RunStep, TrajectoryDiff } from "../types.js";

/** The ordered list of tool_call names in a run — its tool-call sequence. */
function toolCallSequence(run: AgentRun): string[] {
  return (run.steps ?? [])
    .filter((s) => s.kind === "tool_call")
    .map((s) => s.name ?? "");
}

/**
 * Diff a golden run against a fresh run for the same input, as a list of dotted-path
 * field diffs over `output`, each step's `kind` / `name` / `content`, and the overall
 * tool-call sequence. Metadata is deliberately ignored: a metadata-only difference is
 * "within tolerance" and yields no diffs, which is what lets the classifier call it MATCH.
 */
export function diffTrajectory(golden: AgentRun, actual: AgentRun): TrajectoryDiff[] {
  const diffs: TrajectoryDiff[] = [];

  if (golden.output !== actual.output) {
    diffs.push({ field: "output", golden: golden.output, actual: actual.output });
  }

  const gSteps = golden.steps ?? [];
  const aSteps = actual.steps ?? [];
  const maxLen = Math.max(gSteps.length, aSteps.length);
  for (let i = 0; i < maxLen; i++) {
    const g: RunStep | undefined = gSteps[i];
    const a: RunStep | undefined = aSteps[i];
    if (g?.kind !== a?.kind) {
      diffs.push({ field: `steps[${i}].kind`, golden: g?.kind, actual: a?.kind });
    }
    if (g?.name !== a?.name) {
      diffs.push({ field: `steps[${i}].name`, golden: g?.name, actual: a?.name });
    }
    if (g?.content !== a?.content) {
      diffs.push({ field: `steps[${i}].content`, golden: g?.content, actual: a?.content });
    }
  }

  const gSeq = toolCallSequence(golden);
  const aSeq = toolCallSequence(actual);
  if (JSON.stringify(gSeq) !== JSON.stringify(aSeq)) {
    diffs.push({ field: "toolCallSequence", golden: gSeq, actual: aSeq });
  }

  return diffs;
}
