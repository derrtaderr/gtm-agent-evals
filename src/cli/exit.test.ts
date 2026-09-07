import { describe, it, expect } from "vitest";
import { EXIT, UsageError, InputError, exitCodeFor } from "./exit.js";

describe("exit codes", () => {
  it("pins the machine-safe exit code table", () => {
    expect(EXIT.PASS).toBe(0);
    expect(EXIT.USAGE).toBe(1);
    expect(EXIT.INPUT).toBe(2);
    expect(EXIT.BLOCK).toBe(3);
    expect(EXIT.REGRESSION).toBe(4);
  });
});

describe("exitCodeFor", () => {
  it("maps a UsageError to exit 1", () => {
    expect(exitCodeFor(new UsageError("bad flags"))).toBe(EXIT.USAGE);
  });

  it("maps an InputError to exit 2", () => {
    expect(exitCodeFor(new InputError("malformed config"))).toBe(EXIT.INPUT);
  });

  it("maps any other error to exit 2 (unreadable input, fail closed)", () => {
    expect(exitCodeFor(new Error("ENOENT: no such file"))).toBe(EXIT.INPUT);
  });
});
