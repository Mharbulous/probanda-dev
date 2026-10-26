// Admission-ladder state per admission, and per-fact admission coverage.

import { admissionLadderState, admissionRole, admissionRungMarker, admittedAgainstAllOpposing, dedupeLineMarkers, type AdmissionLadderInput } from "./markers.js";
import { suppressedWitnessFactIds } from "./query.js";
import { rows } from "../query-rows.js";

export interface AdmissionStateRow {
  id: number;
  factId: number;
  partyId: number;
  input: AdmissionLadderInput;
}

/**
 * State-input columns for the admission-ladder derivation (issue #344),
 * generalised (issue #345) to a caller-supplied WHERE clause so the same
 * query serves both the Evidence Index's per-admission-id lookup and the
 * unless-admitted guard's per-fact-id lookup, instead of two drifting
 * copies of the three EXISTS booleans backing the 🕹️ predicate
 * (terms-and-symbols.md line 264, pinned interpretations from #344's
 * resolution comment). `whereClause` is an internal literal built by its
 * own callers (this file and document-tenders.ts) with `?` placeholders (`a.id IN (…)` / `a.fact_id IN
 * (…)`), never caller-supplied data -- same interpolation discipline as
 * the `placeholders` pattern used throughout this file.
 */
export function fetchAdmissionStates(dbPath: string, whereClause: string, params: unknown[]): AdmissionStateRow[] {
  const inputRows = rows<{
    id: number;
    fact_id: number;
    party: number;
    method: AdmissionLadderInput["method"];
    instrument: number | null;
    instrument_served_on: string | null;
    instrument_pinpoint: string | null;
    response_due: string | null;
    response: number | null;
    response_date: string | null;
    response_pinpoint: string | null;
    response_excerpt: string | null;
    answer: AdmissionLadderInput["answer"];
    struck_on: string | null;
    response_filing_selected: number;
    instrument_and_service_selected: number;
    default_judgment_requisition_exists: number;
  }>(
    dbPath,
    `SELECT
       a.id,
       a.fact_id,
       a.party,
       a.method,
       a.instrument,
       inst.served_on AS instrument_served_on,
       a.instrument_pinpoint,
       a.response_due,
       a.response,
       resp.document_date AS response_date,
       a.response_pinpoint,
       a.response_excerpt,
       a.answer,
       a.struck_on,
       EXISTS(SELECT 1 FROM filing_documents fd WHERE fd.document_id = a.response) AS response_filing_selected,
       EXISTS(
         SELECT 1 FROM filing_documents fd1
         WHERE fd1.document_id = a.instrument
           AND EXISTS(SELECT 1 FROM filing_documents fd2 WHERE fd2.filing_id = fd1.filing_id AND fd2.role = 'affidavit')
       ) AS instrument_and_service_selected,
       EXISTS(
         SELECT 1 FROM filings f
         WHERE f.proceeding_id = a.proceeding_id AND f.kind = 'requisition_default_judgment'
       ) AS default_judgment_requisition_exists
     FROM admissions a
     LEFT JOIN documents inst ON inst.id = a.instrument
     LEFT JOIN documents resp ON resp.id = a.response
     WHERE ${whereClause}`,
    params
  );
  return inputRows.map((r) => ({
    id: r.id,
    factId: r.fact_id,
    partyId: r.party,
    input: {
      method: r.method,
      instrument: r.instrument,
      instrumentServedOn: r.instrument_served_on,
      instrumentPinpoint: r.instrument_pinpoint,
      responseDue: r.response_due,
      response: r.response,
      responseDate: r.response_date,
      responsePinpoint: r.response_pinpoint,
      responseExcerpt: r.response_excerpt,
      answer: r.answer,
      struckOn: r.struck_on,
      responseFilingSelected: r.response_filing_selected === 1,
      instrumentAndServiceSelected: r.instrument_and_service_selected === 1,
      defaultJudgmentRequisitionExists: r.default_judgment_requisition_exists === 1,
    },
  }));
}

export interface FactAdmissionAnnotations {
  admittedFactIds: Set<number>;
  /** Issue #361: deduped spent-admission rungs (🙅🏻‍♂️/🫸/🤷/⚡️) per fact -- rung only, no
   * capture markers (those are the admission-instrument's own citation concern). Mirrors
   * renderEvidenceIndex's spentGlyphs fold (dedupeLineMarkers over admissionRungMarker), grouped
   * by fact id instead of by document. */
  spentGlyphByFact: Map<number, string>;
  /** Schema v69: the facts whose 👤 counsel has suppressed, so the line prints 🤫 in its place. */
  suppressedFactIds: Set<number>;
}

/** Fact ids whose evidence work the unless-admitted guard silences (issue #345, ADR-0006), plus
 * (issue #361) each fact's spent-admission event glyphs: one pass over every admissions row for
 * the given facts, reduced to its derived ladder state -- "tenders" rows group into the set of
 * parties who have tendered an admission of each fact (checked against admittedAgainstAllOpposing
 * for coverage); "spent" rows fold their rung into spentGlyphByFact. today is always the render's
 * single wall-clock read (ctx.rendered.slice(0, 10)), never a fresh Date() -- keeps golden
 * fixtures reproducible (#344's rule). Coverage still requires opposingIds.length > 0 (a
 * proceeding with no opposing parties never counts as covered -- failing toward showing work);
 * the glyph fold has no such gate, since it never claims a fact is covered, only that a specific
 * admission is spent. */
export function fetchFactAdmissionAnnotations(dbPath: string, factIds: number[], opposingIds: number[], today: string): FactAdmissionAnnotations {
  const spentGlyphByFact = new Map<number, string>();
  if (factIds.length === 0) return { admittedFactIds: new Set(), spentGlyphByFact, suppressedFactIds: new Set() };
  const placeholders = factIds.map(() => "?").join(",");
  const byFact = new Map<number, Set<number>>();
  const spentByFact = new Map<number, string[]>();
  for (const r of fetchAdmissionStates(dbPath, `a.fact_id IN (${placeholders})`, factIds)) {
    const state = admissionLadderState(r.input, today);
    const role = admissionRole(state);
    if (role === "tenders") {
      const set = byFact.get(r.factId) ?? new Set<number>();
      set.add(r.partyId);
      byFact.set(r.factId, set);
    } else if (role === "spent") {
      const list = spentByFact.get(r.factId) ?? [];
      list.push(admissionRungMarker(state));
      spentByFact.set(r.factId, list);
    }
  }
  for (const [factId, glyphs] of spentByFact) spentGlyphByFact.set(factId, dedupeLineMarkers(glyphs));
  const admittedFactIds =
    opposingIds.length === 0 ? new Set<number>() : new Set(factIds.filter((id) => admittedAgainstAllOpposing(byFact.get(id) ?? new Set(), opposingIds)));
  return { admittedFactIds, spentGlyphByFact, suppressedFactIds: suppressedWitnessFactIds(dbPath, factIds) };
}

/** Coverage-only view of fetchFactAdmissionAnnotations, for callers (renderWitnessStatements)
 * that don't need the per-fact spent-glyph fold issue #361 added. */
export function fetchFactAdmissionCoverage(dbPath: string, factIds: number[], opposingIds: number[], today: string): Set<number> {
  return fetchFactAdmissionAnnotations(dbPath, factIds, opposingIds, today).admittedFactIds;
}
