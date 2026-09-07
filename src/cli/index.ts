#!/usr/bin/env node
// The bin entry (`gtm-agent-evals`). The only place that touches process.argv
// and process.exit — all logic lives in run() so it stays unit-testable. The
// exit code is the machine-safe channel CI keys on.

import { run } from "./run.js";

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    // A throw that escaped run() is unexpected; fail closed to exit 2 rather
    // than the Node default of 1 (which the table reserves for a usage error).
    console.error(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exit(2);
  });
