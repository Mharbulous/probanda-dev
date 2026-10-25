// BCSC Form 32 (Notice of Application) renderer (build ticket #297, design
// doc 291 §5, issue #288 §2.1 form content inventory, re-scoped by issue
// #302: the jurisdictional slot reads relief_items, not arguments; #380
// renamed relief_items -> order_sought and moved the jurisdiction slot onto
// order_sought_requires edges).

import { submissionDataQuery } from "../backend.js";
import {
  formatTimeEstimate,
  checkboxOrderBlock,
  signatureBlock,
  STANDARD_MATERIAL_LINES,
  styleOfProceedingCaption,
  type CaptionParty,
} from "./components.js";
import { courtRecordCitation, courtRecordPinpointMarker, dedupeLineMarkers, doubtMarker, exhibitPinpointMarker, gapMarker, isAdmittedGuard, isExhibitTenderRole, looseThreadMarker, noWitnessMarker, suppressMarker, printMarkerSets, statementOfFactMarkers, testimonyPinpointMarker, unservedPetitumMarker, unsponsoredExhibitMarker } from "./markers.js";
import { recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs, recordJurisdictionLadder } from "./proposal-inventory.js";
import { captionHeadingFor, opposingPartyIds } from "./query.js";
import {
  exhibitNumbersFromOrderedIds,
  factStatementCitationLine,
  fetchDeployedIds,
  fetchDocumentLabels,
  fetchDocumentTenderStatus,
  fetchFactAdmissionAnnotations,
  fetchFactStatements,
  fetchFilingDocuments,
  fetchNotBestCopyMarkers,
  fetchOrdersSought,
  fetchSubmissionFacts,
  fetchSubmissionLaw,
  fetchSubmissions,
  groupSubmissionFacts,
  groupSubmissionLaw,
  orderReviewMarkerFor,
  recordParagraph,
  renderSubmissionParagraphs,
  reviewMarkerFor,
  type RenderContext,
} from "./render-vaniac-submissions.js";
import { fetchRhetoric, interleave, renderRhetoricLine } from "./render-rhetoric.js";
import { factsPart, fetchFacts, fetchStatementsOfFact, type StatementOfFactRow } from "./filing-facts.js";
import { filingFrontmatter } from "./filing-frontmatter.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

interface HearingDetailsRow {
  /** Undefined on a database held below v62 (read with SELECT *), which prints the blank. */
  proposed_hearing?: string | null;
  time_estimate_minutes: number | null;
  associate_judge: number | null;
}

function fetchHearingDetails(dbPath: string, filingId: number): HearingDetailsRow | undefined {
  const found = rows<HearingDetailsRow>(dbPath, "SELECT * FROM hearing_details WHERE filing_id = ?", [filingId]);
  return found[0];
}

/** #451: rendered in the jurisdiction sentence's place while associate_judge is NULL (or the filing has
 * no hearing_details row) -- ⬜, alternative unchosen. forms.ts's filed face refuses on this line. */
export const ASSOCIATE_JUDGE_UNDETERMINED_LINE = `Associate judge jurisdiction: not yet determined ${gapMarker("unchosen")}`;

interface WitnessBackedCheck {
  fact_id: number;
  has_statement: number;
}

function fetchWitnessBackedFlags(dbPath: string, factIds: number[]): Map<number, boolean> {
  if (factIds.length === 0) return new Map();
  const placeholders = factIds.map(() => "?").join(",");
  const found = rows<WitnessBackedCheck>(
    dbPath,
    `SELECT f.id AS fact_id,
            EXISTS(SELECT 1 FROM statements_of_fact sof WHERE sof.fact_id = f.id) AS has_statement
     FROM facts f WHERE f.id IN (${placeholders})`,
    factIds
  );
  return new Map(found.map((r) => [r.fact_id, r.has_statement === 1]));
}

export function renderNoticeOfApplication(ctx: RenderContext): string {
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const applicant = ctx.parties.find((p) => p.is_applicant === 1) ?? ctx.parties.find((p) => p.is_client === 1);
  const served = ctx.parties.filter((p) => p.to_be_served === 1);
  const hearing = fetchHearingDetails(ctx.dbPath, ctx.filing.id);
  const relief = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  // 🧵 loose thread (schema v10, #380): what the form deploys that the
  // Written Arguments companion doesn't. Pre-elicitation (the deferred
  // "document-pointer elicitation" follow-on ticket) the WA's pointer lists
  // are empty, so this fires on everything -- correct, fail-visible noise,
  // not a bug (see #384's resolution).
  const waIds = fetchDeployedIds(ctx.dbPath, ctx.filing.id, "written_argument");

  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("notice_of_application"));
  const statementsOfFact = fetchStatementsOfFact(
    ctx.dbPath,
    facts.map((f) => f.id)
  );
  const witnessBacked = fetchWitnessBackedFlags(
    ctx.dbPath,
    facts.map((f) => f.id)
  );
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
  // Issue #345: the unless-admitted guard's per-party half -- silences a
  // fact's evidence work only once every opposing party has tendered an
  // admission of it (ADR-0006). One coverage set over PART 2's facts and
  // PART 3's submission facts together, since both loops need it.
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

  const lines: string[] = [];
  lines.push(filingFrontmatter(ctx.proceeding, ctx, "Notice_of_application"));
  lines.push("");
  lines.push(
    styleOfProceedingCaption(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      titleLine: "NOTICE OF APPLICATION",
    })
  );
  lines.push("");
  // The form's own blank fields: each 🧩 is an open item on this filing, named by its field, and ⬜
  // is the associate-judge instance the Orders criterion counts (Goal card design §2.6, §2.7).
  // Each 🧩 is keyed on its field, not the filing: the Work Board merges entries sharing a marker,
  // table and id, so a filing-keyed gap would swallow the rest (#1219).
  const applicantName = applicant?.name ?? gapMarker("gap");
  const servedNames = served.map((p) => p.name).join(", ") || gapMarker("gap");
  const estimate = hearing?.time_estimate_minutes ? formatTimeEstimate(hearing.time_estimate_minutes) : gapMarker("gap");
  const jurisdiction =
    hearing?.associate_judge == null
      ? ASSOCIATE_JUDGE_UNDETERMINED_LINE
      : hearing.associate_judge === 1
        ? "This matter is within the jurisdiction of an associate judge."
        : "This matter is not within the jurisdiction of an associate judge.";
  recordCriterionGlyphs(ctx.inventory, applicantName, ["🧩"], { table: "form_fields", id: 0, item: "Name of applicant" });
  recordCriterionGlyphs(ctx.inventory, servedNames, ["🧩"], { table: "form_fields", id: 1, item: "Parties to be served" });
  recordCriterionGlyphs(ctx.inventory, estimate, ["🧩"], { table: "form_fields", id: 2, item: "Time estimate" });
  recordCriterionGlyphs(ctx.inventory, jurisdiction, ["⬜"], { table: "filings", id: ctx.filing.id, item: "Associate judge jurisdiction", instance: "associate-judge" });
  lines.push(`Name of applicant: ${applicantName}`);
  lines.push(`To: ${servedNames}`);
  lines.push("");
  lines.push(
    `TAKE NOTICE that an application will be made by the applicant to the presiding judge or associate judge ` +
      `at the courthouse at ${ctx.proceeding.courthouse_address ?? "________________"} on ` +
      `a date to be set by Notice of Hearing of Application for the orders set out in Part 1 below.`
  );
  lines.push("");
  lines.push(`The applicant estimates that the application will take: ${estimate}`);
  // B.C. Reg. 105/2026's Form 32: the notice fixes no date and states the applicant's proposal.
  lines.push(`The applicant proposes that the matter will be heard on ${hearing?.proposed_hearing ?? "________________"}.`);
  // Form 32's own jurisdiction sentence, in the template's position (templates/032-noa.dotx).
  lines.push(jurisdiction);
  lines.push("");

  lines.push("## PART 1: ORDER(S) SOUGHT");
  lines.push("");
  let includedOrderNum = 0;
  let crossedOutOrderNum = 0;
  // Crossed-out (order_sought.crossed_out_on, schema v10 #380 -- was
  // disposition='reserved', #367): the practitioner's own decision not to
  // pursue an order, kept but not deleted, restorable by clearing the date.
  // Renders inline, in filing order, as an unnumbered strikethrough line --
  // no glyph (work-markers.md rule 5: strikethrough alone is the rendering).
  // Reserved (deployed by no document) orders never reach this query at all
  // (fetchOrdersSought already filters to document='form'); their Proposals are
  // recorded by the reserve inventory (render-companions.ts).
  // A rhetorical paragraph placed in the orders part takes the next order number, as the filed
  // face's `orders` list numbers it (render-form32-filed-face.ts).
  for (const entry of interleave(relief, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "orders"), (r) => r.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      includedOrderNum += 1;
      lines.push(...renderRhetoricLine(ctx, entry.row, includedOrderNum, ""));
      continue;
    }
    const r = entry.item;
    const wording = r.wording_override ?? r.wording;
    if (r.crossed_out_on !== null) {
      crossedOutOrderNum += 1;
      lines.push(`~~${wording}~~ <!-- order crossed-out ${crossedOutOrderNum} -->`);
      continue;
    }
    includedOrderNum += 1;
    // Sites 10 / 10' / 10'': this one line merges three keyed rows. The ladder's own glyphs are
    // recorded per edge inside recordJurisdictionLadder (the order, its statement, its authority);
    // 🦵 keys on the order and 🧵 on the venue form's own pointer row. The item is always the base
    // `wording`, never fo.wording_override -- the override is per filing and the reserve inventory
    // records the base, so one key would otherwise carry two items.
    const jurMarker = recordJurisdictionLadder(ctx.inventory, r.id, r.wording, r.requires);
    const petitum = unservedPetitumMarker(r.hasServedBy);
    const looseThread = looseThreadMarker(true, waIds.orderIds.has(r.id));
    recordGlyphs(ctx.inventory, petitum, ["🦵"], { table: "order_sought", id: r.id, item: r.wording });
    recordGlyphs(ctx.inventory, looseThread, ["🧵"], { table: "filing_orders", id: r.pointer_id, item: r.wording });
    const workMarkers = dedupeLineMarkers([jurMarker, petitum, looseThread]);
    const review = orderReviewMarkerFor(ctx.review, ctx.inventory, workMarkers, r);
    // Two sets: the order's (its ladder, 🦵 and 🧐) and the pointer row's 🧵.
    const lineMarkers = printMarkerSets([dedupeLineMarkers([jurMarker, petitum, review]), looseThread]);
    lines.push(`${includedOrderNum}. ${wording}${lineMarkers ? ` ${lineMarkers}` : ""} <!-- order ${includedOrderNum} -->`);
  }
  lines.push("");

  let partNum = 0;
  lines.push("## PART 2: FACTUAL BASIS");
  lines.push("");
  // Each fact's Part 2 paragraph number, so Part 3 names it instead of re-printing it. Read as
  // printed, since a rhetorical paragraph placed in Part 2 takes a number between facts.
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
    // Sites 11 / 11': the fact's own court-record 📌 keys on the fact, 🧵 on the venue form's own
    // pointer row. 👤 and the spent-admission rungs never generate; 👤 is recorded on the fact for
    // the Evidence criterion (Goal card design §2.7), flagged when counsel suppressed it (v69).
    const courtRecordPin = courtRecordPinpointMarker(f.court_record, f.court_record_pinpoint, f.court_record_execution, f.court_record_exhibit_letters);
    const looseThread = looseThreadMarker(true, waIds.factIds.has(f.id));
    recordGlyphs(ctx.inventory, courtRecordPin, ["📌"], { table: "facts", id: f.id, item: f.postulate });
    recordGlyphs(ctx.inventory, looseThread, ["🧵"], { table: "filing_facts", id: f.pointer_id, item: f.postulate });
    recordCriterionGlyphs(ctx.inventory, owedWitness, ["👤"], { table: "facts", id: f.id, item: f.postulate, ...(witnessSuppressed ? { suppressed: true as const } : {}) });
    const tokens: string[] = [witnessMarker, courtRecordPin, looseThread];
    const statementSets: string[][] = [];
    const guarded = isAdmittedGuard(courtRecordLinked, admitted);
    for (const s of stmts) {
      // Sites 11'' / 11''': this line merges every statement's glyphs under one trace comment, so
      // the recorder takes each statement's own tokens before they join the line's dedupe. The
      // locator pair is pushed only when the unless-admitted guard is open, exactly as printed.
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
      // 👃 and 🏆 are this statement's tokens too, so the recorder sees them (Goal card design
      // §2.7). They still join the line last, in the order they always printed.
      statementTokens.push(doubtMarker(s.doubt));
      // Issue #364: the instrument's own copy status, not the exhibit's --
      // outside the guard, since it's not in work-markers.md §2's Silenced list.
      if (s.instrument_id !== null) statementTokens.push(copyMarkers.get(s.instrument_id) ?? "");
      tokens.push(...statementTokens);
      recordFactStatementGlyphs(
        ctx.inventory,
        dedupeLineMarkers(statementTokens),
        { statement_id: s.id, witness_id: s.witness_id, witness_name: s.witness_name, instrument_id: s.instrument_id, instrument_label: s.instrument_label },
        f.postulate
      );
    }
    // 🧐 per object on this merged line, each against everything already on it (design §3): the
    // fact first, then each statement, each joining its own object's set.
    const lineGlyphs = dedupeLineMarkers(tokens);
    const factReview = reviewMarkerFor(ctx.review, ctx.inventory, lineGlyphs, "facts", f.id, f.postulate);
    stmts.forEach((s, i) => {
      if (s.purpose !== "impeachment") statementSets[i].push(reviewMarkerFor(ctx.review, ctx.inventory, lineGlyphs, "statements_of_fact", s.id, `${s.witness_name}: ${f.postulate}`));
    });
    // One set per object: the fact's, the pointer row's 🧵, and each statement's. Identical sets
    // print once, so two statements both owing only a pinpoint show one 🧷 (or one 📌) (issue 322).
    const glyphs = printMarkerSets([dedupeLineMarkers([witnessMarker, courtRecordPin, factReview]), looseThread, ...statementSets.map(dedupeLineMarkers)]);
    // Citation lines: the court record's, then one per statement the forum may read (never an
    // impeachment one). render-form32-filed-face.ts prints the same lines, unindented and untraced.
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

  lines.push("## PART 3: LEGAL BASIS");
  lines.push("");
  // Court-form convention: each Part restarts its own enumeration (#367).
  let submissionNum = 0;
  // Ticket 2026-09-01: one Map per rendered document, shared across every submission in this
  // Legal Basis part, so a law assertion two submissions `requires` renders in full once and
  // cross-references thereafter ("As set out in paragraph N, above, ...").
  const renderedLawAssertions = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      submissionNum += 1;
      lines.push("", ...renderRhetoricLine(ctx, entry.row, submissionNum, ""), "");
      continue;
    }
    const s = entry.item;
    // renderSubmissionParagraphs is shared with the VanIAC written argument
    // (render-vaniac-submissions.ts) and stamps its own <!-- fact_id N -->/
    // <!-- law_assertion_id N --> id-trace comments by database row id --
    // no token collision with Part 2's positional <!-- fact N --> above,
    // since bare labels are always positional and `_id`-suffixed labels
    // are always database row ids naming their schema table (#379). An
    // impeachment fact statement or a lead-authority law statement
    // belonging to a submission never renders on the Notice of Application
    // at all -- renderSubmissionParagraphs excludes them from the inline body
    // (brief-only cap, #370 item 4); only the reserve inventory records them.
    // 🧵 loose-thread rides the contention paragraph, alongside 🧾 -- both handled internally.
    recordParagraph(ctx, s.id, "form", submissionNum);
    // Site 12: 🧵 rides the contention line but keys on the venue form's own pointer row, so it is
    // recorded here rather than inside renderSubmissionParagraphs, which only sees the submission.
    const looseThread = looseThreadMarker(true, waIds.submissionIds.has(s.id));
    recordGlyphs(ctx.inventory, looseThread, ["🧵"], { table: "filing_submissions", id: s.pointer_id, item: s.contention });
    const result = renderSubmissionParagraphs(
      s.id,
      s.contention,
      submissionNum,
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
    submissionNum = result.nextPara;
  }

  lines.push("## PART 4: MATERIAL TO BE RELIED ON");
  lines.push("");
  // Issue #398: exhibit-side 👤 parity with the VanIAC Evidence Index, gated
  // to role='evidence'/'other' rows (isExhibitTenderRole) -- affidavits,
  // orders, pleadings, and witness statements are never checked for a
  // tendering witness/admission (dual-approved role scope, markers.ts).
  //
  // Site 13 (Work Board Proposals design §8) names this Part 4 document line as needing the
  // collector, but nothing generating prints here today: the line carries spent admission rungs,
  // 👤 and 🏆, none of which generates a Proposal (design §4). 🎾, 🕹️, live-admission capture
  // and 🏷️ print only on the VanIAC Evidence Index -- Phase C defect 5, a known limit recorded
  // in renderEvidenceIndex's own doc comment and not fixed here. So no inventory is passed to
  // fetchDocumentTenderStatus below, and no generating hook sits on the line. There is no missing
  // hook to go looking for. Its 👤 and 🏆 are recorded, flagged non-generating, for the Goal card.
  const tenderStatus = fetchDocumentTenderStatus(
    ctx.dbPath,
    docs.map((d) => d.document_id),
    ctx.rendered.slice(0, 10)
  );
  docs.forEach((d, i) => {
    const copy = copyMarkers.get(d.document_id) ?? "";
    let tenderMarkers = "";
    if (isExhibitTenderRole(d.role)) {
      const st = tenderStatus.get(d.document_id)!;
      tenderMarkers = dedupeLineMarkers([st.spentGlyphs, unsponsoredExhibitMarker(st.hasTender)]);
    }
    // 👤 and 🏆 generate nothing, but the Evidence criterion counts both, on the document.
    const markers = [tenderMarkers, copy].filter(Boolean).join(" ");
    recordCriterionGlyphs(ctx.inventory, markers, ["👤", "🏆"], { table: "documents", id: d.document_id, item: d.label });
    // All the document's own markers, the spent rungs prefixing the 👤 they route: one set.
    const printed = printMarkerSets([markers]);
    lines.push(`${i + 1}. ${d.label}${d.document_date ? ` (${d.document_date})` : ""}${printed ? ` ${printed}` : ""} <!-- document ${i + 1} -->`);
  });
  // The standard closing lines: template text, so no marker, no criterion glyph and no trace.
  STANDARD_MATERIAL_LINES.forEach((text, i) => lines.push(`${docs.length + i + 1}. ${text}`));
  lines.push("");

  lines.push(checkboxOrderBlock([]));
  lines.push("");
  if (applicant) lines.push(signatureBlock({ name: applicant.name, role: applicant.role, counselName: applicant.counsel_name }, true));

  // No "Held in reserve" trailing section on the Notice of Application
  // (#367, confirmed by #380): reserved orders/submissions/statements
  // (deployed by no document of this filing) never reach this form's own
  // queries at all -- unlike the VanIAC written argument, a court form has
  // no mechanism for showing the practitioner material withheld from the
  // forum. See filed-face.ts's
  // STRUCK_LINE_RE for the matching filed-face guarantee that a crossed-out
  // order never survives into the filed face.

  return lines.join("\n").trimEnd() + "\n";
}
