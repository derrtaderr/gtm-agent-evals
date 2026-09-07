import { readFile, writeFile } from "node:fs/promises";
import type { RunRecord } from "../types.js";

/** Count of consecutive trailing PASS runs for a config, newest first. A BLOCK
 *  for that config resets the streak; runs for other configs are skipped. */
export function computeStreak(runs: RunRecord[], configId: string): number {
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.configId !== configId) continue;
    if (r.status === "PASS") streak++;
    else break;
  }
  return streak;
}

/** The N-clean-runs autonomy gate: an agent is cleared once its streak of clean
 *  runs meets the configured gate. */
export function clearedForAutonomy(streak: number, gateN: number): boolean {
  return streak >= gateN;
}

/** Read a JSON run log, tolerating a missing/empty/corrupt file as no runs. */
export async function readRuns(path: string): Promise<RunRecord[]> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RunRecord[];
  } catch {
    return [];
  }
}

/** Append one run record to the JSON run log at `path`. */
export async function appendRun(path: string, record: RunRecord): Promise<void> {
  const runs = await readRuns(path);
  runs.push(record);
  await writeFile(path, JSON.stringify(runs, null, 2), "utf8");
}
