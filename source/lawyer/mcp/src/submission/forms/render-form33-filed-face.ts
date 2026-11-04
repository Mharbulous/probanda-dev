// Form 33 filed-face emitter (build ticket #386, handoff from #376): a
// deterministic renderer producing `form-33.md` conforming exactly to
// .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md,
// consumed by publish-bcsc-form's asm33 step. Named and shaped to match its
// sibling, render-form32-filed-face.ts (#392): unlike the mockup renderer
// (render-application-response.ts), this queries the DB directly and
// produces the strict flat-paragraph grammar -- no markers, no HTML
// comments, no frontmatter stamp block, no Parts 1-3 body text (Parts 1-3
// live entirely in the `orders` frontmatter array). Writes nothing to disk
// itself: forms.ts's submissionFormsEmitForm33 returns this markdown for
// /draft to write verbatim and hand to `asm33`.

import type { PublishWarning } from "../publish-sidecar.js";
import { ValidationError } from "../../errors.js";
import { passesBriefOnlyCap } from "./brief-only-cap.js";
import { formatTimeEstimate, pushExcerptBlockquote, STANDARD_MATERIAL_LINES } from "./components.js";
import {
  fetchFilingPositions,
  fetchHearingDetails,
  fetchUnpositionedOrders,
  hearingDateSentence,
  resolveRespondedToDocument,
} from "./render-application-response.js";
import { CITATION_MISSING } from "./law-statement-line.js";
import { exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments } from "./exhibit-documents.js";
import { fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions, type LawAssertionRow } from "./submission-reads.js";
import { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
import type { RenderContext } from "./render-context.js";
import { fetchRhetoric, interleave, renderRhetoricFiled } from "./render-rhetoric.js";
import { materialDateSuffix } from "./render-bcca-factum.js";
import { factsPart, fetchFacts } from "./filing-facts.js";
import { factStatementCitationLine } from "./statement-lines.js";
import { rows } from "../query-rows.js";

/** Lenient emit placeholders: the template's own blanks (templates/form-33.dotx). */
const NOTICE_DATE_PLACEHOLDER = "[notice date]";
const HEARING_DATE_PLACEHOLDER = "[agree, or propose other hearing date(s)]";
const TIME_ESTIMATE_PLACEHOLDER = "[time estimate]";
const NO_FACTUAL_BASIS = "[factual basis: no facts recorded]";

/** Mirrors render-form32-filed-face.ts's own copy. authority_title === null is structurally unreachable via groupSubmissionLaw's output -- kept defensive, not deleted. */
function lawStatementCitationLine(row: LawAssertionRow): string | null {
  if (row.authority_title === null) return row.pinpoint ? `> ${row.pinpoint}` : null;
  const citation = row.authority_citation ?? CITATION_MISSING;
  // Stored pinpoints sometimes repeat the citation ("2023 BCCA 182, para. 34"); strip that
  // prefix so the line never prints the citation twice.
  let pin = row.pinpoint;
  if (pin && row.authority_citation && pin.startsWith(row.authority_citation)) {
    pin = pin.slice(row.authority_citation.length).replace(/^[\s,;]+/, "") || null;
  }
  return `> *${row.authority_title}*, ${citation}${pin ? `, ${pin}` : ""}`;
}

/** Submissions cascade-struck the same way the Written Arguments renders them (render-companions.ts's
 * struckSubmission): every order_sought row this submission serves is crossed out. Rare for a pure
 * response filing (it normally has no order_sought rows of its own to serve), but honoured for
 * consistency with every other emitter's crossed-out contract. Fact-level cascade (a fact struck
 * because every submission resting on it is struck) is not implemented -- accepted simplification,
 * flagged in the ticket resolution; Part 4's facts render unconditionally. */
function struckSubmissionIds(dbPath: string, submissionIds: number[]): Set<number> {
  if (submissionIds.length === 0) return new Set();
  const placeholders = submissionIds.map(() => "?").join(",");
  const served = rows<{ submission_id: number; crossed_out_on: string | null }>(
    dbPath,
    `SELECT sb.submission_id, o.crossed_out_on
     FROM order_sought_served_by sb
     JOIN order_sought o ON o.id = sb.order_sought_id
     WHERE sb.submission_id IN (${placeholders})`,
    submissionIds
  );
  const crossedFlagsBySubmission = new Map<number, boolean[]>();
  for (const r of served) {
    const list = crossedFlagsBySubmission.get(r.submission_id) ?? [];
    list.push(r.crossed_out_on !== null);
    crossedFlagsBySubmission.set(r.submission_id, list);
  }
  const struck = new Set<number>();
  for (const [submissionId, flags] of crossedFlagsBySubmission) {
    if (flags.length > 0 && flags.every(Boolean)) struck.add(submissionId);
  }
  return struck;
}

/**
 * Deterministic from the database alone.
 *
 * Throws ValidationError rather than emitting an invalid/unauthorized file when:
 * - the filing isn't an application_response (wrong caller), mirroring render-form32-filed-face.ts's guard;
 * - the responded-to document can't be resolved, or has no document_date;
 * - any opposing_orders row of that document has no position taken (⬜ is the mockup's fail-visible
 *   surface; refusal is the filed face's);
 * - Part 4 has no facts and no pure-law decision of counsel is recorded (filings.pure_law_on,
 *   schema v49), or Part 4 has facts and that decision is also recorded (a rhetorical paragraph
 *   placed in Part 4 counts as a fact here, schema v71). Like the Form 32 emitter
 *   (#392), it sets `pure_law_confirmed: true` only off counsel's recorded decision, never by
 *   inference, so it records counsel's word rather than speaking for them: with the decision
 *   recorded and Part 4 empty it prints `Nil.` under Part 4 and sets the key. Facts and a decision
 *   together mean one of the two is wrong, so it refuses rather than choose.
 *
 * Given `warnings` (the lenient emit of the publish route, spec 2026-10-09), it refuses for none of the
 * missing data: a served notice with no date, an order with no position, no time estimate, no position
 * on the applicant's hearing date (or that position with no date recorded), a statement
 * of law with no citation and an empty Part 4 with no pure-law decision each print a placeholder (an
 * order with no position is left out) and push a warning instead. It still refuses with nothing to
 * respond to (no served notice resolved, no position taken) and on a facts-and-decision contradiction.
 */
export function renderForm33FiledFace(ctx: RenderContext, warnings?: PublishWarning[]): string {
  if (ctx.filing.kind !== "application_response") {
    throw new ValidationError(
      `"${ctx.filing.title}" is not an Application Response, so it cannot be filled as Form 33.`
    );
  }

  const positions = fetchFilingPositions(ctx.dbPath, ctx.filing.id);
  const respondedTo = resolveRespondedToDocument(ctx.dbPath, ctx.proceeding.id, positions);

  if (!respondedTo) {
    throw new ValidationError(
      `"${ctx.filing.title}": the notice of application this response answers cannot be found -- ` +
        `no position is recorded on any of its orders, and the proceeding does not hold exactly one served notice with its orders recorded.`
    );
  }
  if (respondedTo.document_date === null) {
    if (warnings === undefined) {
      throw new ValidationError(`"${ctx.filing.title}": the served notice of application has no date recorded, so the form's notice date cannot be filled.`);
    }
    warnings.push({ kind: "missing_datum", field_or_id: "notice_dated", message: `Date of the notice of application: not recorded. The form shows ${NOTICE_DATE_PLACEHOLDER}.` });
  }
  if (positions.length === 0) {
    throw new ValidationError(`"${ctx.filing.title}": no position is taken on any order of the served notice -- nothing to assemble.`);
  }
  const unpositioned = fetchUnpositionedOrders(ctx.dbPath, ctx.filing.id, respondedTo.id);
  if (unpositioned.length > 0) {
    if (warnings === undefined) {
      throw new ValidationError(
        `"${ctx.filing.title}": ${unpositioned.length} order(s) of the served notice have no position taken ` +
          `(paragraph(s) ${unpositioned.map((o) => o.paragraph_number).join(", ")}) -- the mockup's ⬜ marker is the ` +
          `fail-visible surface for this; the filed face refuses instead of omitting silently.`
      );
    }
    for (const o of unpositioned) {
      warnings.push({
        kind: "missing_datum",
        field_or_id: `order ${o.paragraph_number}`,
        message: `Order ${o.paragraph_number} of the notice of application: no position taken. This response leaves it out.`,
      });
    }
  }

  const hearing = fetchHearingDetails(ctx.dbPath, ctx.filing.id);
  if (!hearing?.time_estimate_minutes) {
    if (warnings === undefined) {
      throw new ValidationError(`"${ctx.filing.title}": the hearing's time estimate is not recorded, so the form's time estimate cannot be filled.`);
    }
    warnings.push({ kind: "missing_datum", field_or_id: "time_estimate", message: `Time estimate: not recorded. The form shows ${TIME_ESTIMATE_PLACEHOLDER}.` });
  }

  const orders = positions.map((p) => ({
    order: p.paragraph_number,
    position: p.position === "consented" ? "consent" : p.position === "opposed" ? "oppose" : "no-position",
    terms: p.position === "consented" ? p.proposed_terms ?? "" : "",
  }));

  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("application_response"));
  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, "form");
  const struck = struckSubmissionIds(
    ctx.dbPath,
    submissions.map((s) => s.id)
  );
  const liveSubmissions = submissions.filter((s) => !struck.has(s.id));
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);

  // Ticket 2026-08-31: Part 5 used to print only each live submission's contention sentence, with
  // no excerpts or citations at all -- this is new functionality, not a restructure, added to
  // match the same one-paragraph-per-assertion shape every other submissions-of-law surface now
  // has. Scoped to liveSubmissions only -- a struck submission never prints, so its law/facts are
  // never fetched or gated on.
  const liveSubmissionIds = liveSubmissions.map((s) => s.id);
  const submissionFactRows = fetchSubmissionFacts(ctx.dbPath, liveSubmissionIds);
  const submissionFactIds = [...new Set(submissionFactRows.map((f) => f.fact_id))];
  const submissionFactStatements = fetchFactStatements(ctx.dbPath, submissionFactIds);
  // No admission-ladder inputs -- this emitter renders no markers, only .statements[].excerpt/.pinpoint.
  const factsBySubmission = groupSubmissionFacts(submissionFactRows, submissionFactStatements, new Set(), new Map());
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, liveSubmissionIds));

  const exhibitMap = exhibitNumbersFromOrderedIds(docs.map((d) => d.document_id));
  const part4Statements = fetchFactStatements(
    ctx.dbPath,
    facts.map((f) => f.id)
  );
  const referencedDocIds = new Set<number>(docs.map((d) => d.document_id));
  for (const s of [...part4Statements, ...submissionFactStatements]) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);

  // Filing gate (ticket 2026-08-31, decision 5): a filed document may never contain
  // CITATION_MISSING. Checked directly against the typed rows -- already in hand -- not by
  // scanning assembled markdown.
  const missingCitationIds = liveSubmissions.flatMap((s) =>
    (lawBySubmission.get(s.id) ?? []).flatMap((la) =>
      la.statements
        .filter((st) => passesBriefOnlyCap(st) && st.authority_citation === null)
        .map((st) => st.statement_id as number)
    )
  );
  if (missingCitationIds.length > 0) {
    if (warnings === undefined) {
      throw new ValidationError(
        `"${ctx.filing.title}": statement(s) of law ${missingCitationIds.join(", ")} cite an authority with no citation, so the filed document is not made with "${CITATION_MISSING}" in it. Add the missing citation(s), or remove those statements from this document's submissions.`
      );
    }
    for (const id of missingCitationIds) {
      warnings.push({ kind: "missing_datum", field_or_id: `statement ${id}`, message: `Statement of law ${id}: its authority has no citation. Part 5 shows ${CITATION_MISSING}.` });
    }
  }

  // A rhetorical paragraph placed in Part 4 is Part 4 content, as a fact is.
  const factsRhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "facts");
  const part4Content = facts.length + factsRhetoric.length;
  // Undefined on a database held below v49 (the filing row is read with SELECT *), so it refuses as before.
  const pureLawOn = ctx.filing.pure_law_on ?? null;
  if (part4Content > 0 && pureLawOn !== null) {
    throw new ValidationError(
      `"${ctx.filing.title}": Part 4 (factual basis) has ${facts.length} fact(s)${factsRhetoric.length > 0 ? ` and ${factsRhetoric.length} rhetorical paragraph(s)` : ""} recorded and counsel's decision of ${pureLawOn} that the response pleads no facts is also on record. One of the two is wrong: remove the Part 4 ${factsRhetoric.length > 0 ? "content" : "facts"}, or withdraw counsel's decision and its note together, then fill the form again.`
    );
  }
  if (part4Content === 0 && pureLawOn === null) {
    if (warnings === undefined) {
      throw new ValidationError(
        `"${ctx.filing.title}": Part 4 (factual basis) has no facts recorded and no pure-law decision of counsel is on record. Add at least one Part 4 fact, or record counsel's decision, with its note, that this application response pleads no facts, then fill the form again.`
      );
    }
    warnings.push({
      kind: "missing_datum",
      field_or_id: "part4",
      message: `Factual basis (Part 4): no facts are recorded, and counsel has recorded no decision that the response pleads none. Part 4 shows ${NO_FACTUAL_BASIS}.`,
    });
  }

  const hearingDate = hearingDateSentence(hearing);
  if (hearingDate === null) {
    if (warnings === undefined) {
      throw new ValidationError(
        `"${ctx.filing.title}": the response's position on the hearing date is not recorded, or it agrees or proposes another date with no proposed date recorded, so the form's hearing date cannot be filled (Rule 8-1(10)(b)(iv)).`
      );
    }
    warnings.push({
      kind: "missing_datum",
      field_or_id: "hearing_date",
      message: `Whether the application respondent agrees with the applicant's hearing date: not recorded. The form shows ${HEARING_DATE_PLACEHOLDER}.`,
    });
  }

  const front: string[] = [
    "---",
    `notice_dated: ${respondedTo.document_date ?? NOTICE_DATE_PLACEHOLDER}`,
    // "Nil." when the applicant proposed no date: the form then prints no hearing-date line.
    `hearing_date: ${hearingDate === "" ? "Nil." : hearingDate ?? `The application respondent(s) ${HEARING_DATE_PLACEHOLDER}.`}`,
    `time_estimate: ${hearing?.time_estimate_minutes ? formatTimeEstimate(hearing.time_estimate_minutes) : TIME_ESTIMATE_PLACEHOLDER}`,
    `orders: ${JSON.stringify(orders)}`,
    ...(pureLawOn !== null ? ["pure_law_confirmed: true"] : []),
    "---",
  ];

  const body: string[] = [];
  let n = 1;
  body.push("## Part 4");
  body.push("");
  if (part4Content === 0 && pureLawOn === null) {
    // Reached only on a lenient emit: Nil. needs counsel's recorded decision, which is missing.
    body.push(`${n}. ${NO_FACTUAL_BASIS}`);
    n += 1;
  } else if (part4Content === 0) {
    body.push("Nil.");
  } else {
    // The mockup's Part 4 citation lines (render-application-response.ts), unindented and
    // untraced: the court record's pinpoint, then one line per non-impeachment statement.
    for (const entry of interleave(facts, factsRhetoric, (f) => f.filing_ordinal)) {
      if (entry.kind === "rhetoric") {
        body.push(...renderRhetoricFiled(entry.row, n, ""));
        n += 1;
        continue;
      }
      const f = entry.item;
      body.push(`${n}. ${f.postulate}`);
      n += 1;
      if (f.court_record !== null && f.court_record_pinpoint) body.push(`> (${f.court_record_pinpoint})`);
      for (const stmt of part4Statements) {
        if (stmt.fact_id !== f.id || stmt.purpose === "impeachment") continue;
        const citationLine = factStatementCitationLine(exhibitMap, labelMap, stmt);
        if (citationLine) body.push(citationLine);
      }
    }
  }
  body.push("");
  body.push("## Part 5");
  body.push("");
  // "Nil." covers both no live submissions at all and every live submission having no facts/law.
  // A linked fact already printed in Part 4 is not printed again here: the filed face states each
  // fact once, and the Part 5 numbering runs on from Part 4 without it. A linked fact missing from
  // Part 4 prints in full only on a sent or retired Writing, as it was sent: on a drafting Writing
  // the emitter (forms.ts, refuseUnplacedFacts) refuses before this renders (schema v59).
  const part4FactIds = new Set(facts.map((f) => f.id));
  const part5Facts = (submissionId: number) => (factsBySubmission.get(submissionId) ?? []).filter((f) => !part4FactIds.has(f.factId));
  const submissionsRhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions");
  if (submissionsRhetoric.length === 0 && liveSubmissions.every((s) => part5Facts(s.id).length === 0 && (lawBySubmission.get(s.id) ?? []).length === 0)) {
    body.push("Nil.");
  } else {
    // Ticket 2026-09-01: same dedup as the mockup renderers -- a law assertion shared by two
    // submissions renders in full once, then as a numbered cross-reference paragraph, keeping
    // mockup and filed-face numbering aligned. Backward paragraph references are grammar-legal.
    const renderedLawAssertions = new Map<number, number>();
    for (const entry of interleave(liveSubmissions, submissionsRhetoric, (s) => s.filing_ordinal)) {
      if (entry.kind === "rhetoric") {
        body.push(...renderRhetoricFiled(entry.row, n, ""));
        n += 1;
        continue;
      }
      const s = entry.item;
      for (const f of part5Facts(s.id)) {
        body.push(`${n}. ${f.postulate}`);
        n += 1;
        for (const stmt of f.statements) {
          if (stmt.purpose === "impeachment") continue;
          pushExcerptBlockquote(body, stmt.exhibit_id !== null ? stmt.exhibit_excerpt : stmt.excerpt, factStatementCitationLine(exhibitMap, labelMap, stmt));
        }
      }
      for (const la of lawBySubmission.get(s.id) ?? []) {
        const priorPara = renderedLawAssertions.get(la.lawAssertionId);
        if (priorPara !== undefined) {
          body.push(`${n}. As set out in paragraph ${priorPara}, above, ${la.proposition}`);
          n += 1;
          continue;
        }
        renderedLawAssertions.set(la.lawAssertionId, n);
        body.push(`${n}. ${la.proposition}`);
        n += 1;
        for (const stmt of la.statements.filter(passesBriefOnlyCap)) {
          pushExcerptBlockquote(body, stmt.excerpt, lawStatementCitationLine(stmt));
        }
      }
    }
  }
  body.push("");
  body.push("## Part 6");
  body.push("");
  for (const d of docs) {
    body.push(`- ${d.label}${materialDateSuffix(d.label, d.document_date)}`);
  }
  // The standard closing lines always print, so Part 6 is never empty and never "Nil.".
  for (const text of STANDARD_MATERIAL_LINES) body.push(`- ${text}`);

  return front.join("\n") + "\n" + body.join("\n").trimEnd() + "\n";
}
