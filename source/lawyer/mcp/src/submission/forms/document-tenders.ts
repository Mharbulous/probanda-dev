// Who tenders each exhibit: the Evidence Index's Tendered-by cell and its 👤 inputs.

import { submissionDataQuery } from "../backend.js";
import { fetchAdmissionStates, type AdmissionStateRow } from "./admission-annotations.js";
import { fetchDocumentLabels } from "./exhibit-documents.js";
import {
  admissionCaptureMarkers,
  admissionLadderState,
  admissionRole,
  admissionRungMarker,
  dedupeLineMarkers,
  printMarkerSets,
  type AdmissionLadderResult,
  type AdmissionRole,
} from "./markers.js";
import { recordGlyphs, type MarkerInventory } from "./proposal-inventory.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

interface ExhibitTenderRow {
  exhibit_id: number;
  tender_kind: "witness" | "admission";
  name: string;
  instrument_label: string | null;
  purpose: string | null;
  admission_id: number | null;
  /** facts.postulate for the admission branch, NULL for the witness branch -- an admissions-keyed
   * Proposal's item reads `<party>: <fact postulate>` (plan A1). Read by the Proposal inventory
   * alone; nothing rendered uses it. */
  fact_postulate: string | null;
}

/** Every statements_of_fact row and every admissions row tendering one of this filing's exhibits (#330/#333/#339). Proceeding-wide, not filing-scoped -- a tendering statement or admission need not belong to this filing. Every purpose returned for the witness branch (schema v10, #380 -- was every disposition): the Evidence Index cell lists non-impeachment rows only (the brief-only cap, #370 item 4), but the 👤 predicate reads existence across every purpose -- an impeachment-only tender still identifies the witness (same rule as SubmissionFactGroup). The admission branch has no purpose column (admissions carry no impeachment concept) so every row is literal NULL (never impeachment). Ordered witness-first (tender_rank), preserving pre-#339 cell ordering; admissions append after. */
function fetchExhibitTenders(dbPath: string, documentIds: number[]): ExhibitTenderRow[] {
  if (documentIds.length === 0) return [];
  const placeholders = documentIds.map(() => "?").join(",");
  return rows<ExhibitTenderRow>(
    dbPath,
    `SELECT sof.exhibit_id, 'witness' AS tender_kind, w.name AS name, inst.label AS instrument_label, sof.purpose, NULL AS admission_id, NULL AS fact_postulate, 0 AS tender_rank, sof.id AS tender_ord
     FROM statements_of_fact sof
     JOIN witnesses w ON w.id = sof.witness_id
     LEFT JOIN documents inst ON inst.id = sof.instrument
     WHERE sof.exhibit_id IN (${placeholders})
     UNION ALL
     SELECT a.exhibit AS exhibit_id, 'admission' AS tender_kind, p.name AS name, NULL AS instrument_label, NULL AS purpose, a.id AS admission_id, f.postulate AS fact_postulate, 1 AS tender_rank, a.id AS tender_ord
     FROM admissions a
     JOIN parties p ON p.id = a.party
     JOIN facts f ON f.id = a.fact_id
     WHERE a.exhibit IN (${placeholders})
     ORDER BY tender_rank, tender_ord`,
    [...documentIds, ...documentIds]
  );
}

/** Additive decoration only (issue #344) -- the derived ladder rung plus its admission-local 💬/📍/🕹️ work, appended after "(admission". Issue #345: a caller only passes rows whose derived state is "tenders" or "outstanding" -- a "spent" admission (denied/refused/no-knowledge/struck) never reaches this function; its event glyph renders as a description-cell prefix instead (renderEvidenceIndex). */
function tenderedByCitation(t: ExhibitTenderRow, admissionGlyphs: Map<number, string>): string {
  if (t.tender_kind === "admission") {
    const glyphs = t.admission_id !== null ? admissionGlyphs.get(t.admission_id) : undefined;
    return `${t.name} (admission${glyphs ? ` ${printMarkerSets([glyphs])}` : ""})`;
  }
  return t.instrument_label ? `${t.name} (${t.instrument_label})` : t.name;
}

/**
 * Sites 9 / 9' / 9'': the Evidence Index's Tendered-by cell merges each admission's rung and
 * capture glyphs, which key on three different rows -- 🎾 on the admission instrument served,
 * 🕹️ on the document whose entry the tender awaits (design §4: "the response for 🤝; the
 * admission instrument for ⏰"), and the capture pair on the admissions row itself. One
 * fetchDocumentLabels pass supplies the two document items, run only on this path.
 */
function recordAdmissionGlyphs(
  dbPath: string,
  inventory: MarkerInventory,
  admissionRows: AdmissionStateRow[],
  states: Map<number, AdmissionLadderResult>,
  glyphs: Map<number, string>,
  tenders: ExhibitTenderRow[]
): void {
  const enterIdOf = (r: AdmissionStateRow) => (states.get(r.id)?.base === "admitted" ? r.input.response : r.input.instrument);
  const documentIds = [...new Set(admissionRows.flatMap((r) => [r.input.instrument, enterIdOf(r)]).filter((id): id is number => id !== null))];
  const labels = fetchDocumentLabels(dbPath, documentIds);
  const tenderByAdmission = new Map(tenders.filter((t) => t.admission_id !== null).map((t) => [t.admission_id as number, t]));
  for (const r of admissionRows) {
    const printed = glyphs.get(r.id) ?? "";
    if (!printed) continue;
    if (r.input.instrument !== null) {
      recordGlyphs(inventory, printed, ["🎾"], { table: "documents", id: r.input.instrument, item: labels.get(r.input.instrument) ?? "" });
    }
    const enterId = enterIdOf(r);
    if (enterId !== null) {
      recordGlyphs(inventory, printed, ["🕹️"], { table: "documents", id: enterId, item: labels.get(enterId) ?? "" });
    }
    const tender = tenderByAdmission.get(r.id);
    recordGlyphs(inventory, printed, ["📑", "💬", "📌", "🧷"], {
      table: "admissions",
      id: r.id,
      item: tender ? `${tender.name}: ${tender.fact_postulate ?? ""}` : "",
    });
  }
}

export interface DocumentTenderStatus {
  hasTender: boolean; // some tender row's role is "tenders" (witness rows always; admissions via admissionRole)
  spentGlyphs: string; // deduped spent-admission decoration: the rung alone (suppressed when hasTender) -- a spent state is gated out of the capture markers
  tenderedBy: string; // the joined Tendered-by cell text (non-impeachment, non-spent rows)
}

/** Tender status per document (#330/#333/#339/#344/#345, extracted for #398): proceeding-wide
 * existence across statements_of_fact.exhibit_id and admissions.exhibit, state-aware via the
 * derived admission ladder. `today` is the render's single wall-clock read
 * (ctx.rendered.slice(0, 10)), never a fresh Date() -- golden-fixture rule (#344).
 * Returns an entry for every requested id (hasTender false, empty strings, when nothing tenders it).
 * Role-agnostic by design: callers apply isExhibitTenderRole (markers.ts) before rendering the
 * marker/prefix -- the Tendered-by cell is factual data and stays unconditional (#398).
 *
 * `inventory`, when given, records the 🎾 / 🕹️ / admission-capture Proposals this cell's glyphs
 * generate (design §8 names the Tendered-by cell as one of the sites needing the collector: one
 * cell merges glyphs from three different keyed rows). Only renderEvidenceIndex passes it -- the
 * Notice of Application's Part 4 calls this for hasTender and the spent-glyph prefix and prints
 * none of these glyphs, so it would record work no document shows. */
export function fetchDocumentTenderStatus(
  dbPath: string,
  documentIds: number[],
  today: string,
  inventory?: MarkerInventory
): Map<number, DocumentTenderStatus> {
  const result = new Map<number, DocumentTenderStatus>();
  for (const id of documentIds) result.set(id, { hasTender: false, spentGlyphs: "", tenderedBy: "" });

  const tenders = fetchExhibitTenders(dbPath, documentIds);
  const tendersByDoc = new Map<number, ExhibitTenderRow[]>();
  for (const t of tenders) {
    const list = tendersByDoc.get(t.exhibit_id) ?? [];
    list.push(t);
    tendersByDoc.set(t.exhibit_id, list);
  }
  // Issue #344/#345: derive each admission-kind tender's ladder state once,
  // keyed by admission id -- the rung+capture decoration for the cell, and
  // the role ("tenders"/"outstanding"/"spent") that decides whether the row
  // counts toward 👤, stays in the cell, or moves to a spent-glyph prefix.
  const admissionIds = [...new Set(tenders.filter((t) => t.admission_id !== null).map((t) => t.admission_id as number))];
  const states = new Map<number, AdmissionLadderResult>();
  const glyphs = new Map<number, string>();
  const admissionRows: AdmissionStateRow[] = [];
  if (admissionIds.length > 0) {
    const placeholders = admissionIds.map(() => "?").join(",");
    for (const r of fetchAdmissionStates(dbPath, `a.id IN (${placeholders})`, admissionIds)) {
      const state = admissionLadderState(r.input, today);
      states.set(r.id, state);
      glyphs.set(r.id, dedupeLineMarkers([admissionRungMarker(state), admissionCaptureMarkers(r.input, state)]));
      admissionRows.push(r);
    }
  }
  if (inventory && admissionRows.length > 0) recordAdmissionGlyphs(dbPath, inventory, admissionRows, states, glyphs, tenders);
  const roleOf = (t: ExhibitTenderRow): AdmissionRole =>
    t.tender_kind === "witness" ? "tenders" : admissionRole(states.get(t.admission_id as number) ?? { state: "not_sought" });

  for (const id of documentIds) {
    const docTenders = tendersByDoc.get(id) ?? [];
    const hasTender = docTenders.some((t) => roleOf(t) === "tenders");
    // Issue #345: a spent admission tenders nothing, but its event glyph
    // still renders -- rendered for the human, not silently dropped -- as a
    // prefix on the description cell alongside (or feeding into) 👤.
    const spentGlyphs = dedupeLineMarkers(
      docTenders
        .filter((t) => roleOf(t) === "spent" && t.admission_id !== null)
        .map((t) => {
          const state = states.get(t.admission_id as number);
          if (!state) return "";
          // Rung only: every spent state is gated out of admissionCaptureMarkers, so the
          // capture call that used to sit here could never produce a glyph.
          return hasTender ? "" : admissionRungMarker(state);
        })
    );
    const tenderedBy = docTenders
      .filter((t) => t.purpose !== "impeachment" && roleOf(t) !== "spent")
      .map((t) => tenderedByCitation(t, glyphs))
      .join("; ");
    result.set(id, { hasTender, spentGlyphs, tenderedBy });
  }
  return result;
}
