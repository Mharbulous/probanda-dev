// A Writing's party rows, read live from case data, their digest and the parties-drift gate.

import { dirname } from "node:path";

import { sha256 } from "../render-manifest.js";
import { fetchParties, fetchSentParties, type FilingRow, type ProceedingRow } from "./query.js";
import { draftingParties, type DraftingParties, type PartiesDrift, type PartiesDriftRow } from "../parties-drift.js";

/** A Writing's party rows and their drift. A sent Writing prints the party rows it printed when sent
 * (schema v41, party/counsel SSOT) and is never read against case data. A drafting Writing's rows
 * take counsel and the address for service live from case data, in the folder holding this database. */
export function partiesFor(dbPath: string, proceeding: ProceedingRow, filing: FilingRow): DraftingParties {
  if (filing.filed_on) return { parties: fetchSentParties(dbPath, filing), drift: { rows: [] } };
  return draftingParties(dirname(dbPath), proceeding, fetchParties(dbPath, proceeding.id));
}

/** The drift and every party's matter-data values, as the render manifest's `parties_drift` records them:
 * case data's writes move no stamp input, so a counsel change there must miss the manifest. The one
 * construction shared by render, bootstrap's render_state and the background job's freshness check (#1308). */
export function partiesDigest({ parties, drift }: DraftingParties): string {
  return sha256(
    JSON.stringify({
      rows: drift.rows,
      parties: parties.map((p) => [p.id, p.counsel_name, p.counsel_firm, p.counsel_email, p.counsel_phone, p.address_for_service]),
    })
  );
}

/** The drift fields a response carries: each drifted row, and why case data could not be read. */
export function driftReport(drift: PartiesDrift): { parties_drift?: PartiesDriftRow[]; parties_drift_note?: string } {
  return {
    ...(drift.rows.length > 0 ? { parties_drift: drift.rows } : {}),
    ...(drift.unchecked ? { parties_drift_note: drift.unchecked.note } : {}),
  };
}

export interface PartiesDriftRefusal {
  filing_id: number;
  revision: number;
  parties_drift_gate_failed: true;
  parties_drift?: PartiesDriftRow[];
  parties_drift_note?: string;
  note: string;
}

/** The party drift gate (party/counsel SSOT), shared by the filed render and the four filed-face
 * emitters: a drafting Writing's filed face never goes out while a party's counsel or address for
 * service could not be read from case data. Null when no row drifts. */
export function partiesDriftRefusal(filingId: number, revision: number, drift: PartiesDrift, tool: string): PartiesDriftRefusal | null {
  if (drift.rows.length === 0) return null;
  return {
    filing_id: filingId,
    revision,
    parties_drift_gate_failed: true,
    ...driftReport(drift),
    note:
      "Refusing to render the filed face: counsel of record and the address for service, which case data owns, could not be read for party row(s): " +
      drift.rows.map((r) => `${r.name} (${r.kind})`).join(", ") +
      ". Confirm each with the practitioner and link it to its matter-data party, or correct case data through /matter-data first " +
      `(references/filing-checklists.md §0), then call ${tool} again.`,
  };
}
