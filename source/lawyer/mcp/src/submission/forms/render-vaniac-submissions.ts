// VanIAC submissions package renderer (build ticket #297, design doc 291 §5,
// issue #299 ratified layout, issue #288 §1 form content inventory). The
// Submissions body was restructured onto the v3/v4 schema by issue #321
// (target shape per issues #323's contention/postulate/proposition square
// and a Fable-reviewed amendment, 2026-08-23): one line per postulate/
// proposition, its own statement's verbatim excerpt as a fenced code block
// (not the ticket's literal block quote -- copy-paste fidelity and a real
// CommonMark list-fracture issue in an unindented quote). Renders: Written
// Argument, one Witness Statement per witness, Evidence Index. The
// submission-body helpers here (renderSubmissionBody and friends) are also
// used by render-notice-of-application.ts's PART 3, per #321's "same shape"
// instruction.

import { submissionDataQuery } from "../backend.js";
import { authorityNotKilled, authorityNotOverruled, countsAsSupport, notFailed } from "./brief-only-cap.js";
import { BLANK_UNDERLINE, frontmatterHeader, styleOfProceedingCaption, type CaptionParty, type FrontmatterFields } from "./components.js";
import { lawStatementCitationLine, lawStatementMarkers, scrutinyFailedTag } from "./law-statement-line.js";
import type { Lifecycle } from "./lifecycle.js";
import {
  admissionCaptureMarkers,
  admissionLadderState,
  admissionRole,
  admissionRungMarker,
  admittedAgainstAllOpposing,
  counselReviewMarker,
  courtRecordCitation,
  courtRecordPinpointMarker,
  dedupeLineMarkers,
  doctrinalSlotMarker,
  doubtMarker,
  exhibitPinpointMarker,
  factExcerptMarker,
  factualBasisMarker,
  gapMarker,
  isAdmittedGuard,
  isExhibitTenderRole,
  noWitnessMarker,
  suppressMarker,
  notBestCopyMarkers,
  printMarkerSets,
  propositionNeededMarker,
  ordinaryCostsSubmission,
  rebuttalMarker,
  REVIEW_SNAPSHOT_FIELDS,
  reviewKey,
  reviewSnapshotSql,
  sourceRungMarker,
  statementOfFactMarkers,
  testimonyPinpointMarker,
  treatmentMarker,
  unsponsoredExhibitMarker,
  type AdmissionLadderInput,
  type AdmissionLadderResult,
  type AdmissionRole,
  type DocumentCopyRow,
  type JurisdictionRequiresEdge,
  type ReviewedTable,
} from "./markers.js";
import { lawItem, recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs, recordLawStatementGlyphs, type MarkerInventory } from "./proposal-inventory.js";
import { captionHeadingFor, courtRecordDocumentColumns, excerptSpeakerColumn, linkedProvisionsColumn, noFactsNeededColumn, noLawNeededColumn, opposingPartyIds, rhetoricHeld, servedOrderWordingsColumn, settledOnColumn, suppressedWitnessFactIds, treatmentNoteColumn, treatmentNoteHeld, type FilingRow, type PartyRow, type ProceedingRow } from "./query.js";

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

export function fetchDocumentLabels(dbPath: string, documentIds: number[]): Map<number, string> {
  if (documentIds.length === 0) return new Map();
  const placeholders = documentIds.map(() => "?").join(",");
  const found = rows<{ id: number; label: string }>(dbPath, `SELECT id, label FROM documents WHERE id IN (${placeholders})`, documentIds);
  return new Map(found.map((d) => [d.id, d.label]));
}

/** Per-document 🏆 map for one proceeding (issue #364) -- proceeding-wide, not
 * filing-scoped, so a sibling copy marked best elsewhere in the proceeding
 * still clears a group even when that sibling isn't referenced by this render. */
export function fetchNotBestCopyMarkers(dbPath: string, proceedingId: number): Map<number, string> {
  return notBestCopyMarkers(
    rows<DocumentCopyRow>(dbPath, `SELECT id, label, is_best_copy FROM documents WHERE proceeding_id = ?`, [proceedingId])
  );
}

/** Every reviewed object's current snapshot and its latest approval (review.md). Keyed `${table}:${id}`. */
export interface ReviewState {
  current: ReadonlyMap<string, string>;
  approved: ReadonlyMap<string, string>;
}

/** One read per map. `current` computes each of the proceeding's reviewed rows' snapshot with the
 * same json_object expression the approval writer stores, so equality is byte equality (review.md,
 * "Snapshot fields"). `approved` is the latest approval per object -- greatest `id`, the table being
 * append-only -- across the whole database, since review_approvals carries no proceeding_id and ids
 * are unique per table. filing_prose and filing_orders have no proceeding_id: a prose slot's or a
 * filing's order row's proceeding is its filing's. A database held below v71 has no
 * rhetorical_paragraphs table, so the read skips it there. */
export function fetchReviewState(dbPath: string, proceedingId: number): ReviewState {
  const held = rhetoricHeld(dbPath);
  const tables = (Object.keys(REVIEW_SNAPSHOT_FIELDS) as ReviewedTable[]).filter((t) => held || t !== "rhetorical_paragraphs");
  const scope = (t: ReviewedTable) =>
    t === "filing_prose" || t === "filing_orders" ? "filing_id IN (SELECT id FROM filings WHERE proceeding_id = ?)" : "proceeding_id = ?";
  const noteHeld = treatmentNoteHeld(dbPath);
  const current = rows<{ entity: string; entity_id: number; snapshot: string }>(
    dbPath,
    tables
      .map((t) => `SELECT '${t}' AS entity, id AS entity_id, ${reviewSnapshotSql(t, noteHeld)} AS snapshot FROM ${t} WHERE ${scope(t)}`)
      .join(" UNION ALL "),
    Array(tables.length).fill(proceedingId)
  );
  const approved = rows<{ entity: string; entity_id: number; snapshot: string }>(
    dbPath,
    `SELECT entity, entity_id, snapshot FROM review_approvals ra
     WHERE ra.id = (SELECT MAX(id) FROM review_approvals WHERE entity = ra.entity AND entity_id = ra.entity_id)`
  );
  return {
    current: new Map(current.map((r) => [reviewKey(r.entity, r.entity_id), r.snapshot])),
    approved: new Map(approved.map((r) => [reviewKey(r.entity, r.entity_id), r.snapshot])),
  };
}

/** 🧐 for one object on one forum line: the predicate over the line's other glyphs (design §3), recorded
 * on the object with `changed` when an earlier approval exists. Returns "🧐" or "". A caller with no
 * review state (the Counsel Brief) gets "" and records nothing. */
export function reviewMarkerFor(
  review: ReviewState | undefined,
  inv: MarkerInventory | undefined,
  lineGlyphs: string,
  table: ReviewedTable,
  id: number,
  item: string
): string {
  if (review === undefined) return "";
  const key = reviewKey(table, id);
  const current = review.current.get(key);
  if (current === undefined) return ""; // not a row of this proceeding: nothing to review
  const approved = review.approved.get(key) ?? null;
  const glyph = counselReviewMarker(lineGlyphs, current, approved);
  if (glyph && inv) recordCriterionGlyphs(inv, glyph, ["🧐"], { table, id, item, ...(approved === null ? {} : { changed: true as const }) });
  return glyph;
}

/** 🧐 on an order line (review.md, "Snapshot fields"): the order's own, or this filing's
 * `filing_orders` row's while that row holds the filing's own wording. A NULL override raises
 * nothing by itself. Each object records its own entry; the line prints one 🧐. */
export function orderReviewMarkerFor(
  review: ReviewState | undefined,
  inv: MarkerInventory | undefined,
  lineGlyphs: string,
  order: Pick<OrderSoughtRow, "id" | "pointer_id" | "wording" | "wording_override">
): string {
  const own = reviewMarkerFor(review, inv, lineGlyphs, "order_sought", order.id, order.wording);
  const override = order.wording_override === null ? "" : reviewMarkerFor(review, inv, lineGlyphs, "filing_orders", order.pointer_id, order.wording);
  return own || override;
}

/** "Ex. N" numbering shared between the Evidence Index and every excerpt citation that cites an exhibit (issue #321/#325/#330): array position over an already-ordered document id list. Pure -- every caller supplies its own ordered ids (this file's fetchFilingDocuments below, or Notice of Application's own PART 4 list) so "Ex. N" means the same document everywhere it's cited in one rendered document set. */
export function exhibitNumbersFromOrderedIds(documentIds: number[]): Map<number, number> {
  const map = new Map<number, number>();
  documentIds.forEach((id, i) => map.set(id, i + 1));
  return map;
}

/** "Ex. N" across a VanIAC proceeding's whole run of rounds (#712), not one filing: a document
 * keeps the number it was first given for the life of the proceeding, so an Opening exhibit stays
 * Ex. 3 when a Reply cites it, and the Reply's own new exhibits continue after the highest already
 * assigned. Neither forum requires this -- the VanIAC Rules never say "exhibit", and Supreme Court
 * Civil Rules 22-2 and 8-1 read complete impose nothing on labelling across rounds -- so it is the
 * firm's convention, settled on #712, recorded in /draft's VanIAC type file.
 *
 * Scoped to kind='submissions_package' deliberately. On a BCSC or BCCA face, Part 4/Part 6 lists
 * its material with form-local numbered paragraphs (render-notice-of-application, Part 4;
 * render-application-response, Part 6) while Part 5 excerpts cite Ex. N from this map; those two
 * coincide only while both are positional over the same filing-scoped list. Continuing across the
 * proceeding there would print "1., 2., 3." in the list and cite "Ex. 8" in the excerpts. In BCSC
 * the label the forum reads is the affidavit letter (#712 decision 5), and Ex. N is a pointer into
 * the form's own list -- so those emitters stay on fetchFilingDocuments.
 *
 * Ordering puts filed rounds first in the order they were filed, then drafts by filing id, each
 * round by its own ordinal, first occurrence of a document winning. The 23->24 guard triggers make
 * a filed filing's rows immutable, so every filed document's position -- and therefore its number
 * -- is fixed, while a draft's numbers still follow its ordinal. Never-filed retired drafts are
 * excluded: an abandoned draft must not consume a number. */
export function fetchProceedingExhibitNumbers(dbPath: string, proceedingId: number): Map<number, number> {
  const ordered = rows<{ document_id: number }>(
    dbPath,
    `SELECT fd.document_id
     FROM filing_documents fd
     JOIN filings f ON f.id = fd.filing_id
     WHERE f.proceeding_id = ?
       AND f.kind = 'submissions_package'
       AND fd.role != 'witness_statement'
       AND NOT (f.retired_on IS NOT NULL AND f.filed_on IS NULL)
     ORDER BY (f.filed_on IS NULL), f.filed_on, f.id, fd.ordinal`,
    [proceedingId]
  );
  const seen = new Set<number>();
  const firstOccurrence: number[] = [];
  for (const r of ordered) {
    if (seen.has(r.document_id)) continue;
    seen.add(r.document_id);
    firstOccurrence.push(r.document_id);
  }
  return exhibitNumbersFromOrderedIds(firstOccurrence);
}

/** The exhibit map a render must use, chosen by filing kind -- the one place that choice is made,
 * so no surface can drift from the others (#712).
 *
 * A VanIAC submissions package numbers across the proceeding's whole run of rounds. Every other
 * kind stays filing-scoped: on a BCSC or BCCA face, Part 4 / Part 6 lists the material with
 * form-local numbered paragraphs that are positional over the filing, while Part 5 excerpts cite
 * Ex. N from this map. The two coincide only while both are positional over the same list, so a
 * proceeding-wide sequence there would print "1., 2., 3." in the list and cite "Ex. 8" in the
 * excerpts. In BCSC the label the forum reads is the affidavit letter anyway. */
export function exhibitNumbersForFiling(
  dbPath: string,
  filing: { kind: FilingRow["kind"]; proceeding_id: number },
  filingDocumentIds: number[]
): Map<number, number> {
  return filing.kind === "submissions_package"
    ? fetchProceedingExhibitNumbers(dbPath, filing.proceeding_id)
    : exhibitNumbersFromOrderedIds(filingDocumentIds);
}

// Defined in law-statement-line.ts, which this module imports, so the two never import each
// other; re-exported here so every existing importer keeps its path.
export { CITATION_MISSING } from "./law-statement-line.js";

/** Citation as its own blockquote line (ticket 2026-08-31 -- previously folded into the excerpt's
 * parenthetical by the now-removed factStatementCitation). Returns null when there is nothing to
 * cite at all (no exhibit/instrument label resolved and no pinpoint) -- pushStatementLines omits
 * the line entirely rather than printing an empty "> ". The fact side never prints
 * CITATION_MISSING: its "citation" is an exhibit/instrument label, not a nullable authorities
 * column, so a resolved label is either present or the statement has nothing to point at yet
 * (covered by 📑/💬 and 📌/🧷, not this placeholder). */
export function factStatementCitationLine(
  exhibitMap: Map<number, number>,
  labelMap: Map<number, string>,
  s: Pick<FactStatementRow, "instrument_id" | "pinpoint" | "exhibit_id" | "exhibit_pinpoint">
): string | null {
  const parts: string[] = [];
  if (s.instrument_id !== null) {
    const instrumentLabel = labelMap.get(s.instrument_id);
    if (instrumentLabel !== undefined) parts.push(instrumentLabel);
    if (s.pinpoint) parts.push(s.pinpoint);
  } else if (s.pinpoint) {
    parts.push(s.pinpoint);
  }
  if (s.exhibit_id !== null) {
    const num = exhibitMap.get(s.exhibit_id);
    const exhibitLabel = num !== undefined ? `Ex. ${num}` : labelMap.get(s.exhibit_id);
    if (exhibitLabel !== undefined) parts.push(exhibitLabel);
    if (s.exhibit_pinpoint) parts.push(s.exhibit_pinpoint);
  }
  return parts.length === 0 ? null : `> ${parts.join(", ")}`;
}

/** copyMarker is looked up by the caller from s.instrument_id (never exhibit_id --
 * an exhibited document's copy status already shows once at its own Evidence
 * Index/PART 4 line). Computed outside isAdmittedGuard: 🏆 is not in
 * work-markers.md §2's Silenced list, so it still renders on an otherwise-silenced
 * (admitted/court-record) line. */
function factStatementMarkers(s: FactStatementRow, courtRecordLinked: boolean, admitted: boolean, copyMarker: string): string {
  if (isAdmittedGuard(courtRecordLinked, admitted)) return dedupeLineMarkers([doubtMarker(s.doubt), copyMarker]);
  return dedupeLineMarkers([
    factExcerptMarker(s),
    exhibitPinpointMarker(s.exhibit_id, s.exhibit_pinpoint),
    testimonyPinpointMarker(s.instrument_id, s.pinpoint),
    statementOfFactMarkers({
      interviewed: s.interviewed,
      instrument_id: s.instrument_id,
      instrument_kind: s.instrument_kind,
      instrument_execution: s.instrument_execution,
      fact_court_record_linked: courtRecordLinked,
      fact_admitted_by_all_opposing: admitted,
    }),
    doubtMarker(s.doubt),
    copyMarker,
  ]);
}

/** Pushes one statement's rendered lines: a blank line (nothing glues to what came before), then a fenced ``` verbatim quote when excerpt text exists -- 💬 already signals "excerpt needed", so an empty fence would just be noise -- then the citation on its own blockquote line (ticket 2026-08-31: a legal citation is not part of the verbatim quote, on either side of the domain now), then markers + id comment on the line right after (no blank between the two: they're one object). */
export function pushStatementLines(lines: string[], excerpt: string | null, citationLine: string | null, markers: string, tag: string, id: number): void {
  lines.push("");
  if (excerpt) {
    // No surrounding quotation marks -- the fence already marks the text as verbatim, and a
    // statute excerpt keeps the Act's own indentation line by line.
    lines.push("   ```");
    for (const l of excerpt.split("\n")) lines.push(l ? `   ${l}` : "");
    lines.push("   ```");
  }
  if (citationLine) lines.push(`   ${citationLine}`);
  const idComment = `<!-- ${tag} ${id} -->`;
  lines.push(`   ${[markers, idComment].filter(Boolean).join(" ")}`);
}

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

export interface RenderedParagraphs {
  lines: string[];
  nextPara: number;
}

/**
 * Renders a submission's argument as standalone numbered paragraphs (ticket 2026-09-01,
 * reversing ticket 2026-08-31's Fable-reviewed removal: the contention sentence -- the
 * submission's own plain-English point -- is restored as the argument's opening paragraph,
 * because dropping it left law-only submissions with no printed point and law-free submissions
 * with no printed paragraph at all). The contention always renders first, in normal weight (bold is for headings only), carrying this
 * submission's `<!-- submission_id N -->` trace and any submission-level marker. One paragraph
 * per postulate the submission `rests_on` and per proposition it `requires` follows, each with
 * its own statement's verbatim excerpt(s) and citation(s) stacked beneath it -- facts render
 * before law (preserves the traversal order this file has always used).
 *
 * startPara is the next paragraph number to assign; nextPara is handed back so the caller's own
 * counter convention (single running counter, per-Part restart, or continuous across Parts) stays
 * entirely the caller's business.
 *
 * extraFirstParagraphMarker: an additional *submission-level* marker glyph (already deduped by
 * the caller if composed of several) to attach to the contention line -- e.g. 🧵 loose-thread
 * (NoA/Application Response only). 🧾 factual basis needed is computed internally
 * (facts.length === 0 and no opts.noFactsNeededOn) and merged into the same slot, and so is 📚
 * proposition needed (lawAssertions.length === 0, no opts.noLawNeededOn, and not an ordinary-costs
 * submission per opts.servedOrderWordings). A submission with
 * neither link and no record carries both.
 *
 * A submission with no linked facts and no linked law (the schema allows this -- "neither link
 * required, both ∅ held") still renders its contention as a normal numbered paragraph, with no
 * law/fact paragraphs after it -- it never silently disappears, and it consumes exactly one
 * paragraph number like any other submission.
 *
 * The brief-only cap (schema v10, #380; #370 item 4; extended schema v16 for killed
 * authorities; extended again by #842 for overruled ones): an impeachment fact statement
 * (purpose='impeachment') or a law statement resting on a 'lead', killed
 * (`authorities.killed_on` set) or overruled (`authorities.treatment='overruled'`) authority
 * never rides into a deployed document -- all are simply excluded here. They are not routed
 * anywhere by this function; the Counsel Brief surfaces them independently from its own
 * whole-pool query (render-companions.ts), since it is the only surface any of them may ever
 * render on.
 *
 * renderedLawAssertions (ticket 2026-09-01, one paragraph per assertion, deduped; cross-
 * references settled 2026-09-01): a law assertion is a first-class numbered paragraph, so a
 * proposition two or more submissions `requires` never repeats its full excerpt-and-citation
 * block. Its first occurrence in document order renders in full and records its assigned
 * paragraph number in the Map; every later occurrence renders as its own numbered
 * cross-reference paragraph -- "As set out in paragraph {M}, above, {proposition}" (verbatim
 * proposition, no excerpt, no citation line, no statement markers) -- so every submission keeps
 * a numbered anchor and mockup/filed-face numbering stay aligned. The caller owns one Map per
 * rendered document (one running Analysis/Written Argument section), created before its
 * submissions loop and passed to every call so dedup state carries across submissions; the
 * default `new Map()` makes a caller that passes nothing dedupe only within that single call,
 * i.e. not at all (there are no duplicate law_assertion_id rows within one submission's own
 * group). Facts are deduped only through `factParagraphs`, by the two callers whose document has
 * its own facts part -- otherwise a submission's own `rests_on` link is its own fact paragraph
 * regardless of reuse elsewhere.
 *
 * opts (build: Counsel Brief authority citations) -- every field defaults to the behaviour every
 * venue renderer already had, so the four existing call sites are unchanged and their goldens stay
 * byte-identical. Only the Counsel Brief passes any of them:
 *   paragraphPrefix        labels paragraphs "R1." instead of "1." (its Held-in-reserve section,
 *                          whose submissions appear in no venue document and so have no number to
 *                          borrow). Applied to cross-references too, which is only sound because
 *                          the caller gives a prefixed section its OWN renderedLawAssertions Map
 *                          -- a prefixed and an unprefixed number must never share one.
 *   includeLeadStatements  lifts the brief-only cap on `verification='lead'` statements AND on
 *                          statements resting on a killed authority (`authorities.killed_on`
 *                          set, schema v16) or an overruled one (`treatment='overruled'`,
 *                          #842) -- all three ride the identical cap. Printing only: the
 *                          proposition's own markers are unaffected by this flag, so a lead-only
 *                          assertion shows the same 🔬 (#502) on both surfaces, with the excerpt
 *                          stacked beneath it only here.
 *   inventory              the render context's Proposal inventory (forms/proposal-inventory.ts),
 *                          which every caller passes as `ctx.inventory`. Optional only so the
 *                          shape stays one object; a caller that omits it records nothing. The
 *                          recording sits beside pushStatementLines, where the source row and the
 *                          glyph string the site just computed are both still in hand -- never a
 *                          second predicate pass, never a markdown scan (design §8).
 *   review                 passed by every forum caller as `ctx.review`; the Counsel Brief omits
 *                          it, which is what keeps 🧐 off the brief.
 *   scrutinyLive           false for a law assertion that no submission or order deployed on a
 *                          live Writing relies on (spec R6, schema v47): its statement lines then
 *                          raise no 🔬. Read per statement, so a statement shared with a
 *                          live-deployed submission keeps 🔬 on every line it prints on. Only the
 *                          Counsel Brief passes it; every other caller renders a deployed
 *                          submission, whose assertions are all relied on (the default).
 *   noFactsNeededOn        submissions.no_facts_needed_on (schema v48), passed by every caller from
 *                          its row: counsel's recorded decision that the contention needs no stated
 *                          fact. Set on a submission with no linked fact, it clears 🧾 and prints
 *                          the plain-text tag ` (no stated fact needed, per counsel <date>)` after
 *                          the contention. With a linked fact it prints nothing. The database
 *                          clears it when the wording changes, so a set value holds for this wording.
 *   noLawNeededOn          submissions.no_law_needed_on (schema v60), passed by every caller from its
 *                          row: counsel's recorded decision that the contention needs no stated law.
 *                          Set on a submission with no linked proposition, it clears 📚 and prints
 *                          the plain-text tag ` (no stated law needed, per counsel <date>)` after the
 *                          contention. With a linked proposition it prints nothing. The database
 *                          clears it when the wording changes, and refuses it beside noFactsNeededOn.
 *   servedOrderWordings    the row's `served_order_wordings` (query.ts servedOrderWordingsColumn),
 *                          passed by every caller beside noLawNeededOn. A submission whose served
 *                          orders are all ordinary costs orders derives no 📚 and prints no tag.
 *   factParagraphs        fact id -> that fact's paragraph number in this document's own facts
 *                          part, passed only by the Notice of Application (Part 2) and the
 *                          Application Response (Part 4). The legal-basis Part prints no fact
 *                          text: a linked fact in the map is not re-printed and records nothing
 *                          here, and the contention line ends with
 *                          `<!-- supporting fact paragraphs: 1, 3 -->` (ascending). A linked fact
 *                          absent from the map (the database places every one on a drafting
 *                          Writing, schema v59, so only a legacy database or a changed kind leaves
 *                          one) is not printed either: the comment names it after the numbers,
 *                          `<!-- supporting fact paragraphs: 1; NOT PLACED: fact 7 "<postulate>" -->`,
 *                          and the filed face refuses (forms/unplaced-facts.ts). With nothing to
 *                          list and 🧾 firing, it ends `🧾<!-- supporting fact paragraphs:  NONE -->`
 *                          and 🧾 leaves the line's marker set; with nothing to list and no 🧾, no
 *                          comment prints. 📚 never moves onto the comment: it stays in the line's
 *                          marker set in this mode too, because law is never folded into a comment.
 *   printUnplacedFacts     true for a sent or retired Writing, which renders as it was sent: a
 *                          linked fact absent from factParagraphs prints in full, as before v59,
 *                          and the comment lists the numbers alone.
 */
export function renderSubmissionParagraphs(
  submissionId: number,
  contention: string,
  startPara: number,
  facts: SubmissionFactGroup[],
  lawAssertions: SubmissionLawGroup[],
  exhibitMap: Map<number, number>,
  labelMap: Map<number, string>,
  copyMarkers: Map<number, string>,
  extraFirstParagraphMarker = "",
  renderedLawAssertions: Map<number, number> = new Map(),
  opts: { paragraphPrefix?: string; includeLeadStatements?: boolean; inventory?: MarkerInventory; review?: ReviewState; scrutinyLive?: (lawAssertionId: number) => boolean; noFactsNeededOn?: string | null; noLawNeededOn?: string | null; servedOrderWordings?: string | null; factParagraphs?: ReadonlyMap<number, number>; printUnplacedFacts?: boolean } = {}
): RenderedParagraphs {
  const prefix = opts.paragraphPrefix ?? "";
  const inv = opts.inventory;
  const lines: string[] = [];
  let para = startPara;
  const submissionTrace = `<!-- submission_id ${submissionId} -->`;
  const factParagraphs = opts.factParagraphs;

  // Site 1: 🧾 and 📚 key on the submission. extraFirstParagraphMarker rides the same line but belongs
  // to the caller (🧵 on its own pointer row, 🂡 which never generates), so it is recorded there,
  // and it prints as its own set beside the submission's.
  const factualBasis = facts.length === 0 && !opts.noFactsNeededOn ? factualBasisMarker(false) : "";
  // A submission that only asks for ordinary costs derives no 📚 at all (markers.ts ordinaryCostsSubmission).
  const ordinaryCosts = ordinaryCostsSubmission(contention, JSON.parse(opts.servedOrderWordings ?? "[]") as string[]);
  const propositionNeeded = lawAssertions.length === 0 && !opts.noLawNeededOn && !ordinaryCosts ? propositionNeededMarker(false) : "";
  const contentionMarker = dedupeLineMarkers([factualBasis, propositionNeeded, extraFirstParagraphMarker]);
  if (inv) recordGlyphs(inv, factualBasis, ["🧾"], { table: "submissions", id: submissionId, item: contention });
  if (inv) recordGlyphs(inv, propositionNeeded, ["📚"], { table: "submissions", id: submissionId, item: contention });
  const review1 = reviewMarkerFor(opts.review, inv, contentionMarker, "submissions", submissionId, contention);
  // Reference mode (factParagraphs set): 🧾 prints against the supporting-fact-paragraphs comment
  // instead of in the line's marker set. Its derivation and recording above are unchanged. 📚 stays
  // in the line's marker set in every mode.
  const contentionLine = printMarkerSets([
    dedupeLineMarkers(factParagraphs ? [propositionNeeded, review1] : [factualBasis, propositionNeeded, review1]),
    extraFirstParagraphMarker,
  ]);
  // Counsel's no-facts-needed decision (schema v48) is plain text, never a glyph (work-markers rule
  // 5), and the filed-face strip removes it (filed-face.ts), as the v47 settled tag.
  // It prints only where it suppresses 🧾: a submission with a linked fact prints neither.
  const noFactsTag = facts.length === 0 && opts.noFactsNeededOn ? ` (no stated fact needed, per counsel ${opts.noFactsNeededOn})` : "";
  // Counsel's no-law-needed decision (schema v60), on the same footing: it prints only where it
  // suppresses 📚. The database refuses both decisions on one row, so at most one tag prints.
  const noLawTag = lawAssertions.length === 0 && opts.noLawNeededOn ? ` (no stated law needed, per counsel ${opts.noLawNeededOn})` : "";
  // The legal-basis Part prints no fact text. A linked fact already numbered in this document's
  // facts part records nothing here: that part printed its line and recorded its glyphs under the
  // same keys. It is named by its paragraph number in a comment instead. A linked fact absent from
  // that part is named NOT PLACED in the same comment, unprinted and unrecorded, except on a sent or
  // retired Writing, which prints it in full as it was sent.
  const unplacedFacts = factParagraphs ? facts.filter((f) => !factParagraphs.has(f.factId)) : [];
  const printedFacts = !factParagraphs ? facts : opts.printUnplacedFacts ? unplacedFacts : [];
  const refNumbers = factParagraphs
    ? facts.filter((f) => factParagraphs.has(f.factId)).map((f) => factParagraphs.get(f.factId) as number).sort((a, b) => a - b)
    : [];
  const refs = [
    ...(refNumbers.length > 0 ? [refNumbers.join(", ")] : []),
    ...(opts.printUnplacedFacts ? [] : unplacedFacts.map((f) => `NOT PLACED: fact ${f.factId} ${JSON.stringify(f.postulate)}`)),
  ];
  const factRefComment = !factParagraphs
    ? ""
    : refs.length > 0
      ? ` <!-- supporting fact paragraphs: ${refs.join("; ")} -->`
      : factualBasis
        ? ` ${factualBasis}<!-- supporting fact paragraphs:  NONE -->`
        : "";
  para += 1;
  lines.push("");
  lines.push(`${prefix}${para}. ${contention}${noFactsTag}${noLawTag}${contentionLine ? ` ${contentionLine}` : ""} ${submissionTrace}${factRefComment}`);

  for (const f of printedFacts) {
    const courtRecordLinked = f.courtRecord !== null;
    // 👤 reads existence across every purpose, not just what's printed below
    // (mirrors the exhibit side, #339/#345) -- an impeachment-only statement
    // still identifies a witness, so f.statements (unfiltered) feeds the
    // marker while the loop below filters what actually prints.
    // Site 2: the court-record 📌 keys on the fact. 👤 never generates (design §4), and is recorded
    // on the fact for the Evidence criterion (Goal card design §2.7).
    const courtRecordPin = courtRecordPinpointMarker(f.courtRecord, f.courtRecordPinpoint, f.courtRecordExecution, f.courtRecordExhibitLetters);
    // A suppressed 👤 (schema v69) prints as 🤫 and is recorded as 👤, flagged, so the criterion
    // counts it met.
    const witnessMarker = noWitnessMarker(courtRecordLinked, f.statements.length > 0, f.admitted, f.spentAdmissionGlyphs);
    const marker = dedupeLineMarkers([suppressMarker(witnessMarker, f.witnessSuppressed), courtRecordPin]);
    if (inv) recordGlyphs(inv, courtRecordPin, ["📌"], { table: "facts", id: f.factId, item: f.postulate });
    if (inv) recordCriterionGlyphs(inv, witnessMarker, ["👤"], { table: "facts", id: f.factId, item: f.postulate, ...(f.witnessSuppressed ? { suppressed: true as const } : {}) });
    const factReview = reviewMarkerFor(opts.review, inv, marker, "facts", f.factId, f.postulate);
    const factLine = printMarkerSets([dedupeLineMarkers([marker, factReview])]);
    const courtRecordCite = courtRecordCitation(f.courtRecord, f.courtRecordPinpoint);
    para += 1;
    lines.push("");
    lines.push(`${prefix}${para}. ${f.postulate}${courtRecordCite ? ` ${courtRecordCite}` : ""}${factLine ? ` ${factLine}` : ""} <!-- fact_id ${f.factId} -->`);
    for (const s of f.statements) {
      if (s.purpose === "impeachment") continue;
      const citationLine = factStatementCitationLine(exhibitMap, labelMap, s);
      const copyMarker = s.instrument_id !== null ? copyMarkers.get(s.instrument_id) ?? "" : "";
      const statementGlyphs = factStatementMarkers(s, courtRecordLinked, f.admitted, copyMarker);
      // Sites 3 / 3' / 3'': one glyph string, three keyed rows. 👃 and 🏆 never generate; the
      // recorder flags them `generating: false` for the Evidence criterion.
      if (inv) recordFactStatementGlyphs(inv, statementGlyphs, s, f.postulate);
      const statementReview = reviewMarkerFor(opts.review, inv, statementGlyphs, "statements_of_fact", s.statement_id, `${s.witness_name}: ${f.postulate}`);
      pushStatementLines(
        lines,
        s.exhibit_id !== null ? s.exhibit_excerpt : s.excerpt,
        citationLine,
        printMarkerSets([dedupeLineMarkers([statementGlyphs, statementReview])]),
        "statement_of_fact_id",
        s.statement_id
      );
    }
  }

  for (const la of lawAssertions) {
    const priorPara = renderedLawAssertions.get(la.lawAssertionId);
    if (priorPara !== undefined) {
      // Already rendered in full earlier in this document: a numbered cross-reference
      // paragraph, nothing stacked beneath it.
      para += 1;
      lines.push("");
      lines.push(`${prefix}${para}. As set out in paragraph ${prefix}${priorPara}, above, ${la.proposition} <!-- law_assertion_id ${la.lawAssertionId} -->`);
      continue;
    }
    // Three lists, deliberately. `live` is every statement of law from a non-killed authority.
    // `counted` narrows it to the set the proposition's own markers read: 📖 🔬 🥉 🥈 🏅 are blind
    // to a killed authority's statements (work-markers.md §4 "Killed") and, since #830, to an
    // overruled authority's too -- it is not good law, so a proposition holding nothing else has
    // lost its doctrinal basis, and leaving those statements in would let an overruled 🥇 mask a
    // live 🥉. `verifiedCounted` is that set's non-lead half, and since #842 it is also what
    // renders: a statement on a killed OR an overruled authority rides the brief-only cap exactly
    // as a lead one does (#370 item 4; schema v16; work-markers.md §1 "Overruled binds every row
    // of 1a"), so all three appear in the Counsel Brief alone and an authority the court has
    // rejected is never quoted to a forum. A failed statement (schema v46) is blind to the
    // proposition's markers on the same ground as an overruled one: the research lawyer found it
    // does not support the proposition, so a proposition holding nothing else reads 📖 again.
    // `verifiedCounted` reads countsAsSupport, so a failed statement never renders either. A settled
    // statement (schema v47, counsel's confirmed close over a finding) counts and renders exactly as
    // a verified one does.
    const live = la.statements.filter(authorityNotKilled);
    const counted = live.filter(authorityNotOverruled).filter(notFailed);
    const verifiedCounted = counted.filter(countsAsSupport);
    const printStatements = opts.includeLeadStatements ? la.statements : verifiedCounted;
    // 🚧 and 📖 own the line whenever either fires, so the rung never merges with them: 📖
    // structurally (no counted statement => sourceRungMarker returns ""), 🚧 by choice (issue #365
    // pinned interpretation -- "researched, nothing found" has already answered the "get better
    // authority" work 🥉/🥈 asks for, and work-markers.md §5 calls 🚧 the only terminal). 🔬 does
    // co-render with the rung (work-markers.md rows 🔬/🥉), so it goes through dedupeLineMarkers
    // rather than the fallback. The rung reads the verified statements when any exist, else the
    // leads: a verified tertiary statement is never masked by a lead primary one, and a lead-only
    // proposition still shows "get primary".
    const bare = doctrinalSlotMarker({ dead_end: la.deadEnd, countedStatements: counted.length, verifiedStatements: verifiedCounted.length });
    const rung = sourceRungMarker((verifiedCounted.length > 0 ? verifiedCounted : counted).map((s) => s.source));
    // ⛔ joins this line while any live statement's authority is overruled (work-markers.md §1
    // "Overruled binds every row of 1a", #1200). Where no counted statement is left it prefixes the
    // 📖 it reopened (Types, ⛔→🏛️⊕📖), as the order's line carries ⛔ 🏛️. Where one survives it
    // renders beside 🧐, the review confirming the overruling, since the overruled statement itself
    // prints only in the Counsel Brief; once approved, the bare ⛔ names the routing decision left.
    // 🚧 keeps owning the line alone, since "researched, nothing found" has already answered the
    // reopen.
    const overruled = live.some((s) => s.treatment === "overruled") ? treatmentMarker("overruled") : "";
    const doctrinal = bare === "🚧" ? bare : bare === "📖" ? dedupeLineMarkers([overruled, bare]) : dedupeLineMarkers([overruled, bare, rung]);
    // Site 4: 📖 and the 🥉/🥈 rung key on the proposition. 🔬's proposition-line roll-up, 🚧 and
    // 🏅 never generate (design §4) -- recordGlyphs takes only what this site may propose. The
    // three are recorded on the proposition for the Goal card's criteria (Goal card design §2.7).
    // The rung prints fused to 🏅 (🥈🏅, 🥉🏅), so 🏅 is stripped for the whole-token match (#908).
    // While a live statement of the proposition has failed scrutiny (schema v46), its 📖 still
    // prints and still counts for the criteria, but proposes nothing: the next step is counsel's
    // decision on the finding, not new research.
    const scrutinyFailed = live.some((s) => s.verification === "failed");
    if (inv) recordGlyphs(inv, doctrinal.replaceAll("🏅", ""), scrutinyFailed ? ["🥉", "🥈"] : ["📖", "🥉", "🥈"], { table: "law_assertions", id: la.lawAssertionId, item: la.proposition });
    if (inv) recordCriterionGlyphs(inv, doctrinal, scrutinyFailed ? ["🚧", "🔬", "🏅", "📖"] : ["🚧", "🔬", "🏅"], { table: "law_assertions", id: la.lawAssertionId, item: la.proposition, instance: "proposition" });
    const propositionReview = reviewMarkerFor(opts.review, inv, doctrinal, "law_assertions", la.lawAssertionId, la.proposition);
    const propositionLine = printMarkerSets([dedupeLineMarkers([doctrinal, propositionReview])]);
    // #1202: while ⛔ prints, a plain-text tag names each overruled authority once, so counsel can
    // confirm the overruling without opening the Counsel Brief, which prints the overruled
    // statements themselves and so carries no tag (includeLeadStatements is its mode). It sits
    // immediately before ⛔, the anchor the filed-face strip matches on (filed-face.ts), and is
    // joined here rather than through dedupeLineMarkers, which would split it into words.
    const overruledMarkerPrinted = overruled !== "" && doctrinal.startsWith(overruled); // false when 🚧 owns the line
    const overruledTag = overruledMarkerPrinted && !opts.includeLeadStatements ? ` ${overruledAuthorityTag(live)}` : "";
    // A live statement the research lawyer failed (schema v46) tags the line with its finding,
    // whether or not another statement still supports it, so the line never reads clean while a
    // decision is owed. Like the overruled tag it is left out of the Counsel Brief, which prints
    // the failed statement and its tag itself. It precedes the overruled tag, which must stay
    // immediately before ⛔; filed-face.ts strips both.
    const failedTag = opts.includeLeadStatements ? "" : scrutinyFailedTag(live);
    para += 1;
    renderedLawAssertions.set(la.lawAssertionId, para);
    lines.push("");
    lines.push(`${prefix}${para}. ${la.proposition}${failedTag}${overruledTag}${propositionLine ? ` ${propositionLine}` : ""} <!-- law_assertion_id ${la.lawAssertionId} -->`);
    for (const s of printStatements) {
      const statementGlyphs = lawStatementMarkers(s, opts.scrutinyLive?.(la.lawAssertionId) ?? true);
      // Sites 5 / 5': 📜 📍 🔬 key on the statement, 📇 and 🏅 on its authority. A killed authority's
      // statement line prints no marker at all, so the recorder is handed an empty glyph string
      // and records nothing -- design §4's "never generate", with no filter of its own.
      if (inv) recordLawStatementGlyphs(inv, statementGlyphs, { ...s, statement_id: s.statement_id as number });
      const statementReview = reviewMarkerFor(opts.review, inv, statementGlyphs, "statements_of_law", s.statement_id as number, lawItem(s));
      pushStatementLines(lines, s.excerpt, lawStatementCitationLine(s), printMarkerSets([dedupeLineMarkers([statementGlyphs, statementReview])]), "statement_of_law_id", s.statement_id as number);
    }
  }

  return { lines, nextPara: para };
}

/** `(overruled: <title>, <citation>; ...)` over a proposition's live statements whose authority is
 * overruled: each authority once, in first-statement order, the citation omitted when none is
 * recorded (the Counsel Brief's Killed authorities format). Whitespace runs collapse to one space
 * so the tag stays on one line for the filed-face strip. */
function overruledAuthorityTag(live: LawAssertionRow[]): string {
  const names = new Map<number | null, string>();
  for (const s of live) {
    if (s.treatment !== "overruled" || names.has(s.authority_id)) continue;
    const name = `${s.authority_title ?? ""}${s.authority_citation ? `, ${s.authority_citation}` : ""}`;
    names.set(s.authority_id, name.replace(/\s+/g, " ").trim());
  }
  return `(overruled: ${[...names.values()].join("; ")})`;
}

/**
 * Records the paragraph number a venue renderer is about to assign to one submission's contention
 * (always startPara + 1 -- renderSubmissionParagraphs increments before it prints). Called
 * immediately before each renderSubmissionParagraphs call so the Counsel Brief can reproduce this
 * document's numbering instead of re-deriving four different base-offset conventions.
 *
 * First-write-wins, and forms.ts's documentsForFiling renders the venue face before the Written
 * Arguments companion, so a submission carried by both documents keeps the venue face's number --
 * the ticket's requirement (filing_submissions.document='form'). A submission the Written
 * Arguments skips as crossed out never reaches here and so has no entry, which is how the brief
 * tells "struck" from "numbered".
 */
export function recordParagraph(ctx: RenderContext, submissionId: number, document: PointerDocument, startPara: number): void {
  if (!ctx.paragraphLedger.has(submissionId)) ctx.paragraphLedger.set(submissionId, { document, para: startPara + 1 });
}

/** One order_sought row deployed by one filing document, its jurisdictional-basis edges
 * (order_sought_requires, 0..N -- schema v10 #380 replaced the old single jurisdiction_slot_state
 * column) attached. `crossed_out_on` (📅⊕∅) is the pursued axis; `hasServedBy` backs 🦵 unserved
 * petitum -- callers on a document that doesn't want that glyph (the requisition renderers, which
 * never called jurisdictionLadderMarker either) can simply not read it. Shared by every renderer
 * that shows order_sought (VanIAC's Written Argument, the NoA's Part 1, the requisition
 * renderers), one query shape instead of three drifting copies. */
export interface OrderSoughtRow {
  id: number;
  wording: string;
  wording_override: string | null;
  amount: number | null;
  template_key: string | null;
  template_values: string | null;
  crossed_out_on: string | null;
  filing_ordinal: number;
  /** filing_orders.id -- 🧵 loose-thread keys on the venue form's pointer row, not the order
   * (design §4). Read by the Proposal inventory alone; nothing rendered uses it. */
  pointer_id: number;
  hasServedBy: boolean;
  requires: JurisdictionRequiresEdge[];
}

export function fetchOrdersSought(dbPath: string, filingId: number, document: PointerDocument): OrderSoughtRow[] {
  const orders = rows<{
    id: number;
    wording: string;
    wording_override: string | null;
    amount: number | null;
    template_key: string | null;
    template_values: string | null;
    crossed_out_on: string | null;
    filing_ordinal: number;
    pointer_id: number;
    has_served_by: number;
  }>(
    dbPath,
    `SELECT o.id, o.wording, fo.wording_override, o.amount, o.template_key, o.template_values,
            o.crossed_out_on, fo.ordinal AS filing_ordinal, fo.id AS pointer_id,
            EXISTS(
              SELECT 1 FROM order_sought_served_by sb
              JOIN submissions s ON s.id = sb.submission_id
              WHERE sb.order_sought_id = o.id AND s.killed_on IS NULL
            ) AS has_served_by
     FROM filing_orders fo
     JOIN order_sought o ON o.id = fo.order_sought_id
     WHERE fo.filing_id = ? AND fo.document = ?
     ORDER BY fo.ordinal`,
    [filingId, document]
  );
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const edgesByOrder = fetchJurisdictionEdges(dbPath, ids);
  return orders.map((o) => ({ ...o, hasServedBy: o.has_served_by === 1, requires: edgesByOrder.get(o.id) ?? [] }));
}

/** order_sought_requires edges for a set of orders, grouped by order id (schema v10, #380). Shared by
 * fetchOrdersSought (venue faces) and the Counsel Brief's proceeding-wide orders list. */
export function fetchJurisdictionEdges(dbPath: string, orderIds: number[]): Map<number, JurisdictionRequiresEdge[]> {
  const edgesByOrder = new Map<number, JurisdictionRequiresEdge[]>();
  if (orderIds.length === 0) return edgesByOrder;
  const placeholders = orderIds.map(() => "?").join(",");
  const edges = rows<{ order_sought_id: number } & JurisdictionRequiresEdge>(
    dbPath,
    `SELECT req.order_sought_id, req.basis_state, sl.id AS statement_id, sl.excerpt, sl.pinpoint, sl.source, sl.verification,
            auth.treatment, auth.kind AS authority_kind, auth.currency_status, auth.currency_checked_on, auth.killed_on AS authority_killed_on,
            auth.id AS authority_id, auth.style_of_cause_or_title AS authority_title, auth.citation AS authority_citation
     FROM order_sought_requires req
     LEFT JOIN statements_of_law sl ON sl.id = req.excerpt_id
     LEFT JOIN authorities auth ON auth.id = sl.authority_id
     WHERE req.order_sought_id IN (${placeholders})`,
    orderIds
  );
  for (const e of edges) {
    const list = edgesByOrder.get(e.order_sought_id) ?? [];
    list.push(e);
    edgesByOrder.set(e.order_sought_id, list);
  }
  return edgesByOrder;
}

export interface OpposingPointRow {
  id: number;
  component: string;
  pinpoint: string | null;
  verbatim_words: string | null;
  answered_by_submission_id: number | null;
  answered_by_contention: string | null;
}

/** opposing_points (build #359): proceeding-scoped -- the table carries no
 * filing/round column, and a coverage inventory is meant to read across the
 * whole proceeding, not just this filing. Rendered as a mockup-only
 * "Opposing points" section (↩️ is a work marker like any other, so it
 * renders for the human and is stripped from the filed face, filed-face.ts)
 * -- the filed answer to a point is the responsive submission's own
 * verbatim-quoted anchor, not this inventory. */
export function fetchOpposingPoints(dbPath: string, proceedingId: number): OpposingPointRow[] {
  return rows<OpposingPointRow>(
    dbPath,
    `SELECT op.id, op.component, op.pinpoint, op.verbatim_words, op.answered_by_submission_id,
            s.contention AS answered_by_contention
     FROM opposing_points op
     LEFT JOIN submissions s ON s.id = op.answered_by_submission_id
     WHERE op.proceeding_id = ?
     ORDER BY op.ordinal`,
    [proceedingId]
  );
}

function frontmatterFor(
  documentType: string,
  proceeding: ProceedingRow,
  filing: FilingRow,
  revision: number,
  rendered: string,
  clientName: string,
  clientNo: string,
  matterNo: string,
  matterDescription: string
): string {
  const fields: FrontmatterFields = {
    matterNo,
    matterDescription,
    clientName,
    clientNo,
    documentType,
    documentName: filing.title,
    documentDate: BLANK_UNDERLINE,
    venue: proceeding.court_or_centre ?? captionHeadingFor(filing, proceeding).display_label,
    proceedingFileNo: proceeding.file_number ?? "",
    revision,
    rendered,
  };
  return frontmatterHeader(fields);
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

/** What a venue renderer actually assigned to one submission's contention paragraph. */
export interface LedgerEntry {
  document: PointerDocument;
  para: number;
}

export interface RenderContext {
  dbPath: string;
  proceeding: ProceedingRow;
  parties: PartyRow[];
  filing: FilingRow;
  revision: number;
  rendered: string;
  clientName: string;
  clientNo: string;
  matterNo: string;
  /** The matter's description from practice data, "" when the caller resolved none. */
  matterDescription: string;
  /**
   * submission_id -> the paragraph number and source document a venue renderer actually assigned
   * to that submission's contention. Written first-write-wins by every renderSubmissionParagraphs
   * call site; read only by renderCounselBrief, which reproduces the venue numbering rather than
   * re-deriving it (each venue document has its own base offset -- NoA Part 3 restarts at 1, the
   * Application Response continues from Part 4's fact count, the BCCA response book runs one
   * counter across the whole document, Written Arguments starts at 1). The brief must therefore
   * stay LAST in forms.ts's documentsForFiling, after every renderer that fills this. Required,
   * not optional, so a future RenderContext construction site cannot silently forget it.
   * Per-filing: buildContext creates a fresh Map for each render.
   */
  paragraphLedger: Map<number, LedgerEntry>;
  /** The filing's derived lifecycle state (schema v17, forms/lifecycle.ts). Read by the Work
   * Board only -- no advocacy document shows it. Required, not optional, so a future
   * RenderContext construction site cannot silently forget it. */
  lifecycle: Lifecycle;
  /**
   * Every generating work-marker glyph this render emitted, recorded at its emit site on the row
   * the work is done on (Work Board Proposals design §8; forms/proposal-inventory.ts), plus the
   * glyphs a Goal-card criterion counts although they never generate, flagged `generating: false`
   * (Goal card design §2.2). forms.ts stamps each entry with the document that emitted it. The Job
   * Board derives its proposed and Shelved lanes from it, and render-manifest.json saves
   * it so a stamp hit derives the same lanes without re-rendering. Every mockup render builds all
   * documents before the board, so the inventory is complete by the time the board reads it -- the
   * ORDER IS LOAD-BEARING comment in forms.ts's documentsForFiling is what guarantees that.
   * Required, not optional, for the same reason as paragraphLedger above.
   */
  inventory: MarkerInventory;
  /**
   * Every reviewed object's current snapshot and latest approval (fetchReviewState; the
   * /drafting-data reference review.md). Read by the forum emit sites through reviewMarkerFor,
   * which prints 🧐 final review; the Counsel Brief never reads it. Required, not optional, so
   * a future RenderContext construction site cannot forget it.
   */
  review: ReviewState;
}

/** Witness statement folded into documents (schema v3 #328/#327): the witness statement itself is a documents row (instrument='witness_statement'), reached through filing_documents(role='witness_statement') rather than a dedicated table. */
interface WitnessStatementRow {
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

interface StatementParagraphRow {
  id: number;
  ordinal: number;
  text: string;
}

function fetchWitnessStatements(dbPath: string, filingId: number): WitnessStatementRow[] {
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

function fetchStatementParagraphs(dbPath: string, documentId: number): StatementParagraphRow[] {
  return rows<StatementParagraphRow>(
    dbPath,
    `SELECT id, ordinal, text FROM statement_paragraphs WHERE document_id = ? ORDER BY ordinal`,
    [documentId]
  );
}

/** A paragraph links to the witness's statement of fact, not the fact directly (schema v3 #328: paragraph_statements_of_fact, closing the double path); resolved back to fact_id for the mockup's [facts F#] tag. statement_of_fact_id (build #329) tells renderWitnessStatements which included rows are already drafted into this document, vs. still belonging in the trailing "not yet in this statement" subsection. */
function fetchParagraphFacts(
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
interface WitnessFactRow {
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

function fetchIncludedStatementsOfFactForWitness(dbPath: string, witnessId: number): WitnessFactRow[] {
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

/** Fact-side ladder for a statement of fact not yet linked to any paragraph of its witness statement (work-markers.md 1a: 🗣️ talk to witness / ✍️ draft it -- never 🖋️/✒️, since "unlinked" means not yet written in this instrument; instrument_id: null makes that structural, not a convention to remember). 🧷 never rides here: the instrument is null by construction. 📌 does (Phase C, #777): an exhibit can be linked before the statement is drafted into the instrument, and §5 says 📌 still fires with no instrument. Build #329, decision #320. */
function unlinkedFactMarkers(f: WitnessFactRow, admitted: boolean): string {
  const courtRecordLinked = f.fact_court_record !== null;
  if (isAdmittedGuard(courtRecordLinked, admitted)) return doubtMarker(f.doubt);
  return dedupeLineMarkers([
    exhibitPinpointMarker(f.exhibit_id, f.exhibit_pinpoint),
    statementOfFactMarkers({
      interviewed: f.interviewed,
      instrument_id: null,
      instrument_kind: null,
      instrument_execution: null,
      fact_court_record_linked: courtRecordLinked,
      fact_admitted_by_all_opposing: admitted,
    }),
    doubtMarker(f.doubt),
  ]);
}

interface ReliedOnDocumentRow {
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
function fetchDocumentsReliedOn(dbPath: string, statementDocumentId: number): ReliedOnDocumentRow[] {
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

/** One Witness Statement document per filing_documents(role='witness_statement') row on this filing. Returns one markdown string per witness. */
export function renderWitnessStatements(ctx: RenderContext): { witnessName: string; markdown: string }[] {
  const statements = fetchWitnessStatements(ctx.dbPath, ctx.filing.id);
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const opposing = opposingPartyIds(ctx.parties);
  const today = ctx.rendered.slice(0, 10);
  // Same exhibit numbering the Evidence Index uses (renderEvidenceIndex),
  // so "Documents relied on" cites the identical Ex. N for a shared document.
  // Same numbering the Evidence Index uses, so "Documents relied on" cites the identical Ex. N
  // for a shared document -- proceeding-wide for a VanIAC package since #712, so a statement may
  // rely on a document first exhibited in an earlier round and print the number it was given there.
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, fetchFilingDocuments(ctx.dbPath, ctx.filing.id).map((d) => d.document_id));

  return statements.map((s) => {
    const paragraphs = fetchStatementParagraphs(ctx.dbPath, s.id);
    const links = fetchParagraphFacts(
      ctx.dbPath,
      paragraphs.map((p) => p.id)
    );
    const factsByParagraph = new Map<number, number[]>();
    for (const link of links) {
      const list = factsByParagraph.get(link.statement_paragraph_id) ?? [];
      list.push(link.fact_id);
      factsByParagraph.set(link.statement_paragraph_id, list);
    }

    const witnessFacts = fetchIncludedStatementsOfFactForWitness(ctx.dbPath, s.witness_id);
    const linkedSofIds = new Set(links.map((l) => l.statement_of_fact_id));
    const unlinkedFacts = witnessFacts.filter((f) => !linkedSofIds.has(f.id));
    const admittedFactIds = fetchFactAdmissionCoverage(
      ctx.dbPath,
      unlinkedFacts.map((f) => f.fact_id),
      opposing,
      today
    );

    const lines: string[] = [];
    lines.push(
      frontmatterFor("Witness_statement", ctx.proceeding, ctx.filing, ctx.revision, ctx.rendered, ctx.clientName, ctx.clientNo, ctx.matterNo, ctx.matterDescription)
    );
    lines.push(`<!-- filing ${ctx.filing.id} proceeding ${ctx.proceeding.id} witness_statement ${s.id} -->`);
    lines.push("");
    lines.push(
      styleOfProceedingCaption(captionParties, {
        heading: captionHeadingFor(ctx.filing, ctx.proceeding),
        registry: ctx.proceeding.registry,
        fileNumber: ctx.proceeding.file_number,
        titleLine: `WITNESS STATEMENT OF ${s.witness_name.toUpperCase()}`,
      })
    );
    lines.push("");
    lines.push(`I, ${s.witness_name}, state as follows:`);
    lines.push("");

    paragraphs.forEach((p, i) => {
      const factIds = factsByParagraph.get(p.id) ?? [];
      const tag =
        factIds.length > 0
          ? ` [facts ${factIds.map((id) => `F${id}`).join(", ")}]`
          : ` ${gapMarker("gap")} [GAP -- no fact linked]`;
      // Each 🧩 is an open item keyed on its own row (#1226).
      recordCriterionGlyphs(ctx.inventory, tag, ["🧩"], { table: "statement_paragraphs", id: p.id, item: `${s.witness_name}'s witness statement, paragraph ${i + 1}: linked fact` });
      lines.push(`${i + 1}. ${p.text}${tag} <!-- statement_paragraph ${i + 1} -->`);
    });
    if (witnessFacts.length === 0) {
      // Statement-level gap (work-markers.md 1a line 21, derived; build #329/#320): this witness has
      // no included statements_of_fact row at all -- nothing yet attributed, so nothing to sign either.
      const line = `${gapMarker("gap")} no facts attributed to this witness`;
      recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "witnesses", id: s.witness_id, item: `${s.witness_name}'s witness statement: attributed facts` });
      lines.push(line);
    }
    lines.push("");

    // Rule 18(b)(v): identify with specificity any document relied on. Only
    // rendered when this statement's own paragraphs actually cite an
    // exhibit -- an empty list is silent, matching every other open slot.
    const reliedOn = fetchDocumentsReliedOn(ctx.dbPath, s.id);
    if (reliedOn.length > 0) {
      lines.push("**Documents relied on**");
      lines.push("");
      for (const d of reliedOn) {
        const exhibitNo = exhibitMap.get(d.id);
        const cite = exhibitNo !== undefined ? `Ex. ${exhibitNo}` : d.label;
        const dated = d.document_date ? `, dated ${d.document_date}` : "";
        lines.push(`- ${cite} — ${d.label}${dated} <!-- document_id ${d.id} -->`);
      }
      lines.push("");
    }

    // sign-it: documents.execution IS NULL AND >=1 paragraph linked (work-markers.md 1a line 34's
    // compound predicate; build #329/#320 -- an unsigned statement with nothing drafted shows the
    // gap above, not this).
    const swearMarker = s.execution === null && links.length > 0 ? "🖋️" : "";
    // Site 6: this instrument's own 🖋️, keyed on the witness statement document.
    recordGlyphs(ctx.inventory, swearMarker, ["🖋️"], { table: "documents", id: s.id, item: s.label, witness_id: s.witness_id });
    lines.push(`I make this statement believing its contents to be true. ${swearMarker}`.trim());
    lines.push("");
    // Rule 18(b)(iv): be signed by the witness, with the date and place of
    // signature. Rule 18(c): need not be sworn or affirmed -- a plain
    // signature line, never a jurat.
    lines.push("________________________________");
    lines.push(s.witness_name);
    lines.push("");
    lines.push(`Signed at: ${s.signed_at ?? "________________"}`);
    lines.push(`Date: ${s.execution ?? "________________"}`);

    if (unlinkedFacts.length > 0) {
      // Rendered for the human, withheld from the filed face -- same mechanism as Held in reserve
      // (build #329, decision #320(a)).
      lines.push("");
      lines.push("## Facts attributed to this witness, not yet in this statement");
      lines.push("");
      for (const f of unlinkedFacts) {
        const rung = unlinkedFactMarkers(f, admittedFactIds.has(f.fact_id));
        // Sites 7 / 7': 📌 keys on the statement, 🗣️/✍️ on the witness. "Unlinked" means no
        // instrument by construction, so no 🖋️/✒️ entry can arise here.
        recordFactStatementGlyphs(
          ctx.inventory,
          rung,
          { statement_id: f.id, witness_id: s.witness_id, witness_name: s.witness_name, instrument_id: null, instrument_label: null },
          f.postulate
        );
        const printed = printMarkerSets([rung]);
        lines.push(`- ${f.postulate}${printed ? ` ${printed}` : ""} <!-- statement_of_fact_id ${f.id} -->`);
      }
    }

    return { witnessName: s.witness_name, markdown: lines.join("\n").trimEnd() + "\n" };
  });
}

export interface FilingDocumentRow {
  id: number;
  document_id: number;
  ordinal: number;
  role: string;
  label: string;
  document_date: string | null;
  description: string | null;
  file_path: string | null;
  /** 'already_in_court_file' marks a row the drafter listed rather than shipped -- material
   * already before the forum from an earlier round (#712). The pre-filing gate reads it to tell
   * a cited-not-shipped exhibit apart from a missing one. */
  provenance: "served_with_this_response" | "already_in_court_file" | null;
}

export function fetchFilingDocuments(dbPath: string, filingId: number): FilingDocumentRow[] {
  return rows<FilingDocumentRow>(
    dbPath,
    `SELECT fd.id, fd.document_id, fd.ordinal, fd.role, fd.provenance, d.label, d.document_date, d.description, d.file_path
     FROM filing_documents fd
     JOIN documents d ON d.id = fd.document_id
     WHERE fd.filing_id = ? AND fd.role != 'witness_statement'
     ORDER BY fd.ordinal`,
    [filingId]
  );
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
 * resolution comment). `whereClause` is an internal literal built by this
 * file's own callers with `?` placeholders (`a.id IN (…)` / `a.fact_id IN
 * (…)`), never caller-supplied data -- same interpolation discipline as
 * the `placeholders` pattern used throughout this file.
 */
function fetchAdmissionStates(dbPath: string, whereClause: string, params: unknown[]): AdmissionStateRow[] {
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

/**
 * Evidence Index: one table, Ex. N / date / description / tendered by,
 * numbered by filing_documents.ordinal (the drafting skill's citation
 * order; issue #321's exhibitNumbersFromOrderedIds is the same numbering,
 * shared with any excerpt citation that cites an exhibit). Excludes
 * role='witness_statement' rows -- those are their own rendered documents
 * (renderWitnessStatements), not exhibits (schema v3 #328/#327). Tendered
 * by (issue #330/#333/#339/#345): every included statements_of_fact row
 * whose exhibit_id is this document -- witness name, and the instrument
 * it's written in when linked -- plus every admissions row whose exhibit
 * is this document and whose derived ladder state is a genuine tender
 * (admissionRole "tenders") or still-live work ("outstanding") -- the
 * admitting party's name. A "spent" admission (denied/refused/no-knowledge/
 * struck -- it tenders nothing) is suppressed from this cell; its event
 * glyph instead prefixes 👤 in the description cell (terms-and-symbols.md:
 * "🙅🏻‍♂️→👤", "⚡️→⏳ ⊕ 👤" -- rendered for the human, not silently
 * dropped, CLAUDE.md's "document" rule). Existence is a flat check across
 * both sources and every party (not per-opposing-party -- the Evidence
 * Index has one row per exhibit, not one per party; see #339's resolution
 * comment) but is state-aware since #345: only a tendering admission
 * clears 👤. Since #398, 👤 and its spent-glyph prefix apply only to
 * role='evidence'/'other' rows (isExhibitTenderRole, markers.ts) -- shared
 * with the Notice of Application's Part 4; the Tendered-by cell itself stays
 * unconditional across every role. Also renders a trailing Source trace
 * section (issue #325) -- a human-side lookup of each exhibit's
 * matter-workspace location and PDF page range, rendered the same way as
 * Held in reserve: for the human, withheld from the forum (CLAUDE.md
 * "document" rule). A NULL file_path renders no line here and no marker
 * on the main table -- work-markers.md's 🏷️ *not recorded* is the nearest
 * glyph, but claiming it for this field is a change-controlled SSOT edit
 * this ticket does not make (issue #325).
 *
 * Known limit, not fixed (Work Board Proposals plan, Phase C defect 5; #777): 🎾, 🕹️, live-admission
 * capture (📑 📌 / 💬 🧷 on an admission) and 🏷️ print only here, on the VanIAC Evidence Index. The NoA
 * Part 4, Application Response Part 6 and BCCA material lists emit none of them, so a Job Board for
 * those filing kinds never proposes that work (design §4: Proposals come only from emitted markers).
 * Record it as a loose thread on the first filing that needs it; do not add the emissions here without that
 * ticket.
 */
export function renderEvidenceIndex(ctx: RenderContext): string {
  // Rows are this filing's own: what this round ships, plus any row the drafter linked as already
  // before the tribunal. The numbers are the proceeding's (#712), so an Opening exhibit cited
  // again in the Reply keeps its original Ex. N.
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, docs.map((d) => d.document_id));
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const tenderStatus = fetchDocumentTenderStatus(ctx.dbPath, docs.map((d) => d.document_id), ctx.rendered.slice(0, 10), ctx.inventory);

  const lines: string[] = [];
  lines.push(frontmatterFor("Evidence_index", ctx.proceeding, ctx.filing, ctx.revision, ctx.rendered, ctx.clientName, ctx.clientNo, ctx.matterNo, ctx.matterDescription));
  lines.push(`<!-- filing ${ctx.filing.id} proceeding ${ctx.proceeding.id} -->`);
  lines.push("");
  lines.push("| Ex. | Date | Description | Tendered by |");
  lines.push("| --- | --- | --- | --- |");
  docs.forEach((d) => {
    const date = d.document_date ?? "undated";
    const status = tenderStatus.get(d.document_id)!;
    const eligible = isExhibitTenderRole(d.role);
    const marker = eligible ? unsponsoredExhibitMarker(status.hasTender) : "";
    const spentGlyphs = eligible ? status.spentGlyphs : "";
    const gap = d.description ? "" : ` ${gapMarker("not_recorded")}`;
    // Site 8: 🏷️ keys on the document. 👤, the spent-admission rungs and 🏆 never generate.
    recordGlyphs(ctx.inventory, gap.trim(), ["🏷️"], { table: "documents", id: d.document_id, item: d.label });
    const copyMarker = copyMarkers.get(d.document_id) ?? "";
    // All the document's own markers, the spent rungs prefixing the 👤 they route: one set.
    const markers = printMarkerSets([[gap.trim(), spentGlyphs, marker, copyMarker].filter(Boolean).join(" ")]);
    lines.push(
      `| Ex. ${exhibitMap.get(d.document_id)} | ${date} | ${d.description ?? "(not recorded)"}${markers ? ` ${markers}` : ""} | ${status.tenderedBy} | <!-- document_id ${d.document_id} -->`
    );
  });

  if (docs.some((d) => d.file_path)) {
    lines.push("");
    lines.push("## Source trace");
    lines.push("");
    docs.forEach((d) => {
      if (!d.file_path) return;
      lines.push(`- Ex. ${exhibitMap.get(d.document_id)} — ${d.file_path} <!-- document_id ${d.document_id} -->`);
    });
  }

  return lines.join("\n").trimEnd() + "\n";
}
