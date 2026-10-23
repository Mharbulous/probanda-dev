// drafting_data__record_filed (party/counsel SSOT; submission schema v42): the filing date of a
// Writing that is not a general one. A general Writing's Sent date is the Sent write's
// (sent-write.ts). One transaction writes the party rows the Writing is filed with
// (forms/parties-snapshot.ts) and then sets `filed_on`, which freezes its exhibits and moves the
// revision; the v42 guard refuses to set filed_on any other way while its proceeding has a party.
// The /drafting-data gatekeeper documents it in filing-checklists.md section 11. Clearing a
// filed_on set in error stays a raw update there: the guard reads only a NULL becoming a date.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { storedLayout } from "./layout-snapshot.js";
import { SERVED_KINDS } from "./lifecycle.js";
import { partiesSnapshotStatements } from "./parties-snapshot.js";
import { fetchRevision, isJobOnlyBoard, type FilingRow } from "./query.js";
import { isCalendarDate } from "./sent-write.js";

const TOOL = "drafting_data__record_filed";

export interface RecordFiledArgs {
  db_path: string;
  filing_id: number;
  /** The filing date, YYYY-MM-DD. */
  filed_on: string;
}

export interface RecordFiledResult {
  filing_id: number;
  filed_on: string;
  /** The party rows this call wrote: 0 when the Writing already had them, or its proceeding has no party. */
  parties_snapshot_rows: number;
  revision: number;
  note: string;
  warning?: string;
}

function refused(message: string, code: string): DataServerError {
  return new DataServerError(`${TOOL}: ${message}`, code);
}

/** drafting_data__record_filed. Every refusal writes nothing. */
export async function submissionDataRecordFiled(args: RecordFiledArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordFiledResult> {
  if (!isCalendarDate(args.filed_on)) throw new ValidationError(`${TOOL}.filed_on must be a calendar date, YYYY-MM-DD`, "invalid_filed_on");
  const [filing] = submissionDataQuery(args.db_path, "SELECT * FROM filings WHERE id = ?", [args.filing_id]).rows as unknown as FilingRow[];
  if (filing === undefined) throw new NotFoundError("That Writing is not in this matter's drafting records", "not_found");
  if (isJobOnlyBoard(filing)) throw refused(`Job Board ${filing.id} has no Writing, so there is nothing to record as filed`, "job_board_only");
  if (filing.retired_on) throw refused(`"${filing.title}" was retired on ${filing.retired_on}`, "writing_retired");
  if (filing.filed_on && filing.sent_copy_id !== null && SERVED_KINDS.has(filing.kind)) {
    throw refused(
      `"${filing.title}" was recorded as served on ${filing.filed_on} under amended Rule 8-1 and stays frozen as served. ` +
        "Its registry filing is a step of the Set down for hearing or File the served response job, which saves the filed copy",
      "served_writing"
    );
  }
  if (filing.filed_on) throw refused(`"${filing.title}" was already recorded as filed or sent on ${filing.filed_on}`, "already_filed");
  if (filing.layout_snapshot !== null && storedLayout(filing).layout.renderer === "general") {
    throw refused(`"${filing.title}" is a letter or general document; record it as sent, not as filed`, "general_writing");
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
      { sql: "UPDATE filings SET filed_on = ? WHERE id = ? AND filed_on IS NULL AND retired_on IS NULL", params: [args.filed_on, filing.id], expect_changes: 1 },
    ],
    env
  );
  if (!written.ok) {
    if (written.failed === 0) {
      throw refused(`"${filing.title}" changed while it was being recorded; nothing was written. Record it as filed again`, "revision_moved");
    }
    throw refused(`"${filing.title}" was filed, sent or retired while it was being recorded; nothing was written`, "already_filed");
  }
  return {
    filing_id: filing.id,
    filed_on: args.filed_on,
    parties_snapshot_rows: snapshot.length,
    revision: fetchRevision(args.db_path),
    note:
      `"${filing.title}" recorded as filed on ${args.filed_on}; its exhibits are frozen. ` +
      (snapshot.length > 0 ? `The details of the ${snapshot.length} part(ies) it was filed with were saved from the case records.` : "Its parties' details stand as they were, or its proceeding has no party."),
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
