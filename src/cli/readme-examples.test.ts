// The README's "every runnable example matches real output" promise, enforced.
//
// It was not enforced before. `ledger-fixtures.test.ts` asserts CLI output
// against expectations written inline in the test file; it never opens
// README.md, so a reworded message or a new table column updated the test and
// left the README stale — which is exactly what happened when the INCIDENT
// column and the "unarchived" summary landed. A promise that nothing checks is
// a promise that decays on the next commit.
//
// The mechanism: a README block preceded by
//
//     <!-- verified: <argv...> -->
//
// is run through the real CLI and compared to the block byte for byte. A
// trailing `# exit N` line in the block is stripped and asserted as the exit
// code. Adding a verified example is one comment line; letting one drift is a
// failing test.
//
// Only blocks whose output is fully determined belong here. The README's
// elided examples (`# ...`) deliberately carry no marker.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./run.js";
import type { CliIo } from "./run.js";

const README = readFileSync(join(process.cwd(), "README.md"), "utf8");

const VERIFIED = /<!-- verified: (.+?) -->\r?\n```text\r?\n([\s\S]*?)```/g;

type Example = { argv: string[]; expected: string; exit?: number };

function parseExamples(): Example[] {
  const found: Example[] = [];
  for (const m of README.matchAll(VERIFIED)) {
    const argv = m[1].trim().split(/\s+/);
    const lines = m[2].replace(/\r?\n$/, "").split("\n");
    let exit: number | undefined;
    const last = lines[lines.length - 1];
    const exitMatch = last?.match(/^# exit (\d+)$/);
    if (exitMatch) {
      exit = Number(exitMatch[1]);
      lines.pop();
    }
    found.push({ argv, expected: lines.join("\n"), exit });
  }
  return found;
}

const examples = parseExamples();

describe("README examples match real output", () => {
  it("finds the verified blocks — a deleted marker must not silently pass", () => {
    // Guards the mechanism itself. Without this, removing every marker turns
    // this whole file into a green no-op.
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  for (const ex of examples) {
    it(`\`${ex.argv[0]}\` block is byte-identical to the CLI's output`, async () => {
      const out: string[] = [];
      const io: CliIo = { out: (l) => out.push(l), err: () => {}, env: {} };
      const code = await run(ex.argv, io);
      expect(out.join("\n")).toBe(ex.expected);
      if (ex.exit !== undefined) expect(code).toBe(ex.exit);
    });
  }
});
