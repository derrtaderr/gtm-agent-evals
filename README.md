# gtm-agent-evals

An eval and regression platform for GTM agents. Deterministic rules, an LLM rubric
that fails closed, an autonomy gate that makes an agent earn unattended operation,
golden-trajectory regression, telemetry, and a CI gate.

> Scaffold in progress. This README is a stub the build fills in with the real
> quickstart, the three worked archetypes, and the regression walkthrough. Every
> runnable example here must match real output before this repo ships.

## The idea

Drafting is no longer the bottleneck. The failure mode moved downstream, to agents
that ship at volume with nothing checking them. This platform gates a GTM agent the
way tests gate a deploy: it has to pass before it ships, and it has to keep passing.

## Layers

- **Rules** — deterministic, cheap, no model in the loop.
- **Rubric** — an LLM scores named dimensions against thresholds, and fails closed
  to BLOCK if it cannot run.
- **Autonomy gate** — an agent earns unattended operation with N clean runs.
- **Regression** — record a known-good run, replay, and diff. A pass that turns
  into a block, or a scored dimension that drops, is a regression.
- **Telemetry** — every verdict is emitted to a vendor-agnostic sink.
- **CI gate** — evals block a merge the way a failing test does.

## Status

See `SPEC.md` for the full scope and the lane decomposition.

## License

MIT.
