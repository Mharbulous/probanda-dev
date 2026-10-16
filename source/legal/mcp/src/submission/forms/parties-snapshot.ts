// The party rows a Writing is sent or filed with (party/counsel SSOT; submission schema v42). The
// runtime writes them into `parties_snapshot` from the case-data read, in the transaction that sets
// the Writing's filed_on and ahead of that statement: drafting_data__record_sent and
// drafting_data__record_filed. The v42 trigger guard_filings_parties_snapshot refuses to set
// filed_on any other way while the proceeding has a party. The SQL here is the runtime's own, as
// sent-write.ts's is.

import { dirname } from "node:path";

import { DataServerError } from "../../errors.js";
import { submissionDataQuery, type WriteStatement } from "../backend.js";
import { draftingParties } from "../parties-drift.js";
import { fetchParties, fetchProceeding, type FilingRow } from "./query.js";

const INSERT =
  "INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, " +
  "address_for_service, address_for_service_filed, counsel_name, counsel_firm, counsel_phone, counsel_email, lower_court_role) " +
  "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? " +
  "WHERE NOT EXISTS (SELECT 1 FROM parties_snapshot WHERE filing_id = ? AND party_id = ?)";

/**
 * The INSERTs writing a drafting Writing's party rows as its mockup prints them: names, roles and
 * flags from `parties`, counsel and the address for service read from case data in the folder holding
 * the database. None when the Writing already has snapshot rows, which stand (a filed_on cleared in
 * error and set again keeps the first snapshot), or when its proceeding has no party. Refuses
 * `parties_drift`, before anything is written, while any party's values cannot be read from case
 * data: the filed render's gate.
 */
export function partiesSnapshotStatements(dbPath: string, filing: FilingRow, tool: string, env: NodeJS.ProcessEnv = process.env): WriteStatement[] {
  const [held] = submissionDataQuery(dbPath, "SELECT COUNT(*) AS n FROM parties_snapshot WHERE filing_id = ?", [filing.id]).rows as unknown as { n: number }[];
  if (held.n > 0) return [];
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const { parties, drift } = draftingParties(dirname(dbPath), proceeding, fetchParties(dbPath, proceeding.id), env);
  if (drift.rows.length > 0) {
    throw new DataServerError(
      `${tool}: counsel of record and the address for service, which case data owns, could not be read for party row(s): ` +
        drift.rows.map((r) => `${r.name} (${r.kind})`).join(", ") +
        (drift.unchecked ? ` (${drift.unchecked.note})` : "") +
        ". Nothing was written. Confirm each with the practitioner and link it to its case-data party, or correct case data through /case-data first " +
        `(references/filing-checklists.md §0), then call ${tool} again`,
      "parties_drift"
    );
  }
  return parties.map((p) => ({
    sql: INSERT,
    params: [
      filing.id,
      p.id,
      p.name,
      p.role,
      p.ordinal,
      p.is_client,
      p.is_applicant,
      p.to_be_served,
      p.address_for_service,
      p.address_for_service_filed,
      p.counsel_name,
      p.counsel_firm,
      p.counsel_phone,
      p.counsel_email,
      p.lower_court_role,
      filing.id,
      p.id,
    ],
    // A row another session wrote for this Writing and party since the read changes none, so the
    // caller's write fails at this statement rather than raising on UNIQUE (filing_id, party_id).
    expect_changes: 1,
  }));
}
