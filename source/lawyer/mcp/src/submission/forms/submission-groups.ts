// Groups a filing's fact rows and law rows by submission.

import type { FactStatementRow, LawAssertionRow, SubmissionFactRow } from "./submission-reads.js";

export interface SubmissionFactGroup {
  factId: number;
  postulate: string;
  courtRecord: number | null; // issue #360/#362: facts.court_record -> documents
  courtRecordPinpoint: string | null;
  courtRecordExecution: string | null;
  courtRecordExhibitLetters: string | null;
  /** Issue #345: derived per-fact coverage, see admittedAgainstAllOpposing -- true once every opposing party has tendered an admission of this postulate. */
  admitted: boolean;
  /** Issue #361: this fact's deduped spent-admission rungs (🙅🏻‍♂️/🫸/🤷/⚡️), "" if none -- prefixed onto noWitnessMarker's 👤 when it fires. */
  spentAdmissionGlyphs: string;
  /** Schema v69: counsel has suppressed this fact's 👤, so the line prints 🤫 in its place. */
  witnessSuppressed: boolean;
  /** Every purpose (schema v10, #380) -- 👤 reads whether anyone is identified at all, not just what's printed; renderSubmissionBody filters out purpose='impeachment' rows when building the inline body (brief-only cap, #370 item 4). */
  statements: FactStatementRow[];
}

export interface SubmissionLawGroup {
  lawAssertionId: number;
  proposition: string;
  deadEnd: number;
  /** Rows with statement_id !== null only -- statements_of_law has no disposition column, so every row here renders inline. */
  statements: LawAssertionRow[];
}

export function groupSubmissionFacts(
  factRows: SubmissionFactRow[],
  statementRows: FactStatementRow[],
  admittedFactIds: ReadonlySet<number>,
  spentGlyphs: ReadonlyMap<number, string>,
  suppressedFactIds: ReadonlySet<number> = new Set()
): Map<number, SubmissionFactGroup[]> {
  const statementsByFact = new Map<number, FactStatementRow[]>();
  for (const s of statementRows) {
    const list = statementsByFact.get(s.fact_id) ?? [];
    list.push(s);
    statementsByFact.set(s.fact_id, list);
  }
  const result = new Map<number, SubmissionFactGroup[]>();
  for (const f of factRows) {
    const list = result.get(f.submission_id) ?? [];
    list.push({
      factId: f.fact_id,
      postulate: f.postulate,
      courtRecord: f.court_record,
      courtRecordPinpoint: f.court_record_pinpoint,
      courtRecordExecution: f.court_record_execution,
      courtRecordExhibitLetters: f.court_record_exhibit_letters,
      admitted: admittedFactIds.has(f.fact_id),
      spentAdmissionGlyphs: spentGlyphs.get(f.fact_id) ?? "",
      witnessSuppressed: suppressedFactIds.has(f.fact_id),
      statements: statementsByFact.get(f.fact_id) ?? [],
    });
    result.set(f.submission_id, list);
  }
  return result;
}

export function groupSubmissionLaw(lawRows: LawAssertionRow[]): Map<number, SubmissionLawGroup[]> {
  const bySubmission = new Map<number, Map<number, SubmissionLawGroup>>();
  for (const row of lawRows) {
    let subMap = bySubmission.get(row.submission_id);
    if (!subMap) {
      subMap = new Map();
      bySubmission.set(row.submission_id, subMap);
    }
    let group = subMap.get(row.law_assertion_id);
    if (!group) {
      group = { lawAssertionId: row.law_assertion_id, proposition: row.proposition, deadEnd: row.dead_end, statements: [] };
      subMap.set(row.law_assertion_id, group);
    }
    if (row.statement_id !== null) group.statements.push(row);
  }
  const result = new Map<number, SubmissionLawGroup[]>();
  for (const [subId, subMap] of bySubmission) result.set(subId, [...subMap.values()]);
  return result;
}
