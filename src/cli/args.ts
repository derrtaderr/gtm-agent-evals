// A tiny, dependency-free flag parser for the CLI. Grammar: the first positional
// token is the command; the rest are `--key value` pairs or bare `--flag`
// booleans. A `--key` immediately followed by another `--flag` (or end of argv)
// is a boolean true. That is all the CLI needs; anything richer belongs in a
// library, and this stays testable and obvious.

export type ParsedArgs = {
  command: string | undefined;
  options: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i++;
    }
  }

  return { command, options };
}
