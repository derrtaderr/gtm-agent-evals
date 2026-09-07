// Lane B — golden-trajectory regression. Public surface for the CLI + consumers.
export { record, goldenId, type RecordOptions } from "./record.js";
export { diffTrajectory } from "./diff.js";
export {
  classify,
  DEFAULT_SCORE_TOLERANCE,
  type ClassifyOptions,
} from "./classify.js";
export { regressAll } from "./regress.js";
export { saveGolden, loadGoldens, loadGolden } from "./store.js";
