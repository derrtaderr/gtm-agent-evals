import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { GoldenRecord } from "../types.js";

/**
 * Golden store format: a single JSONL file, one GoldenRecord per line. Chosen over a
 * directory-of-files because it is a single artifact the CLI and CI can commit, diff, and
 * cat, and it stays append-friendly. Records are keyed by `id`; saving is an upsert.
 */

/** Read all goldens from a JSONL store. A missing file is an empty store, not an error. */
export function loadGoldens(path: string): GoldenRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as GoldenRecord);
}

/** Read one golden by id, or undefined if it is not in the store. */
export function loadGolden(path: string, id: string): GoldenRecord | undefined {
  return loadGoldens(path).find((g) => g.id === id);
}

/** Upsert a golden into the JSONL store by id, replacing any existing record. */
export function saveGolden(golden: GoldenRecord, path: string): void {
  const existing = loadGoldens(path).filter((g) => g.id !== golden.id);
  existing.push(golden);
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = existing.map((g) => JSON.stringify(g)).join("\n") + "\n";
  // Atomic write: a full-file overwrite that crashes mid-write would corrupt the
  // committed CI golden store. Write a sibling temp file, then rename it over the
  // target — rename is atomic on the same filesystem, so a reader sees either the old
  // store or the fully-written new one, never a torn file.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}
