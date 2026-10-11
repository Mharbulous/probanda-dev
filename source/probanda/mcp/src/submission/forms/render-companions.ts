// Universal companion documents (#370, #380, build ticket #384): Written
// Arguments and the Counsel Brief, rendering for every filing kind. For a
// VanIAC submissions_package filing the Written Arguments IS the venue
// document (its pointer rows read document='form' -- #380's resolution:
// "for a VanIAC submissions package that face is the submissions document
// itself"; #370 item 5); for the three BCSC kinds it is a true companion,
// reading document='written_argument'. The Counsel Brief is privileged,
// never delivered (forms.ts filters it out of renderMode:'filed' by its
// neverDelivered tag), and is the sole surface for reserved (🂡),
// impeachment (🤥), adverse (🚩, #390/#401), and lead-authority material
// (#370 item 4, the brief-only cap) -- lead statements actually render there
// as of the Counsel Brief authority-citations build, which also turned its
// submission list into full numbered argument bodies carrying the venue
// document's own paragraph numbers.

import { DataServerError } from "../../errors.js";
import { submissionDataQuery } from "../backend.js";
import { BLANK_UNDERLINE, frontmatterHeader, styleOfProceedingCaption, type CaptionParty, type FrontmatterFields } from "./components.js";
import {
  adverseFactMarker,
  anticipatedPointMarker,
  dedupeLineMarkers,
  impeachmentMarker,
  printMarkerSets,
  rebuttalMarker,
  reservedMarker,
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
import { fetchFilingRhetoricPlacements, fetchProceedingRhetoric, fetchRhetoric, interleave, renderRhetoricLine, rhetoricPrintable } from "./render-rhetoric.js";
import { deriveLifecycle, LIFECYCLE_LABELS } from "./lifecycle.js";
import { captionHeadingFor, fetchHearingDate, noFactsNeededColumn, noLawNeededColumn, opposingPartyIds, rhetoricHeld, servedOrderWordingsColumn, venueHeadingFor, type ProceedingRow } from "./query.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

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
 * reserved material (deployed by no document of this filing) is Counsel-
 * Brief-only and never reaches this document's own queries at all
 * (fetchSubmissions/fetchOrdersSought already filter to `documentKey`).
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
  lines.push(`<!-- filing ${ctx.filing.id} proceeding ${ctx.proceeding.id} -->`);
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

/** #959: order/submission/rhetorical paragraph id -> "<title> (<state>)" of each OTHER filing of
 * the proceeding that deploys it, on either document or, for a Form 8's alternatives, by placement
 * (#996). An item listed here and not deployed on this filing is not held in reserve (no 🂡, no
 * ladder, no Proposals): the Counsel Brief lists it marker-free instead. Retired and live filings
 * alike -- the state label is what tells counsel which. No appeal deadline on this path, so a
 * state never reads appeal_expired. A database held below v71 deploys no rhetorical paragraph. */
function fetchOtherFilingDeployments(
  dbPath: string,
  proceedingId: number,
  filingId: number,
  today: string
): { orders: Map<number, string[]>; submissions: Map<number, string[]>; rhetoric: Map<number, string[]> } {
  const filings = rows<{ id: number; kind: string; title: string; filed_on: string | null; decided_on: string | null; entered_on: string | null; retired_on: string | null; needs_forum_parts: 0 | 1 }>(
    dbPath,
    `SELECT id, kind, title, filed_on, decided_on, entered_on, retired_on, needs_forum_parts FROM filings WHERE proceeding_id = ? AND id <> ? ORDER BY id`,
    [proceedingId, filingId]
  );
  const orders = new Map<number, string[]>();
  const submissions = new Map<number, string[]>();
  const rhetoric = new Map<number, string[]>();
  const held = rhetoricHeld(dbPath);
  const add = (map: Map<number, string[]>, id: number, label: string) => {
    const labels = map.get(id) ?? [];
    if (!labels.includes(label)) labels.push(label);
    map.set(id, labels);
  };
  for (const f of filings) {
    const label = `${f.title} (${LIFECYCLE_LABELS[deriveLifecycle(f, fetchHearingDate(dbPath, f.id), today).state]})`;
    for (const r of rows<{ order_sought_id: number }>(dbPath, `SELECT order_sought_id FROM filing_orders WHERE filing_id = ?`, [f.id])) {
      add(orders, r.order_sought_id, label);
    }
    // #996: a sibling Form 8 deploys its alternatives by placement, as the own filing does (#960).
    for (const id of fetchPlacedAlternativeIds(dbPath, f)) add(orders, id, label);
    for (const r of rows<{ submission_id: number }>(dbPath, `SELECT submission_id FROM filing_submissions WHERE filing_id = ?`, [f.id])) {
      add(submissions, r.submission_id, label);
    }
    if (!held) continue;
    for (const r of rows<{ rhetorical_paragraph_id: number }>(dbPath, `SELECT rhetorical_paragraph_id FROM filing_rhetoric WHERE filing_id = ?`, [f.id])) {
      add(rhetoric, r.rhetorical_paragraph_id, label);
    }
  }
  return { orders, submissions, rhetoric };
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

/** Ordered by the practitioner's own `ordinal`, not by id: the Held-in-reserve section's R1/R2
 * labels are the practitioner's reading order, and a reserved submission has no filing ordinal to
 * fall back on. The deployed section re-sorts by assigned paragraph number anyway. Excludes
 * killed submissions (schema v16) -- those render in their own "Killed submissions" section
 * below, never mixed into Held in reserve (a killed item is reserved by construction, but the
 * two sections answer different questions: still a live candidate, vs. already rejected). */
function fetchProceedingSubmissions(dbPath: string, proceedingId: number): PoolSubmissionRow[] {
  return rows<PoolSubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention, ${noFactsNeededColumn(dbPath)}, ${noLawNeededColumn(dbPath)}, ${servedOrderWordingsColumn()} FROM submissions s WHERE s.proceeding_id = ? AND s.killed_on IS NULL ORDER BY s.ordinal, s.id`,
    [proceedingId]
  );
}

interface KilledSubmissionRow {
  id: number;
  contention: string;
  killed_on: string;
}

/** Killed submissions (schema v16): kept intact so a later drafting session never re-proposes
 * the same contention -- listed here, plain text, never numbered (the decision is already made,
 * not work; work-markers.md rule 5). */
function fetchKilledSubmissions(dbPath: string, proceedingId: number): KilledSubmissionRow[] {
  return rows<KilledSubmissionRow>(
    dbPath,
    `SELECT id, contention, killed_on FROM submissions WHERE proceeding_id = ? AND killed_on IS NOT NULL ORDER BY killed_on, id`,
    [proceedingId]
  );
}

interface KilledAuthorityRow {
  id: number;
  style_of_cause_or_title: string;
  citation: string | null;
  killed_on: string;
}

/** Killed authorities (schema v16): the case/statute itself was reviewed and rejected. Its
 * statements_of_law rows stay in the database (the breadcrumb a later research sweep must not
 * re-run) and ride the same brief-only cap as verification='lead' -- excluded from every deployed
 * face and from 📖/🥉/🥈, printed only where they still support a rendered submission's argument
 * body above. This listing is the proceeding-wide inventory: every killed authority, whether or
 * not any submission currently requires it. */
function fetchKilledAuthorities(dbPath: string, proceedingId: number): KilledAuthorityRow[] {
  return rows<KilledAuthorityRow>(
    dbPath,
    `SELECT id, style_of_cause_or_title, citation, killed_on FROM authorities WHERE proceeding_id = ? AND killed_on IS NOT NULL ORDER BY killed_on, id`,
    [proceedingId]
  );
}

/** Every (submission, order) service edge in the proceeding, for the struck cascade below --
 * the same one-hop rule renderWrittenArguments applies (#380's Rendering rule): a submission
 * renders struck when it serves >=1 order and every order it serves is crossed out. */
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

interface PoolStatementRow {
  id: number;
  fact_id: number;
  postulate: string;
  excerpt: string | null;
  purpose: string | null;
}

function fetchProceedingStatements(dbPath: string, proceedingId: number): PoolStatementRow[] {
  return rows<PoolStatementRow>(
    dbPath,
    `SELECT sof.id, sof.fact_id, f.postulate, sof.excerpt, sof.purpose
     FROM statements_of_fact sof JOIN facts f ON f.id = sof.fact_id
     WHERE sof.proceeding_id = ? ORDER BY sof.id`,
    [proceedingId]
  );
}

interface PoolFactRow {
  id: number;
  postulate: string;
  adverse: number | null;
}

function fetchProceedingFacts(dbPath: string, proceedingId: number): PoolFactRow[] {
  return rows<PoolFactRow>(dbPath, `SELECT id, postulate, adverse FROM facts WHERE proceeding_id = ? ORDER BY id`, [proceedingId]);
}

interface AnticipatedPointRow {
  id: number;
  point: string;
}

/** anticipated_points (schema v11, #390/#401): the practitioner's own prediction of a point the
 * other side may run, not yet raised -- proceeding-scoped, no edges, never deployed. */
function fetchAnticipatedPoints(dbPath: string, proceedingId: number): AnticipatedPointRow[] {
  return rows<AnticipatedPointRow>(dbPath, `SELECT id, point FROM anticipated_points WHERE proceeding_id = ? ORDER BY id`, [proceedingId]);
}

/**
 * Counsel Brief: the whole proceeding pool -- every order sought, every
 * submission, every fact statement -- annotated with this filing's own
 * deployment (deployed by neither document of this filing nor by any other
 * filing => 🂡, derived, never stored; deployed only on another filing =>
 * listed marker-free under "used on other filings", #959) and, on
 * statements, impeachment status (🤥, independent of
 * deployment since v10). Never delivered: forms.ts tags this document
 * `neverDelivered` and drops it entirely from renderMode:'filed' output --
 * not stripped, absent.
 *
 * Submissions render as full argument bodies, not one inventory line each (build: Counsel Brief
 * authority citations, superseding the "compact annotated inventory" this section used to be):
 * counsel doing a wording or strategy pass needs the authority behind each contention without
 * cross-checking the venue document, and for a RESERVED submission there is no venue document to
 * cross-check -- its authority was rendered nowhere at all. A deployed submission carries the same
 * paragraph number here that it carries on the face that deployed it, read back from
 * ctx.paragraphLedger and never re-derived, so the two can be read side by side. Lead-authority
 * statements, filtered out of every deployed document by the brief-only cap, render here and only
 * here.
 *
 * Killed submissions/authorities (schema v16) get their own trailing sections, plain lines with
 * the kill date, never numbered and never mixed into Held in reserve -- a killed item is reserved
 * by construction, but "still a live candidate" and "already reviewed and rejected" are different
 * facts a reader needs told apart.
 */
export function renderCounselBrief(ctx: RenderContext): string {
  const formIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "form");
  const waIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "written_argument");
  // #960: a Form 8 alternative has no pointer row -- its primary's placement deploys it.
  const deployedOrders = new Set([...formIds.orderIds, ...waIds.orderIds, ...fetchPlacedAlternativeIds(ctx.dbPath, ctx.filing)]);
  const deployedSubmissions = new Set([...formIds.submissionIds, ...waIds.submissionIds]);

  const elsewhere = fetchOtherFilingDeployments(ctx.dbPath, ctx.proceeding.id, ctx.filing.id, ctx.rendered.slice(0, 10));
  const pooledOrders = fetchProceedingOrders(ctx.dbPath, ctx.proceeding.id);
  const orders = pooledOrders.filter((o) => deployedOrders.has(o.id) || !elsewhere.orders.has(o.id));
  const ordersElsewhere = pooledOrders.filter((o) => !deployedOrders.has(o.id) && elsewhere.orders.has(o.id));
  const submissions = fetchProceedingSubmissions(ctx.dbPath, ctx.proceeding.id);
  const statements = fetchProceedingStatements(ctx.dbPath, ctx.proceeding.id);

  // Argument bodies, proceeding-wide rather than filing-scoped: a reserved submission is exactly
  // the one this filing's pointer tables do not reach, and it needs its facts and law here.
  const submissionIds = submissions.map((s) => s.id);
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));
  const factRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const factIds = [...new Set(factRows.map((f) => f.fact_id))];
  const statementRows = fetchFactStatements(ctx.dbPath, factIds);
  // Not optional: without the admission annotations the brief's fact lines would carry different
  // 👤/spent-rung glyphs from the identical lines on the venue face.
  const { admittedFactIds, spentGlyphByFact, suppressedFactIds } = fetchFactAdmissionAnnotations(
    ctx.dbPath,
    factIds,
    opposingPartyIds(ctx.parties),
    ctx.rendered.slice(0, 10)
  );
  const factsBySubmission = groupSubmissionFacts(factRows, statementRows, admittedFactIds, spentGlyphByFact, suppressedFactIds);

  // "Ex. N" is proceeding-scoped since #712 (position in the proceeding's ordered run of rounds),
  // so a document keeps one number for the proceeding's life. The superseded comment here read
  // "Ex. N is definitionally filing-scoped ... do not fix it by numbering exhibits
  // proceeding-wide, which would make Ex. 3 name two different documents" (c2d64ca, 2026-09-04).
  // That warning was against changing THIS surface alone: a proceeding-wide Brief beside a
  // filing-scoped Evidence Index really would make "Ex. 3" name two documents in one rendered
  // set, which exhibitNumbersFromOrderedIds' own contract forbids. Every VanIAC surface moved
  // together, so the hazard it named is closed rather than ignored (practitioner confirmed, #712).
  // Consequence: a reserved submission citing a document outside the filing now carries a real
  // number here instead of falling back to its label. That is a mockup -- the Counsel Brief has no
  // filed face -- and the filed Evidence Index renders from this filing's filing_documents rows, of
  // which a reserved submission is not one, so a number here cannot reach the forum.
  // labelMap is still seeded from the proceeding-wide statement rows: a label missing from both
  // maps degrades silently to a bare pinpoint, or to no citation line.
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

  function renderBody(
    s: PoolSubmissionRow,
    startPara: number,
    renderedLawAssertions: Map<number, number>,
    paragraphPrefix: string,
    extraFirstParagraphMarker: string
  ) {
    return renderSubmissionParagraphs(
      s.id,
      s.contention,
      startPara,
      factsBySubmission.get(s.id) ?? [],
      lawBySubmission.get(s.id) ?? [],
      exhibitMap,
      labelMap,
      copyMarkers,
      extraFirstParagraphMarker,
      renderedLawAssertions,
      // Site 21: the Counsel Brief is the only surface where lead statements print, so the
      // statement-line 🔬 and its 📇 come only from here (design §4). A statement whose law
      // assertion nothing on a live Writing relies on raises no 🔬 (spec R6, schema v47). The test
      // is per statement, not per submission: a lead under a reserved submission keeps 🔬 while
      // another live-deployed submission or order requires the same proposition.
      { paragraphPrefix, includeLeadStatements: true, inventory: ctx.inventory, scrutinyLive: (id: number) => reliedOn.has(id), noFactsNeededOn: s.no_facts_needed_on, noLawNeededOn: s.no_law_needed_on, servedOrderWordings: s.served_order_wordings }
    );
  }

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Counsel_brief"));
  lines.push(`<!-- filing ${ctx.filing.id} proceeding ${ctx.proceeding.id} -->`);
  lines.push("");
  lines.push("*Privileged and confidential — counsel's eyes only. Never delivered.*");
  lines.push("");

  lines.push("## Orders sought");
  lines.push("");
  for (const o of orders) {
    const struck = o.crossed_out_on !== null;
    const wording = struck ? `~~${o.wording}~~` : o.wording;
    const reserved = reservedMarker(deployedOrders.has(o.id));
    // §4 "Reserve orthogonal": 🂡 co-occurs with any marker and both render. A reserved order appears on no
    // venue face, so this is the only line its jurisdictional ladder and 🦵 can be seen on. A deployed order
    // already carries them on the face that deploys it, and a crossed-out order carries none there either.
    // Site 22: recorded only inside the reserved-and-not-struck branch, which is when the ladder
    // and 🦵 actually print. Keys as site 20.
    let marker = reserved;
    if (reserved && !struck) {
      // A reserved order is deployed on no live Writing, so its edges raise no 🔬 (spec R6, schema
      // v47). One deployed only on another filing is listed below with no ladder at all.
      const jurMarker = recordJurisdictionLadder(ctx.inventory, o.id, o.wording, o.requires, false);
      const petitum = unservedPetitumMarker(o.hasServedBy);
      recordGlyphs(ctx.inventory, petitum, ["🦵"], { table: "order_sought", id: o.id, item: o.wording });
      marker = printMarkerSets([dedupeLineMarkers([jurMarker, petitum, reserved])]);
    }
    lines.push(`- ${wording}${marker ? ` ${marker}` : ""} <!-- order_sought_id ${o.id} -->`);
  }
  lines.push("");

  if (ordersElsewhere.length > 0) {
    lines.push("## Orders used on other filings");
    lines.push("");
    for (const o of ordersElsewhere) {
      const wording = o.crossed_out_on !== null ? `~~${o.wording}~~` : o.wording;
      lines.push(`- ${wording} — ${elsewhere.orders.get(o.id)?.join("; ")} <!-- order_sought_id ${o.id} -->`);
    }
    lines.push("");
  }

  // Three buckets, by whether a face of this filing actually numbered the submission:
  //   numbered -- a venue renderer assigned it a paragraph; reproduce that number exactly
  //   struck   -- every order it serves is crossed out, so the Written Arguments skipped it
  //   held     -- everything else: reserved (🂡), or deployed onto a face that renders no
  //               submissions at all (the requisition kinds), which is deployed and so gets no 🂡
  const numbered = submissions.filter((s) => ctx.paragraphLedger.has(s.id));
  const struck = submissions.filter((s) => !ctx.paragraphLedger.has(s.id) && struckIds.has(s.id));
  const unnumbered = submissions.filter((s) => !ctx.paragraphLedger.has(s.id) && !struckIds.has(s.id));
  // #959: deployed only on another filing -- one line under its own heading, no body, so none of
  // its glyphs reach this filing's Proposals.
  const isElsewhere = (s: PoolSubmissionRow) => !deployedSubmissions.has(s.id) && elsewhere.submissions.has(s.id);
  const held = unnumbered.filter((s) => !isElsewhere(s));
  const submissionsElsewhere = unnumbered.filter(isElsewhere);

  lines.push("## Submissions");
  lines.push("");
  // Grouped by source document, each group with its OWN renderedLawAssertions Map, mirroring the
  // "one Map per rendered document" invariant every venue renderer keeps. Without the split, a
  // submission on the form and one on the Written Arguments would both claim paragraph 1 (each
  // document counts from its own base), and a shared law assertion would cross-reference a number
  // belonging to the other document's numbering space.
  for (const documentKey of ["form", "written_argument"] as const) {
    const group = numbered
      .filter((s) => ctx.paragraphLedger.get(s.id)?.document === documentKey)
      .sort((a, b) => (ctx.paragraphLedger.get(a.id)?.para ?? 0) - (ctx.paragraphLedger.get(b.id)?.para ?? 0));
    if (group.length === 0) continue;
    lines.push(
      documentKey === "form"
        ? "*Paragraph numbers as in this filing's venue document (mockup).*"
        : "*Paragraph numbers as in the Written Arguments (mockup).*"
    );
    const renderedLawAssertions = new Map<number, number>();
    for (const s of group) {
      const entry = ctx.paragraphLedger.get(s.id);
      if (entry === undefined) continue;
      lines.push(...renderBody(s, entry.para - 1, renderedLawAssertions, "", "").lines);
      lines.push("");
    }
  }

  // Same one-hop cascade the Written Arguments applies (#380's Rendering rule) -- unnumbered
  // there, so unnumbered here.
  for (const s of struck) {
    lines.push(`~~${s.contention}~~ (crossed out — every order it serves is crossed out) <!-- submission_id ${s.id} -->`);
  }
  if (struck.length > 0) lines.push("");

  if (held.length > 0) {
    lines.push("## Held in reserve");
    lines.push("");
    lines.push("*Numbered independently (R1, R2, …): these appear on no face of this filing, so there is no paragraph number to share.*");
    // Its own Map: a law assertion shared with a deployed submission re-renders in full under an R
    // number rather than pointing back across two different numbering spaces.
    const renderedLawAssertions = new Map<number, number>();
    let r = 0;
    for (const s of held) {
      // 🂡 only where it is genuinely reserved. A submission deployed onto a face that renders no
      // submissions (requisition kinds) lands in this section too, and must not be marked reserved.
      const result = renderBody(s, r, renderedLawAssertions, "R", reservedMarker(deployedSubmissions.has(s.id)));
      lines.push(...result.lines);
      lines.push("");
      r = result.nextPara;
    }
  }

  if (submissionsElsewhere.length > 0) {
    lines.push("## Submissions used on other filings");
    lines.push("");
    for (const s of submissionsElsewhere) {
      lines.push(`- ${s.contention} — ${elsewhere.submissions.get(s.id)?.join("; ")} <!-- submission_id ${s.id} -->`);
    }
    lines.push("");
  }

  const killedSubmissions = fetchKilledSubmissions(ctx.dbPath, ctx.proceeding.id);
  if (killedSubmissions.length > 0) {
    lines.push("## Killed submissions");
    lines.push("");
    for (const s of killedSubmissions) {
      lines.push(`- ${s.contention} (killed ${s.killed_on}) <!-- submission_id ${s.id} -->`);
    }
    lines.push("");
  }

  // Every rhetorical paragraph of the proceeding (schema v71), with where this filing prints it.
  // Reserve works as a submission's does (#959): placed on no filing at all is 🂡, placed only on
  // another filing is listed marker-free with that filing. A placement in a part this kind has no
  // host for prints nowhere, and the note says so. No 🧐 here: review is on the forum lines.
  const rhetoricRows = fetchProceedingRhetoric(ctx.dbPath, ctx.proceeding.id);
  if (rhetoricRows.length > 0) {
    const placements = fetchFilingRhetoricPlacements(ctx.dbPath, ctx.filing.id);
    lines.push("## Rhetorical paragraphs");
    lines.push("");
    for (const rp of rhetoricRows) {
      const here = placements.filter((p) => p.rhetorical_paragraph_id === rp.id);
      const trace = `<!-- rhetorical_paragraph_id ${rp.id} -->`;
      if (here.length > 0) {
        const printed = here.map((p) => {
          const kindLabel = p.document === "written_argument" ? "the Written Arguments" : ctx.filing.kind;
          const notPrinted = rhetoricPrintable(ctx.filing.kind, p.document, p.part) ? "" : ` (not printed: ${kindLabel} has no ${p.part} part)`;
          return `${p.document}, ${p.part}${notPrinted}`;
        });
        lines.push(`- ${rp.wording} — printed on ${printed.join("; ")} ${trace}`);
      } else if (elsewhere.rhetoric.has(rp.id)) {
        lines.push(`- ${rp.wording} — ${elsewhere.rhetoric.get(rp.id)?.join("; ")} ${trace}`);
      } else {
        lines.push(`- ${rp.wording} ${reservedMarker(false)} ${trace}`);
      }
    }
    lines.push("");
  }

  const killedAuthorities = fetchKilledAuthorities(ctx.dbPath, ctx.proceeding.id);
  if (killedAuthorities.length > 0) {
    lines.push("## Killed authorities");
    lines.push("");
    for (const a of killedAuthorities) {
      const citation = a.citation ? `, ${a.citation}` : "";
      lines.push(`- ${a.style_of_cause_or_title}${citation} (killed ${a.killed_on}) <!-- authority_id ${a.id} -->`);
    }
    lines.push("");
  }

  const impeachment = statements.filter((s) => s.purpose === "impeachment");
  if (impeachment.length > 0) {
    lines.push("## Impeachment material");
    lines.push("");
    for (const s of impeachment) {
      const content = s.excerpt ? `"${s.excerpt}" (re: ${s.postulate})` : s.postulate;
      lines.push(`- ${content} ${impeachmentMarker(s.purpose)} <!-- statement_of_fact_id ${s.id} -->`);
    }
    lines.push("");
  }

  // 🚩 adverse (#390/#401): two independent predicates, two distinct groups -- a fact recorded as
  // true but harmful to our own side (facts.adverse=1), and the practitioner's own prediction of a
  // point the other side may run (anticipated_points, existence alone the predicate). Neither reads
  // deployment state; an adverse fact can also appear above as 🂡-marked or not, independently.
  const facts = fetchProceedingFacts(ctx.dbPath, ctx.proceeding.id);
  const adverseFacts = facts.filter((f) => adverseFactMarker(f.adverse) !== "");
  if (adverseFacts.length > 0) {
    lines.push("## Adverse facts");
    lines.push("");
    for (const f of adverseFacts) {
      lines.push(`- ${f.postulate} ${adverseFactMarker(f.adverse)} <!-- fact_id ${f.id} -->`);
    }
    lines.push("");
  }

  // Named "Anticipated points", not "...adverse submissions" -- terms-and-symbols.md's decision log:
  // deliberately not named anticipated_submission (collides with the defined meaning of
  // *submission*, always our own side); this section sits directly under Submissions above.
  const anticipatedPoints = fetchAnticipatedPoints(ctx.dbPath, ctx.proceeding.id);
  if (anticipatedPoints.length > 0) {
    lines.push("## Anticipated points");
    lines.push("");
    for (const p of anticipatedPoints) {
      lines.push(`- ${p.point} ${anticipatedPointMarker()} <!-- anticipated_point_id ${p.id} -->`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
