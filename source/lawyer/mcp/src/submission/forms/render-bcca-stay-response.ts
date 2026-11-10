// BCCA stay-application Response Book renderer (build ticket #436, research
// #433; cover page/TOC/multi-party/TOA-delta compliance fix following #436,
// schema v13). The sixth /draft filing kind: the respondents'
// response to a Court of Appeal stay application under B.C. Reg. 120/2022
// R. 21(1)(a). No prescribed form exists -- the filed document is a
// "response book" whose contents the registrar's completion instructions
// set (R. 21(2); canonical requirements doc at
// source/skills/draft/references/bcca-response-book-form.md,
// primary sources at planning/bcca-response-inputs/): a required cover page,
// a required table of contents, Part 1 evidence/affidavits not already in
// the application book, Part 2 written argument -- itself carrying its OWN
// required cover page (e-CI §2.1) -- (max 5 pages stay-only; parts Facts /
// Issues / Analysis / Order Sought, paragraphs numbered consecutively from
// the Statement of Facts), and an optional Part 3 table of authorities that
// is a DELTA against the application book's own table (e-CI §1.2: "including
// new cases and sections of enactments that have not been referenced in the
// application book").
//
// Like the VanIAC submissions package -- and unlike every BCSC kind -- the
// written argument here IS the substantive venue document (the book is its
// binding), so pointer rows read document='form' and forms.ts appends no
// separate Written Arguments companion for this kind (#370/#380 item 5's
// exemption, extended). The appellants' sought orders and this filing's
// stance on them reuse opposing_orders/filing_positions exactly as the BCSC
// Application Response does (#372/#386). Book assembly (PDF combining,
// bookmarks, CSO packaging) is out of scope -- the mockup carries correct,
// complete part content for manual assembly (phase-2 ticket #439); table of
// contents page numbers render "TBD" until that assembly happens.

import { BRIEF_ONLY_CAP_SQL } from "./brief-only-cap.js";
import {
  bccaCoverPage,
  buildLowerCourtRoleByRole,
  contactCells,
  formatNameList,
  groupPartiesByRole,
  pluralizeRole,
  signatureBlock,
  type BccaCoverPageContact,
  type CaptionParty,
} from "./components.js";
import {
  courtRecordCitation,
  courtRecordPinpointMarker,
  dedupeLineMarkers,
  doubtMarker,
  exhibitPinpointMarker,
  gapMarker,
  isAdmittedGuard,
  mockupMessage,
  noWitnessMarker,
  suppressMarker,
  printMarkerSets,
  statementOfFactMarkers,
  testimonyPinpointMarker,
  unpositionedOrderMarker,
} from "./markers.js";
import { recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs, type MarkerInventory } from "./proposal-inventory.js";
import { captionHeadingFor, opposingPartyIds } from "./query.js";
import { exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments, fetchNotBestCopyMarkers, type FilingDocumentRow } from "./exhibit-documents.js";
import { fetchFactAdmissionAnnotations } from "./admission-annotations.js";
import { fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions } from "./submission-reads.js";
import { fetchOrdersSought } from "./orders-sought.js";
import { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
import { orderReviewMarkerFor, reviewMarkerFor, type ReviewState } from "./review-state.js";
import { recordParagraph, renderSubmissionParagraphs } from "./submission-paragraphs.js";
import type { RenderContext } from "./render-context.js";
import {
  fetchFilingPositions,
  fetchUnpositionedOrders,
  resolveRespondedToDocument,
  type PositionRow,
} from "./render-application-response.js";
import { fetchRhetoric, interleave, renderRhetoricLine, type RhetoricRow } from "./render-rhetoric.js";
import { factsPart, fetchFacts, fetchStatementsOfFact, type FactRow, type StatementOfFactRow } from "./filing-facts.js";
import { filingFrontmatter } from "./filing-frontmatter.js";
import { rows } from "../query-rows.js";

/** Statement-of-Facts paragraphs for part2-slot facts, numbered from startPara + 1, each with its
 * court-record citation line and fact-side markers. Exported: the BCCA factum's Part 1
 * (render-bcca-factum.ts) renders its facts the same way. */
export function renderFactParagraphs(
  dbPath: string,
  facts: FactRow[],
  startPara: number,
  copyMarkers: Map<number, string>,
  admittedFactIds: ReadonlySet<number>,
  spentGlyphByFact: ReadonlyMap<number, string>,
  suppressedFactIds: ReadonlySet<number>,
  inventory: MarkerInventory,
  review?: ReviewState
): { lines: string[]; nextPara: number } {
  const statementsByFact = new Map<number, StatementOfFactRow[]>();
  for (const stmt of fetchStatementsOfFact(dbPath, facts.map((f) => f.id))) {
    const list = statementsByFact.get(stmt.fact_id) ?? [];
    list.push(stmt);
    statementsByFact.set(stmt.fact_id, list);
  }
  const lines: string[] = [];
  let para = startPara;
  facts.forEach((f) => {
    para += 1;
    const stmts = statementsByFact.get(f.id) ?? [];
    const admitted = admittedFactIds.has(f.id);
    const courtRecordLinked = f.court_record !== null;
    const courtRecordCite = courtRecordCitation(f.court_record, f.court_record_pinpoint);
    // Site 16, the Application Response's Part 4 line in every respect (site 14): the fact's
    // court-record 📌 keys on the fact, and each statement's own tokens are recorded before they
    // join the line's dedupe. No 🧵 on either BCCA kind -- neither carries a Written Arguments
    // companion, so there is no pointer row for a loose thread to key on. 👃 and the copy marker
    // never generate.
    const courtRecordPin = courtRecordPinpointMarker(f.court_record, f.court_record_pinpoint, f.court_record_execution, f.court_record_exhibit_letters);
    recordGlyphs(inventory, courtRecordPin, ["📌"], { table: "facts", id: f.id, item: f.postulate });
    const factTokens: string[] = [
      suppressMarker(noWitnessMarker(courtRecordLinked, stmts.length > 0, admitted, spentGlyphByFact.get(f.id) ?? ""), suppressedFactIds.has(f.id)),
      courtRecordPin,
    ];
    const tokens: string[] = [...factTokens];
    const statementSets: string[][] = [];
    const guarded = isAdmittedGuard(courtRecordLinked, admitted);
    for (const s of stmts) {
      const statementTokens: string[] = [];
      if (!guarded) {
        statementTokens.push(exhibitPinpointMarker(s.exhibit_id, s.exhibit_pinpoint));
        statementTokens.push(testimonyPinpointMarker(s.instrument_id, s.pinpoint));
      }
      statementTokens.push(
        statementOfFactMarkers({
          interviewed: s.interviewed,
          instrument_id: s.instrument_id,
          instrument_kind: s.instrument_kind,
          instrument_execution: s.instrument_execution,
          fact_court_record_linked: courtRecordLinked,
          fact_admitted_by_all_opposing: admitted,
        })
      );
      tokens.push(...statementTokens);
      recordFactStatementGlyphs(
        inventory,
        dedupeLineMarkers(statementTokens),
        { statement_id: s.id, witness_id: s.witness_id, witness_name: s.witness_name, instrument_id: s.instrument_id, instrument_label: s.instrument_label },
        f.postulate
      );
      const doubtAndCopy = [doubtMarker(s.doubt), s.instrument_id !== null ? copyMarkers.get(s.instrument_id) ?? "" : ""];
      tokens.push(...doubtAndCopy);
      statementSets.push([...statementTokens, ...doubtAndCopy]);
    }
    // 🧐 per object on this merged line, and one set per object, as the Application Response's Part 4 does.
    const lineGlyphs = dedupeLineMarkers(tokens);
    factTokens.push(reviewMarkerFor(review, inventory, lineGlyphs, "facts", f.id, f.postulate));
    stmts.forEach((s, i) => {
      if (s.purpose !== "impeachment") statementSets[i].push(reviewMarkerFor(review, inventory, lineGlyphs, "statements_of_fact", s.id, `${s.witness_name}: ${f.postulate}`));
    });
    const glyphs = printMarkerSets([dedupeLineMarkers(factTokens), ...statementSets.map(dedupeLineMarkers)]);
    lines.push(`${para}. ${f.postulate}${glyphs ? ` ${glyphs}` : ""}${courtRecordCite ? "" : ` <!-- fact ${para} -->`}`);
    if (courtRecordCite) lines.push(`   > ${courtRecordCite} <!-- fact ${para} -->`);
  });
  return { lines, nextPara: para };
}

/** renderFactParagraphs with the facts part's rhetorical paragraphs merged in by ordinal
 * (render-rhetoric.ts), each taking the next paragraph number. Exported: the BCCA factum's Part 1
 * merges them the same way. */
export function renderFactParagraphsWithRhetoric(
  ctx: RenderContext,
  facts: FactRow[],
  rhetoric: RhetoricRow[],
  startPara: number,
  copyMarkers: Map<number, string>,
  admittedFactIds: ReadonlySet<number>,
  spentGlyphByFact: ReadonlyMap<number, string>,
  suppressedFactIds: ReadonlySet<number>
): { lines: string[]; nextPara: number } {
  const lines: string[] = [];
  let para = startPara;
  let run: FactRow[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const result = renderFactParagraphs(ctx.dbPath, run, para, copyMarkers, admittedFactIds, spentGlyphByFact, suppressedFactIds, ctx.inventory, ctx.review);
    lines.push(...result.lines);
    para = result.nextPara;
    run = [];
  };
  for (const entry of interleave(facts, rhetoric, (f) => f.filing_ordinal)) {
    if (entry.kind === "host") {
      run.push(entry.item);
      continue;
    }
    flush();
    para += 1;
    lines.push(...renderRhetoricLine(ctx, entry.row, para, ""));
  }
  flush();
  return { lines, nextPara: para };
}

export interface AffidavitDetailRow {
  document_id: number;
  deponent_name: string | null;
  affidavit_number: string | null;
}

/** Deponent/number detail for Part 1's affidavit lines and the TOC data the completion
 * instructions require ("the name of the deponent, the date the affidavit was filed, a
 * description of any attached exhibits" -- e-CI §1.3). Exported: the bcca-book.md emitter
 * (emit-bcca-book.ts) reuses this for its own response_book_toc rows. */
export function fetchAffidavitDetails(dbPath: string, documentIds: number[]): Map<number, AffidavitDetailRow> {
  if (documentIds.length === 0) return new Map();
  const placeholders = documentIds.map(() => "?").join(",");
  const found = rows<AffidavitDetailRow>(
    dbPath,
    `SELECT d.id AS document_id, w.name AS deponent_name, d.affidavit_number
     FROM documents d
     LEFT JOIN witnesses w ON w.id = d.deponent
     WHERE d.id IN (${placeholders})`,
    documentIds
  );
  return new Map(found.map((r) => [r.document_id, r]));
}

export interface AuthorityListRow {
  id: number;
  style_of_cause_or_title: string;
  citation: string | null;
}

/** Distinct authorities cited by this filing's deployed submissions, alphabetical, EXCLUDING
 * any already recorded in opposing_authorities for this proceeding (schema v13) -- Part 3's
 * optional table of authorities is a DELTA against the application book's own table (e-CI
 * §1.2: "including new cases and sections of enactments that have not been referenced in the
 * application book"), not a full list with a note. Exported: the bcca-book.md emitter
 * (emit-bcca-book.ts) reuses this for its own boa_toc. Overruled authorities are excluded
 * (#842): their statements no longer print in Part 3, so listing them here would name an
 * authority the document never cites. Lead statements are excluded for the same reason as
 * overruled ones (#850): a lead never prints in Part 3's body, so an authority cited only by
 * leads drops out while one with any non-lead statement stays. The cap itself is
 * BRIEF_ONLY_CAP_SQL (brief-only-cap.ts). */
export function fetchCitedAuthorities(dbPath: string, filingId: number, proceedingId: number): AuthorityListRow[] {
  return rows<AuthorityListRow>(
    dbPath,
    `SELECT MIN(a.id) AS id, a.style_of_cause_or_title, a.citation
     FROM filing_submissions fs
     JOIN submission_law slk ON slk.submission_id = fs.submission_id
     JOIN statements_of_law sl ON sl.law_assertion_id = slk.law_assertion_id
     JOIN authorities a ON a.id = sl.authority_id
     WHERE fs.filing_id = ? AND fs.document = 'form' AND ${BRIEF_ONLY_CAP_SQL}
       AND a.id NOT IN (SELECT authority_id FROM opposing_authorities WHERE proceeding_id = ? AND authority_id IS NOT NULL)
     GROUP BY a.style_of_cause_or_title, a.citation
     ORDER BY a.style_of_cause_or_title COLLATE NOCASE`,
    [filingId, proceedingId]
  );
}

/** Whether ANY opposing_authorities rows have been transcribed yet for this proceeding
 * (schema v13) -- zero means the delta above is computed against nothing, not against a
 * confirmed-empty application-book table, so the mockup must say so rather than imply the
 * full cited list is already delta-clean. Exported: the bcca-book.md emitter
 * (emit-bcca-book.ts) reuses this for its own response_book_toc Part 3 condition. */
export function fetchOpposingAuthoritiesCount(dbPath: string, proceedingId: number): number {
  const found = rows<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM opposing_authorities WHERE proceeding_id = ?`, [proceedingId]);
  return found[0]?.n ?? 0;
}

interface AttachedExhibitRow {
  document_id: number;
  label: string;
  document_date: string | null;
}

/** Exhibits attached to one affidavit, for the table of contents' exhibit rows (e-CI §1.3:
 * "each exhibit by number + full description + date"). Derived from statements_of_fact rows
 * that cite this affidavit as their instrument and carry an exhibit_id -- no separate exhibit-
 * attachment data to populate. */
function fetchAttachedExhibits(dbPath: string, affidavitDocumentId: number): AttachedExhibitRow[] {
  return rows<AttachedExhibitRow>(
    dbPath,
    `SELECT DISTINCT d.id AS document_id, d.label, d.document_date
     FROM statements_of_fact sof
     JOIN documents d ON d.id = sof.exhibit_id
     WHERE sof.instrument = ? AND sof.exhibit_id IS NOT NULL`,
    [affidavitDocumentId]
  );
}

/** part: the index of the part file whose first page this row's page cell shows, "cover" or
 * "toc" for the self-rows, or null for a row whose page cell stays blank (a heading, or a row
 * inside a part's file -- an exhibit, a written-argument sub-part). */
export interface TocRow {
  text: string;
  indent: 0 | 1 | 2;
  part: number | "cover" | "toc" | null;
}

/** One file the combined book is built from, in book order; bookmark is its PDF bookmark text. */
export interface BookPart {
  bookmark: string;
}

/** Table of contents row content (e-CI §1.2 "Table of Contents -- Required", unconditional;
 * e-CI §1.3's exhibit/affidavit description requirements), shared between this mockup's
 * buildToc below and the bcca-book.md filed-face emitter's response_book_toc
 * (emit-bcca-book.ts) -- same document/affidavit/exhibit row set and order in both, so the
 * mockup the practitioner reviewed and the filed table of contents never diverge. onMissing
 * decides what happens when a deponent name, filed date, or exhibit number is absent: the
 * mockup renders a gap marker (a review surface), the emitter refuses (a filed face may
 * never carry a marker) -- everything else about the row set is identical. */
export function buildTocRows(
  docs: FilingDocumentRow[],
  affidavitDetails: Map<number, AffidavitDetailRow>,
  exhibitMap: Map<number, number>,
  dbPath: string,
  hasAuthorities: boolean,
  unverifiedDelta: boolean,
  onMissing: (what: string, gap: { table: string; id: number; item: string }) => string
): { rows: TocRow[]; parts: BookPart[] } {
  const out: TocRow[] = [];
  const parts: BookPart[] = [];
  // Each document, the written argument and the table of authorities is one part file; the
  // row that opens it points at it.
  const newPart = (text: string, indent: 0 | 1) => {
    out.push({ text, indent, part: parts.length });
    parts.push({ bookmark: text });
  };
  out.push({ text: "Cover Page", indent: 0, part: "cover" });
  out.push({ text: "Table of Contents", indent: 0, part: "toc" });
  out.push({ text: "Part 1: Evidence, Exhibits or Affidavits", indent: 0, part: null });
  docs.forEach((d) => {
    if (d.role === "affidavit") {
      const detail = affidavitDetails.get(d.document_id);
      const deponent = detail?.deponent_name ?? onMissing(`${d.label}'s deponent name`, { table: "documents.deponent", id: d.document_id, item: `${d.label}: deponent` });
      const number = detail?.affidavit_number ? ` #${detail.affidavit_number}` : "";
      const filedDate = d.document_date ?? onMissing(`${d.label}'s filed date`, { table: "documents.document_date", id: d.document_id, item: `${d.label}: filed date` });
      newPart(`Affidavit${number} of ${deponent}, filed ${filedDate}`, 1);
      const exhibits = fetchAttachedExhibits(dbPath, d.document_id);
      exhibits.forEach((ex) => {
        const num =
          exhibitMap.get(ex.document_id) ??
          onMissing(`${ex.label}'s exhibit number`, { table: "documents.exhibit_number", id: ex.document_id, item: `${ex.label}: exhibit number` });
        out.push({ text: `Exhibit ${num}: ${ex.label} (${ex.document_date ?? "undated"})`, indent: 2, part: null });
      });
    } else {
      newPart(`${d.label}${d.document_date ? ` (${d.document_date})` : ""}`, 1);
    }
  });
  newPart("Part 2: Written Argument", 0);
  out.push({ text: "Part 1: Statement of Facts", indent: 1, part: null });
  out.push({ text: "Part 2: Issues", indent: 1, part: null });
  out.push({ text: "Part 3: Analysis", indent: 1, part: null });
  out.push({ text: "Part 4: Order(s) Sought", indent: 1, part: null });
  if (hasAuthorities || unverifiedDelta) newPart("Part 3: Table of Authorities", 0);
  return { rows: out, parts };
}

/** Table of contents (e-CI §1.2 "Table of Contents -- Required", unconditional). Page numbers
 * are TBD until the combined PDF exists (book assembly is manual, phase-2 #439) -- this section
 * carries the required structure and the exhibit/affidavit descriptions e-CI §1.3 mandates
 * ("each exhibit by number + full description + date"; "each affidavit by...deponent...date
 * filed...description of attached exhibits"), for the practitioner to number once assembled. */
function buildToc(
  inv: MarkerInventory,
  docs: FilingDocumentRow[],
  affidavitDetails: Map<number, AffidavitDetailRow>,
  exhibitMap: Map<number, number>,
  dbPath: string,
  hasAuthorities: boolean,
  unverifiedDelta: boolean
): string[] {
  const out: string[] = [];
  out.push("## TABLE OF CONTENTS");
  out.push("");
  out.push(
    "<!-- Required by e-CI §1.2. Page numbers are TBD until the combined PDF is assembled -- fill in " +
      "then, and confirm this table's numbering matches the PDF's actual page numbering (e-CI §1.3). -->"
  );
  out.push("");
  out.push("| Item | Page |");
  out.push("| :--- | ---: |");
  // Each 🧩 a row prints is an open item keyed on the row it is missing from (#1226).
  const { rows } = buildTocRows(docs, affidavitDetails, exhibitMap, dbPath, hasAuthorities, unverifiedDelta, (_what, gap) => {
    const marker = gapMarker("gap");
    recordCriterionGlyphs(inv, marker, ["🧩"], gap);
    return marker;
  });
  rows.forEach((r) => out.push(`| ${"&nbsp;&nbsp;".repeat(r.indent)}${r.text} | TBD |`));
  out.push("");
  return out;
}

/** Records each 🧩 cell of a cover page's contact table, keyed `counsel_of_record.<field>` on the party
 * row (#1226): counsel of record is case data's, so the key names the value missing, never a
 * submission column (#1306). Called once per render however many covers print the table, from the
 * cells as printed. */
export function recordContactGaps(inv: MarkerInventory, contacts: BccaCoverPageContact[]): void {
  for (const c of contacts) {
    for (const cell of contactCells(c, gapMarker("gap"))) {
      recordCriterionGlyphs(inv, cell.text, ["🧩"], { table: `counsel_of_record.${cell.column}`, id: c.partyId, item: `Counsel for the ${pluralizeRole(c.role, c.names.length)}: ${cell.missing}` });
    }
  }
}

function positionsSentence(positions: PositionRow[]): string {
  return positions.map((p) => `paragraph ${p.paragraph_number} (${p.wording})`).join("; ");
}

export function renderBccaStayResponse(ctx: RenderContext): string {
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const client = ctx.parties.find((p) => p.is_client === 1);
  const applicant = ctx.parties.find((p) => p.is_applicant === 1);
  const hearingDate = rows<{ hearing_date: string | null; hearing_time: string | null }>(
    ctx.dbPath,
    "SELECT hearing_date, hearing_time FROM hearing_details WHERE filing_id = ?",
    [ctx.filing.id]
  )[0];

  const positions = fetchFilingPositions(ctx.dbPath, ctx.filing.id);
  const respondedTo = resolveRespondedToDocument(ctx.dbPath, ctx.proceeding.id, positions);
  const unpositioned = respondedTo ? fetchUnpositionedOrders(ctx.dbPath, ctx.filing.id, respondedTo.id) : [];

  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("bcca_stay_response"));

  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, "form");
  const submissionIds = submissions.map((s) => s.id);
  const lawRows = fetchSubmissionLaw(ctx.dbPath, submissionIds);
  const lawBySubmission = groupSubmissionLaw(lawRows);
  const submissionFactRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const submissionFactIds = [...new Set(submissionFactRows.map((f) => f.fact_id))];
  const submissionFactStatements = fetchFactStatements(ctx.dbPath, submissionFactIds);
  const allFactIds = [...new Set([...facts.map((f) => f.id), ...submissionFactIds])];
  const { admittedFactIds, spentGlyphByFact, suppressedFactIds } = fetchFactAdmissionAnnotations(
    ctx.dbPath,
    allFactIds,
    opposingPartyIds(ctx.parties),
    ctx.rendered.slice(0, 10)
  );
  const factsBySubmission = groupSubmissionFacts(submissionFactRows, submissionFactStatements, admittedFactIds, spentGlyphByFact, suppressedFactIds);

  const orders = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const affidavitDetails = fetchAffidavitDetails(ctx.dbPath, docs.map((d) => d.document_id));
  const exhibitMap = exhibitNumbersFromOrderedIds(docs.map((d) => d.document_id));
  const referencedDocIds = new Set<number>(docs.map((d) => d.document_id));
  for (const s of submissionFactStatements) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const authorities = fetchCitedAuthorities(ctx.dbPath, ctx.filing.id, ctx.proceeding.id);
  const unverifiedDelta = fetchOpposingAuthoritiesCount(ctx.dbPath, ctx.proceeding.id) === 0;

  // Role groups drive the multi-party boilerplate and both cover pages' contact tables --
  // "the Respondents, A, B, and C" is every party sharing the client's own role, not just the
  // one is_client=1 row (the schema models no within-role adversity, so role-group is the only
  // available reading; same pinned-interpretation pattern as opposingPartyIds in query.ts).
  const roleGroups = groupPartiesByRole(captionParties);
  const clientGroup = client ? roleGroups.find((g) => g.role === client.role) : undefined;
  const applicantGroup = applicant ? roleGroups.find((g) => g.role === applicant.role) : undefined;
  const lowerCourtRoles = buildLowerCourtRoleByRole(ctx.parties);
  const contacts: BccaCoverPageContact[] = roleGroups.map((g) => {
    const rep = ctx.parties.find((p) => p.role === g.role);
    return {
      role: g.role,
      names: g.names,
      partyId: rep!.id,
      counselName: rep?.counsel_name ?? null,
      counselFirm: rep?.counsel_firm ?? null,
      addressForService: rep?.address_for_service ?? null,
      counselPhone: rep?.counsel_phone ?? null,
      counselEmail: rep?.counsel_email ?? null,
    };
  });

  const lines: string[] = [];
  lines.push(filingFrontmatter(ctx.proceeding, ctx, "Response_book"));
  lines.push("");
  lines.push(
    bccaCoverPage(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      recordLabel: "Response Book",
      titleLine: "RESPONSE BOOK",
      filingPartyPhrase: clientGroup ? formatNameList(clientGroup.names) : null,
      onAppealFrom: {
        judge: ctx.proceeding.under_appeal_judge,
        court: ctx.proceeding.under_appeal_court,
        pronounced: ctx.proceeding.under_appeal_pronounced,
      },
      accessRestrictions: ctx.proceeding.access_restrictions,
      lowerCourtRoleByRole: lowerCourtRoles,
      contacts,
      gapMarker: gapMarker("gap"),
    })
  );
  // Once, here: the written argument's own cover below prints the same cells.
  recordContactGaps(ctx.inventory, contacts);
  lines.push("");
  lines.push(...buildToc(ctx.inventory, docs, affidavitDetails, exhibitMap, ctx.dbPath, authorities.length > 0, unverifiedDelta));
  // The form's own blank fields: each 🧩 is an open item keyed on its field (#1226, as #1219).
  const respondents = clientGroup ? `, ${formatNameList(clientGroup.names)}` : ` ${gapMarker("gap")}`;
  const applicants = applicantGroup ? formatNameList(applicantGroup.names) : gapMarker("gap");
  const filedOn = respondedTo?.document_date ?? gapMarker("gap");
  const returnable = hearingDate?.hearing_date ?? gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, respondents, ["🧩"], { table: "form_fields", id: 0, item: "Respondents" });
  recordCriterionGlyphs(ctx.inventory, applicants, ["🧩"], { table: "form_fields", id: 1, item: "Applicants" });
  recordCriterionGlyphs(ctx.inventory, filedOn, ["🧩"], { table: "form_fields", id: 2, item: "Date the stay application was filed" });
  recordCriterionGlyphs(ctx.inventory, returnable, ["🧩"], { table: "form_fields", id: 3, item: "Hearing date" });
  lines.push(`Response of: the ${clientGroup ? pluralizeRole(clientGroup.role, clientGroup.names.length) : "Respondent"}${respondents}`);
  lines.push(
    `THIS IS A RESPONSE TO the stay application of the ${applicantGroup ? pluralizeRole(applicantGroup.role, applicantGroup.names.length) : "Applicant"}, ` +
      `${applicants}, filed ${filedOn}, ` +
      `returnable ${returnable}${hearingDate?.hearing_time ? ` at ${hearingDate.hearing_time}` : ""}.`
  );
  lines.push("");
  lines.push(
    "<!-- Response book per the registrar's completion instructions (R. 21(2), leave & stay version): " +
      "cover page and table of contents rendered above (e-CI §1.2 Required), Part 1 evidence/affidavits NOT already in the application book, " +
      "Part 2 written argument with its own required cover page (e-CI §2.1) (MAX 5 PAGES stay-only; Arial 12, 1.5-spaced, margins >= 2.5 cm), " +
      "optional Part 3 table of authorities computed as a delta against the application book's own table (e-CI §1.2). " +
      "File AND serve at least 2 business days before the hearing (R. 21(1)(a)); one PDF <= 200 MB via CSO. " +
      "Book assembly is manual for this kind -- assemble from this mockup's parts. -->"
  );
  lines.push("");

  lines.push("## PART 1: EVIDENCE, EXHIBITS OR AFFIDAVITS");
  lines.push("");
  lines.push("<!-- Only material not otherwise included in the application book or another respondent's response book (e-CI §1.2). -->");
  if (docs.length === 0) {
    lines.push(`NONE ${gapMarker("question")}`);
  } else {
    docs.forEach((d, i) => {
      const detail = affidavitDetails.get(d.document_id);
      const deponent = d.role === "affidavit" && detail?.deponent_name ? `, deponent ${detail.deponent_name}` : "";
      const number = d.role === "affidavit" && detail?.affidavit_number ? ` (#${detail.affidavit_number})` : "";
      const copy = copyMarkers.get(d.document_id) ?? "";
      lines.push(
        `${i + 1}. ${d.label}${number}${d.document_date ? ` (${d.document_date})` : ""}${deponent}${copy ? ` ${copy}` : ""} <!-- document ${i + 1} -->`
      );
    });
  }
  lines.push("");

  lines.push("## PART 2: WRITTEN ARGUMENT");
  lines.push("");
  lines.push(
    bccaCoverPage(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      recordLabel: "Memorandum of Argument",
      titleLine: `WRITTEN ARGUMENT OF THE ${clientGroup ? pluralizeRole(clientGroup.role, clientGroup.names.length).toUpperCase() : "RESPONDENT"} ON A STAY APPLICATION`,
      filingPartyPhrase: clientGroup ? formatNameList(clientGroup.names) : null,
      lowerCourtRoleByRole: lowerCourtRoles,
      contacts,
      gapMarker: gapMarker("gap"),
    })
  );
  lines.push("");
  lines.push(
    "<!-- e-CI §2.1: the written argument carries its own required cover page, separate from the book's outer cover. " +
      "Paragraphs number consecutively from the Statement of Facts through Order Sought (e-CI §2.2). -->"
  );
  lines.push("");

  let para = 0;
  lines.push("### Part 1: Statement of Facts");
  lines.push("");
  const factResult = renderFactParagraphsWithRhetoric(ctx, facts, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "facts"), para, copyMarkers, admittedFactIds, spentGlyphByFact, suppressedFactIds);
  lines.push(...factResult.lines);
  para = factResult.nextPara;
  lines.push("");

  lines.push("### Part 2: Issues");
  lines.push("");
  const consented = positions.filter((p) => p.position === "consented");
  const opposed = positions.filter((p) => p.position === "opposed");
  const noPosition = positions.filter((p) => p.position === "no_position");
  opposed.forEach((p) => {
    para += 1;
    lines.push(`${para}. Whether the order sought in paragraph ${p.paragraph_number} of the notice of application should be granted: ${p.wording} <!-- order ${p.paragraph_number} -->`);
  });
  if (consented.length > 0) {
    para += 1;
    lines.push(`${para}. The ${client?.role ?? "Respondent"}(s) consent(s) to the order(s) sought in ${positionsSentence(consented)}.`);
  }
  if (noPosition.length > 0) {
    para += 1;
    lines.push(`${para}. The ${client?.role ?? "Respondent"}(s) take(s) no position on the order(s) sought in ${positionsSentence(noPosition)}.`);
  }
  if (opposed.length + consented.length + noPosition.length === 0) {
    lines.push(mockupMessage(gapMarker("question"), "No position has been recorded on any order sought in the notice of application."));
  }
  lines.push("");

  if (unpositioned.length > 0) {
    lines.push("#### Positions not yet taken");
    lines.push("");
    unpositioned.forEach((o) => {
      lines.push(`- Order ${o.paragraph_number}: ${o.wording} ${unpositionedOrderMarker()} <!-- order ${o.paragraph_number} -->`);
    });
    lines.push("");
  }

  lines.push("### Part 3: Analysis");
  lines.push("");
  lines.push(
    "<!-- e-CI §2.1 (stay-only): a brief statement of the reasons why the stay should or should not be granted, " +
      "which should include the respondent's position on (e) the merits of the proposed appeal, (f) irreparable harm, " +
      "and (g) the balance of inconvenience. -->"
  );
  lines.push("");
  // Ticket 2026-09-01: one Map per rendered document, shared across every submission in this
  // Analysis section, so a law assertion two submissions `requires` renders in full once and
  // cross-references thereafter ("As set out in paragraph N, above, ...").
  const renderedLawAssertions = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      para += 1;
      lines.push("", ...renderRhetoricLine(ctx, entry.row, para, ""), "");
      continue;
    }
    const s = entry.item;
    recordParagraph(ctx, s.id, "form", para);
    // Site 17: the shared submission body's own sites 1-5 record through the opts inventory.
    const result = renderSubmissionParagraphs(
      s.id,
      s.contention,
      para,
      factsBySubmission.get(s.id) ?? [],
      lawBySubmission.get(s.id) ?? [],
      exhibitMap,
      labelMap,
      copyMarkers,
      "",
      renderedLawAssertions,
      { inventory: ctx.inventory, review: ctx.review, noFactsNeededOn: s.no_facts_needed_on, noLawNeededOn: s.no_law_needed_on, servedOrderWordings: s.served_order_wordings }
    );
    lines.push(...result.lines);
    lines.push("");
    para = result.nextPara;
  }

  lines.push("### Part 4: Order(s) Sought");
  lines.push("");
  let orderNum = 0;
  for (const entry of interleave(orders, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "orders"), (o) => o.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      para += 1;
      lines.push(...renderRhetoricLine(ctx, entry.row, para, ""));
      continue;
    }
    const o = entry.item;
    const wording = o.wording_override ?? o.wording;
    if (o.crossed_out_on !== null) {
      lines.push(`~~${wording}~~ <!-- order_sought_id ${o.id} -->`);
    } else {
      orderNum += 1;
      para += 1;
      const review = orderReviewMarkerFor(ctx.review, ctx.inventory, "", o);
      lines.push(`${para}. ${wording}${review ? ` ${review}` : ""} <!-- order_sought_id ${o.id} -->`);
    }
  }
  if (orderNum === 0) {
    const line = mockupMessage(gapMarker("gap"), "No order sought has been recorded for this response.");
    recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "form_fields", id: 4, item: "Order sought" });
    lines.push(line);
  }
  lines.push("");
  const preparer = client?.counsel_name ?? gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, preparer, ["🧩"], { table: "form_fields", id: 5, item: "Preparer" });
  lines.push(`Prepared by: ${preparer}`);
  lines.push("");

  lines.push("## PART 3: TABLE OF AUTHORITIES (OPTIONAL)");
  lines.push("");
  lines.push(
    unverifiedDelta
      ? "<!-- Alphabetical. The application book's own table of authorities has not yet been transcribed into " +
          "opposing_authorities for this proceeding, so every authority this filing cites is listed below (e-CI §1.2) -- " +
          "the delta exclusion is unverified until that transcription happens. -->"
      : "<!-- Alphabetical; excludes authorities already referenced in the application book (e-CI §1.2), computed " +
          "against the transcribed opposing_authorities rows. -->"
  );
  if (authorities.length === 0) {
    lines.push("NONE");
  } else {
    authorities.forEach((a, i) => {
      const citation = a.citation ? `, ${a.citation}` : ` ${gapMarker("gap")}`;
      recordCriterionGlyphs(ctx.inventory, citation, ["🧩"], { table: "authority_citations", id: a.id, item: `${a.style_of_cause_or_title}: citation` });
      lines.push(`${i + 1}. ${a.style_of_cause_or_title}${citation}`);
    });
    if (unverifiedDelta) {
      lines.push(
        mockupMessage(
          gapMarker("question"),
          "Opposing application book's table of authorities not yet transcribed -- this list may include authorities that must be excluded once it is."
        )
      );
    }
  }
  lines.push("");

  if (client) lines.push(signatureBlock({ name: client.name, role: client.role, counselName: client.counsel_name }, false));

  return lines.join("\n").trimEnd() + "\n";
}
