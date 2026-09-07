import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("reads the command as the first positional token", () => {
    const parsed = parseArgs(["eval", "--config", "c.json"]);
    expect(parsed.command).toBe("eval");
  });

  it("reads --key value pairs into options", () => {
    const parsed = parseArgs(["eval", "--config", "c.json", "--run", "r.json"]);
    expect(parsed.options.config).toBe("c.json");
    expect(parsed.options.run).toBe("r.json");
  });

  it("treats a --flag with no following value as a boolean true", () => {
    const parsed = parseArgs(["eval", "--rules-only", "--config", "c.json"]);
    expect(parsed.options["rules-only"]).toBe(true);
    expect(parsed.options.config).toBe("c.json");
  });

  it("treats a trailing --flag as a boolean true", () => {
    const parsed = parseArgs(["eval", "--config", "c.json", "--rules-only"]);
    expect(parsed.options["rules-only"]).toBe(true);
  });

  it("returns an undefined command when argv is empty", () => {
    const parsed = parseArgs([]);
    expect(parsed.command).toBeUndefined();
  });
});
