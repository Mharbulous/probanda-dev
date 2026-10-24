// The submission-side rows a render reads: submissions, their law and facts, and fact statements.

import { submissionDataQuery } from "../backend.js";
import { courtRecordDocumentColumns, excerptSpeakerColumn, linkedProvisionsColumn, noFactsNeededColumn, noLawNeededColumn, servedOrderWordingsColumn, settledOnColumn, treatmentNoteColumn } from "./query.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

export interface SubmissionRow {
  id: number;
  contention: string;
  filing_ordinal: number;
  /** filing_submissions.id -- 🧵 loose-thread keys on the venue form's pointer row, not the
   * submission (design §4). Read by the Proposal inventory alone; nothing rendered uses it. */
  pointer_id: number;
  no_facts_needed_on: string | null; // submissions.no_facts_needed_on (schema v48): counsel's decision that the contention needs no stated fact
  no_law_needed_on: string | null; // submissions.no_law_needed_on (schema v60): counsel's decision that the contention needs no stated law
  served_order_wordings: string; // query.ts servedOrderWordingsColumn: JSON array of the served orders' wordings, read by 📚's ordinary-costs test
}

/** One row per (law_assertion, statement_of_law) a submission `requires` (schema v3 #328/#323: argument_authorities dissolved). A law_assertion with no statement produces one row with statement_id NULL via the LEFT JOIN. statements_of_law.verification (schema v25; was authorities.verification, v10 #380 -- itself was authorities.tier) drives the brief-only cap: a 'lead' statement never rides into a deployed document. */
export interface LawAssertionRow {
  submission_id: number;
  law_assertion_id: number;
  proposition: string;
  dead_end: number;
  statement_id: number | null;
  pinpoint: string | null;
  excerpt: string | null;
  doubt: string | null;
  authority_title: string | null;
  authority_citation: string | null;
  treatment: string | null;
  authority_kind: string | null; // authorities.kind -- with currency_status, picks what 📇 reads (#1628)
  currency_status: string | null; // authorities.currency_status
  currency_checked_on: string | null; // authorities.currency_checked_on -- with currency_status, 📇's freshness window
  treatment_note: string | null; // authorities.treatment_note (schema v51): the note-up note, printed in the note-up tag
  source: string | null; // statements_of_law.source (schema v9, #365); NULL = not yet rated
  verification: string | null; // statements_of_law.verification (schema v25; was authorities.verification, v10 #380); 'lead' -> brief-only cap. NULL only when the LEFT JOIN found no statement at all.
  authority_killed_on: string | null; // authorities.killed_on (schema v16); set -> same brief-only cap as verification='lead'. `treatment='overruled'` rides that cap too (#842).
  settled_on: string | null; // statements_of_law.settled_on (schema v47): the date of counsel's confirmed close, printed in the settled tag
  excerpt_speaker: string | null; // statements_of_law.excerpt_speaker (schema v61): the source the excerpt quotes, printed in the quoting tag
  linked_provisions: string | null; // query.ts linkedProvisionsColumn: the proposition's other statute/regulation/rule citations, read by 🕰️
  /** authorities.id -- the 📇 Proposal keys on the authority, not the statement (design §4).
   * Read by the Proposal inventory, and by the proposition line's overruled tag to name each
   * authority once (#1202). NULL only when the LEFT JOIN found no statement at all
   * (statements_of_law.authority_id is NOT NULL). */
  authority_id: number | null;
}

/** One row per (fact, submission) a submission `rests_on` (schema v3 #328/#323). */
export interface SubmissionFactRow {
  submission_id: number;
  fact_id: number;
  postulate: string;
  court_record: number | null; // issue #360/#362: facts.court_record -> documents
  court_record_pinpoint: string | null;
  /** The court-record document's execution and exhibit_letters (v56), for 📌. */
  court_record_execution: string | null;
  court_record_exhibit_letters: string | null;
}

/** statements_of_fact row (schema v4, #321): `excerpt` is the fact-side twin of statements_of_law.excerpt. instrument_kind/instrument_execution come from the document the statement's instrument points at -- mirrors render-notice-of-application.ts's PART 2 fetchStatementsOfFact join. purpose (schema v10, #380 -- was disposition) drives the brief-only cap: 'impeachment' never rides into a deployed document. */
export interface FactStatementRow {
  fact_id: number;
  statement_id: number;
  /** statements_of_fact.witness_id (NOT NULL) and the witness's own name -- 🗣️/✍️ key on the
   * witness, and a statements_of_fact-keyed item reads `<witness>: <postulate>` (design §8).
   * instrument_label is the item for a documents-keyed 🖋️/✒️ entry. Read by the Proposal
   * inventory alone; nothing rendered uses any of the three. */
  witness_id: number;
  witness_name: string;
  instrument_label: string | null;
  instrument_id: number | null;
  instrument_kind: "witness_statement" | "affidavit" | null;
  instrument_execution: string | null;
  exhibit_id: number | null;
  exhibit_excerpt: string | null;
  exhibit_pinpoint: string | null;
  pinpoint: string | null;
  excerpt: string | null;
  interviewed: number;
  purpose: string | null;
  doubt: string | null;
}

/** document discriminator on the per-filing pointer tables (schema v10, #380): 'form' is a
 * filing's venue document(s); 'written_argument' is its Written Arguments companion -- except for
 * a VanIAC submissions_package filing, where the Written Arguments IS the venue document and its
 * pointer rows are 'form' (#380's resolution: "for a VanIAC submissions package that face is the
 * submissions document itself"; #370 item 5). */
export type PointerDocument = "form" | "written_argument";

export function fetchSubmissions(dbPath: string, filingId: number, document: PointerDocument): SubmissionRow[] {
  return rows<SubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention, fs.ordinal AS filing_ordinal, fs.id AS pointer_id, ${noFactsNeededColumn(dbPath)}, ${noLawNeededColumn(dbPath)}, ${servedOrderWordingsColumn()}
     FROM filing_submissions fs
     JOIN submissions s ON s.id = fs.submission_id
     WHERE fs.filing_id = ? AND fs.document = ? AND s.killed_on IS NULL
     ORDER BY fs.ordinal`,
    [filingId, document]
  );
}

export function fetchSubmissionLaw(dbPath: string, submissionIds: number[]): LawAssertionRow[] {
  if (submissionIds.length === 0) return [];
  const placeholders = submissionIds.map(() => "?").join(",");
  return rows<LawAssertionRow>(
    dbPath,
    `SELECT sub_law.submission_id, la.id AS law_assertion_id, la.proposition, la.dead_end,
            sl.id AS statement_id, sl.pinpoint, sl.excerpt, sl.doubt, sl.source, sl.verification, ${settledOnColumn(dbPath)},
            ${excerptSpeakerColumn(dbPath)}, ${linkedProvisionsColumn(dbPath)},
            auth.id AS authority_id,
            auth.style_of_cause_or_title AS authority_title, auth.citation AS authority_citation, auth.treatment,
            auth.kind AS authority_kind, auth.currency_status, auth.currency_checked_on, ${treatmentNoteColumn(dbPath)}, auth.killed_on AS authority_killed_on
     FROM submission_law sub_law
     JOIN law_assertions la ON la.id = sub_law.law_assertion_id
     LEFT JOIN statements_of_law sl ON sl.law_assertion_id = la.id
     LEFT JOIN authorities auth ON auth.id = sl.authority_id
     WHERE sub_law.submission_id IN (${placeholders})
     ORDER BY la.id, sl.id`,
    submissionIds
  );
}

export function fetchSubmissionFacts(dbPath: string, submissionIds: number[]): SubmissionFactRow[] {
  if (submissionIds.length === 0) return [];
  const placeholders = submissionIds.map(() => "?").join(",");
  return rows<SubmissionFactRow>(
    dbPath,
    `SELECT sf.submission_id, f.id AS fact_id, f.postulate, f.court_record, f.court_record_pinpoint, ${courtRecordDocumentColumns(dbPath, "cr")}
     FROM submission_facts sf
     JOIN facts f ON f.id = sf.fact_id
     LEFT JOIN documents cr ON cr.id = f.court_record
     WHERE sf.submission_id IN (${placeholders})
     ORDER BY f.id`,
    submissionIds
  );
}

export function fetchFactStatements(dbPath: string, factIds: number[]): FactStatementRow[] {
  if (factIds.length === 0) return [];
  const placeholders = factIds.map(() => "?").join(",");
  return rows<FactStatementRow>(
    dbPath,
    `SELECT sof.fact_id, sof.id AS statement_id, sof.instrument AS instrument_id,
            sof.witness_id, w.name AS witness_name, doc.label AS instrument_label,
            doc.instrument AS instrument_kind, doc.execution AS instrument_execution,
            sof.exhibit_id, sof.exhibit_excerpt, sof.exhibit_pinpoint, sof.pinpoint, sof.excerpt, sof.interviewed, sof.purpose, sof.doubt
     FROM statements_of_fact sof
     JOIN witnesses w ON w.id = sof.witness_id
     LEFT JOIN documents doc ON doc.id = sof.instrument
     WHERE sof.fact_id IN (${placeholders})
     ORDER BY sof.id`,
    factIds
  );
}

export interface DeployedIds {
  orderIds: Set<number>;
  submissionIds: Set<number>;
  factIds: Set<number>;
}

/** id-only pointer-list read for one filing/document (schema v10, #380) -- cheap enough to call a
 * second time just to diff against, for 🧵 loose-thread: an item the venue form deploys that the
 * Written Arguments doesn't. Not meaningful for a VanIAC submissions_package filing (its venue
 * document IS the Written Arguments, both read document='form' -- #380/#370 item 5), so callers
 * on that filing kind never invoke this. */
export function fetchDeployedIds(dbPath: string, filingId: number, document: PointerDocument): DeployedIds {
  return {
    orderIds: new Set(
      rows<{ order_sought_id: number }>(dbPath, `SELECT order_sought_id FROM filing_orders WHERE filing_id = ? AND document = ?`, [filingId, document]).map(
        (r) => r.order_sought_id
      )
    ),
    submissionIds: new Set(
      rows<{ submission_id: number }>(
        dbPath,
        `SELECT fs.submission_id FROM filing_submissions fs
         JOIN submissions s ON s.id = fs.submission_id
         WHERE fs.filing_id = ? AND fs.document = ? AND s.killed_on IS NULL`,
        [filingId, document]
      ).map((r) => r.submission_id)
    ),
    factIds: new Set(
      rows<{ fact_id: number }>(dbPath, `SELECT fact_id FROM filing_facts WHERE filing_id = ? AND document = ?`, [filingId, document]).map((r) => r.fact_id)
    ),
  };
}
