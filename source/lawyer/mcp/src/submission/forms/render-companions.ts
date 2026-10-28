// The Written Arguments companion (#370, #380, build ticket #384), rendering
// for every filing kind that declares it, and the reserve inventory. For a
// VanIAC submissions_package filing the Written Arguments IS the venue
// document (its pointer rows read document='form' -- #380's resolution:
// "for a VanIAC submissions package that face is the submissions document
// itself"; #370 item 5); for the three BCSC kinds it is a true companion,
// reading document='written_argument'. The reserve inventory prints nothing:
// it records the Proposals of reserved orders, held-in-reserve submissions
// and lead-authority material (#370 item 4, the brief-only cap), which no
// venue face prints.

import { DataServerError } from "../../errors.js";
import { BLANK_UNDERLINE, frontmatterHeader, styleOfProceedingCaption, type CaptionParty, type FrontmatterFields } from "./components.js";
import {
  dedupeLineMarkers,
  printMarkerSets,
  rebuttalMarker,
  unservedPetitumMarker,
  type JurisdictionRequiresEdge,
} from "./markers.js";
import {
  exhibitNumbersForFiling,
  fetchDeployedIds,
  fetchDocumentLabels,
  fetchFactAdmissionAnnotations,
  fetchFactStatements,
  fetchFilingDocuments,
  fetchJurisdictionEdges,
  fetchNotBestCopyMarkers,
  fetchOpposingPoints,
  fetchOrdersSought,
  fetchSubmissionFacts,
  fetchSubmissionLaw,
  fetchSubmissions,
  groupSubmissionFacts,
  groupSubmissionLaw,
  orderReviewMarkerFor,
  recordParagraph,
  renderSubmissionParagraphs,
  type PointerDocument,
  type RenderContext,
} from "./render-vaniac-submissions.js";
import { recordCriterionGlyphs, recordGlyphs, recordJurisdictionLadder } from "./proposal-inventory.js";
import { fetchPlacedAlternativeIds } from "./render-requisition.js";
import { fetchRhetoric, interleave, renderRhetoricLine } from "./render-rhetoric.js";
import { captionHeadingFor, JOB_BOARD_KIND, noFactsNeededColumn, noLawNeededColumn, opposingPartyIds, servedOrderWordingsColumn, venueHeadingFor, type ProceedingRow } from "./query.js";
import { rows } from "../query-rows.js";

/** What the Written Arguments prints differently by venue, keyed by the proceeding's tree key: who
 * is asked for the relief, whether the Rule 24(j) award-cap paragraph prints, and whether the relief
 * list ends with interest and costs. A BCCA type declares no Written Arguments companion. */
interface WrittenArgumentsVenue {
  tribunal: string;
  awardCap: boolean;
  interestAndCosts: boolean;
}

const WRITTEN_ARGUMENTS_VENUES: ReadonlyMap<string, WrittenArgumentsVenue> = new Map([
  ["CAN/BC/Vancouver-International-Arbitration-Centre", { tribunal: "the Arbitral Tribunal", awardCap: true, interestAndCosts: true }],
  ["CAN/BC/BCSC", { tribunal: "the Court", awardCap: false, interestAndCosts: false }],
]);

/** The proceeding's Written Arguments settings. An unknown key fails hard, and so does a forum not
 * yet chosen: the document never renders with another venue's settings. */
function writtenArgumentsVenue(proceeding: ProceedingRow): WrittenArgumentsVenue {
  const venue = proceeding.forum === null ? undefined : WRITTEN_ARGUMENTS_VENUES.get(proceeding.forum);
  if (venue === undefined) {
    throw new DataServerError(
      `Proceeding ${proceeding.id} has forum ${proceeding.forum === null ? "null" : `"${proceeding.forum}"`}, which has no Written Arguments settings`,
      "venue_unknown"
    );
  }
  return venue;
}

function frontmatterFor(ctx: RenderContext, documentType: string): string {
  const fields: FrontmatterFields = {
    clientName: ctx.clientName,
    clientNo: ctx.clientNo,
    matterNo: ctx.matterNo,
    matterDescription: ctx.matterDescription,
    venue: ctx.proceeding.court_or_centre ?? venueHeadingFor(ctx.filing, ctx.proceeding)?.display_label ?? "",
    proceedingFileNo: ctx.proceeding.file_number ?? "",
    documentType,
    documentName: ctx.filing.title,
    documentDate: BLANK_UNDERLINE,
    revision: ctx.revision,
    rendered: ctx.rendered,
  };
  return frontmatterHeader(fields);
}

/**
 * Written Arguments: caption, numbered Submissions (each with its argument
 * body), crossed-out submissions below the numbered paragraphs referencing
 * the order they support (#380's Rendering rule), a relief/orders block, and
 * a mockup-only Opposing points section. No trailing Held-in-reserve --
 * reserved material (deployed by no document of this filing) never reaches
 * this document's own queries at all (fetchSubmissions/fetchOrdersSought
 * already filter to `documentKey`); recordReserveInventory records its Proposals.
 */
export function renderWrittenArguments(ctx: RenderContext, documentKey: PointerDocument): string {
  const venue = writtenArgumentsVenue(ctx.proceeding);
  const client = ctx.parties.find((p) => p.is_client === 1);
  const clientRole = client?.role ?? "Party";
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));

  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, documentKey);
  const submissionIds = submissions.map((s) => s.id);

  const lawRows = fetchSubmissionLaw(ctx.dbPath, submissionIds);
  const lawBySubmission = groupSubmissionLaw(lawRows);

  const factRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const factIds = [...new Set(factRows.map((f) => f.fact_id))];
  const statementRows = fetchFactStatements(ctx.dbPath, factIds);
  const { admittedFactIds, spentGlyphByFact, suppressedFactIds } = fetchFactAdmissionAnnotations(ctx.dbPath, factIds, opposingPartyIds(ctx.parties), ctx.rendered.slice(0, 10));
  const factsBySubmission = groupSubmissionFacts(factRows, statementRows, admittedFactIds, spentGlyphByFact, suppressedFactIds);

  // Rows are this filing's; the numbers come from exhibitNumbersForFiling, which is proceeding-
  // wide for a VanIAC package and filing-scoped for every BCSC/BCCA kind (#712). So a VanIAC
  // written argument citing an exhibit first produced in an earlier round prints that round's
  // number, while a BCSC companion keeps numbering against its own form's material list.
  const exhibitDocs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, exhibitDocs.map((d) => d.document_id));
  const referencedDocIds = new Set<number>(exhibitDocs.map((d) => d.document_id));
  for (const s of statementRows) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);

  const relief = fetchOrdersSought(ctx.dbPath, ctx.filing.id, documentKey);
  const includedRelief = relief.filter((r) => r.crossed_out_on === null);
  const crossedOutRelief = relief.filter((r) => r.crossed_out_on !== null);
  const total = includedRelief.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  // Cascade, one hop (#380's Rendering rule; the practitioner's own ruling
  // quoted in #380 -- "one reserved submission might support an order
  // sought, while another supports one that is crossed out"): a submission
  // renders struck when it serves >=1 order and every order it serves is
  // crossed out. Read across every order the submission serves proceeding-
  // wide, not just this document's own relief list -- a submission's
  // service relationship isn't document-scoped.
  const servedRows =
    submissionIds.length === 0
      ? []
      : rows<{ submission_id: number; order_sought_id: number; crossed_out_on: string | null; wording: string }>(
          ctx.dbPath,
          `SELECT sb.submission_id, sb.order_sought_id, o.crossed_out_on, o.wording
           FROM order_sought_served_by sb
           JOIN order_sought o ON o.id = sb.order_sought_id
           WHERE sb.submission_id IN (${submissionIds.map(() => "?").join(",")})`,
          submissionIds
        );
  const servedBySubmission = new Map<number, { order_sought_id: number; crossed_out_on: string | null; wording: string }[]>();
  for (const r of servedRows) {
    const list = servedBySubmission.get(r.submission_id) ?? [];
    list.push(r);
    servedBySubmission.set(r.submission_id, list);
  }
  function struckSubmission(submissionId: number): { order_sought_id: number; wording: string } | null {
    const served = servedBySubmission.get(submissionId) ?? [];
    if (served.length === 0 || !served.every((s) => s.crossed_out_on !== null)) return null;
    return served[0];
  }

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Written_arguments"));
  lines.push("");
  lines.push(
    styleOfProceedingCaption(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      titleLine: `WRITTEN ARGUMENT OF THE ${clientRole.toUpperCase()}`,
    })
  );
  lines.push("");
  lines.push("## Submissions");
  lines.push("");

  let n = 1;
  const struckLines: string[] = [];
  // Ticket 2026-09-01: one Map per rendered document, shared across every submission in this
  // Submissions section, so a law assertion two submissions `requires` renders in full once and
  // cross-references thereafter ("As set out in paragraph N, above, ...").
  const renderedLawAssertions = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, ctx.filing.id, documentKey, "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      lines.push("", ...renderRhetoricLine(ctx, entry.row, n, ""), "");
      n += 1;
      continue;
    }
    const s = entry.item;
    const struck = struckSubmission(s.id);
    if (struck) {
      struckLines.push(`~~${s.contention}~~ (crossed out — supports order_sought ${struck.order_sought_id}, "${struck.wording}") <!-- submission_id ${s.id} -->`);
      continue;
    }
    recordParagraph(ctx, s.id, documentKey, n - 1);
    // Site 19: the shared submission body's own sites 1-5 record through the opts inventory. For
    // a VanIAC filing this IS the venue document, so without it the filing records no 🧾 📖 🥈 🔬
    // at all.
    const result = renderSubmissionParagraphs(
      s.id,
      s.contention,
      n - 1,
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
    n = result.nextPara + 1;
  }
  for (const line of struckLines) lines.push(line);
  if (struckLines.length > 0) lines.push("");

  if (venue.awardCap) {
    lines.push(`${n}. The award sought is within the Tribunal's Rule 24(j) cap.`);
    if (total <= 250000) {
      lines.push(`   The total claimed by the ${clientRole}, exclusive of interest and costs, is $${total.toLocaleString("en-US")}.`);
    } else {
      lines.push(
        `   The total claimed by the ${clientRole}, exclusive of interest and costs, is $${total.toLocaleString("en-US")}. ` +
          "[PRACTITIONER — total exceeds the Rule 24(j) cap; Rule 24(h) consent position required]"
      );
    }
    lines.push("");
    n += 1;
  }

  // The relief is one lettered paragraph, so an orders-part rhetorical paragraph prints as its own
  // numbered paragraph just before it, in ordinal order.
  for (const row of fetchRhetoric(ctx.dbPath, ctx.filing.id, documentKey, "orders")) {
    lines.push(...renderRhetoricLine(ctx, row, n, ""), "");
    n += 1;
  }

  const askVerb = `asks ${venue.tribunal}`;
  lines.push(`${n}. The ${clientRole} ${askVerb} to award the following relief.`);
  const letters = "abcdefghijklmnopqrstuvwxyz";
  includedRelief.forEach((r, i) => {
    const wording = r.wording_override ?? r.wording;
    const amountPart = r.amount !== null ? `$${r.amount.toLocaleString("en-US")} — ` : "";
    // Site 20: the ladder records per edge and returns the same deduped string, and 🦵 keys on the
    // order. Item is the base wording, as the Notice of Application's Part 1 does (site 10).
    const jurMarker = recordJurisdictionLadder(ctx.inventory, r.id, r.wording, r.requires);
    const petitum = unservedPetitumMarker(r.hasServedBy);
    recordGlyphs(ctx.inventory, petitum, ["🦵"], { table: "order_sought", id: r.id, item: r.wording });
    const workMarkers = dedupeLineMarkers([jurMarker, petitum]);
    const review = orderReviewMarkerFor(ctx.review, ctx.inventory, workMarkers, r);
    const lineMarkers = printMarkerSets([dedupeLineMarkers([workMarkers, review])]);
    lines.push(`   (${letters[i] ?? i + 1}) ${amountPart}${wording}${lineMarkers ? ` ${lineMarkers}` : ""} <!-- relief_item ${letters[i] ?? i + 1} -->`);
  });
  if (venue.interestAndCosts) {
    lines.push(`   (${letters[includedRelief.length] ?? "x"}) interest;`);
    lines.push(`   (${letters[includedRelief.length + 1] ?? "y"}) costs.`);
  }
  lines.push("");
  for (const r of crossedOutRelief) {
    const wording = r.wording_override ?? r.wording;
    lines.push(`~~${wording}~~ <!-- order crossed-out order_sought_id ${r.id} -->`);
  }
  if (crossedOutRelief.length > 0) lines.push("");

  const opposingPoints = fetchOpposingPoints(ctx.dbPath, ctx.proceeding.id);
  if (opposingPoints.length > 0) {
    lines.push("## Opposing points");
    lines.push("");
    for (const op of opposingPoints) {
      const pinpointPart = op.pinpoint ? `, ${op.pinpoint}` : "";
      const quotePart = op.verbatim_words ? `: "${op.verbatim_words}"` : "";
      const rebuttal = rebuttalMarker(op.answered_by_submission_id);
      const status = op.answered_by_submission_id === null ? rebuttal : `— answered by: ${op.answered_by_contention}`;
      // ↩️ generates nothing; the Goal card counts it on the opposing point (design §2.7).
      recordCriterionGlyphs(ctx.inventory, rebuttal, ["↩️"], { table: "opposing_points", id: op.id, item: `${op.component}${pinpointPart}${quotePart}` });
      lines.push(`- ${op.component}${pinpointPart}${quotePart}${status ? ` ${status}` : ""} <!-- opposing_point_id ${op.id} -->`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

interface PoolOrderRow {
  id: number;
  wording: string;
  crossed_out_on: string | null;
  hasServedBy: boolean;
  requires: JurisdictionRequiresEdge[];
}

function fetchProceedingOrders(dbPath: string, proceedingId: number): PoolOrderRow[] {
  const orders = rows<{ id: number; wording: string; crossed_out_on: string | null; has_served_by: number }>(
    dbPath,
    `SELECT o.id, o.wording, o.crossed_out_on,
            EXISTS(
              SELECT 1 FROM order_sought_served_by sb
              JOIN submissions s ON s.id = sb.submission_id
              WHERE sb.order_sought_id = o.id AND s.killed_on IS NULL
            ) AS has_served_by
     FROM order_sought o WHERE o.proceeding_id = ? ORDER BY o.id`,
    [proceedingId]
  );
  const edgesByOrder = fetchJurisdictionEdges(dbPath, orders.map((o) => o.id));
  return orders.map((o) => ({ ...o, hasServedBy: o.has_served_by === 1, requires: edgesByOrder.get(o.id) ?? [] }));
}

/** #959: the order and submission ids each OTHER filing of the proceeding deploys, on either
 * document or, for a Form 8's alternatives, by placement (#996). An item here and not deployed on
 * this filing is not held in reserve, so it records no ladder and no Proposals. Retired and live
 * filings alike. */
function fetchOtherFilingDeployments(dbPath: string, proceedingId: number, filingId: number): { orders: Set<number>; submissions: Set<number> } {
  const filings = rows<{ id: number; kind: string; title: string; filed_on: string | null; decided_on: string | null; entered_on: string | null; retired_on: string | null; needs_forum_parts: 0 | 1 }>(
    dbPath,
    // A Milestone with no Writing deploys nothing.
    `SELECT id, kind, title, filed_on, decided_on, entered_on, retired_on, needs_forum_parts FROM filings WHERE proceeding_id = ? AND id <> ? AND kind <> ? ORDER BY id`,
    [proceedingId, filingId, JOB_BOARD_KIND]
  );
  const orders = new Set<number>();
  const submissions = new Set<number>();
  for (const f of filings) {
    for (const r of rows<{ order_sought_id: number }>(dbPath, `SELECT order_sought_id FROM filing_orders WHERE filing_id = ?`, [f.id])) {
      orders.add(r.order_sought_id);
    }
    // #996: a sibling Form 8 deploys its alternatives by placement, as the own filing does (#960).
    for (const id of fetchPlacedAlternativeIds(dbPath, f)) orders.add(id);
    for (const r of rows<{ submission_id: number }>(dbPath, `SELECT submission_id FROM filing_submissions WHERE filing_id = ?`, [f.id])) {
      submissions.add(r.submission_id);
    }
  }
  return { orders, submissions };
}

/** Spec R6 (schema v47): the law assertions some live Writing of the proceeding relies on, through
 * a deployed submission or a deployed order's requires edge. A lead statement of any other
 * assertion raises no 🔬. A killed submission falls out by its killed_on: a sent Writing keeps
 * its filing_submissions row (v58).
 * Not read: a Form 8 alternative deployed by placement alone (no filing_orders row), whose
 * requires edge would need a law_assertion_id to matter -- doubly rare, so left out. */
function fetchLiveReliedLawAssertions(dbPath: string, proceedingId: number): Set<number> {
  const relied = rows<{ law_assertion_id: number }>(
    dbPath,
    `SELECT sl.law_assertion_id FROM submission_law sl
       JOIN filing_submissions fs ON fs.submission_id = sl.submission_id
       JOIN submissions s ON s.id = fs.submission_id AND s.killed_on IS NULL
       JOIN filings f ON f.id = fs.filing_id
      WHERE f.proceeding_id = ? AND f.retired_on IS NULL
     UNION
     SELECT r.law_assertion_id FROM order_sought_requires r
       JOIN filing_orders fo ON fo.order_sought_id = r.order_sought_id
       JOIN filings f ON f.id = fo.filing_id
      WHERE f.proceeding_id = ? AND f.retired_on IS NULL AND r.law_assertion_id IS NOT NULL`,
    [proceedingId, proceedingId]
  );
  return new Set(relied.map((r) => r.law_assertion_id));
}

interface PoolSubmissionRow {
  id: number;
  contention: string;
  no_facts_needed_on: string | null; // submissions.no_facts_needed_on (schema v48)
  no_law_needed_on: string | null; // submissions.no_law_needed_on (schema v60)
  served_order_wordings: string; // query.ts servedOrderWordingsColumn, read by 📚's ordinary-costs test
}

/** Ordered by the practitioner's own `ordinal`, not by id: the held-in-reserve R1/R2 numbering is
 * the practitioner's reading order, and a reserved submission has no filing ordinal to fall back
 * on. The numbered groups re-sort by assigned paragraph number anyway. Excludes killed submissions
 * (schema v16): a killed item is rejected, not held. */
function fetchProceedingSubmissions(dbPath: string, proceedingId: number): PoolSubmissionRow[] {
  return rows<PoolSubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention, ${noFactsNeededColumn(dbPath)}, ${noLawNeededColumn(dbPath)}, ${servedOrderWordingsColumn()} FROM submissions s WHERE s.proceeding_id = ? AND s.killed_on IS NULL ORDER BY s.ordinal, s.id`,
    [proceedingId]
  );
}

/** Every (submission, order) service edge in the proceeding, for the struck cascade below --
 * the same one-hop rule renderWrittenArguments applies (#380's Rendering rule): a submission
 * is struck when it serves >=1 order and every order it serves is crossed out. */
function fetchStruckSubmissionIds(dbPath: string, proceedingId: number): Set<number> {
  const served = rows<{ submission_id: number; crossed_out_on: string | null }>(
    dbPath,
    `SELECT sb.submission_id, o.crossed_out_on
     FROM order_sought_served_by sb
     JOIN order_sought o ON o.id = sb.order_sought_id
     WHERE o.proceeding_id = ?`,
    [proceedingId]
  );
  const bySubmission = new Map<number, boolean>();
  for (const r of served) {
    const allStruckSoFar = bySubmission.get(r.submission_id) ?? true;
    bySubmission.set(r.submission_id, allStruckSoFar && r.crossed_out_on !== null);
  }
  return new Set([...bySubmission].filter(([, allStruck]) => allStruck).map(([id]) => id));
}

/**
 * Records the Proposals of the proceeding pool that no venue face prints, and writes nothing:
 * reserved orders (the 🏛️ ladder and 🦵), held-in-reserve submission bodies (🧾, 📚, the rungs, 📌
 * and 👤), and lead, failed, killed and overruled statements of law (`includeLeadStatements`),
 * with their 🔬, 📇 and 🏅. An order or submission deployed only on another filing records
 * nothing here (#959). The entries are what the Milestone's Proposals, job eligibility, dead_key,
 * board_card and note_up_due read; forms.ts tags them with a never-delivered doc, so they reach no
 * completion criterion.
 *
 * The bodies are walked exactly as a printed surface would number them, so each entry's key and
 * item match what a render recorded before this surface stopped printing: a deployed submission
 * at the paragraph number its own face gave it (read back from ctx.paragraphLedger, never
 * re-derived), grouped by that face, and a held one under its own R numbering. The markdown the
 * walk builds is discarded.
 */
export function recordReserveInventory(ctx: RenderContext): void {
  const formIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "form");
  const waIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "written_argument");
  // #960: a Form 8 alternative has no pointer row -- its primary's placement deploys it.
  const deployedOrders = new Set([...formIds.orderIds, ...waIds.orderIds, ...fetchPlacedAlternativeIds(ctx.dbPath, ctx.filing)]);
  const deployedSubmissions = new Set([...formIds.submissionIds, ...waIds.submissionIds]);

  const elsewhere = fetchOtherFilingDeployments(ctx.dbPath, ctx.proceeding.id, ctx.filing.id);
  const orders = fetchProceedingOrders(ctx.dbPath, ctx.proceeding.id).filter((o) => deployedOrders.has(o.id) || !elsewhere.orders.has(o.id));
  const submissions = fetchProceedingSubmissions(ctx.dbPath, ctx.proceeding.id);

  // Argument bodies, proceeding-wide rather than filing-scoped: a reserved submission is exactly
  // the one this filing's pointer tables do not reach, and it needs its facts and law here.
  const submissionIds = submissions.map((s) => s.id);
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));
  const factRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const factIds = [...new Set(factRows.map((f) => f.fact_id))];
  const statementRows = fetchFactStatements(ctx.dbPath, factIds);
  // Not optional: without the admission annotations the fact lines would record different
  // 👤/spent-rung glyphs from the identical lines on the venue face.
  const { admittedFactIds, spentGlyphByFact, suppressedFactIds } = fetchFactAdmissionAnnotations(
    ctx.dbPath,
    factIds,
    opposingPartyIds(ctx.parties),
    ctx.rendered.slice(0, 10)
  );
  const factsBySubmission = groupSubmissionFacts(factRows, statementRows, admittedFactIds, spentGlyphByFact, suppressedFactIds);

  // "Ex. N" is proceeding-scoped since #712, so a reserved submission citing a document outside the
  // filing still finds its number. labelMap is seeded from the proceeding-wide statement rows.
  const exhibitDocs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, exhibitDocs.map((d) => d.document_id));
  const referencedDocIds = new Set<number>(exhibitDocs.map((d) => d.document_id));
  for (const s of statementRows) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const struckIds = fetchStruckSubmissionIds(ctx.dbPath, ctx.proceeding.id);
  const reliedOn = fetchLiveReliedLawAssertions(ctx.dbPath, ctx.proceeding.id);

  function recordBody(s: PoolSubmissionRow, startPara: number, renderedLawAssertions: Map<number, number>, paragraphPrefix: string) {
    return renderSubmissionParagraphs(
      s.id,
      s.contention,
      startPara,
      factsBySubmission.get(s.id) ?? [],
      lawBySubmission.get(s.id) ?? [],
      exhibitMap,
      labelMap,
      copyMarkers,
      "",
      renderedLawAssertions,
      // Site 21: the only walk where lead statements are included, so the statement-line 🔬 and its
      // 📇 come only from here (design §4). A statement whose law assertion nothing on a live
      // Writing relies on raises no 🔬 (spec R6, schema v47). The test is per statement, not per
      // submission: a lead under a reserved submission keeps 🔬 while another live-deployed
      // submission or order requires the same proposition. No `review`, so no 🧐 is recorded here.
      { paragraphPrefix, includeLeadStatements: true, inventory: ctx.inventory, scrutinyLive: (id: number) => reliedOn.has(id), noFactsNeededOn: s.no_facts_needed_on, noLawNeededOn: s.no_law_needed_on, servedOrderWordings: s.served_order_wordings }
    );
  }

  // Site 22: a reserved order that is not crossed out is on no venue face, so its ladder and 🦵 are
  // recorded only here. A reserved order is deployed on no live Writing, so its edges raise no 🔬
  // (spec R6, schema v47). Keys as site 20.
  for (const o of orders) {
    if (deployedOrders.has(o.id) || o.crossed_out_on !== null) continue;
    recordJurisdictionLadder(ctx.inventory, o.id, o.wording, o.requires, false);
    recordGlyphs(ctx.inventory, unservedPetitumMarker(o.hasServedBy), ["🦵"], { table: "order_sought", id: o.id, item: o.wording });
  }

  // Three buckets, by whether a face of this filing actually numbered the submission:
  //   numbered -- a venue renderer assigned it a paragraph; reproduce that number exactly
  //   struck   -- every order it serves is crossed out: recorded nowhere
  //   held     -- everything else: reserved, or deployed onto a face that renders no submissions
  //               at all (the requisition kinds)
  // #959: a submission deployed only on another filing is not held, and records nothing here.
  const numbered = submissions.filter((s) => ctx.paragraphLedger.has(s.id));
  const held = submissions.filter(
    (s) => !ctx.paragraphLedger.has(s.id) && !struckIds.has(s.id) && (deployedSubmissions.has(s.id) || !elsewhere.submissions.has(s.id))
  );

  // Grouped by source document, each group with its OWN renderedLawAssertions Map, mirroring the
  // "one Map per rendered document" invariant every venue renderer keeps. Without the split, a
  // submission on the form and one on the Written Arguments would both claim paragraph 1 (each
  // document counts from its own base), and a shared law assertion would cross-reference a number
  // belonging to the other document's numbering space.
  for (const documentKey of ["form", "written_argument"] as const) {
    const group = numbered
      .filter((s) => ctx.paragraphLedger.get(s.id)?.document === documentKey)
      .sort((a, b) => (ctx.paragraphLedger.get(a.id)?.para ?? 0) - (ctx.paragraphLedger.get(b.id)?.para ?? 0));
    const renderedLawAssertions = new Map<number, number>();
    for (const s of group) {
      const entry = ctx.paragraphLedger.get(s.id);
      if (entry === undefined) continue;
      recordBody(s, entry.para - 1, renderedLawAssertions, "");
    }
  }

  // Its own Map: a law assertion shared with a deployed submission is walked in full under an R
  // number rather than pointing back across two different numbering spaces.
  const renderedLawAssertions = new Map<number, number>();
  let r = 0;
  for (const s of held) r = recordBody(s, r, renderedLawAssertions, "R").nextPara;
}
