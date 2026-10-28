// The reads every drafting_forms tool entry opens with.

import { submissionDataQuery } from "../backend.js";
import { isJobOnlyBoard, type FilingRow } from "./query.js";
import { ValidationError } from "../../errors.js";

export function fetchFilingById(dbPath: string, filingId: number): FilingRow {
  const found = submissionDataQuery(dbPath, "SELECT * FROM filings WHERE id = ?", [filingId]).rows as unknown as FilingRow[];
  if (found.length === 0) throw new ValidationError(`No filing found with id ${filingId}`);
  return found[0];
}

/** A Milestone with no Writing has no document to emit or gate: the filed-face emitters and the
 * pre-filing check refuse it by name, before anything is read for it. */
export function refuseJobOnlyBoard(filing: FilingRow): void {
  if (isJobOnlyBoard(filing)) {
    throw new ValidationError(`Milestone ${filing.id} has no Writing, so it has no document`, "milestone_only");
  }
}

/** Generalises the single `schema_version` read below to any db_meta key -- the one SQL shape
 * already there, with `key` bound rather than inlined. `db_meta.value` is always TEXT; a caller
 * wanting a number converts it with Number() (see readSchemaVersion). */
export function readDbMetaValue(dbPath: string, key: string): string | null {
  const rows = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = ?", [key]).rows as unknown as {
    value: string;
  }[];
  return rows.length > 0 ? rows[0].value : null;
}

export function readSchemaVersion(dbPath: string): number | null {
  const value = readDbMetaValue(dbPath, "schema_version");
  return value === null ? null : Number(value);
}
