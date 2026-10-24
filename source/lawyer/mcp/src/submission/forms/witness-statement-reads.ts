// The reads behind each VanIAC Witness Statement.

import { submissionDataQuery } from "../backend.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** Witness statement folded into documents (schema v3 #328/#327): the witness statement itself is a documents row (instrument='witness_statement'), reached through filing_documents(role='witness_statement') rather than a dedicated table. */
export interface WitnessStatementRow {
  id: number; // documents.id
  witness_id: number; // documents.deponent
  execution: string | null; // documents.execution
  signed_at: string | null;
  ordinal: number;
  witness_name: string;
  /** documents.label -- the item for this instrument's own 🖋️ Proposal entry. Read by the
   * Proposal inventory alone; nothing rendered uses it. */
  label: string;
}

export interface StatementParagraphRow {
  id: number;
  ordinal: number;
  text: string;
}

export function fetchWitnessStatements(dbPath: string, filingId: number): WitnessStatementRow[] {
  return rows<WitnessStatementRow>(
    dbPath,
    `SELECT d.id, d.deponent AS witness_id, d.execution, d.signed_at, d.label, fd.ordinal,
            w.name AS witness_name
     FROM filing_documents fd
     JOIN documents d ON d.id = fd.document_id
     JOIN witnesses w ON w.id = d.deponent
     WHERE fd.filing_id = ? AND fd.role = 'witness_statement'
     ORDER BY fd.ordinal`,
    [filingId]
  );
}

export function fetchStatementParagraphs(dbPath: string, documentId: number): StatementParagraphRow[] {
  return rows<StatementParagraphRow>(
    dbPath,
    `SELECT id, ordinal, text FROM statement_paragraphs WHERE document_id = ? ORDER BY ordinal`,
    [documentId]
  );
}

/** A paragraph links to the witness's statement of fact, not the fact directly (schema v3 #328: paragraph_statements_of_fact, closing the double path); resolved back to fact_id for the mockup's [facts F#] tag. statement_of_fact_id (build #329) tells renderWitnessStatements which included rows are already drafted into this document, vs. still belonging in the trailing "not yet in this statement" subsection. */
export function fetchParagraphFacts(
  dbPath: string,
  paragraphIds: number[]
): { statement_paragraph_id: number; fact_id: number; statement_of_fact_id: number }[] {
  if (paragraphIds.length === 0) return [];
  const placeholders = paragraphIds.map(() => "?").join(",");
  return rows(
    dbPath,
    `SELECT psof.statement_paragraph_id, sof.fact_id, psof.statement_of_fact_id
     FROM paragraph_statements_of_fact psof
     JOIN statements_of_fact sof ON sof.id = psof.statement_of_fact_id
     WHERE psof.statement_paragraph_id IN (${placeholders})`,
    paragraphIds
  );
}

/** statements_of_fact rows attributed to a witness (build #329/#320: the fact-side ladder).
 * Excludes purpose='impeachment' (schema v10, #380 -- was disposition='included': a witness
 * statement is a delivered document, so the brief-only cap applies, #370 item 4). */
export interface WitnessFactRow {
  id: number; // statements_of_fact.id
  fact_id: number;
  interviewed: number;
  pinpoint: string | null;
  doubt: string | null;
  postulate: string;
  fact_court_record: number | null; // issue #360/#362: facts.court_record -> documents
  exhibit_id: number | null;
  exhibit_pinpoint: string | null;
}

export function fetchIncludedStatementsOfFactForWitness(dbPath: string, witnessId: number): WitnessFactRow[] {
  return rows<WitnessFactRow>(
    dbPath,
    `SELECT sof.id, sof.fact_id, sof.interviewed, sof.pinpoint, sof.doubt,
            sof.exhibit_id, sof.exhibit_pinpoint,
            f.postulate, f.court_record AS fact_court_record
     FROM statements_of_fact sof
     JOIN facts f ON f.id = sof.fact_id
     WHERE sof.witness_id = ? AND (sof.purpose IS NULL OR sof.purpose != 'impeachment')
     ORDER BY sof.id`,
    [witnessId]
  );
}

export interface ReliedOnDocumentRow {
  id: number;
  label: string;
  document_date: string | null;
}

/** Rule 18(b)(v) "documents relied on" (build #359): every exhibit this
 * statement's drafted paragraphs actually cite, via
 * paragraph_statements_of_fact -> statements_of_fact.exhibit_id. Deduped by
 * document, ordered by id -- numbered against the filing's own exhibit map
 * (fetchFilingDocuments + exhibitNumbersFromOrderedIds) so a number here
 * always matches the same document's number on the Evidence Index. */
export function fetchDocumentsReliedOn(dbPath: string, statementDocumentId: number): ReliedOnDocumentRow[] {
  return rows<ReliedOnDocumentRow>(
    dbPath,
    `SELECT DISTINCT d.id, d.label, d.document_date
     FROM statement_paragraphs sp
     JOIN paragraph_statements_of_fact psof ON psof.statement_paragraph_id = sp.id
     JOIN statements_of_fact sof ON sof.id = psof.statement_of_fact_id
     JOIN documents d ON d.id = sof.exhibit_id
     WHERE sp.document_id = ? AND sof.exhibit_id IS NOT NULL
     ORDER BY d.id`,
    [statementDocumentId]
  );
}
