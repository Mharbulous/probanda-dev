// drafting_data__record_served (amended Rule 8-1, B.C. Reg. 105/2026, in force 2026-10-01): the
// service date of a Notice of Application or Application Response, which is served before it is
// filed (8-1 (3), (9)). One transaction, in the order of the Sent write (sent-write.ts), writes the
// party rows the Writing is served with (forms/parties-snapshot.ts), a `documents` row for the
// served copy, `sent_copy_id` pointing at it, and `filed_on` set to the service date. Setting
// filed_on freezes the Writing at service, which is right: 14.4 (b) files "the notice of
// application served under subrule (3)". sent_copy_id is what tells a served Writing from one filed
// the old way (lifecycle.ts). The later registry filing is a job step with an unlinked documents
// row (jobs-stock.md §3b), not a write here. The /drafting-data gatekeeper documents it in
// filing-checklists.md section 11.

import { existsSync } from "node:fs";
import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { SERVED_KINDS } from "./lifecycle.js";
import { partiesSnapshotStatements } from "./parties-snapshot.js";
import { fetchRevision, isJobOnlyBoard, type FilingRow } from "./query.js";
import { isCalendarDate } from "./sent-write.js";

const TOOL = "drafting_data__record_served";

export interface RecordServedArgs {
  db_path: string;
  filing_id: number;
  /** The service date, YYYY-MM-DD. */
  served_on: string;
  /** The copy served, when it is on disk. */
  served_copy_path?: string;
}

export interface RecordServedResult {
  filing_id: number;
  served_on: string;
  /** The documents row of the served copy. */
  sent_copy_id: number;
  /** The party rows this call wrote: 0 when the Writing already had them, or its proceeding has no party. */
  parties_snapshot_rows: number;
  revision: number;
  note: string;
  warning?: string;
}

function refused(message: string, code: string): DataServerError {
  return new DataServerError(`${TOOL}: ${message}`, code);
}

/** drafting_data__record_served. Every refusal writes nothing. */
export async function submissionDataRecordServed(args: RecordServedArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordServedResult> {
  if (!isCalendarDate(args.served_on)) throw new ValidationError(`${TOOL}.served_on must be a calendar date, YYYY-MM-DD`, "invalid_served_on");
  if (args.served_copy_path !== undefined && !existsSync(args.served_copy_path)) {
    throw new ValidationError(`${TOOL}.served_copy_path does not exist: ${args.served_copy_path}`, "invalid_served_copy");
  }
  const [filing] = submissionDataQuery(args.db_path, "SELECT * FROM filings WHERE id = ?", [args.filing_id]).rows as unknown as FilingRow[];
  if (filing === undefined) throw new NotFoundError("That Writing is not in this matter's drafting records", "not_found");
  if (isJobOnlyBoard(filing)) throw refused(`Job Board ${filing.id} has no Writing, so there is nothing to record as served`, "job_board_only");
  if (filing.retired_on) throw refused(`"${filing.title}" was retired on ${filing.retired_on}`, "writing_retired");
  if (filing.filed_on) throw refused(`"${filing.title}" was already recorded as served, filed or sent on ${filing.filed_on}`, "already_filed");
  if (!SERVED_KINDS.has(filing.kind)) {
    throw refused(
      `"${filing.title}" is not a notice of application or an application response, the only documents served before filing. ` +
        "Record a court form as filed, or a letter or general document as sent",
      "not_served_kind"
    );
  }
  const revision = fetchRevision(args.db_path);
  const snapshot = partiesSnapshotStatements(args.db_path, filing, TOOL, env);
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      // The revision guard: nothing has moved since the party rows were read.
      { sql: "UPDATE db_meta SET value = value WHERE key = 'revision' AND CAST(value AS INTEGER) = ?", params: [revision], expect_changes: 1 },
      // Before the statement that sets filed_on, which the v42 guard refuses while the Writing has none.
      ...snapshot,
      {
        sql: "INSERT INTO documents (proceeding_id, label, document_date, description, file_path) VALUES (?, ?, ?, ?, ?)",
        params: [filing.proceeding_id, `Served copy — ${filing.title}`, args.served_on, "served copy, unfiled", args.served_copy_path ?? null],
        expect_changes: 1,
      },
      {
        // The documents row inserted just above.
        sql: "UPDATE filings SET sent_copy_id = last_insert_rowid(), filed_on = ? WHERE id = ? AND filed_on IS NULL AND retired_on IS NULL",
        params: [args.served_on, filing.id],
        expect_changes: 1,
      },
    ],
    env
  );
  if (!written.ok) {
    if (written.failed === 0) {
      throw refused(`"${filing.title}" changed while it was being recorded; nothing was written. Record it as served again`, "revision_moved");
    }
    throw refused(`"${filing.title}" was served, filed or retired while it was being recorded; nothing was written`, "already_filed");
  }
  const [after] = submissionDataQuery(args.db_path, "SELECT sent_copy_id FROM filings WHERE id = ?", [filing.id]).rows as unknown as { sent_copy_id: number }[];
  return {
    filing_id: filing.id,
    served_on: args.served_on,
    sent_copy_id: after.sent_copy_id,
    parties_snapshot_rows: snapshot.length,
    revision: fetchRevision(args.db_path),
    note:
      `"${filing.title}" recorded as served on ${args.served_on}; it is frozen as served. ` +
      (snapshot.length > 0 ? `The details of the ${snapshot.length} part(ies) it was served with were saved from the case records.` : "Its parties' details stand as they were, or its proceeding has no party."),
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
