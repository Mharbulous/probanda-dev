// BCSC Application Response (Form 33) renderer (build ticket #386, design
// #372's resolution comment, schema hop #380). The fifth /draft
// filing kind: the applicant's own sought orders (opposing_orders, verbatim
// from the served Notice of Application) are positioned on via
// filing_positions (consented/opposed/no_position); Parts 4-6 reuse the
// existing facts/submissions/documents pointer chains #372 left untouched.
// The Written Arguments companion renders generically via
// forms.ts's documentsForFiling wrapper -- nothing here builds them.

import {
  formatTimeEstimate,
  checkboxOrderBlock,
  signatureBlock,
  STANDARD_MATERIAL_LINES,
  styleOfProceedingCaption,
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
  looseThreadMarker,
  noWitnessMarker,
  suppressMarker,
  printMarkerSets,
  statementOfFactMarkers,
  testimonyPinpointMarker,
  unpositionedOrderMarker,
} from "./markers.js";
import { recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs } from "./proposal-inventory.js";
import { captionHeadingFor, opposingPartyIds, type PartyRow } from "./query.js";
import { exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments, fetchNotBestCopyMarkers } from "./exhibit-documents.js";
import { factStatementCitationLine } from "./statement-lines.js";
import { fetchDeployedIds, fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions } from "./submission-reads.js";
import { fetchFactAdmissionAnnotations } from "./admission-annotations.js";
import { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
import { recordParagraph, renderSubmissionParagraphs } from "./submission-paragraphs.js";
import { reviewMarkerFor } from "./review-state.js";
import type { RenderContext } from "./render-context.js";
import { fetchRhetoric, interleave, renderRhetoricLine } from "./render-rhetoric.js";
import { materialDateSuffix } from "./render-bcca-factum.js";
import { factsPart, fetchFacts, fetchStatementsOfFact, type StatementOfFactRow } from "./filing-facts.js";
import { filingFrontmatter } from "./filing-frontmatter.js";
import { rows } from "../query-rows.js";

export interface HearingDetailsRow {
  time_estimate_minutes: number | null;
  proposed_hearing?: string | null;
  hearing_date_position?: "agree" | "propose_other" | "none_proposed" | null;
}

/** Form 33 reads time_estimate_minutes, and proposed_hearing with hearing_date_position (schema v79) --
 * hearing_date/hearing_time/associate_judge have no Form 33 surface. */
export function fetchHearingDetails(dbPath: string, filingId: number): HearingDetailsRow | undefined {
  const found = rows<HearingDetailsRow>(dbPath, "SELECT * FROM hearing_details WHERE filing_id = ?", [filingId]);
  return found[0];
}

/**
 * Form 33's hearing-date line (Rule 8-1(10)(b)(iv), B.C. Reg. 105/2026), in the form's own words.
 * "" when the applicant proposed no date (the form prints neither line); null when the position, or
 * the date it needs, is not recorded.
 */
export function hearingDateSentence(hearing: HearingDetailsRow | undefined): string | null {
  const date = hearing?.proposed_hearing;
  switch (hearing?.hearing_date_position) {
    case "none_proposed":
      return "";
    case "agree":
      return date ? `The application respondent(s) agree to the applicant's hearing date of ${date}.` : null;
    case "propose_other":
      return date ? `The application respondent(s) do not agree to the applicant's hearing date and propose the following date(s): ${date}.` : null;
    default:
      return null;
  }
}

export interface PositionRow {
  opposing_order_id: number;
  paragraph_number: number;
  wording: string;
  document_id: number;
  position: "consented" | "opposed" | "no_position";
  proposed_terms: string | null;
}

/** filing_positions joined to opposing_orders, ordered by the served notice's own paragraph
 * order (#372: "no ordinal -- orders render in the served notice's own paragraph order"). Direct
 * FK (filing_positions.opposing_order_id -> opposing_orders.id) means no filing->document link is
 * needed to fetch this filing's own positions. */
export function fetchFilingPositions(dbPath: string, filingId: number): PositionRow[] {
  return rows<PositionRow>(
    dbPath,
    `SELECT oo.id AS opposing_order_id, oo.paragraph_number, oo.wording, oo.document_id,
            fp.position, fp.proposed_terms
     FROM filing_positions fp
     JOIN opposing_orders oo ON oo.id = fp.opposing_order_id
     WHERE fp.filing_id = ?
     ORDER BY oo.paragraph_number`,
    [filingId]
  );
}

export interface RespondedToDocumentRow {
  id: number;
  label: string;
  document_date: string | null;
}

/** The document this filing responds to: the distinct document_id across its own positions.
 * Fallback (no positions taken yet -- a blank-slate render): if exactly one document in the
 * proceeding carries opposing_orders rows, use it; otherwise unresolved (renders 🧩, Parts 1-3
 * empty, no unpositioned-orders scan -- there is nothing to scan against). */
export function resolveRespondedToDocument(dbPath: string, proceedingId: number, positions: PositionRow[]): RespondedToDocumentRow | undefined {
  const positionedIds = new Set(positions.map((p) => p.document_id));
  let documentId: number | undefined;
  if (positionedIds.size === 1) {
    documentId = [...positionedIds][0];
  } else if (positionedIds.size === 0) {
    const candidates = rows<{ document_id: number }>(
      dbPath,
      `SELECT DISTINCT document_id FROM opposing_orders WHERE proceeding_id = ?`,
      [proceedingId]
    );
    if (candidates.length === 1) documentId = candidates[0].document_id;
  }
  if (documentId === undefined) return undefined;
  const found = rows<RespondedToDocumentRow>(dbPath, `SELECT id, label, document_date FROM documents WHERE id = ?`, [documentId]);
  return found[0];
}

export interface UnpositionedOrderRow {
  id: number;
  paragraph_number: number;
  wording: string;
}

/** opposing_orders of the responded-to document with no filing_positions row for this filing --
 * the practitioner hasn't taken a position yet (⬜, third derived instance, see markers.ts). */
export function fetchUnpositionedOrders(dbPath: string, filingId: number, documentId: number): UnpositionedOrderRow[] {
  return rows<UnpositionedOrderRow>(
    dbPath,
    `SELECT oo.id, oo.paragraph_number, oo.wording
     FROM opposing_orders oo
     WHERE oo.document_id = ?
       AND oo.id NOT IN (SELECT opposing_order_id FROM filing_positions WHERE filing_id = ?)
     ORDER BY oo.paragraph_number`,
    [documentId, filingId]
  );
}

/** Part 6's own provenance lookup (#372) -- filing_documents.provenance has no place on the
 * shared FilingDocumentRow (exhibit-documents.ts's fetchFilingDocuments), since no other
 * renderer reads it; keyed by document_id so it composes with that shared fetch's own ordering
 * rather than risking a second, possibly-misaligned document list. */
function fetchPartSixProvenance(dbPath: string, filingId: number): Map<number, "served_with_this_response" | "already_in_court_file" | null> {
  const found = rows<{ document_id: number; provenance: "served_with_this_response" | "already_in_court_file" | null }>(
    dbPath,
    `SELECT document_id, provenance FROM filing_documents WHERE filing_id = ? AND role != 'witness_statement'`,
    [filingId]
  );
  return new Map(found.map((r) => [r.document_id, r.provenance]));
}

function provenanceLabel(p: "served_with_this_response" | "already_in_court_file" | null | undefined): string {
  if (p === "served_with_this_response") return "served with this application response";
  if (p === "already_in_court_file") return "already in the court file";
  return "";
}

function witnessBackedFlags(dbPath: string, factIds: number[]): Map<number, boolean> {
  if (factIds.length === 0) return new Map();
  const placeholders = factIds.map(() => "?").join(",");
  const found = rows<{ fact_id: number; has_statement: number }>(
    dbPath,
    `SELECT f.id AS fact_id, EXISTS(SELECT 1 FROM statements_of_fact sof WHERE sof.fact_id = f.id) AS has_statement
     FROM facts f WHERE f.id IN (${placeholders})`,
    factIds
  );
  return new Map(found.map((r) => [r.fact_id, r.has_statement === 1]));
}

function afsCheckbox(party: PartyRow | undefined): string {
  if (!party) return `[ ] Yes  [ ] No ${gapMarker("question")}`;
  if (party.address_for_service_filed === "yes") return "[x] Yes  [ ] No";
  if (party.address_for_service_filed === "no") return "[ ] Yes  [x] No";
  return `[ ] Yes  [ ] No ${gapMarker("question")}`;
}

export function renderApplicationResponse(ctx: RenderContext): string {
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const client = ctx.parties.find((p) => p.is_client === 1);
  const applicant = ctx.parties.find((p) => p.is_applicant === 1);
  const hearing = fetchHearingDetails(ctx.dbPath, ctx.filing.id);
  const waIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "written_argument");

  const positions = fetchFilingPositions(ctx.dbPath, ctx.filing.id);
  const respondedTo = resolveRespondedToDocument(ctx.dbPath, ctx.proceeding.id, positions);
  const unpositioned = respondedTo ? fetchUnpositionedOrders(ctx.dbPath, ctx.filing.id, respondedTo.id) : [];

  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("application_response"));
  const statementsOfFact = fetchStatementsOfFact(ctx.dbPath, facts.map((f) => f.id));
  const witnessBacked = witnessBackedFlags(ctx.dbPath, facts.map((f) => f.id));
  const statementsByFact = new Map<number, StatementOfFactRow[]>();
  for (const stmt of statementsOfFact) {
    const list = statementsByFact.get(stmt.fact_id) ?? [];
    list.push(stmt);
    statementsByFact.set(stmt.fact_id, list);
  }

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

  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersFromOrderedIds(docs.map((d) => d.document_id));
  const referencedDocIds = new Set<number>(docs.map((d) => d.document_id));
  for (const s of [...statementsOfFact, ...submissionFactStatements]) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const provenanceMap = fetchPartSixProvenance(ctx.dbPath, ctx.filing.id);

  const lines: string[] = [];
  lines.push(filingFrontmatter(ctx.proceeding, ctx, "Application_response"));
  lines.push("");
  lines.push(
    styleOfProceedingCaption(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      titleLine: "APPLICATION RESPONSE",
    })
  );
  lines.push("");
  // The form's own blank fields: each 🧩 is an open item on this filing, named by its field
  // (Goal card design §2.7), and keyed on that field so the Work Board keeps each its own item (#1219).
  const clientName = client?.name ?? gapMarker("gap");
  const applicantName = applicant?.name ?? gapMarker("gap");
  // B.C. Reg. 105/2026: the notice is served unfiled, so the form names it by the date it bears.
  const datedOn = respondedTo?.document_date ?? gapMarker("gap");
  const estimate = hearing?.time_estimate_minutes ? formatTimeEstimate(hearing.time_estimate_minutes) : gapMarker("gap");
  const hearingDate = hearingDateSentence(hearing) ?? `The application respondent(s) ${gapMarker("gap")}`;
  recordCriterionGlyphs(ctx.inventory, clientName, ["🧩"], { table: "form_fields", id: 0, item: "Name of application respondent" });
  recordCriterionGlyphs(ctx.inventory, applicantName, ["🧩"], { table: "form_fields", id: 1, item: "Name of applicant" });
  recordCriterionGlyphs(ctx.inventory, datedOn, ["🧩"], { table: "form_fields", id: 2, item: "Date of the notice of application" });
  recordCriterionGlyphs(ctx.inventory, estimate, ["🧩"], { table: "form_fields", id: 3, item: "Time estimate" });
  recordCriterionGlyphs(ctx.inventory, hearingDate, ["🧩"], { table: "form_fields", id: 4, item: "Whether the application respondent agrees with the applicant's hearing date" });
  lines.push(`Application response of: the ${client?.role ?? "Application Respondent"}, ${clientName}`);
  lines.push(
    `THIS IS A RESPONSE TO the notice of application of the ${applicant?.role ?? "Applicant"}, ` +
      `${applicantName}, dated ${datedOn}.`
  );
  lines.push("");
  if (hearingDate !== "") {
    lines.push(hearingDate);
    lines.push("");
  }
  // Form 33's own estimate sentence, in the template's position (templates/form-33.dotx).
  lines.push(`The application respondent estimates that the application will take ${estimate}`);
  lines.push("");

  const consented = positions.filter((p) => p.position === "consented");
  const opposed = positions.filter((p) => p.position === "opposed");
  const noPosition = positions.filter((p) => p.position === "no_position");

  lines.push("## PART 1: ORDER(S) CONSENTED TO");
  lines.push("");
  if (consented.length === 0) {
    lines.push("NONE");
  } else {
    consented.forEach((p) => {
      const terms = p.proposed_terms || `Order ${p.paragraph_number}`;
      lines.push(`Order ${p.paragraph_number}: ${p.wording} -- consented, on the following terms: ${terms} <!-- order ${p.paragraph_number} -->`);
    });
  }
  lines.push("");

  lines.push("## PART 2: ORDER(S) OPPOSED");
  lines.push("");
  if (opposed.length === 0) {
    lines.push("The application respondent(s) oppose(s) the granting of NONE of the orders set out in Part 1 of the notice of application.");
  } else {
    lines.push(
      `The application respondent(s) oppose(s) the granting of the orders set out in paragraphs ` +
        `${opposed.map((p) => p.paragraph_number).join(", ")} of Part 1 of the notice of application.`
    );
    opposed.forEach((p) => lines.push(`- Order ${p.paragraph_number}: ${p.wording} <!-- order ${p.paragraph_number} -->`));
  }
  lines.push("");

  lines.push("## PART 3: ORDER(S) ON WHICH NO POSITION IS TAKEN");
  lines.push("");
  if (noPosition.length === 0) {
    lines.push("The application respondent(s) take(s) no position on the granting of NONE of the orders set out in Part 1 of the notice of application.");
  } else {
    lines.push(
      `The application respondent(s) take(s) no position on the granting of the orders set out in paragraphs ` +
        `${noPosition.map((p) => p.paragraph_number).join(", ")} of Part 1 of the notice of application.`
    );
    noPosition.forEach((p) => lines.push(`- Order ${p.paragraph_number}: ${p.wording} <!-- order ${p.paragraph_number} -->`));
  }
  lines.push("");

  if (unpositioned.length > 0) {
    lines.push("## Positions not yet taken");
    lines.push("");
    unpositioned.forEach((o) => {
      // ⬜'s unpositioned-order instance, the Orders criterion's member on this kind (Goal card
      // design §2.6). It generates nothing.
      const marker = unpositionedOrderMarker();
      recordCriterionGlyphs(ctx.inventory, marker, ["⬜"], { table: "opposing_orders", id: o.id, item: o.wording, instance: "unpositioned-order" });
      lines.push(`- Order ${o.paragraph_number}: ${o.wording} ${marker} <!-- order ${o.paragraph_number} -->`);
    });
    lines.push("");
  }

  let partNum = 0;
  lines.push("## PART 4: FACTUAL BASIS");
  lines.push("");
  // Each fact's Part 4 paragraph number, so Part 5 names it instead of re-printing it.
  const factParagraphs = new Map<number, number>();
  for (const entry of interleave(facts, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "facts"), (f) => f.filing_ordinal)) {
    partNum += 1;
    if (entry.kind === "rhetoric") {
      lines.push(...renderRhetoricLine(ctx, entry.row, partNum, ""));
      continue;
    }
    const f = entry.item;
    factParagraphs.set(f.id, partNum);
    const stmts = statementsByFact.get(f.id) ?? [];
    const admitted = admittedFactIds.has(f.id);
    const courtRecordLinked = f.court_record !== null;
    const owedWitness = noWitnessMarker(courtRecordLinked, witnessBacked.get(f.id) ?? false, admitted, spentGlyphByFact.get(f.id) ?? "");
    const witnessSuppressed = suppressedFactIds.has(f.id);
    const witnessMarker = suppressMarker(owedWitness, witnessSuppressed);
    const courtRecordCite = courtRecordCitation(f.court_record, f.court_record_pinpoint);
    // Site 14, the Notice of Application's Part 2 line in every respect (sites 11 to 11'''): the
    // fact's court-record 📌 keys on the fact, 🧵 on this form's own pointer row, and each
    // statement's own tokens are recorded before they join the line's dedupe.
    const courtRecordPin = courtRecordPinpointMarker(f.court_record, f.court_record_pinpoint, f.court_record_execution, f.court_record_exhibit_letters);
    const looseThread = looseThreadMarker(true, waIds.factIds.has(f.id));
    recordGlyphs(ctx.inventory, courtRecordPin, ["📌"], { table: "facts", id: f.id, item: f.postulate });
    recordGlyphs(ctx.inventory, looseThread, ["🧵"], { table: "filing_facts", id: f.pointer_id, item: f.postulate });
    recordCriterionGlyphs(ctx.inventory, owedWitness, ["👤"], { table: "facts", id: f.id, item: f.postulate, ...(witnessSuppressed ? { suppressed: true as const } : {}) });
    const tokens: string[] = [witnessMarker, courtRecordPin, looseThread];
    const statementSets: string[][] = [];
    const guarded = isAdmittedGuard(courtRecordLinked, admitted);
    for (const s of stmts) {
      const statementTokens: string[] = [];
      statementSets.push(statementTokens);
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
      statementTokens.push(doubtMarker(s.doubt));
      if (s.instrument_id !== null) statementTokens.push(copyMarkers.get(s.instrument_id) ?? "");
      tokens.push(...statementTokens);
      recordFactStatementGlyphs(
        ctx.inventory,
        dedupeLineMarkers(statementTokens),
        { statement_id: s.id, witness_id: s.witness_id, witness_name: s.witness_name, instrument_id: s.instrument_id, instrument_label: s.instrument_label },
        f.postulate
      );
    }
    // 🧐 per object on this merged line, and one set per object, as the Notice of Application's Part 2 does.
    const lineGlyphs = dedupeLineMarkers(tokens);
    const factReview = reviewMarkerFor(ctx.review, ctx.inventory, lineGlyphs, "facts", f.id, f.postulate);
    stmts.forEach((s, i) => {
      if (s.purpose !== "impeachment") statementSets[i].push(reviewMarkerFor(ctx.review, ctx.inventory, lineGlyphs, "statements_of_fact", s.id, `${s.witness_name}: ${f.postulate}`));
    });
    const glyphs = printMarkerSets([dedupeLineMarkers([witnessMarker, courtRecordPin, factReview]), looseThread, ...statementSets.map(dedupeLineMarkers)]);
    // Citation lines, as the Notice of Application's Part 2 prints them; render-form33-filed-face.ts
    // prints the same lines, unindented and untraced.
    const citationLines = [
      ...(courtRecordCite ? [`> ${courtRecordCite}`] : []),
      ...stmts.filter((s) => s.purpose !== "impeachment").flatMap((s) => factStatementCitationLine(exhibitMap, labelMap, s) ?? []),
    ];
    const trace = `<!-- fact ${partNum} -->`;
    lines.push(`${partNum}. ${f.postulate}${glyphs ? ` ${glyphs}` : ""}${citationLines.length > 0 ? "" : ` ${trace}`}`);
    // One trace per paragraph, on its last line.
    citationLines.forEach((c, i) => lines.push(`   ${c}${i === citationLines.length - 1 ? ` ${trace}` : ""}`));
  }
  lines.push("");

  lines.push("## PART 5: LEGAL BASIS");
  lines.push("");
  // Parts 4-5 share one continuous counter (#372/#386 ticket text: "Parts
  // 4->5 continuous numbering") -- unlike the Notice of Application, where
  // Parts 2/3 each restart at 1.
  // Ticket 2026-09-01: one Map per rendered document, shared across every submission in this
  // Legal Basis part, so a law assertion two submissions `requires` renders in full once and
  // cross-references thereafter ("As set out in paragraph N, above, ...").
  const renderedLawAssertions = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      partNum += 1;
      lines.push("", ...renderRhetoricLine(ctx, entry.row, partNum, ""), "");
      continue;
    }
    const s = entry.item;
    recordParagraph(ctx, s.id, "form", partNum);
    // Site 15: 🧵 rides the contention line but keys on this form's own pointer row.
    const looseThread = looseThreadMarker(true, waIds.submissionIds.has(s.id));
    recordGlyphs(ctx.inventory, looseThread, ["🧵"], { table: "filing_submissions", id: s.pointer_id, item: s.contention });
    const result = renderSubmissionParagraphs(
      s.id,
      s.contention,
      partNum,
      factsBySubmission.get(s.id) ?? [],
      lawBySubmission.get(s.id) ?? [],
      exhibitMap,
      labelMap,
      copyMarkers,
      looseThread,
      renderedLawAssertions,
      { inventory: ctx.inventory, review: ctx.review, noFactsNeededOn: s.no_facts_needed_on, noLawNeededOn: s.no_law_needed_on, servedOrderWordings: s.served_order_wordings, factParagraphs, printUnplacedFacts: Boolean(ctx.filing.filed_on || ctx.filing.retired_on) }
    );
    lines.push(...result.lines);
    lines.push("");
    partNum = result.nextPara;
  }

  lines.push("## PART 6: MATERIAL TO BE RELIED ON");
  lines.push("");
  docs.forEach((d, i) => {
    const copy = copyMarkers.get(d.document_id) ?? "";
    recordCriterionGlyphs(ctx.inventory, copy, ["🏆"], { table: "documents", id: d.document_id, item: d.label });
    const provenance = provenanceLabel(provenanceMap.get(d.document_id));
    const provenancePart = provenance ? ` (${provenance})` : "";
    lines.push(
      `${i + 1}. ${d.label}${materialDateSuffix(d.label, d.document_date)}${provenancePart}${copy ? ` ${copy}` : ""} <!-- document ${i + 1} -->`
    );
  });
  // The standard closing lines: template text, so no marker, no criterion glyph, no provenance and no trace.
  STANDARD_MATERIAL_LINES.forEach((text, i) => lines.push(`${docs.length + i + 1}. ${text}`));
  lines.push("");

  lines.push("**Address for service filed:**");
  const afs = afsCheckbox(client);
  recordCriterionGlyphs(ctx.inventory, afs, ["🕵️"], { table: "filings", id: ctx.filing.id, item: "Address for service filed" });
  lines.push(afs);
  lines.push("");

  lines.push(checkboxOrderBlock([]));
  lines.push("");
  if (client) lines.push(signatureBlock({ name: client.name, role: client.role, counselName: client.counsel_name }, true));

  return lines.join("\n").trimEnd() + "\n";
}
