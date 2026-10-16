// Rhetorical paragraphs (schema v71): a numbered paragraph of persuasion from the record that fits
// no other paragraph type. Placed on a filing by filing_rhetoric (document, part, ordinal), its
// ordinal on the host part's own ordinal scale: a paragraph at ordinal k prints immediately after
// the host item at k, the host item winning a tie, so it prints before the first host item whose
// ordinal is greater than k. Ordinal 0 prints first; several at one ordinal print in placement
// order.
//
// Every link is optional and advisory. The label `(rhetorical)` and the two tells are plain text,
// never glyphs (work-markers rule 5): they print on the mockup only, filed-face.ts strips them,
// they never refuse a render and they never hold 🧐 back. The links feed nothing but the tells and
// the Counsel Brief: no rhetorical paragraph reads or clears ↩️, 🧾 or 📚.
//
// A database held below v71 has none of these tables, so every read here returns nothing there.

import { submissionDataQuery } from "../backend.js";
import { rhetoricHeld } from "./query.js";
import { pushStatementLines, reviewMarkerFor, type PointerDocument, type RenderContext } from "./render-vaniac-submissions.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** The host part a filing_rhetoric row places a paragraph in. */
export type RhetoricPart = "facts" | "submissions" | "orders";

/** One rhetorical_paragraph_record row: the document cited, its pinpoint, and the excerpt quoted. */
export interface RhetoricRecord {
  id: number;
  /** documents.label, the label a statement of fact's citation line names its instrument by. */
  label: string;
  pinpoint: string | null;
  excerpt: string | null;
}

/** One placement of a rhetorical paragraph on one filing document's part. */
export interface RhetoricRow {
  id: number;
  wording: string;
  statesLaw: boolean;
  statesFact: boolean;
  /** filing_rhetoric.ordinal, on the host part's ordinal scale. */
  ordinal: number;
  hasLaw: boolean;
  hasFactOrRecord: boolean;
  records: RhetoricRecord[];
}

/** The rhetorical paragraphs one filing document places in one part, by ordinal, then placement id. */
export function fetchRhetoric(dbPath: string, filingId: number, document: PointerDocument, part: RhetoricPart): RhetoricRow[] {
  if (!rhetoricHeld(dbPath)) return [];
  const found = rows<{ id: number; wording: string; states_law: number; states_fact: number; ordinal: number; has_law: number; has_fact_or_record: number }>(
    dbPath,
    `SELECT rp.id, rp.wording, rp.states_law, rp.states_fact, fr.ordinal,
            EXISTS(SELECT 1 FROM rhetorical_paragraph_law l WHERE l.rhetorical_paragraph_id = rp.id) AS has_law,
            (EXISTS(SELECT 1 FROM rhetorical_paragraph_facts f WHERE f.rhetorical_paragraph_id = rp.id)
              OR EXISTS(SELECT 1 FROM rhetorical_paragraph_record r WHERE r.rhetorical_paragraph_id = rp.id)) AS has_fact_or_record
     FROM filing_rhetoric fr
     JOIN rhetorical_paragraphs rp ON rp.id = fr.rhetorical_paragraph_id
     WHERE fr.filing_id = ? AND fr.document = ? AND fr.part = ?
     ORDER BY fr.ordinal, fr.id`,
    [filingId, document, part]
  );
  if (found.length === 0) return [];
  const ids = [...new Set(found.map((r) => r.id))];
  const recordRows = rows<RhetoricRecord & { rhetorical_paragraph_id: number }>(
    dbPath,
    `SELECT rec.rhetorical_paragraph_id, rec.id, doc.label, rec.pinpoint, rec.excerpt
     FROM rhetorical_paragraph_record rec
     JOIN documents doc ON doc.id = rec.document_id
     WHERE rec.rhetorical_paragraph_id IN (${ids.map(() => "?").join(",")})
     ORDER BY rec.id`,
    ids
  );
  const recordsByParagraph = new Map<number, RhetoricRecord[]>();
  for (const { rhetorical_paragraph_id, ...rec } of recordRows) {
    const list = recordsByParagraph.get(rhetorical_paragraph_id) ?? [];
    list.push(rec);
    recordsByParagraph.set(rhetorical_paragraph_id, list);
  }
  return found.map((r) => ({
    id: r.id,
    wording: r.wording,
    statesLaw: r.states_law === 1,
    statesFact: r.states_fact === 1,
    ordinal: r.ordinal,
    hasLaw: r.has_law === 1,
    hasFactOrRecord: r.has_fact_or_record === 1,
    records: recordsByParagraph.get(r.id) ?? [],
  }));
}

export type Interleaved<T> = { kind: "host"; item: T } | { kind: "rhetoric"; row: RhetoricRow };

/** The host part's items with its rhetorical paragraphs merged in: each prints before the first host
 * item whose ordinal is greater than its own, so the host item wins a tie, an ordinal below the
 * first host item's prints first, and one past the last prints last. Both lists come in ordinal
 * order; rhetoric rows sharing an ordinal keep the order they came in. */
export function interleave<T>(host: readonly T[], rhetoric: readonly RhetoricRow[], ordinalOf: (t: T) => number): Interleaved<T>[] {
  const out: Interleaved<T>[] = [];
  let r = 0;
  for (const item of host) {
    while (r < rhetoric.length && rhetoric[r].ordinal < ordinalOf(item)) out.push({ kind: "rhetoric", row: rhetoric[r++] });
    out.push({ kind: "host", item });
  }
  while (r < rhetoric.length) out.push({ kind: "rhetoric", row: rhetoric[r++] });
  return out;
}

/** A record's citation, as a statement of fact's citation line names an instrument: label, pinpoint. */
function recordCitation(r: RhetoricRecord): string | null {
  const parts = [r.label, r.pinpoint].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

/** The label, then each advisory tell that applies. Plain text: filed-face.ts strips all three. */
function rhetoricTags(row: RhetoricRow): string {
  return (
    " (rhetorical)" +
    (row.statesLaw && !row.hasLaw ? " (states law, no authority linked)" : "") +
    (row.statesFact && !row.hasFactOrRecord ? " (states fact beyond its record)" : "")
  );
}

/** The mockup's numbered paragraph: wording, label and tells, 🧐, the id trace, then each record's
 * excerpt and citation as a statement's are printed beneath its paragraph. The line carries no work
 * glyph, so 🧐 reads against nothing else. No leading blank line: the caller spaces it as its
 * surface spaces its own paragraphs. */
export function renderRhetoricLine(ctx: RenderContext, row: RhetoricRow, n: number, prefix: string): string[] {
  const review = reviewMarkerFor(ctx.review, ctx.inventory, "", "rhetorical_paragraphs", row.id, row.wording);
  const lines = [`${prefix}${n}. ${row.wording}${rhetoricTags(row)}${review ? ` ${review}` : ""} <!-- rhetorical_paragraph_id ${row.id} -->`];
  for (const r of row.records) {
    const cite = recordCitation(r);
    pushStatementLines(lines, r.excerpt, cite === null ? null : `> ${cite}`, "", "rhetorical_paragraph_record_id", r.id);
  }
  return lines;
}

/** A filed emitter's numbered paragraph: the wording, then each record's excerpt as `> ` lines and
 * its citation on `citePrefix`. No tag, no glyph, no comment. */
export function renderRhetoricFiled(row: RhetoricRow, n: number, prefix: string, citePrefix = "> "): string[] {
  const lines = [`${prefix}${n}. ${row.wording}`];
  for (const r of row.records) {
    if (r.excerpt) for (const l of r.excerpt.split("\n")) if (l.trim() !== "") lines.push(`> ${l}`);
    const cite = recordCitation(r);
    if (cite !== null) lines.push(`${citePrefix}${cite}`);
  }
  return lines;
}

/** The parts each kind's venue document hosts. Any other kind is a general Writing, whose
 * legal-basis and orders-sought projections host the submissions and orders parts. */
const FORM_PARTS: Readonly<Record<string, readonly RhetoricPart[]>> = {
  notice_of_application: ["facts", "submissions", "orders"],
  application_response: ["facts", "submissions"],
  requisition_default_judgment: [],
  requisition_consent: [],
  submissions_package: ["submissions", "orders"],
  bcca_stay_response: ["facts", "submissions", "orders"],
  bcca_factum: ["facts", "submissions", "orders"],
};
const GENERAL_FORM_PARTS: readonly RhetoricPart[] = ["submissions", "orders"];

/** The kinds whose venue document is itself the written argument, so they render no Written
 * Arguments companion. */
const NO_WRITTEN_ARGUMENT_COMPANION = new Set(["submissions_package", "bcca_stay_response", "bcca_factum"]);
const WRITTEN_ARGUMENT_PARTS: readonly RhetoricPart[] = ["submissions", "orders"];

/** Whether a placement on this kind's document prints anywhere. */
export function rhetoricPrintable(kind: string, document: PointerDocument, part: RhetoricPart): boolean {
  if (document === "written_argument") return !NO_WRITTEN_ARGUMENT_COMPANION.has(kind) && WRITTEN_ARGUMENT_PARTS.includes(part);
  return (FORM_PARTS[kind] ?? GENERAL_FORM_PARTS).includes(part);
}

/** Every rhetorical paragraph of the proceeding, by id. */
export function fetchProceedingRhetoric(dbPath: string, proceedingId: number): { id: number; wording: string }[] {
  if (!rhetoricHeld(dbPath)) return [];
  return rows<{ id: number; wording: string }>(dbPath, `SELECT id, wording FROM rhetorical_paragraphs WHERE proceeding_id = ? ORDER BY id`, [proceedingId]);
}

/** Every placement on one filing. */
export function fetchFilingRhetoricPlacements(dbPath: string, filingId: number): { rhetorical_paragraph_id: number; document: PointerDocument; part: RhetoricPart }[] {
  if (!rhetoricHeld(dbPath)) return [];
  return rows<{ rhetorical_paragraph_id: number; document: PointerDocument; part: RhetoricPart }>(
    dbPath,
    `SELECT rhetorical_paragraph_id, document, part FROM filing_rhetoric WHERE filing_id = ? ORDER BY document, part, ordinal, id`,
    [filingId]
  );
}
