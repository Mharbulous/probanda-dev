// BCCA respondent's factum renderer (build ticket #648; ownership #438; part contents
// planning/bcca-appeal-books-inputs/research-findings-647.md §1, §5 and research-findings-439.md
// §2). The seventh /draft filing kind. Parts follow the court's
// tpl_factum_respondent.dotx in order and heading text: cover, table of contents, chronology,
// opening statement (not paragraph-numbered), Parts 1-4 (numbered consecutively from Part 1),
// appendices: list of authorities (alphabetical, page # and para # columns), appendices:
// enactments (acts and regulations only).
//
// Like the stay response, the factum IS the substantive venue document: pointer rows read
// document='form' and forms.ts appends no Written Arguments companion. The filed face is not a
// strip of this mockup -- it is emit-bcca-factum.ts's bcca-factum.md, filled into the court's
// .dotx by /publish with publish-bcca-factum. Both number paragraphs the same way (the template numbers
// "The respondent seeks an Order:" and "All of which is respectfully submitted." too, but not
// the order wording between them), so para # references agree.

import { BRIEF_ONLY_CAP_SQL } from "./brief-only-cap.js";
import {
  bccaCoverPage,
  buildLowerCourtRoleByRole,
  formatNameList,
  groupPartiesByRole,
  pluralizeRole,
  type BccaCoverPageContact,
  type CaptionParty,
} from "./components.js";
import { gapMarker, mockupMessage, rebuttalMarker } from "./markers.js";
import { recordCriterionGlyphs } from "./proposal-inventory.js";
import { captionHeadingFor, opposingPartyIds } from "./query.js";
import { exhibitNumbersFromOrderedIds, fetchDocumentLabels, fetchFilingDocuments, fetchNotBestCopyMarkers } from "./exhibit-documents.js";
import { fetchFactAdmissionAnnotations } from "./admission-annotations.js";
import { fetchFactStatements, fetchSubmissionFacts, fetchSubmissionLaw, fetchSubmissions } from "./submission-reads.js";
import { fetchOpposingPoints } from "./opposing-points.js";
import { fetchOrdersSought } from "./orders-sought.js";
import { groupSubmissionFacts, groupSubmissionLaw } from "./submission-groups.js";
import { orderReviewMarkerFor } from "./review-state.js";
import { recordParagraph, renderSubmissionParagraphs } from "./submission-paragraphs.js";
import type { RenderContext } from "./render-context.js";
import { recordContactGaps, renderFactParagraphsWithRhetoric } from "./render-bcca-stay-response.js";
import { fetchRhetoric, interleave, renderRhetoricLine } from "./render-rhetoric.js";
import { factsPart, fetchFacts } from "./filing-facts.js";
import { filingFrontmatter } from "./filing-frontmatter.js";
import { rows } from "../query-rows.js";

/** Prints a section's whole 🧩 line and records it as an open item keyed on its field (#1226). */
function pushGap(ctx: RenderContext, lines: string[], line: string, field: number, item: string): void {
  recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "form_fields", id: field, item });
  lines.push(line);
}

/** Rough layout constant for the mockup's page budget only (Arial 12, 1.5 spacing, 2.5 cm
 * margins). Never used to refuse -- Word's own layout is the only real page count. */
const WORDS_PER_PAGE = 300;
const PARTS_PAGE_LIMIT = 30;
const OPENING_STATEMENT_PAGE_LIMIT = 1;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-28" -> "July 28, 2026", the template chronology example's own date style. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** A BCSC material line's date: ", dated July 8, 2026", the form's long style, never the stored
 * ISO date; nothing when there is no date or the label already names it in either style. The
 * Notice of Application's Part 4, the Application Response's Part 6 and the Form 32 and Form 33
 * emits share it (spec 2026-10-09, material relied on write path). */
export function materialDateSuffix(label: string, documentDate: string | null): string {
  if (!documentDate) return "";
  const long = longDate(documentDate);
  return label.includes(long) || label.includes(documentDate) ? "" : `, dated ${long}`;
}

export interface ChronologyRow {
  event_date: string;
  event: string;
}

export function fetchChronology(dbPath: string, filingId: number): ChronologyRow[] {
  return rows<ChronologyRow>(dbPath, "SELECT event_date, event FROM filing_chronology WHERE filing_id = ? ORDER BY ordinal", [filingId]);
}

export type ProseSlot = "opening_statement" | "facts_position" | "signing_place";

/** filing_prose (schema v22), one block per slot. Paragraphs are separated by blank lines. */
export function fetchProseParagraphs(dbPath: string, filingId: number): Map<ProseSlot, string[]> {
  const found = rows<{ slot: ProseSlot; text: string }>(dbPath, "SELECT slot, text FROM filing_prose WHERE filing_id = ?", [filingId]);
  return new Map(
    found.map((r) => [
      r.slot,
      r.text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p !== ""),
    ])
  );
}

export interface FactumAuthority {
  /** Keys the list's citation 🧩 (#1226); the emitter drops it from its JSON. */
  authority_id: number;
  authority: string;
  citation: string | null;
  paras: number[];
}

interface CitedStatementRow {
  law_assertion_id: number;
  authority_id: number;
  title: string;
  citation: string | null;
  kind: string;
  pinpoint: string | null;
  excerpt: string | null;
}

/** Verified, non-killed, non-overruled authorities behind the law assertions rendered in
 * Part 3 -- the same brief-only filter renderSubmissionParagraphs applies before it prints a
 * statement. The overruled clause is #842's: without it the factum's List of Authorities, its
 * Book of Authorities and its Enactments appendix would name an authority Part 3 never cites.
 * The cap itself is BRIEF_ONLY_CAP_SQL (brief-only-cap.ts). */
function fetchCitedStatements(dbPath: string, lawAssertionIds: number[]): CitedStatementRow[] {
  if (lawAssertionIds.length === 0) return [];
  const placeholders = lawAssertionIds.map(() => "?").join(",");
  return rows<CitedStatementRow>(
    dbPath,
    `SELECT sl.law_assertion_id, a.id AS authority_id, a.style_of_cause_or_title AS title, a.citation, a.kind, sl.pinpoint, sl.excerpt
     FROM statements_of_law sl
     JOIN authorities a ON a.id = sl.authority_id
     WHERE sl.law_assertion_id IN (${placeholders})
       AND ${BRIEF_ONLY_CAP_SQL}
     ORDER BY sl.id`,
    lawAssertionIds
  );
}

/** Appendix: List of Authorities -- alphabetical, each with the numbered paragraphs whose law
 * assertion it supports. lawParas maps law_assertion_id -> the paragraph it rendered in full.
 * Shared by this mockup and the emitter so both list the same authorities and paragraphs. */
export function factumAuthorities(dbPath: string, lawParas: Map<number, number>): FactumAuthority[] {
  const byAuthority = new Map<number, FactumAuthority>();
  for (const s of fetchCitedStatements(dbPath, [...lawParas.keys()])) {
    const entry = byAuthority.get(s.authority_id) ?? { authority_id: s.authority_id, authority: s.title, citation: s.citation, paras: [] };
    const para = lawParas.get(s.law_assertion_id) as number;
    if (!entry.paras.includes(para)) entry.paras.push(para);
    byAuthority.set(s.authority_id, entry);
  }
  return [...byAuthority.values()]
    .map((a) => ({ ...a, paras: a.paras.sort((x, y) => x - y) }))
    .sort((x, y) => x.authority.localeCompare(y.authority, "en", { sensitivity: "base" }));
}

/** Every law assertion deployed to the factum's own submissions, once each, in deployment
 * order. emit-bcca-factum.ts builds the identical set inline while it numbers Part 3 (it needs
 * each assertion's paragraph); this gathers it without rendering anything. */
function factumLawAssertionIds(dbPath: string, filingId: number): number[] {
  const submissions = fetchSubmissions(dbPath, filingId, "form");
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(dbPath, submissions.map((s) => s.id)));
  const ids: number[] = [];
  for (const s of submissions) {
    for (const la of lawBySubmission.get(s.id) ?? []) {
      if (!ids.includes(la.lawAssertionId)) ids.push(la.lawAssertionId);
    }
  }
  return ids;
}

/** The authority kinds a factum's Book of Authorities reproduces (#813).
 *
 * 'case' and 'doctrine' carry an express duty: R. 27(1)(a), (2)(a), (4) of BC Reg 120/2022 with
 * the registrar's Book of Authorities completion instructions, which describe a book's contents
 * as "authorities (case law, legal texts etc.) referred to in a party's factum".
 *
 * 'statute' and 'regulation' are here by the practitioner's decision of 2026-09-22, NOT by any
 * requirement -- no source imposes, permits or forbids them, and the definitional route is
 * exhausted (R. 27(1) turns on "authority"; R. 1(1) does not define it; R. 1(2) routes to the
 * Court of Appeal Act, SBC 2021, c 6, whose s. 1 does not define it either). 'rule' is excluded
 * by the same decision, and is omitted from the book outright rather than listed without a part.
 * Either choice could be reversed without contradicting any authority; neither may be described
 * as required by the Rules. The audit behind all of this is persisted at
 * planning/bcca-appeal-books-inputs/2026-09-22 law-librarian answer (Book of Authorities content
 * by kind, R 27).md. */
const BOOK_AUTHORITY_KINDS = new Set(["case", "doctrine", "statute", "regulation"]);

/** The authorities a bcca_factum filing's Book of Authorities reproduces -- the factum's own
 * Appendix: List of Authorities narrowed to BOOK_AUTHORITY_KINDS, in the same citation text and
 * the same alphabetical order. Expressed through factumAuthorities so the book and the appendix
 * can never drift on anything but the kind filter. An excluded authority still appears on the
 * factum's List of Authorities; only the book omits it (#731, #813). */
export function factumBookAuthorities(dbPath: string, filingId: number): { authority: string; citation: string | null }[] {
  const lawParas = new Map(factumLawAssertionIds(dbPath, filingId).map((id) => [id, 0]));
  const key = (title: string, citation: string | null) => `${title}\0${citation ?? ""}`;
  const kinds = new Map<string, string>();
  for (const s of fetchCitedStatements(dbPath, [...lawParas.keys()])) kinds.set(key(s.title, s.citation), s.kind);
  return factumAuthorities(dbPath, lawParas)
    .filter((a) => BOOK_AUTHORITY_KINDS.has(kinds.get(key(a.authority, a.citation)) ?? ""))
    .map(({ authority, citation }) => ({ authority, citation }));
}

export interface FactumEnactment {
  /** Keys the appendix's excerpt 🧩 (#1226); the emitter drops it from its JSON. */
  authority_id: number;
  title: string;
  citation: string | null;
  excerpts: { pinpoint: string | null; text: string }[];
}

/** Appendix: Enactments -- excerpts of cited authorities recorded as 'statute' or 'regulation'
 * (template Enactments step 1: acts or regulations only). 'rule' authorities are returned
 * separately: whether one belongs here is the practitioner's call, so the mockup lists them
 * and the filed face leaves them out. */
export function factumEnactments(dbPath: string, lawParas: Map<number, number>): { enactments: FactumEnactment[]; rules: string[] } {
  const enactments = new Map<number, FactumEnactment>();
  const rules = new Map<number, string>();
  for (const s of fetchCitedStatements(dbPath, [...lawParas.keys()])) {
    if (s.kind === "rule") {
      rules.set(s.authority_id, `${s.title}${s.citation ? `, ${s.citation}` : ""}`);
      continue;
    }
    if (s.kind !== "statute" && s.kind !== "regulation") continue;
    const entry = enactments.get(s.authority_id) ?? { authority_id: s.authority_id, title: s.title, citation: s.citation, excerpts: [] };
    if (s.excerpt && !entry.excerpts.some((e) => e.text === s.excerpt && e.pinpoint === s.pinpoint)) {
      entry.excerpts.push({ pinpoint: s.pinpoint, text: s.excerpt });
    }
    enactments.set(s.authority_id, entry);
  }
  return {
    enactments: [...enactments.values()].sort((x, y) => x.title.localeCompare(y.title, "en", { sensitivity: "base" })),
    rules: [...rules.values()],
  };
}

/** The client's role group, pluralized ("Respondents"), and the name that authorizes filing
 * (R. 79(4)(b)): counsel's name if recorded, else the client party's own. */
export function factumSigner(ctx: RenderContext): { roleLabel: string | null; name: string | null; line: string | null } {
  const client = ctx.parties.find((p) => p.is_client === 1);
  if (!client) return { roleLabel: null, name: null, line: null };
  const group = groupPartiesByRole(ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }))).find((g) => g.role === client.role);
  const roleLabel = pluralizeRole(client.role, group?.names.length ?? 1);
  return client.counsel_name
    ? { roleLabel, name: client.counsel_name, line: `Counsel for the ${roleLabel}` }
    : { roleLabel, name: client.name, line: roleLabel };
}

/** The cover's short label, e.g. "Respondents' Factum". */
export function factumRecordLabel(roleLabel: string | null): string {
  const role = roleLabel ?? "Respondent";
  return `${role}${role.endsWith("s") ? "'" : "'s"} Factum`;
}

function wordCount(lines: string[]): number {
  return lines
    .join(" ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function pageBudgetLine(label: string, words: number, limit: number, limitNote: string): string {
  const pages = Math.max(1, Math.ceil(words / WORDS_PER_PAGE));
  const over = words > limit * WORDS_PER_PAGE;
  return `- ${label}: ${words} words, about ${pages} page${pages === 1 ? "" : "s"} of the ${limit}-page limit.${over ? ` **Over the limit** -- ${limitNote}` : ""}`;
}

export function renderBccaFactum(ctx: RenderContext): string {
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const client = ctx.parties.find((p) => p.is_client === 1);
  const roleGroups = groupPartiesByRole(captionParties);
  const clientGroup = client ? roleGroups.find((g) => g.role === client.role) : undefined;
  const signer = factumSigner(ctx);
  const prose = fetchProseParagraphs(ctx.dbPath, ctx.filing.id);

  const facts = fetchFacts(ctx.dbPath, ctx.filing.id, factsPart("bcca_factum"));
  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, "form");
  const submissionIds = submissions.map((s) => s.id);
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));
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
  for (const s of submissionFactStatements) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const orders = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  const points = fetchOpposingPoints(ctx.dbPath, ctx.proceeding.id);

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
  const title = factumRecordLabel(signer.roleLabel);

  const lines: string[] = [];
  lines.push(filingFrontmatter(ctx.proceeding, ctx, "Factum"));
  lines.push("");
  lines.push(
    bccaCoverPage(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      recordLabel: title,
      titleLine: title.toUpperCase(),
      filingPartyPhrase: clientGroup ? formatNameList(clientGroup.names) : null,
      onAppealFrom: {
        judge: ctx.proceeding.under_appeal_judge,
        court: ctx.proceeding.under_appeal_court,
        pronounced: ctx.proceeding.under_appeal_pronounced,
      },
      accessRestrictions: ctx.proceeding.access_restrictions,
      lowerCourtRoleByRole: buildLowerCourtRoleByRole(ctx.parties),
      contacts,
      gapMarker: gapMarker("gap"),
    })
  );
  recordContactGaps(ctx.inventory, contacts);
  lines.push("");
  lines.push(
    "<!-- Respondent's factum per tpl_factum_respondent.dotx and the factum completion instructions (R. 25(4)): " +
      "Arial 12, 1.5 spacing, single space between paragraphs, margins >= 2.5 cm, pages numbered from the cover. " +
      "No wet signature -- the name of the person authorizing filing is enough (R. 79(4)). -->"
  );
  lines.push("");

  lines.push("## TABLE OF CONTENTS");
  lines.push("");
  lines.push("<!-- Word builds this from the headings; page numbers fill when the assembled document's fields update. -->");
  lines.push("");
  for (const heading of [
    "CHRONOLOGY",
    "OPENING STATEMENT",
    "PART 1 - STATEMENT OF FACTS",
    "PART 2 - ISSUES ON APPEAL",
    "PART 3 - ARGUMENT",
    "PART 4 - NATURE OF ORDER SOUGHT",
    "APPENDICES: LIST OF AUTHORITIES",
    "APPENDICES: ENACTMENTS",
  ]) {
    lines.push(`- ${heading}`);
  }
  lines.push("");

  lines.push("## CHRONOLOGY");
  lines.push("");
  const chronology = fetchChronology(ctx.dbPath, ctx.filing.id);
  if (chronology.length === 0) {
    pushGap(ctx, lines, mockupMessage(gapMarker("gap"), "No chronology events recorded."), 0, "Chronology");
  } else {
    lines.push("| Date | Event |");
    lines.push("| :--- | :--- |");
    chronology.forEach((c) => lines.push(`| ${longDate(c.event_date)} | ${c.event} |`));
  }
  lines.push("");

  lines.push("## OPENING STATEMENT");
  lines.push("");
  const opening = prose.get("opening_statement") ?? [];
  if (opening.length === 0) {
    pushGap(ctx, lines, mockupMessage(gapMarker("gap"), "No opening statement recorded."), 1, "Opening statement");
  } else {
    opening.forEach((p) => {
      lines.push(p);
      lines.push("");
    });
  }
  lines.push("");

  let para = 0;
  const partsStart = lines.length;
  lines.push("## PART 1 - STATEMENT OF FACTS");
  lines.push("");
  const factsPosition = prose.get("facts_position") ?? [];
  if (factsPosition.length === 0) {
    pushGap(ctx, lines, mockupMessage(gapMarker("gap"), "No position on the appellants' statement of facts recorded."), 2, "Position on the appellants' statement of facts");
  }
  factsPosition.forEach((p) => {
    para += 1;
    lines.push(`${para}. ${p}`);
  });
  const factResult = renderFactParagraphsWithRhetoric(ctx, facts, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "facts"), para, copyMarkers, admittedFactIds, spentGlyphByFact, suppressedFactIds);
  lines.push(...factResult.lines);
  para = factResult.nextPara;
  lines.push("");

  lines.push("## PART 2 - ISSUES ON APPEAL");
  lines.push("");
  if (submissions.length === 0) {
    pushGap(ctx, lines, mockupMessage(gapMarker("gap"), "No submissions deployed to this factum."), 3, "Submissions");
  }
  submissions.forEach((s) => {
    para += 1;
    const answers = points.filter((pt) => pt.answered_by_submission_id === s.id).map((pt) => pt.component);
    lines.push(`${para}. ${s.contention}${answers.length > 0 ? ` <!-- answers: ${answers.join("; ")} -->` : ""}`);
  });
  lines.push("");
  const unanswered = points.filter((pt) => pt.answered_by_submission_id === null);
  if (unanswered.length > 0) {
    lines.push("#### Points not yet answered");
    lines.push("");
    unanswered.forEach((pt) => {
      lines.push(`- ${pt.component}${pt.pinpoint ? ` (${pt.pinpoint})` : ""}: ${pt.verbatim_words ?? ""} ${rebuttalMarker(null)} <!-- opposing_point ${pt.id} -->`);
    });
    lines.push("");
  }

  lines.push("## PART 3 - ARGUMENT");
  lines.push("");
  const renderedLawAssertions = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      para += 1;
      lines.push("", ...renderRhetoricLine(ctx, entry.row, para, ""), "");
      continue;
    }
    const s = entry.item;
    recordParagraph(ctx, s.id, "form", para);
    // Site 18: the shared submission body's own sites 1-5 record through the opts inventory.
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

  lines.push("## PART 4 - NATURE OF ORDER SOUGHT");
  lines.push("");
  // The order wording is unnumbered, so an orders-part rhetorical paragraph prints as its own
  // numbered paragraph before the lead-in, in ordinal order (emit-bcca-factum.ts does the same).
  for (const row of fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "orders")) {
    para += 1;
    lines.push(...renderRhetoricLine(ctx, row, para, ""), "");
  }
  para += 1;
  const seeks = signer.roleLabel && signer.roleLabel.endsWith("s") ? "seek" : "seeks";
  lines.push(`${para}. The ${(signer.roleLabel ?? "respondent").toLowerCase()} ${seeks} an Order:`);
  lines.push("");
  const liveOrders = orders.filter((o) => o.crossed_out_on === null);
  orders.forEach((o) => {
    const wording = o.wording_override ?? o.wording;
    if (o.crossed_out_on !== null) {
      lines.push(`~~${wording}~~ <!-- order_sought_id ${o.id} -->`);
    } else {
      const review = orderReviewMarkerFor(ctx.review, ctx.inventory, "", o);
      lines.push(`${wording}${review ? ` ${review}` : ""} <!-- order_sought_id ${o.id} -->`);
    }
    lines.push("");
  });
  if (liveOrders.length === 0) {
    pushGap(ctx, lines, mockupMessage(gapMarker("gap"), "No order sought recorded. The order must include a costs disposition."), 4, "Order sought");
    lines.push("");
  }
  para += 1;
  lines.push(`${para}. All of which is respectfully submitted.`);
  const partsEnd = lines.length;
  lines.push("");
  const place = (prose.get("signing_place") ?? []).join(" ");
  const signingPlace = place || gapMarker("gap");
  const signerName = signer.name ?? gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, signingPlace, ["🧩"], { table: "form_fields", id: 5, item: "Place of signing" });
  recordCriterionGlyphs(ctx.inventory, signerName, ["🧩"], { table: "form_fields", id: 6, item: "Name authorizing filing" });
  lines.push(`Dated at the City of ${signingPlace}, Province of British Columbia, this [month] [day] of [year]. <!-- date supplied when the factum is assembled -->`);
  lines.push("");
  lines.push(signerName);
  lines.push(signer.line ?? "");
  lines.push("");

  lines.push("## APPENDICES: LIST OF AUTHORITIES");
  lines.push("");
  const authorities = factumAuthorities(ctx.dbPath, renderedLawAssertions);
  if (authorities.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Authorities | Page # in factum | Para # in factum |");
    lines.push("| :--- | :---: | :---: |");
    authorities.forEach((a) => {
      const citation = a.citation ?? gapMarker("gap");
      recordCriterionGlyphs(ctx.inventory, citation, ["🧩"], { table: "authority_citations", id: a.authority_id, item: `${a.authority}: citation` });
      lines.push(`| ${a.authority}, ${citation} | (fills in Word) | ${a.paras.join(", ")} |`);
    });
  }
  lines.push("");

  lines.push("## APPENDICES: ENACTMENTS");
  lines.push("");
  const { enactments, rules } = factumEnactments(ctx.dbPath, renderedLawAssertions);
  if (enactments.length === 0) {
    lines.push("None.");
    lines.push("");
  }
  enactments.forEach((e) => {
    lines.push(`**${e.title}**${e.citation ? `, ${e.citation}` : ""}`);
    lines.push("");
    if (e.excerpts.length === 0) {
      const line = mockupMessage(gapMarker("gap"), "No excerpt recorded for this enactment.");
      recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "enactment_excerpts", id: e.authority_id, item: `${e.title}: excerpt` });
      lines.push(line);
      lines.push("");
    }
    e.excerpts.forEach((x) => {
      for (const l of x.text.split("\n")) if (l.trim() !== "") lines.push(`> ${l}`);
      if (x.pinpoint) lines.push(`> (${x.pinpoint})`);
      lines.push("");
    });
  });
  if (rules.length > 0) {
    lines.push("#### Court rules not in this appendix");
    lines.push("");
    lines.push("These authorities are recorded as rules. The appendix takes acts and regulations only, so they are left out of the filed factum, and they are left out of the Book of Authorities too, unless recorded as a regulation. They stay on the Appendix: List of Authorities either way.");
    lines.push("");
    rules.forEach((r) => lines.push(`- ${r}`));
    lines.push("");
  }

  lines.push("## Page budget");
  lines.push("");
  lines.push(`Estimated at ${WORDS_PER_PAGE} words a page. Confirm in Word once the factum is assembled.`);
  lines.push("");
  lines.push(pageBudgetLine("Opening Statement", wordCount(opening), OPENING_STATEMENT_PAGE_LIMIT, "the opening statement is limited to one page."));
  lines.push(
    pageBudgetLine(
      "Parts 1-4",
      wordCount(lines.slice(partsStart, partsEnd)),
      PARTS_PAGE_LIMIT,
      "Parts 1-4 are limited to 30 pages; more pages need an order under R. 48(1)(f)."
    )
  );

  return lines.join("\n").trimEnd() + "\n";
}
