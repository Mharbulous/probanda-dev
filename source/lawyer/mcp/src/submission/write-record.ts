// This computer's record of its own writes to one drafting database (spec 2026-11-17 drafting-records sync
// safety, section 3.2): a random writer id minted on first write and the count of committed writes it made.
// Every committed write also sets db_meta `writes:<writer id>` to the new count in the file (backend.ts). A
// live file holding a lower count, or none while this computer remembers one, has lost this computer's writes:
// a sync or a restore put an older copy in its place. The record is host-local, beside the write lock, so it
// is never synced, and it is Probanda's own file (Commandment 7).

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { hostLocalPath } from "./lock.js";

export interface WriteRecord {
  id: string;
  writes: number;
}

/** The db_meta key holding a writer's count in the file. */
export const writesKey = (id: string): string => `writes:${id}`;

const recordPath = (dbPath: string, env: NodeJS.ProcessEnv): string => hostLocalPath(dbPath, "writes.json", env);

/** This computer's record for dbPath, or null before its first committed write. */
export function readWriteRecord(dbPath: string, env: NodeJS.ProcessEnv = process.env): WriteRecord | null {
  const path = recordPath(dbPath, env);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, "utf-8")) as WriteRecord;
  if (typeof record.id !== "string" || !Number.isInteger(record.writes)) throw new Error(`unreadable write record at ${path}`);
  return record;
}

/** The record a write passes to the helper: the stored one, or a fresh id at count 0 (stored only once a write commits). */
export function writerFor(dbPath: string, env: NodeJS.ProcessEnv = process.env): WriteRecord {
  return readWriteRecord(dbPath, env) ?? { id: randomUUID(), writes: 0 };
}

/** Stores the record, called after the live file was replaced. */
export function saveWriteRecord(dbPath: string, record: WriteRecord, env: NodeJS.ProcessEnv = process.env): void {
  const path = recordPath(dbPath, env);
  writeFileSync(`${path}.tmp`, JSON.stringify(record));
  renameSync(`${path}.tmp`, path);
}

/** The refusal when the live file lacks `missing` of this computer's writes. Plain words: the practitioner hears it. */
export function lostWritesMessage(dbPath: string, missing: number): string {
  return (
    `lost_writes: the drafting records file ${dbPath} is missing ${missing} change${missing === 1 ? "" : "s"} this computer saved to it, ` +
    "so an older copy of the file has taken its place, most likely through the file sync. Nothing was written. Wait for the file sync " +
    "to finish on this computer, then try again. If the changes do not come back, look for a newer version of the file in the sync " +
    "service's version history for its folder, or, if copies of it appear, merge them by /drafting-data references/sync-split.md. " +
    "Only if the practitioner, asked plainly what is missing, says to carry on without those changes: call drafting_forms__open_session " +
    "or drafting_data__migrate with accept_current_file: true."
  );
}
