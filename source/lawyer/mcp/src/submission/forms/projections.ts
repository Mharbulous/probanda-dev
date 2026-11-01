// The general renderer's projections (shared/declared-layout.md section 4; spec §6 piece 3).
//
// A general type's part names its content by `source`: a projection, which prints Writing
// content the runtime already holds; `slot:<name>`, the Writing's own free text; or `literal`,
// the part's fixed sentence. validateTypeBlock owns membership of the closed vocabulary. This
// module owns what each member prints. A member not yet built is registered with the phase or
// reason that holds it back, and Writing creation refuses a layout that declares one
// (`projection_not_built`), so no stored layout reaches the renderer with a part it cannot print.
//
// Free text lives in filing_prose (schema v33): a `slot:<name>` part reads the row whose slot is
// <name>, and `addressee` and `sender` read the rows 'addressee' and 'sender'. A slot with no
// row, and a DB-backed projection with no rows, prints a whole mockup-only message line and joins
// ProjectionState.unwritten, which the filed render refuses on (forms.ts).

import { DataServerError } from "../../errors.js";
import { readFirmProfile } from "../../tools/practice/firm-profile.js";
import { submissionDataQuery } from "../backend.js";
import { CITATION_MISSING, lawStatementCitationLine, lawStatementMarkers, scrutinyFailedTag } from "./law-statement-line.js";
import { clauseMarkers, dedupeLineMarkers, gapMarker, printMarkerSets, unservedPetitumMarker, type ClauseRow } from "./markers.js";
import { lawItem, recordCriterionGlyphs, recordGlyphs, recordJurisdictionLadder } from "./proposal-inventory.js";
import {
  exhibitNumbersForFiling,
  fetchDocumentLabels,
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
import { captionHeadingFor, clientParty, fetchFilingLaw, opposingPartyIds, type FilingLawRow } from "./query.js";
import { BLANK_UNDERLINE, pluralizeRole, styleOfProceedingCaption } from "./components.js";
import { formatFlag, proseFormatRules, REFUSED_FORMAT_RULES } from "./prose-format.js";
import { hasTable } from "../schema-capabilities.js";

/** One entry of a general type's `parts` (shared/declared-layout.md section 3). */
export interface LayoutPart {
  heading: string | null;
  heading_numbering: "none" | "part-roman" | "part-arabic" | "letter";
  paragraph_numbering: "none" | "restart" | "continue";
  source: string;
  text?: string;
  rule_ref?: string;
}

export interface ProjectionState {
  /** The last paragraph number printed, which a `continue` part carries on from. */
  paragraph: number;
  /** The Writing's filing_prose rows, by slot. */
  prose: Map<string, { id: number; text: string }>;
  /** Who signs, from the stored layout's `signer` (`lawyer` by default). */
  signer: "lawyer" | "party";
  /** True when the stored layout declares `letterhead: true`, which lets a lawyer's block print the roster closing. */
  letterhead: boolean;
  /** Each part printed with no content, by name, in block order. */
  unwritten: string[];
  /** The index in the stored layout's `parts` of the part being printed, which keys its 🧩 gap line. */
  part: number;
  /** Each `terms` line tagged `[currency: ...]`, in print order, which the filed render refuses on. */
  currency_withheld: CurrencyWithheld[];
  /** Each prose line breaking a refused format rule (prose-format.ts), in print order, which the
   * filed render refuses on. */
  prose_format: ProseFormatHit[];
}

/** A prose line breaking a refused format rule: its slot, the refused rules, and the line. */
export interface ProseFormatHit {
  slot: string;
  rules: string[];
  line: string;
}

/** An implied clause naming the enactment its cited statement rests on, whose stored
 * statute-currency result is not `current` (null: never checked). `provision` is the cited
 * pinpoint when the result is that provision's, and null when it is the instrument's own or the
 * statement has no pinpoint. */
export interface CurrencyWithheld {
  clause_id: number;
  currency_status: string | null;
  provision: string | null;
}

/** The `[currency: ...]` tag's text: the instrument's result, or the provision and its result. */
export function currencyLabel(w: CurrencyWithheld): string {
  const status = w.currency_status ?? "unchecked";
  return w.provision === null ? status : `${w.provision} ${status}`;
}

/** Lines without the part's heading. */
export type Projection = (ctx: RenderContext, part: LayoutPart, state: ProjectionState) => string[];

/** A blank signing space. */
export const SIGNING_SPACE = "________________________________";
/** A whole mockup-only 🧩 line, the marker and a blank underline with `what` in a comment (plan
 * 2026-10-07, Q2: `🧩 ________ <!-- signer not chosen -->`), which filed-face.ts drops whole. It is
 * recorded as an open-items entry (#1213) whose item is `what`, so the Milestone still names the gap.
 * Keyed on the part, not the filing: the Work Board merges entries sharing a marker, table and id,
 * and a part prints at most one gap line, so each gap stays its own item. A gap printed outside
 * every part passes its own `row` (render-general.ts's `recipients` gap, #1234). */
export function gap(ctx: RenderContext, state: ProjectionState, what: string, row = { table: "layout_parts", id: state.part }): string {
  const line = `${gapMarker("gap")} ${BLANK_UNDERLINE} <!-- ${what} -->`;
  recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { ...row, item: what });
  return line;
}

/** The whole mockup-only line a slot with no text prints, recorded as unwritten. */
function notWritten(ctx: RenderContext, name: string, state: ProjectionState): string {
  state.unwritten.push(name);
  return gap(ctx, state, `${name} not written`);
}

/** The whole mockup-only line a DB-backed projection with no rows prints, recorded as unwritten. */
function empty(ctx: RenderContext, source: string, state: ProjectionState): string {
  state.unwritten.push(source);
  return gap(ctx, state, `${source} empty`);
}

/** Paragraphs separated by one blank line. */
function spaced(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p, i) => (i === 0 ? [p] : ["", p]));
}

/** A prose slot's 🧐 (work-markers.md row 🧐): the row is reviewed whole, so the glyph is printed
 * once, after the last of the lines it prints. */
function withReview(ctx: RenderContext, name: string, id: number, lines: string[]): string[] {
  const review = reviewMarkerFor(ctx.review, ctx.inventory, "", "filing_prose", id, name);
  return review ? [...lines.slice(0, -1), `${lines[lines.length - 1]} ${review}`] : lines;
}

/** The prose format check (prose-format.ts) on a prose row's lines as written: a line breaking a
 * rule gets the flag after it, recorded as an open-items entry on the row, and a refused rule's line
 * joins ProjectionState.prose_format. */
function checkFormat(ctx: RenderContext, name: string, id: number, lines: string[], state: ProjectionState): string[] {
  return lines.map((line) => {
    const rules = proseFormatRules(line);
    if (rules.length === 0) return line;
    const flag = formatFlag(rules);
    recordCriterionGlyphs(ctx.inventory, flag, ["🧩"], { table: "filing_prose", id, item: `${name} format: ${rules.join(", ")}` });
    const refused = rules.filter((r) => REFUSED_FORMAT_RULES.has(r));
    if (refused.length > 0) state.prose_format.push({ slot: name, rules: refused, line: line.trim() });
    return `${line}${flag}`;
  });
}

/** The Writing's own lines, printed as written and never numbered. */
function ownLines(slot: string): Projection {
  return (ctx, _part, state) => {
    const row = state.prose.get(slot);
    return row === undefined || row.text.trim() === ""
      ? [notWritten(ctx, slot, state)]
      : withReview(ctx, slot, row.id, checkFormat(ctx, slot, row.id, row.text.trim().split(/\r?\n/), state));
  };
}

/** The comment that ends a prose paragraph standing for one statement of law the Writing cites
 * (filing_law): a research memo's item (shared/research-memo-template.md). */
const STATEMENT_REF = /\s*<!-- statement_of_law_id (\d+) -->\s*$/;

/** An item paragraph's lines after its summary: the statement's verbatim excerpt as a block quote,
 * then its citation line with the statement-line markers and the id comment, so a paragraph number
 * names one stored row. The markers are not recorded here: the header's "Authorities cited" line
 * records each linked statement once (render-general.ts). A statement the Writing does not cite
 * prints a gap line instead. */
function itemLines(ctx: RenderContext, state: ProjectionState, id: number, law: Map<number, FilingLawRow>): string {
  const row = law.get(id);
  if (row === undefined) return gap(ctx, state, `statement_of_law ${id} is not cited by this Writing`);
  const quote = (row.excerpt ?? "").trim() === "" ? [] : [...row.excerpt!.trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd()), ">"];
  const cite = [lawStatementCitationLine(row) ?? `> ${CITATION_MISSING}`, lawStatementMarkers(row), `<!-- statement_of_law_id ${id} -->`].filter(Boolean).join(" ");
  return [...quote, cite].join("\n");
}

function slot(ctx: RenderContext, name: string, part: LayoutPart, state: ProjectionState): string[] {
  const row = state.prose.get(name);
  if (row === undefined || row.text.trim() === "") return [notWritten(ctx, name, state)];
  let law: Map<number, FilingLawRow> | null = null;
  const paragraphs = row.text
    .trim()
    .split(/\r?\n[ \t]*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => {
      const ref = STATEMENT_REF.exec(p);
      const text = checkFormat(ctx, name, row.id, (ref ? p.slice(0, ref.index) : p).split(/\r?\n/), state).join("\n");
      if (!ref) return text;
      law ??= new Map(fetchFilingLaw(ctx.dbPath, ctx.filing.id).map((r) => [r.statement_id, r]));
      return `${text}\n\n${itemLines(ctx, state, Number(ref[1]), law)}`;
    });
  if (part.paragraph_numbering === "none") return spaced(withReview(ctx, name, row.id, paragraphs));
  let n = part.paragraph_numbering === "restart" ? 0 : state.paragraph;
  const numbered = paragraphs.map((p) => `${++n}. ${p}`);
  state.paragraph = n;
  return spaced(withReview(ctx, name, row.id, numbered));
}

/** The caption (shared/declared-layout.md section 8): the stored venue block's heading rows, the
 * proceeding's registry and file number, and the parties by role. No title row: the title prints as
 * the document's own heading. Writing creation refuses a caption part under _NoVenue, which has no
 * venue block. */
const caption: Projection = (ctx) =>
  styleOfProceedingCaption(
    ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal })),
    { heading: captionHeadingFor(ctx.filing, ctx.proceeding), registry: ctx.proceeding.registry, fileNumber: ctx.proceeding.file_number }
  ).split("\n");

const parties: Projection = (ctx, _part, state) =>
  ctx.parties.length === 0 ? [empty(ctx, "parties", state)] : ctx.parties.map((p) => `${p.name}, ${p.role}`);

/** The orders asked for, as the lettered list the Written Arguments prints, with the same markers.
 * Empty when no order is live; crossed-out orders print on the mockup only. An orders-part
 * rhetorical paragraph prints as its own numbered paragraph just before the list, in ordinal order,
 * numbered as a legal-basis part numbers its paragraphs. */
const ordersSought: Projection = (ctx, part, state) => {
  const rhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "orders");
  let n = part.paragraph_numbering === "continue" ? state.paragraph : 0;
  const before = rhetoric.flatMap((row) => [...renderRhetoricLine(ctx, row, ++n, ""), ""]);
  if (rhetoric.length > 0 && part.paragraph_numbering !== "none") state.paragraph = n;
  const relief = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const lines = relief
    .filter((r) => r.crossed_out_on === null)
    .map((r, i) => {
      const wording = r.wording_override ?? r.wording;
      const amountPart = r.amount !== null ? `$${r.amount.toLocaleString("en-US")} — ` : "";
      const jurMarker = recordJurisdictionLadder(ctx.inventory, r.id, r.wording, r.requires);
      const petitum = unservedPetitumMarker(r.hasServedBy);
      recordGlyphs(ctx.inventory, petitum, ["🦵"], { table: "order_sought", id: r.id, item: r.wording });
      const workMarkers = dedupeLineMarkers([jurMarker, petitum]);
      const review = orderReviewMarkerFor(ctx.review, ctx.inventory, workMarkers, r);
      const lineMarkers = printMarkerSets([dedupeLineMarkers([workMarkers, review])]);
      return `(${letters[i] ?? i + 1}) ${amountPart}${wording}${lineMarkers ? ` ${lineMarkers}` : ""} <!-- relief_item ${letters[i] ?? i + 1} -->`;
    });
  if (lines.length === 0) lines.push(empty(ctx, "orders-sought", state));
  const crossedOut = relief.filter((r) => r.crossed_out_on !== null);
  if (crossedOut.length > 0) {
    lines.push("", ...crossedOut.map((r) => `~~${r.wording_override ?? r.wording}~~ <!-- order crossed-out order_sought_id ${r.id} -->`));
  }
  return [...before, ...lines];
};

/**
 * The Writing's submissions, each through renderSubmissionParagraphs with the fetch set the
 * Written Arguments builds, sharing one law-assertion map. Numbered always: `restart` starts at 1,
 * `continue` carries the running number on; Writing creation refuses `none` (layout-snapshot.ts).
 */
const legalBasis: Projection = (ctx, part, state) => {
  const submissions = fetchSubmissions(ctx.dbPath, ctx.filing.id, "form");
  const rhetoric = fetchRhetoric(ctx.dbPath, ctx.filing.id, "form", "submissions");
  if (submissions.length === 0 && rhetoric.length === 0) return [empty(ctx, "legal-basis", state)];
  const submissionIds = submissions.map((s) => s.id);
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));
  const factRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const factIds = [...new Set(factRows.map((f) => f.fact_id))];
  const statementRows = fetchFactStatements(ctx.dbPath, factIds);
  const { admittedFactIds, spentGlyphByFact, suppressedFactIds } = fetchFactAdmissionAnnotations(ctx.dbPath, factIds, opposingPartyIds(ctx.parties), ctx.rendered.slice(0, 10));
  const factsBySubmission = groupSubmissionFacts(factRows, statementRows, admittedFactIds, spentGlyphByFact, suppressedFactIds);
  const exhibitDocs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, exhibitDocs.map((d) => d.document_id));
  const referencedDocIds = new Set<number>(exhibitDocs.map((d) => d.document_id));
  for (const s of statementRows) {
    if (s.exhibit_id !== null) referencedDocIds.add(s.exhibit_id);
    if (s.instrument_id !== null) referencedDocIds.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referencedDocIds]);
  const copyMarkers = fetchNotBestCopyMarkers(ctx.dbPath, ctx.proceeding.id);
  const renderedLawAssertions = new Map<number, number>();

  let n = part.paragraph_numbering === "continue" ? state.paragraph : 0;
  const lines: string[] = [];
  for (const entry of interleave(submissions, rhetoric, (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      n += 1;
      lines.push("", ...renderRhetoricLine(ctx, entry.row, n, ""));
      continue;
    }
    const s = entry.item;
    recordParagraph(ctx, s.id, "form", n);
    const result = renderSubmissionParagraphs(
      s.id,
      s.contention,
      n,
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
    n = result.nextPara;
  }
  if (part.paragraph_numbering !== "none") state.paragraph = n;
  return lines;
};

const materialReliedOn: Projection = (ctx, _part, state) => {
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
  if (docs.length === 0) return [empty(ctx, "material-relied-on", state)];
  const exhibitMap = exhibitNumbersForFiling(ctx.dbPath, ctx.filing, docs.map((d) => d.document_id));
  return docs.map((d) => `Ex. ${exhibitMap.get(d.document_id)} — ${d.label}, ${d.document_date ?? "undated"} <!-- document_id ${d.document_id} -->`);
};

/** The saved copy of the published form whose fixed wording the Writing copies (plan 2026-10-07,
 * "Saved-copy guard"): the Writing's first `filing_documents` link of role `other`. Linked, it
 * prints only a comment naming the document, which no filed face carries. Unlinked, a gap,
 * recorded as unwritten, which the filed render refuses on (forms.ts). */
const formSource: Projection = (ctx, _part, state) => {
  const form = fetchFilingDocuments(ctx.dbPath, ctx.filing.id).find((d) => d.role === "other");
  return form === undefined ? [empty(ctx, "form-source", state)] : [`<!-- form copy: document_id ${form.document_id} -->`];
};

/** One selected clause: its filing_clauses pointer and clause row, with the cited statement of law
 * and that statement's authority (LEFT JOIN, NULL when the clause cites none). */
interface ClauseLine extends ClauseRow {
  id: number;
  wording: string;
  wording_override: string | null;
  statement_id: number | null;
  doubt: string | null; // statements_of_law.doubt -- a failed statement's finding (schema v46)
  authority_title: string | null;
  authority_citation: string | null;
  authority_kind: string | null;
  currency_status: string | null;
  provision_currency: string | null; // provision_currency.currency_status for the cited pinpoint
}

/** Whether the database holds `provision_currency`. A database held below v53 has no provision
 * result, so its cited provision reads unchecked. It keeps v42 readable (forms.ts
 * MIN_READABLE_SCHEMA_VERSION). */
function hasProvisionCurrency(dbPath: string): boolean {
  return hasTable(dbPath, "provision_currency");
}

function fetchClauses(dbPath: string, filingId: number): ClauseLine[] {
  const held = hasProvisionCurrency(dbPath);
  return submissionDataQuery(
    dbPath,
    `SELECT c.id, c.wording, fc.wording_override, c.basis, c.document_id, c.pinpoint, c.excerpt, c.excerpt_id,
            s.id AS statement_id, s.pinpoint AS statement_pinpoint, s.verification, s.doubt, a.treatment, a.killed_on AS authority_killed_on,
            a.style_of_cause_or_title AS authority_title, a.citation AS authority_citation,
            a.kind AS authority_kind, a.currency_status, ${held ? "pc.currency_status" : "NULL"} AS provision_currency
     FROM filing_clauses fc
     JOIN clauses c ON c.id = fc.clause_id
     LEFT JOIN statements_of_law s ON s.id = c.excerpt_id
     LEFT JOIN authorities a ON a.id = s.authority_id
     ${held ? "LEFT JOIN provision_currency pc ON pc.authority_id = s.authority_id AND pc.provision = s.pinpoint" : ""}
     WHERE fc.filing_id = ?
     ORDER BY fc.ordinal`,
    [filingId]
  ).rows as unknown as ClauseLine[];
}

const ENACTMENT_KINDS = new Set(["statute", "regulation", "rule"]);

/** Lower-cased, with each whitespace run collapsed to one space. */
const normalized = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Whether the printed wording names the clause's cited authority, by its citation or its title. */
function namesEnactment(printed: string, c: ClauseLine): boolean {
  const text = normalized(printed);
  return [c.authority_citation, c.authority_title].some((name) => name !== null && normalized(name) !== "" && text.includes(normalized(name)));
}

/** The currency rule, held once: an implied clause whose printed wording names the statute,
 * regulation or rule its cited statement rests on is withheld while that authority's own
 * statute-currency result is not `current` (NULL included), and otherwise while the result recorded
 * for the provision the statement pinpoints is not `current` (no row included). Null when the rule
 * does not withhold it. */
function currencyWithheld(c: ClauseLine, printed: string): CurrencyWithheld | null {
  if (c.basis !== "implied" || c.authority_kind === null || !ENACTMENT_KINDS.has(c.authority_kind) || !namesEnactment(printed, c)) return null;
  if (c.currency_status !== "current") return { clause_id: c.id, currency_status: c.currency_status, provision: null };
  if (c.provision_currency !== "current") return { clause_id: c.id, currency_status: c.provision_currency, provision: c.statement_pinpoint };
  return null;
}

/** The Writing's selected clauses the currency rule withholds, read live, in `filing_clauses` order,
 * each with its printed wording. Empty when no stored layout part is `terms`: a clause no part
 * prints never trips the filed render's currency gate. The Sent write's hold and the Milestone's
 * pre-send gate row read this (jobs.md §14a). */
export function currencyWithheldClauses(
  dbPath: string,
  filingId: number,
  parts: readonly LayoutPart[]
): (CurrencyWithheld & { wording: string })[] {
  if (!parts.some((part) => part.source === "terms")) return [];
  return fetchClauses(dbPath, filingId).flatMap((c) => {
    const printed = c.wording_override ?? c.wording;
    const withheld = currencyWithheld(c, printed);
    return withheld === null ? [] : [{ ...withheld, wording: printed }];
  });
}

/**
 * The Writing's selected clauses (shared/declared-layout.md section 4), in `filing_clauses` order,
 * each printing its `wording_override` when set, else the clause's wording, numbered as a slot's
 * paragraphs are. Each line carries clauseMarkers, then 🧐; a clause citing a killed authority's
 * statement carries the plain-text `(killed <date>)` tag a statement line prints on such a
 * citation. An implied clause the currency rule withholds carries `[currency: <result or
 * "unchecked">]` in the same slot, the result being the instrument's own while it is not `current`,
 * else the cited provision's preceded by its pinpoint (`[currency: Rule 8-1 amendment-unchecked]`),
 * and joins ProjectionState.currency_withheld, which the filed render refuses on (forms.ts). A clause citing a
 * statement the research lawyer failed (schema v46) carries `(scrutiny failed: <finding>)` last, so
 * it never reads clean while counsel's decision is owed. Markers and tags are rendered for the
 * human and withheld from the forum (filed-face.ts).
 * 📑, 📌 and 📍 are recorded on the clause row, which is what `terms-traced` counts; 🔬 on the cited
 * statement of law, where the scrutiny is done.
 */
const terms: Projection = (ctx, part, state) => {
  const clauses = fetchClauses(ctx.dbPath, ctx.filing.id);
  if (clauses.length === 0) return [empty(ctx, "terms", state)];
  let n = part.paragraph_numbering === "continue" ? state.paragraph : 0;
  const lines = clauses.map((c) => {
    const workMarkers = clauseMarkers(c);
    recordGlyphs(ctx.inventory, workMarkers, ["📑", "📌", "📍"], { table: "clauses", id: c.id, item: c.wording });
    if (c.statement_id !== null) {
      recordGlyphs(ctx.inventory, workMarkers, ["🔬"], { table: "statements_of_law", id: c.statement_id, item: lawItem(c) });
    }
    const review = reviewMarkerFor(ctx.review, ctx.inventory, workMarkers, "clauses", c.id, c.wording);
    const lineMarkers = printMarkerSets([dedupeLineMarkers([workMarkers, review])]);
    const killed = c.authority_killed_on !== null ? ` (killed ${c.authority_killed_on})` : "";
    const printed = c.wording_override ?? c.wording;
    const withheld = currencyWithheld(c, printed);
    if (withheld !== null) state.currency_withheld.push(withheld);
    const currency = withheld !== null ? ` [currency: ${currencyLabel(withheld)}]` : "";
    const failed = scrutinyFailedTag([c]);
    return `${++n}. ${printed}${killed}${currency}${failed}${lineMarkers ? ` ${lineMarkers}` : ""} <!-- clause_id ${c.id} -->`;
  });
  state.paragraph = n;
  return spaced(lines);
};

/**
 * The signer's block (shared/declared-layout.md section 4): a blank signing space for a party
 * signer, and for a lawyer signer who is not this machine's `person`; then the lawyer's roster
 * details and the firm name, or the party's name. A lawyer's roster details are read live, since
 * an unsent Writing never snapshots them. The roster closing prints only when the layout is a
 * letter (`letterhead: true`), which ends there. Any other lawyer-signed block ends with a counsel
 * line, `Counsel for the {role}`, from the first `is_client` party's role, pluralised by every
 * party sharing it; with no client party the line is a gap.
 */
const signatureBlock: Projection = (ctx, _part, state) => {
  if (state.signer === "party") {
    const id = ctx.filing.signer_party_id;
    if (id === null) return [SIGNING_SPACE, gap(ctx, state, "signer not chosen")];
    const party = ctx.parties.find((p) => p.id === id);
    if (party === undefined) throw new DataServerError(`"${ctx.filing.title}": its signer is not a party of the proceeding`, "invalid_signer");
    return [SIGNING_SPACE, party.name];
  }
  const key = ctx.filing.signer_key;
  if (key === null) return [SIGNING_SPACE, gap(ctx, state, "signer not chosen")];
  const profile = readFirmProfile();
  const entry = profile.roster.find((e) => e.key === key);
  if (entry === undefined) throw new DataServerError(`"${ctx.filing.title}": its signer "${key}" is not in the firm roster`, "invalid_signer");
  const lines: string[] = [];
  if (state.letterhead && typeof entry.closing === "string" && entry.closing !== "") lines.push(entry.closing, "");
  if (profile.person !== key) lines.push(SIGNING_SPACE);
  for (const field of ["name", "designation"]) {
    if (typeof entry[field] === "string" && entry[field] !== "") lines.push(entry[field] as string);
  }
  lines.push(profile.firm_name);
  if (state.letterhead) return lines;
  const client = clientParty(ctx.parties);
  if (client === undefined) lines.push(gap(ctx, state, "counsel empty"));
  else lines.push(`Counsel for the ${pluralizeRole(client.role, ctx.parties.filter((p) => p.role === client.role).length)}`);
  return lines;
};

/** Every projection this runtime prints. */
export const BUILT_PROJECTIONS: ReadonlyMap<string, Projection> = new Map<string, Projection>([
  ["addressee", ownLines("addressee")],
  ["sender", ownLines("sender")],
  ["caption", caption],
  ["parties", parties],
  ["orders-sought", ordersSought],
  ["legal-basis", legalBasis],
  ["material-relied-on", materialReliedOn],
  ["form-source", formSource],
  ["signature-block", signatureBlock],
  ["terms", terms],
]);

/** Members of the closed vocabulary not built yet, each with what holds it back. */
export const UNBUILT_PROJECTIONS: ReadonlyMap<string, string> = new Map([
  ["facts", "no phase yet: no type file declares it before Phase 20"],
  ["witness-statements", "no phase yet: no type file declares it before Phase 20"],
  ["hearing-details", "no phase yet: no type file declares it before Phase 20"],
  ["positions", "no phase yet: no type file declares it before Phase 20"],
]);

/** One part's lines: a slot and a literal here, every other source through its projection. */
export function renderPart(ctx: RenderContext, part: LayoutPart, state: ProjectionState): string[] {
  if (part.source === "literal") return [part.text as string];
  if (part.source.startsWith("slot:")) return slot(ctx, part.source.slice("slot:".length), part, state);
  const projection = BUILT_PROJECTIONS.get(part.source);
  if (projection === undefined) {
    throw new DataServerError(
      `"${ctx.filing.title}": its layout holds a part this version of Probanda cannot print yet ` +
        `(${UNBUILT_PROJECTIONS.get(part.source) ?? "an unknown part"})`,
      "projection_not_built"
    );
  }
  return projection(ctx, part, state);
}
