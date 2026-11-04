// Form 32 filed-face emitter (issue #392, handoff contract settled in #376).
// Produces form-32.md in the strict grammar owned by
// .claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md
// (SSOT) -- consumed by publish-bcsc-form's asm32 operation, which hard-
// validates and fills the court-ready .docx. Not a strip pass over
// render-notice-of-application.ts's mockup: that mockup prints Part 3
// contentions and fences verbatim excerpts (both disallowed by the
// grammar), restarts paragraph numbering per Part (the grammar requires
// Parts 2-3 numbered continuously), and renders Part 1 in the body (the
// grammar derives Part 1 from frontmatter `orders`). So this is a
// purpose-built renderer, structurally incapable of emitting a marker,
// an HTML comment, or bold -- not something stripped afterward.
//
// fetchHearingDetails and lawStatementCitationLine are kept here; the facts,
// the fact-statement citation line (with its own `>> ` prefix), the time
// estimate and the excerpt blockquote come from the shared modules. Part 4
// and "Ex. N" read the shared fetchFilingDocuments, the same list the NoA
// mockup reads (#458).

import { ValidationError } from "../../errors.js";
import type { PublishWarning } from "../publish-sidecar.js";
import { passesBriefOnlyCap } from "./brief-only-cap.js";
import { formatTimeEstimate, pushExcerptBlockquote, STANDARD_MATERIAL_LINES } from "./components.js";
import { CITATION_MISSING } from "./law-statement-line.js";
import { exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments, type FilingDocumentRow } from "./exhibit-documents.js";
import { fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions, type LawAssertionRow } from "./submission-reads.js";
import { fetchOrdersSought } from "./orders-sought.js";
import { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
import type { RenderContext } from "./render-context.js";
import { fetchRhetoric, interleave, renderRhetoricFiled } from "./render-rhetoric.js";
import { longDate, materialDateSuffix } from "./render-bcca-factum.js";
import { factsPart, fetchFacts } from "./filing-facts.js";
import { factStatementCitationLine } from "./statement-lines.js";
import { rows } from "../query-rows.js";

interface HearingDetailsRow {
  /** Undefined on a database held below v62, so the key is omitted and asm32 refuses its absence. */
  proposed_hearing?: string | null;
  time_estimate_minutes: number | null;
  associate_judge: number | null;
}

function fetchHearingDetails(dbPath: string, filingId: number): HearingDetailsRow | undefined {
  return rows<HearingDetailsRow>(dbPath, "SELECT * FROM hearing_details WHERE filing_id = ?", [filingId])[0];
}

/** A copy of law-statement-line.ts's function of this name, with this form's own line prefix. authority_title === null is structurally unreachable via groupSubmissionLaw's output -- kept defensive, not deleted. */
function lawStatementCitationLine(row: LawAssertionRow): string | null {
  if (row.authority_title === null) return row.pinpoint ? `>> ${row.pinpoint}` : null;
  const citation = row.authority_citation ?? CITATION_MISSING;
  // Stored pinpoints sometimes repeat the citation ("2023 BCCA 182, para. 34"); strip that
  // prefix so the line never prints the citation twice.
  let pin = row.pinpoint;
  if (pin && row.authority_citation && pin.startsWith(row.authority_citation)) {
    pin = pin.slice(row.authority_citation.length).replace(/^[\s,;]+/, "") || null;
  }
  return `>> *${row.authority_title}*, ${citation}${pin ? `, ${pin}` : ""}`;
}

/** Part 2's evidence reference (spec 2026-10-09, §4.3): the court-record document's label and the
 * fact's pinpoint, as "Affidavit #2 of <deponent>, at paras 2-4; Exhibit A". "para." and "paras."
 * lose their period, as the practitioner writes them. A pinpoint that already begins with the label
 * ("Order of ..., 2 July 2026, para 1") names the document once, not twice. */
function evidenceReference(document: string | undefined, pinpoint: string | null): string | null {
  let pin = pinpoint?.trim() ? pinpoint.trim().replace(/\b(paras?)\.(?=\s)/gi, "$1") : null;
  if (document === undefined) return pin;
  if (pin !== null && pin.startsWith(document) && /^($|[\s,;:])/.test(pin.slice(document.length))) {
    pin = pin.slice(document.length).replace(/^[\s,;:]+/, "") || null;
  }
  if (pin === null) return document;
  return `${document}, ${/^paras?\b/i.test(pin) ? "at " : ""}${pin}`;
}

/** A matched `*…*` span (the asm32 grammar's ITALIC). */
const ITALIC_SPAN = /(?<!\*)\*[^*\n]+\*(?!\*)/g;

/** Every authority name the drafting database holds for the proceeding (case names and statute,
 * regulation and rule titles are all authorities rows), as one pattern, longest name first. Never
 * against a letter, digit or asterisk, so a wrap can neither split a word nor make `**`. Null when
 * the proceeding holds none. */
function authorityNamePattern(dbPath: string, proceedingId: number): RegExp | null {
  const names = [
    ...new Set(
      rows<{ name: string }>(dbPath, "SELECT style_of_cause_or_title AS name FROM authorities WHERE proceeding_id = ?", [proceedingId]).map((r) =>
        r.name.trim()
      )
    ),
  ]
    .filter((name) => name !== "" && !name.includes("*"))
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return null;
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}*])(?:${alternatives})(?![\\p{L}\\p{N}*])`, "gu");
}

/** Wraps each authority name in `*…*` (spec 2026-10-09, §4.2), never inside a span already marked. */
function italicizeNames(line: string, names: RegExp): string {
  const marked = [...line.matchAll(ITALIC_SPAN)].map((m) => [m.index, m.index + m[0].length]);
  return line.replace(names, (name: string, offset: number) => (marked.some(([start, end]) => offset >= start && offset < end) ? name : `*${name}*`));
}

interface AffidavitFieldsRow {
  id: number;
  instrument: string | null;
  affidavit_number: string | null;
  execution: string | null;
  deponent_name: string | null;
}

function fetchAffidavitFields(dbPath: string, documentIds: number[]): Map<number, AffidavitFieldsRow> {
  if (documentIds.length === 0) return new Map();
  const found = rows<AffidavitFieldsRow>(
    dbPath,
    `SELECT d.id, d.instrument, d.affidavit_number, d.execution, w.name AS deponent_name
     FROM documents d
     LEFT JOIN witnesses w ON w.id = d.deponent
     WHERE d.id IN (${documentIds.map(() => "?").join(",")})`,
    documentIds
  );
  return new Map(found.map((r) => [r.id, r]));
}

/**
 * Form 32 Part 4's identification, "Affidavit #<n> of <name>, made <Month D, YYYY>". A drafted
 * affidavit is made on its execution date, NULL until sworn; another affidavit listed from the
 * court file is dated by its document_date. With no date the line prints the visible placeholder
 * "[date]", which asm32's verify reports as a warning. With no deponent recorded the label stands
 * in for "Affidavit #<n> of <name>".
 */
function affidavitLine(d: FilingDocumentRow, a: AffidavitFieldsRow | undefined): string {
  const made = a?.execution ?? (a?.instrument === "affidavit" ? null : d.document_date);
  const who = a?.deponent_name ? `Affidavit${a.affidavit_number ? ` #${a.affidavit_number}` : ""} of ${a.deponent_name}` : d.label;
  return `${who}, made ${made ? longDate(made) : "[date]"}`;
}

function frontmatterValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Lenient emit (the publish route): what a required frontmatter key the database leaves NULL prints,
 * and its cover line. A key with no entry prints its own name in brackets. asm32 prints a bracketed
 * associate_judge in the jurisdiction sentence's place (assembly-input-contract.md). */
const MISSING_FRONTMATTER: Record<string, { placeholder: string; message: string }> = {
  proposed_hearing: { placeholder: "[proposed hearing]", message: "Proposed hearing: not recorded. The form shows [proposed hearing]." },
  time_estimate: { placeholder: "[time estimate]", message: "Time estimate: not recorded. The form shows placeholders for the hours and minutes." },
  associate_judge: {
    placeholder: "[associate judge: not determined]",
    message: "Associate judge jurisdiction: not determined. The form shows [associate judge: not determined] in place of the jurisdiction sentence.",
  },
};

/** Lenient emit: Part 2's paragraph while it has no facts and counsel has recorded no pure-law decision. */
const NO_FACTUAL_BASIS = "[factual basis: no facts recorded]";
/** Lenient emit: Part 1's order while no order is deployed to the form. */
const NO_ORDERS = "[orders sought: none recorded]";

/**
 * Renders one BCSC Notice of Application filing's form-32.md filed face.
 * Deterministic from the database alone (ctx.rendered is never read).
 *
 * Throws ValidationError rather than emitting an invalid file when:
 * - the filing isn't a notice_of_application (wrong caller);
 * - Part 2 has no facts and no pure-law decision of counsel is recorded
 *   (filings.pure_law_on, schema v49), or Part 2 has facts and that
 *   decision is also recorded (a rhetorical paragraph placed in Part 2
 *   counts as a fact here, schema v71). The grammar lets an empty Part 2 through
 *   only with an affirmative `pure_law_confirmed: true`, and this emitter
 *   sets that key only off counsel's recorded decision, never by
 *   inference: with the decision recorded and Part 2 empty it prints
 *   `Nil.` under Part 2 and sets the key. Facts and a decision together
 *   mean one of the two is wrong, so it refuses rather than choose. Per
 *   the contract's own division of discipline ("by the time a form-32.md
 *   exists, its content is filing-ready"), a reject the pipeline cannot
 *   cure belongs at emit time, not downstream. Every other asm32
 *   rejection (missing hearing fields, an empty orders list, malformed
 *   markdown) is left to asm32 itself -- this emitter does not duplicate
 *   its validation.
 *
 * Given `warnings` (the lenient emit of the publish route, spec 2026-10-09), it refuses for none of the
 * missing data above: an undetermined associate judge jurisdiction, a NULL required frontmatter value,
 * an empty Part 2 with no pure-law decision, no deployed order and a statement of law with no citation
 * each print a visible placeholder and push a warning instead. Part 2 facts together with a pure-law
 * decision still refuse: that is a contradiction in the record, not missing data. It also pushes onto
 * `warnings` each Part 2 fact with no court record, whose paragraph then carries no evidence reference
 * naming a document.
 */
export function renderForm32FiledFace(ctx: RenderContext, warnings?: PublishWarning[]): string {
  if (ctx.filing.kind !== "notice_of_application") {
    throw new ValidationError(
      `"${ctx.filing.title}" is not a Notice of Application, so it cannot be filled as Form 32.`
    );
  }

  const hearing = fetchHearingDetails(ctx.dbPath, ctx.filing.id);
  // #451: asm32's fill defaults a missing associate_judge to "within the jurisdiction", so an
  // undetermined value (NULL, or no hearing_details row) stops here instead of being guessed. A lenient
  // emit prints a placeholder in the sentence's place instead (the frontmatter loop below).
  if (hearing?.associate_judge == null && warnings === undefined) {
    throw new ValidationError(
      `"${ctx.filing.title}": whether the application is within the jurisdiction of an associate judge is not yet settled, so Form 32 is not filled with a jurisdiction sentence nobody confirmed. Record whether it is within that jurisdiction, then fill the form again.`
    );
  }
  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("notice_of_application"));
  // A rhetorical paragraph placed in Part 2 is Part 2 content, as a fact is.
  const factsRhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "facts");
  const part2Content = facts.length + factsRhetoric.length;
  // Undefined on a database held below v49 (the filing row is read with SELECT *), so it refuses as before.
  const pureLawOn = ctx.filing.pure_law_on ?? null;
  if (part2Content > 0 && pureLawOn !== null) {
    throw new ValidationError(
      `"${ctx.filing.title}": Part 2 (factual basis) has ${facts.length} fact(s)${factsRhetoric.length > 0 ? ` and ${factsRhetoric.length} rhetorical paragraph(s)` : ""} recorded and counsel's decision of ${pureLawOn} that the application pleads no facts is also on record. One of the two is wrong: remove the Part 2 ${factsRhetoric.length > 0 ? "content" : "facts"}, or withdraw counsel's decision and its note together, then fill the form again.`
    );
  }
  if (part2Content === 0 && pureLawOn === null) {
    if (warnings === undefined) {
      throw new ValidationError(
        `"${ctx.filing.title}": Part 2 (factual basis) has no facts recorded and no pure-law decision of counsel is on record. Add at least one Part 2 fact, or record counsel's decision, with its note, that this application pleads no facts, then fill the form again.`
      );
    }
    warnings.push({
      kind: "missing_datum",
      field_or_id: "part2",
      message: `Factual basis (Part 2): no facts are recorded, and counsel has recorded no decision that the application pleads none. Part 2 shows ${NO_FACTUAL_BASIS}.`,
    });
  }

  // An orders-part rhetorical paragraph takes the next order number, as the mockup's Part 1 prints
  // it. The grammar's `orders` entry holds text alone, so its record lines cannot be carried here.
  const liveOrders = interleave(
    fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form").filter((r) => r.crossed_out_on === null),
    fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "orders"),
    (r) => r.filing_ordinal
  ).map((entry, i) => ({ order: i + 1, text: entry.kind === "host" ? entry.item.wording_override ?? entry.item.wording : entry.row.wording }));
  // The grammar requires one order at least; a strict emit leaves an empty list to asm32's refusal.
  if (liveOrders.length === 0 && warnings !== undefined) {
    liveOrders.push({ order: 1, text: NO_ORDERS });
    warnings.push({ kind: "missing_datum", field_or_id: "orders", message: `Orders sought (Part 1): none is deployed to the form. Part 1 shows ${NO_ORDERS}.` });
  }

  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, "form");
  const submissionIds = submissions.map((s) => s.id);
  const submissionFactRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const submissionFactIds = [...new Set(submissionFactRows.map((f) => f.fact_id))];
  const submissionFactStatements = fetchFactStatements(ctx.dbPath, submissionFactIds);
  // No admission-ladder inputs -- this emitter renders no markers, only .statements[].excerpt/.pinpoint.
  const factsBySubmission = groupSubmissionFacts(submissionFactRows, submissionFactStatements, new Set(), new Map());
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));

  // Filing gate (ticket 2026-08-31, decision 5): a filed document may never contain
  // CITATION_MISSING. Checked directly against the typed rows -- they're already in hand -- not
  // by scanning assembled markdown, since this emitter (unlike submissionFormsRender's mockup
  // path) has none to scan against.
  const missingCitationIds = submissions.flatMap((s) =>
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
      warnings.push({ kind: "missing_datum", field_or_id: `statement ${id}`, message: `Statement of law ${id}: its authority has no citation. Part 3 shows ${CITATION_MISSING}.` });
    }
  }

  const materials = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersFromOrderedIds(materials.map((d) => d.document_id));
  const part2Statements = fetchFactStatements(
    ctx.dbPath,
    facts.map((f) => f.id)
  );
  const referencedDocIds = new Set<number>(materials.map((d) => d.document_id));
  for (const f of facts) if (f.court_record !== null) referencedDocIds.add(f.court_record);
  for (const s of [...part2Statements, ...submissionFactStatements]) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);

  const lines: string[] = [];
  lines.push("---");
  const frontmatterFields: [string, string | null][] = [
    // B.C. Reg. 105/2026's Form 32 fixes no hearing date: it prints the applicant's proposal.
    // With none recorded, the template's own leave-blank token: counsel fills it in Word.
    ["proposed_hearing", frontmatterValue(hearing?.proposed_hearing) ?? "[proposed hearing]"],
    ["hearing_place", frontmatterValue(ctx.proceeding.courthouse_address)],
    // The style of proceeding's registry line; asm32 prints it as "<registry> Registry".
    ["registry", frontmatterValue(ctx.proceeding.registry)],
    ["time_estimate", hearing?.time_estimate_minutes != null ? formatTimeEstimate(hearing.time_estimate_minutes) : null],
    ["associate_judge", hearing?.associate_judge == null ? null : hearing.associate_judge === 1 ? "yes" : "no"],
    ["pure_law_confirmed", pureLawOn !== null ? "true" : null],
  ];
  for (const [key, value] of frontmatterFields) {
    if (value !== null) {
      lines.push(`${key}: ${value}`);
    } else if (warnings !== undefined && key !== "pure_law_confirmed") {
      // Lenient: a required key is never omitted, so asm32 always parses the file.
      const name = key.replace(/_/g, " ");
      const missing = MISSING_FRONTMATTER[key] ?? { placeholder: `[${name}]`, message: `${name[0].toUpperCase()}${name.slice(1)}: not recorded. The form shows [${name}].` };
      lines.push(`${key}: ${missing.placeholder}`);
      warnings.push({ kind: "missing_datum", field_or_id: key, message: missing.message });
    }
  }
  lines.push(`orders: ${JSON.stringify(liveOrders)}`);
  // The "To:" line: every party of record but the applicant(s), or the client where no party is
  // marked applicant (the mockup's own fallback). With none, asm32 keeps the Generate context's.
  const anyApplicant = ctx.parties.some((p) => p.is_applicant === 1);
  const toParties = [...ctx.parties]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((p) => (anyApplicant ? p.is_applicant !== 1 : p.is_client !== 1))
    .map((p) => p.name);
  if (toParties.length > 0) lines.push(`to_parties: ${JSON.stringify(toParties)}`);
  lines.push("---");
  lines.push("");

  let n = 0;

  const bodyStart = lines.length;
  lines.push("## Part 2");
  lines.push("");
  if (part2Content === 0 && pureLawOn === null) {
    // Reached only on a lenient emit: Nil. needs counsel's recorded decision, which is missing.
    n += 1;
    lines.push(`${n}. ${NO_FACTUAL_BASIS}`);
  } else if (part2Content === 0) {
    lines.push("Nil.");
  } else {
    // The mockup's Part 2 citation lines (render-notice-of-application.ts), unindented and
    // untraced: the court record's evidence reference, then one line per non-impeachment statement.
    for (const entry of interleave(facts, factsRhetoric, (f) => f.filing_ordinal)) {
      n += 1;
      if (entry.kind === "rhetoric") {
        lines.push(...renderRhetoricFiled(entry.row, n, "", ">> "));
        continue;
      }
      const f = entry.item;
      lines.push(`${n}. ${f.postulate}`);
      if (f.court_record === null) {
        warnings?.push({
          kind: "missing_datum",
          field_or_id: `fact ${f.id}`,
          message: `Fact ${f.id} (Part 2, paragraph ${n}): no court record is linked, so no evidence reference names the document it comes from.`,
        });
      } else {
        const reference = evidenceReference(labelMap.get(f.court_record), f.court_record_pinpoint);
        if (reference !== null) lines.push(`>> ${reference}`);
      }
      for (const stmt of part2Statements) {
        if (stmt.fact_id !== f.id || stmt.purpose === "impeachment") continue;
        const citationLine = factStatementCitationLine(exhibitMap, labelMap, stmt, ">> ");
        if (citationLine) lines.push(citationLine);
      }
    }
  }
  lines.push("");

  lines.push("## Part 3");
  lines.push("");
  // Ticket 2026-08-31: one numbered paragraph per postulate/proposition, never the submission's
  // own contention -- judges read the law's own words, not a lawyer's or an LLM's summary of it.
  // "Nil." covers both no submissions at all and every selected submission having no facts/law.
  // A linked fact already printed in Part 2 is not printed again here: the filed face states each
  // fact once, and the Part 3 numbering runs on from Part 2 without it. A linked fact missing from
  // Part 2 prints in full only on a sent or retired Writing, as it was sent: on a drafting Writing
  // the emitter (forms.ts, refuseUnplacedFacts) refuses before this renders (schema v59).
  const part2FactIds = new Set(facts.map((f) => f.id));
  const part3Facts = (submissionId: number) => (factsBySubmission.get(submissionId) ?? []).filter((f) => !part2FactIds.has(f.factId));
  const submissionsRhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions");
  if (submissionsRhetoric.length === 0 && submissions.every((s) => part3Facts(s.id).length === 0 && (lawBySubmission.get(s.id) ?? []).length === 0)) {
    lines.push("Nil.");
  } else {
    // Ticket 2026-09-01: same dedup as the mockup renderers -- a law assertion shared by two
    // submissions renders in full once, then as a numbered cross-reference paragraph, keeping
    // mockup and filed-face numbering aligned. Backward paragraph references are grammar-legal.
    const renderedLawAssertions = new Map<number, number>();
    for (const entry of interleave(submissions, submissionsRhetoric, (s) => s.filing_ordinal)) {
      if (entry.kind === "rhetoric") {
        n += 1;
        lines.push(...renderRhetoricFiled(entry.row, n, "", ">> "));
        continue;
      }
      const s = entry.item;
      for (const f of part3Facts(s.id)) {
        n += 1;
        lines.push(`${n}. ${f.postulate}`);
        for (const stmt of f.statements) {
          if (stmt.purpose === "impeachment") continue;
          pushExcerptBlockquote(lines, stmt.exhibit_id !== null ? stmt.exhibit_excerpt : stmt.excerpt, factStatementCitationLine(exhibitMap, labelMap, stmt, ">> "));
        }
      }
      for (const la of lawBySubmission.get(s.id) ?? []) {
        const priorPara = renderedLawAssertions.get(la.lawAssertionId);
        n += 1;
        if (priorPara !== undefined) {
          lines.push(`${n}. As set out in paragraph ${priorPara}, above, ${la.proposition}`);
          continue;
        }
        renderedLawAssertions.set(la.lawAssertionId, n);
        lines.push(`${n}. ${la.proposition}`);
        for (const stmt of la.statements.filter(passesBriefOnlyCap)) {
          pushExcerptBlockquote(lines, stmt.excerpt, lawStatementCitationLine(stmt));
        }
      }
    }
  }
  lines.push("");

  lines.push("## Part 4");
  lines.push("");
  const affidavitFields = fetchAffidavitFields(ctx.dbPath, materials.map((d) => d.document_id));
  materials.forEach((d) => {
    const a = affidavitFields.get(d.document_id);
    if (d.role === "affidavit" || a?.instrument === "affidavit") lines.push(`- ${affidavitLine(d, a)}`);
    else lines.push(`- ${d.label}${materialDateSuffix(d.label, d.document_date)}`);
  });
  // The pleadings line always prints, so Part 4 is never empty and never "Nil.". The other
  // standard line, "Such further affidavits ... as this honourable court may allow", identifies no
  // document, which Form 32's Part 4 instruction requires of each entry, so the filed face drops it.
  lines.push(`- ${STANDARD_MATERIAL_LINES[0]}`);

  // Spec 2026-10-09, §4.2: every authority name in Parts 2-4 is italic, quotations and citations included.
  const names = authorityNamePattern(ctx.dbPath, ctx.filing.proceeding_id);
  if (names !== null) for (let i = bodyStart; i < lines.length; i++) lines[i] = italicizeNames(lines[i], names);

  return lines.join("\n").trimEnd() + "\n";
}
