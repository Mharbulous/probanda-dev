// BCSC supporting affidavit companion (#1486; decisions in #1425's resolution comment): one
// mockup per affidavit the Notice of Application or Application Response lists under role
// 'affidavit'. Pattern: renderWitnessStatements (render-vaniac-submissions.ts). Content follows
// the Form 109 style guide (publish-bcsc-form/forms/109-AFF/style-guide.md): numbered paragraphs,
// no headings, bold exhibit references. Exhibit letters are derived here and never stored.

import { submissionDataQuery } from "../backend.js";
import { BLANK_UNDERLINE, frontmatterHeader, styleOfProceedingCaption, type CaptionParty, type FrontmatterFields } from "./components.js";
import { gapMarker, mockupMessage } from "./markers.js";
import { recordCriterionGlyphs, recordGlyphs } from "./proposal-inventory.js";
import { captionHeadingFor } from "./query.js";
import { fetchDocumentLabels, type RenderContext } from "./render-vaniac-submissions.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** Where a paragraph attaches an exhibit: `{exhibit:<document_id>}` in its stored text. */
const EXHIBIT_TOKEN = /\{exhibit:(\d+)\}/g;

function placedDocumentIds(text: string): number[] {
  return [...text.matchAll(EXHIBIT_TOKEN)].map((m) => Number(m[1]));
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
function letterFor(index: number): string {
  let out = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/**
 * Each placed document's exhibit letter, from one affidavit's paragraph texts in ordinal order:
 * tokens in text order within each paragraph, the first distinct document A. Letters restart at A
 * in every affidavit (style guide rule 5). The filed-face emitter (#1487) shares this.
 */
export function exhibitLetters(paragraphTexts: string[]): Map<number, string> {
  const letters = new Map<number, string>();
  for (const text of paragraphTexts) {
    for (const id of placedDocumentIds(text)) if (!letters.has(id)) letters.set(id, letterFor(letters.size));
  }
  return letters;
}

/** A paragraph's text with each token printed as its bold exhibit reference (style guide rule 4). */
export function withExhibitLetters(text: string, letters: Map<number, string>): string {
  return text.replace(EXHIBIT_TOKEN, (_, id: string) => `**Exhibit "${letters.get(Number(id))}"**`);
}

export interface AffidavitRow {
  id: number; // documents.id
  witness_id: number | null; // documents.deponent
  deponent_name: string | null;
  execution: string | null;
  signed_at: string | null;
  label: string;
  affidavit_number: string | null;
}

/**
 * The filing's role='affidavit' rows that are affidavit instruments, the shape the
 * supporting-affidavit recipe writes (drafting-data filing-checklists.md). A role='affidavit' row
 * naming any other document is material listed for Part 4 or Part 6 alone, with no paragraphs
 * here to render. An instrument with no deponent still renders, carrying its 🧩.
 */
export function fetchAffidavits(dbPath: string, filingId: number): AffidavitRow[] {
  return rows<AffidavitRow>(
    dbPath,
    `SELECT d.id, d.deponent AS witness_id, w.name AS deponent_name, d.execution, d.signed_at, d.label, d.affidavit_number
     FROM filing_documents fd
     JOIN documents d ON d.id = fd.document_id
     LEFT JOIN witnesses w ON w.id = d.deponent
     WHERE fd.filing_id = ? AND fd.role = 'affidavit' AND d.instrument = 'affidavit'
     ORDER BY fd.ordinal`,
    [filingId]
  );
}

export function affidavitFileName(a: AffidavitRow): string {
  return `${a.label.replace(/[\\/:*?"<>|]/g, "_").trim()}.md`;
}

interface ParagraphRow {
  id: number;
  text: string;
}

interface ParagraphLink {
  statement_paragraph_id: number;
  statement_of_fact_id: number;
  fact_id: number;
  exhibit_id: number | null;
}

function fetchParagraphLinks(dbPath: string, paragraphIds: number[]): ParagraphLink[] {
  if (paragraphIds.length === 0) return [];
  const placeholders = paragraphIds.map(() => "?").join(",");
  return rows<ParagraphLink>(
    dbPath,
    `SELECT psof.statement_paragraph_id, psof.statement_of_fact_id, sof.fact_id, sof.exhibit_id
     FROM paragraph_statements_of_fact psof
     JOIN statements_of_fact sof ON sof.id = psof.statement_of_fact_id
     WHERE psof.statement_paragraph_id IN (${placeholders})
     ORDER BY sof.id`,
    paragraphIds
  );
}

/** Every document a token in any affidavit of the proceeding places. */
function fetchPlacedInProceeding(dbPath: string, proceedingId: number): Set<number> {
  const texts = rows<{ text: string }>(
    dbPath,
    `SELECT sp.text FROM statement_paragraphs sp
     JOIN documents d ON d.id = sp.document_id
     WHERE d.proceeding_id = ? AND d.instrument = 'affidavit'`,
    [proceedingId]
  );
  return new Set(texts.flatMap((t) => placedDocumentIds(t.text)));
}

function frontmatterFor(ctx: RenderContext): string {
  const fields: FrontmatterFields = {
    clientName: ctx.clientName,
    clientNo: ctx.clientNo,
    matterNo: ctx.matterNo,
    matterDescription: ctx.matterDescription,
    venue: ctx.proceeding.court_or_centre ?? captionHeadingFor(ctx.filing, ctx.proceeding).display_label,
    proceedingFileNo: ctx.proceeding.file_number ?? "",
    documentType: "Affidavit",
    documentName: ctx.filing.title,
    documentDate: BLANK_UNDERLINE,
    revision: ctx.revision,
    rendered: ctx.rendered,
  };
  return frontmatterHeader(fields);
}

/** One affidavit's mockup. */
export function renderAffidavit(ctx: RenderContext, a: AffidavitRow): string {
  const paragraphs = rows<ParagraphRow>(ctx.dbPath, `SELECT id, text FROM statement_paragraphs WHERE document_id = ? ORDER BY ordinal`, [a.id]);
  const links = fetchParagraphLinks(
    ctx.dbPath,
    paragraphs.map((p) => p.id)
  );
  const letters = exhibitLetters(paragraphs.map((p) => p.text));
  const placedInProceeding = fetchPlacedInProceeding(ctx.dbPath, ctx.proceeding.id);
  const labels = fetchDocumentLabels(ctx.dbPath, [...new Set([...letters.keys(), ...links.flatMap((l) => (l.exhibit_id === null ? [] : [l.exhibit_id]))])]);
  const labelOf = (id: number) => labels.get(id) ?? `document ${id}`;
  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const deponent = a.deponent_name ?? "________________";

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx));
  lines.push("");
  // Rule 22-2(3)'s identifier block, which the Form 109 template prints top right.
  lines.push(`This is Affidavit #${a.affidavit_number ?? "____"} of ${deponent} in this case and was made on ${a.execution ?? "________________"}.`);
  lines.push("");
  lines.push(
    styleOfProceedingCaption(captionParties, {
      heading: captionHeadingFor(ctx.filing, ctx.proceeding),
      registry: ctx.proceeding.registry,
      fileNumber: ctx.proceeding.file_number,
      titleLine: "AFFIDAVIT",
    })
  );
  lines.push("");
  lines.push(`I, ${deponent}, swear (or affirm) that:`);
  lines.push("");
  // Rendered for the human, withheld from the filed face, like the witness statement's
  // statement-level 🧩 (render-vaniac-submissions.ts). A sworn affidavit relied on here, with no
  // paragraphs stored, owes nothing.
  const affidavitGaps = [
    ...(a.deponent_name === null ? [{ text: "no deponent recorded", what: "deponent" }] : []),
    ...(paragraphs.length === 0 && a.execution === null ? [{ text: "no paragraphs drafted", what: "paragraphs" }] : []),
  ];
  for (const gap of affidavitGaps) {
    const line = mockupMessage(gapMarker("gap"), gap.text);
    recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "documents", id: a.id, item: `${a.label}: ${gap.what}` });
    lines.push(line);
  }

  paragraphs.forEach((p, i) => {
    const n = i + 1;
    const own = links.filter((l) => l.statement_paragraph_id === p.id);
    const tag = own.length > 0 ? ` [facts ${own.map((l) => `F${l.fact_id}`).join(", ")}]` : ` ${gapMarker("gap")} [GAP -- no fact linked]`;
    // Each 🧩 is an open item keyed on its own row (#1226).
    recordCriterionGlyphs(ctx.inventory, tag, ["🧩"], { table: "statement_paragraphs", id: p.id, item: `${a.label}, paragraph ${n}: linked fact` });
    lines.push(`${n}. ${withExhibitLetters(p.text, letters)}${tag} <!-- statement_paragraph ${n} -->`);
    if (own.length === 0) return; // the unlinked 🧩 above already covers every token here

    const tendered = new Set(own.map((l) => l.exhibit_id));
    for (const id of new Set(placedDocumentIds(p.text))) {
      if (tendered.has(id)) continue;
      const line = mockupMessage(gapMarker("gap"), `Exhibit "${letters.get(id)}" (${labelOf(id)}) is attached here, but no statement of fact linked to this paragraph tenders it`);
      recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "statement_paragraphs", id: p.id, item: `${a.label}, paragraph ${n}: Exhibit "${letters.get(id)}" tendered` });
      lines.push(`   ${line}`);
    }
    for (const l of own) {
      if (l.exhibit_id === null || placedInProceeding.has(l.exhibit_id)) continue;
      const line = mockupMessage(gapMarker("gap"), `${labelOf(l.exhibit_id)} is tendered by a statement of fact linked to this paragraph, but no affidavit in this proceeding attaches it`);
      recordCriterionGlyphs(ctx.inventory, line, ["🧩"], { table: "statements_of_fact", id: l.statement_of_fact_id, item: `${a.label}, paragraph ${n}: ${labelOf(l.exhibit_id)} attached` });
      lines.push(`   ${line}`);
    }
  });
  lines.push("");

  // swear-it: documents.execution IS NULL AND >=1 paragraph linked, the predicate the witness
  // statement's 🖋️ uses (work-markers.md 1a).
  const swearMarker = a.execution === null && links.length > 0 ? "✒️" : "";
  recordGlyphs(ctx.inventory, swearMarker, ["✒️"], { table: "documents", id: a.id, item: a.label, witness_id: a.witness_id ?? undefined });
  // The template's Rule 22-2(5) jurat (style guide, Template provenance).
  lines.push(`SWORN (OR AFFIRMED) BEFORE ME at ${a.signed_at ?? "________________"}, British Columbia on ${a.execution ?? "________________"}. ${swearMarker}`.trim());
  lines.push("");
  lines.push("________________________________");
  lines.push("A commissioner for taking affidavits for British Columbia");
  lines.push("");
  lines.push("________________________________");
  lines.push(deponent);

  return lines.join("\n").trimEnd() + "\n";
}
