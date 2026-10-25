// The facts a filing's form holds in its facts Part, and the statements of fact behind them:
// the reads every filing renderer shares, with each kind's facts Part in one table.

import { submissionDataQuery } from "../backend.js";
import { courtRecordDocumentColumns } from "./query.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** Each kind's facts Part, as its form's filing_facts rows record it: the BCSC Notice of
 * Application's Part 2, the Application Response's Part 4 (#372), the BCCA stay response's
 * Statement of Facts (checklists §10) and the factum's Part 1, which uses the same slot (§12). */
const FACTS_PART: ReadonlyMap<string, string> = new Map([
  ["notice_of_application", "part2"],
  ["application_response", "part4"],
  ["bcca_stay_response", "part2"],
  ["bcca_factum", "part2"],
]);

/** The facts Part of `kind`'s form. Throws for a kind whose form has none. */
export function factsPart(kind: string): string {
  const part = FACTS_PART.get(kind);
  if (part === undefined) throw new Error(`No facts Part is registered for kind ${kind}`);
  return part;
}

export interface FactRow {
  id: number;
  postulate: string;
  court_record: number | null;
  court_record_pinpoint: string | null;
  /** The court-record document's execution and exhibit_letters (v56), for 📌. */
  court_record_execution: string | null;
  court_record_exhibit_letters: string | null;
  /** filing_facts.id -- 🧵 loose-thread keys on the venue form's pointer row, not the fact
   * (design §4). Read by the Proposal inventory alone; nothing rendered uses it. */
  pointer_id: number;
  /** filing_facts.ordinal, the scale a facts-part rhetorical paragraph is placed on (render-rhetoric.ts). */
  filing_ordinal: number;
}

/** filing_facts scoped to document='form' AND the given part, in form order. */
export function fetchFacts(dbPath: string, filingId: number, part: string): FactRow[] {
  return rows<FactRow>(
    dbPath,
    `SELECT f.id, f.postulate, f.court_record, f.court_record_pinpoint, ${courtRecordDocumentColumns(dbPath, "cr")}, ff.id AS pointer_id, ff.ordinal AS filing_ordinal
     FROM filing_facts ff
     JOIN facts f ON f.id = ff.fact_id
     LEFT JOIN documents cr ON cr.id = f.court_record
     WHERE ff.filing_id = ? AND ff.document = 'form' AND ff.part = ?
     ORDER BY ff.ordinal`,
    [filingId, part]
  );
}

export interface StatementOfFactRow {
  id: number;
  fact_id: number;
  pinpoint: string | null;
  doubt: string | null;
  interviewed: number;
  instrument_id: number | null;
  instrument_kind: "witness_statement" | "affidavit" | null;
  instrument_execution: string | null;
  exhibit_id: number | null;
  exhibit_pinpoint: string | null;
  /** 'impeachment' never rides a delivered document, so it gets no 🧐 (renderSubmissionParagraphs skips it too). */
  purpose: string | null;
  /** Witness and instrument identity for the Proposal inventory alone (design §8: 🗣️/✍️ key on
   * the witness, 🖋️/✒️ on the instrument, and a statement's item reads `<witness>: <postulate>`).
   * Nothing rendered uses any of the three. */
  witness_id: number;
  witness_name: string;
  instrument_label: string | null;
}

export function fetchStatementsOfFact(dbPath: string, factIds: number[]): StatementOfFactRow[] {
  if (factIds.length === 0) return [];
  const placeholders = factIds.map(() => "?").join(",");
  return rows<StatementOfFactRow>(
    dbPath,
    `SELECT sof.id, sof.fact_id, sof.pinpoint, sof.doubt, sof.exhibit_id, sof.exhibit_pinpoint, sof.interviewed, sof.instrument AS instrument_id, sof.purpose,
            sof.witness_id, w.name AS witness_name, doc.label AS instrument_label,
            doc.instrument AS instrument_kind, doc.execution AS instrument_execution
     FROM statements_of_fact sof
     JOIN witnesses w ON w.id = sof.witness_id
     LEFT JOIN documents doc ON doc.id = sof.instrument
     WHERE sof.fact_id IN (${placeholders})`,
    factIds
  );
}
