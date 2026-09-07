// The CLI's I/O seam. Every command writes through `CliIo` rather than calling
// console directly, so `run()` is unit-testable: tests capture `out`/`err` into
// arrays and read `env` from a fixture instead of the process. The bin shim
// (index.ts) supplies the real console + process.env.

export type CliIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Environment lookup — the API key is read from here, never printed. */
  env: Record<string, string | undefined>;
};

export const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
};
