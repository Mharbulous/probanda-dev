// The general renderer (spec §6 piece 4; shared/declared-layout.md sections 3-5). A `general`
// Writing renders one document from its stored layout alone: the parts in array order, each
// through its projection (projections.ts), then the recipients. The mockup-only material is in the
// header's optional list fields (Authorities cited, Page budget, Layout confirmation, Blind copies).
// The filed face is the kind-agnostic toFiledFace transform, which drops the whole header.
//
// The confirmation gate's mockup half (spec §6 piece 5): each item the stored layout cites is
// tagged on the line it renders, `[unverified: <rule_ref>]` while a learned file's item is
// unconfirmed, `[source changed: <rule_ref>]` when a vetted file's passage moved since the
// snapshot or the session's source check found it missing. Both tags are rendered for the human
// and withheld from the forum. A cited item that renders on no line of its own is listed in the
// header's "Layout confirmation" field with its tag. The filed half is forms.ts's, from confirmationGate below.

import { BLANK_UNDERLINE, frontmatterHeader } from "./components.js";
import { lawStatementCitationLine, lawStatementMarkers } from "./law-statement-line.js";
import { dedupeLineMarkers, gapMarker, mockupMessage, printMarkerSets } from "./markers.js";
import { gap, renderPart, type CurrencyWithheld, type LayoutPart, type ProjectionState, type ProseFormatHit } from "./projections.js";
import { lawItem, recordLawStatementGlyphs } from "./proposal-inventory.js";
import { fetchFilingLaw, fetchFilingRecipients, fetchProse, type FilingLawRow, type FilingRecipientRow, type FilingRow } from "./query.js";
import { scalarValue, type CitedState, type StoredLayout } from "./layout-snapshot.js";
import { reviewMarkerFor, type RenderContext } from "./render-vaniac-submissions.js";
import { generalDocumentName } from "./writing-label.js";

/** The item's mockup tag, or "" when it needs none. */
export function tagOf(state: CitedState): string {
  if (state.learned) {
    if (state.item !== undefined && state.item.status !== "unconfirmed") return "";
    const pdf = state.item?.pdf_page ? `, transcribed from PDF p. ${state.item.pdf_page}` : "";
    return `[unverified: ${state.rule_ref}${pdf}]`;
  }
  const moved = state.item === undefined || state.item.passage_hash !== state.snapshot_hash || state.item.freshness === "missing";
  return moved ? `[source changed: ${state.rule_ref}]` : "";
}

export interface ChangedSinceSnapshot {
  rule_ref: string;
  snapshot_hash: string;
  /** Null when the file no longer carries the rule_ref. */
  current_hash: string | null;
}

/**
 * The filed render's gate: every cited item of a learned file that reads unconfirmed, and every
 * cited item of any status whose passage differs from the snapshot's. A vetted file's items never
 * appear in `unconfirmed`.
 */
export function confirmationGate(states: CitedState[]): { unconfirmed: string[]; changed_since_snapshot: ChangedSinceSnapshot[] } {
  return {
    unconfirmed: states.filter((s) => s.learned && (s.item === undefined || s.item.status === "unconfirmed")).map((s) => s.rule_ref),
    changed_since_snapshot: states
      .filter((s) => (s.item?.passage_hash ?? null) !== s.snapshot_hash)
      .map((s) => ({ rule_ref: s.rule_ref, snapshot_hash: s.snapshot_hash, current_hash: s.item?.passage_hash ?? null })),
  };
}

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

function roman(n: number): string {
  let out = "";
  for (const [value, numeral] of ROMAN) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

function headingLine(part: LayoutPart & { heading: string }, n: number): string {
  switch (part.heading_numbering) {
    case "part-roman":
      return `## Part ${roman(n)} — ${part.heading}`;
    case "part-arabic":
      return `## Part ${n} — ${part.heading}`;
    case "letter":
      return `## ${String.fromCharCode(64 + n)}. ${part.heading}`;
    default:
      return `## ${part.heading}`;
  }
}

function withTag(line: string, tag: string): string {
  return tag === "" ? line : `${line} ${tag}`;
}

/** Leading and trailing blank lines dropped, so parts join with exactly one. */
function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/** The keyed table of the `recipients` gap's inventory entry (#1234), which the `recipients`
 * criterion counts (render-work-board.ts). Keyed on the Writing's id: the row it asks for does not
 * exist yet. */
export const NO_TO_RECIPIENT_TABLE = "filing_recipients";

function recipientLine(r: FilingRecipientRow): string {
  const contact = [r.email, r.address?.replace(/\s*\r?\n\s*/g, ", ")].filter((v) => v !== null && v !== undefined && v !== "").join(" | ");
  return `${r.name}${r.capacity ? ` — ${r.capacity}` : ""}${contact ? ` (${contact})` : ""}`;
}

/** A recipient's `<label>: ` line, or, for a sent Writing's party-linked recipient whose party it was
 * not sent with, a 🏷️ *not recorded* line in its place (work-markers.md 1a, as a drifted party's line
 * in parties-drift.ts): rendered for the human, withheld from the forum, no inventory entry. */
function recipientEntry(r: FilingRecipientRow, label: string): string {
  if (!r.unrecorded) return `${label}: ${recipientLine(r)}`;
  return mockupMessage(
    gapMarker("not_recorded"),
    `${label} recipient ${r.id}${r.capacity ? ` (${r.capacity})` : ""}: its party ${r.party_id} is not among the parties this Writing was sent with, so no name, email or address was recorded for it`
  );
}

/** The mockup-only item in the header's "Authorities cited" while a Writing's authority confirmation is
 * unset (#1231). Plain text with no glyph, so `open-items` does not count it. */
const UNCONFIRMED_AUTHORITY_LINE =
  "Authority not confirmed: link each authority this text cites, or record that it cites none. Sending is held until then.";

/** Whether the Writing's cited authority is unconfirmed (#1231): an unsent general Writing (no
 * forum parts) whose layout declares `primary-authority` and whose `authority_confirmed_on` is
 * NULL. A venue's letter, which needs forum parts, is outside it. A layout that declares
 * `noting-up` is outside it too: the citation scan (citation-scan.ts) computes what the session
 * attested, counting each untracked citation under that criterion. */
export function authorityUnconfirmed(filing: FilingRow, layout: StoredLayout["layout"]): boolean {
  return (
    filing.needs_forum_parts === 0 &&
    filing.filed_on === null &&
    filing.authority_confirmed_on === null &&
    Array.isArray(layout.goal_criteria) &&
    layout.goal_criteria.includes("primary-authority") &&
    !layout.goal_criteria.includes("noting-up")
  );
}

/** One prose-cited statement's item in the header's "Authorities cited" (#1214; work-markers.md rows 📜 📍 🔬
 * 🏅): the citation line and the statement-line markers the doctrinal statement line prints, recorded
 * on the inventory as there, and its own 🧐. A lead prints, the header reaching no sent face. A
 * killed authority's line carries its `(killed <date>)` tag and no marker at all, 🧐 included. */
function authorityCitedLine(ctx: RenderContext, row: FilingLawRow): string {
  const glyphs = lawStatementMarkers(row);
  recordLawStatementGlyphs(ctx.inventory, glyphs, row);
  const review =
    row.authority_killed_on === null ? reviewMarkerFor(ctx.review, ctx.inventory, glyphs, "statements_of_law", row.statement_id, lawItem(row)) : "";
  return [lawStatementCitationLine(row), printMarkerSets([dedupeLineMarkers([glyphs, review])]), `<!-- statement_of_law_id ${row.statement_id} -->`].filter(Boolean).join(" ");
}

function wordCount(lines: string[]): number {
  return lines.join(" ").replace(/<!--[\s\S]*?-->/g, " ").split(/\s+/).filter((w) => w !== "").length;
}

/** The learned-file notice (shared/knowledge-tree.md section 11), filled from header fields only. A
 * vetted file's names its reviewer, and still asks this firm to confirm. */
function notice(venue: string, kind: string, learned: boolean, header: Record<string, string | null>): string {
  if (!learned) {
    return (
      `Note: the ${venue} requirements for ${kind} used here were reviewed by ${header.reviewed_by ?? "a practitioner"} on ${header.reviewed_on ?? "an unrecorded date"}, ` +
      "but this firm has not yet confirmed or corrected every item; confirm each item before relying on it."
    );
  }
  return (
    `Note: the ${venue} requirements for ${kind} used here were learned by an agent on ${header.accessed ?? "an unrecorded date"} ` +
    "from the venue's published sources and have not been reviewed by a practitioner; unverified items are tagged on the mockup."
  );
}

/** Whether this firm's sidecar leaves the item open: the notice stops only once every cited item reads confirmed or corrected. */
const firmOpen = (s: CitedState): boolean => s.item?.status !== "confirmed" && s.item?.status !== "corrected";

/** A venue's stock `unstructured` type file, or a `_NoVenue` recipient's `unstructured-<recipient>`
 * (plan 2026-10-07, "Stock types"). Its title names the
 * type, not the document, so an Unstructured Writing prints no title heading: the document's own
 * title, where it has one, is printed wording in its slots. */
const STOCK_UNSTRUCTURED = /\/Documents\/unstructured(-[a-z-]+)?\.md$/;

/** One `General_writing` document from the stored layout, with `cited` from citedStates, the
 * parts it printed with no content, and the clause lines it tagged `[currency: ...]`, both of which
 * the filed render refuses on (forms.ts). */
export function renderGeneral(
  ctx: RenderContext,
  stored: StoredLayout,
  cited: CitedState[]
): { markdown: string; unwritten: string[]; currency_withheld: CurrencyWithheld[]; prose_format: ProseFormatHit[] } {
  const { layout } = stored;
  const title = String(scalarValue(layout.title));
  const venueLabel = stored.venue === null ? "" : String(scalarValue(stored.venue.display_label));
  const placed = new Set<CitedState>();
  const tagAt = (block: CitedState["block"], field: string): string => {
    const state = cited.find((s) => s.block === block && s.field === field);
    if (state === undefined) return "";
    placed.add(state);
    return tagOf(state);
  };

  const state: ProjectionState = { paragraph: 0, prose: fetchProse(ctx.dbPath, ctx.filing.id), signer: layout.signer === "party" ? "party" : "lawyer", letterhead: layout.letterhead === true, unwritten: [], part: 0, currency_withheld: [], prose_format: [] };
  const date = state.prose.get("date")?.text.trim().replace(/\s+/g, " ") ?? "";
  // The header is built last, because its optional fields are read after the body (the page
  // estimate counts it, and a cited item is unplaced only once every line has printed).
  const lines: string[] = [];
  if (!STOCK_UNSTRUCTURED.test(stored.type_file ?? "")) lines.push("", withTag(`# ${title}`, tagAt("type", "title")));

  const body: string[] = [];
  let numbered = 0;
  (layout.parts as LayoutPart[]).forEach((part, i) => {
    state.part = i;
    const partLines = trimBlank(renderPart(ctx, part, state));
    const field = `parts[${i}]`;
    const out: string[] = [];
    if (part.heading !== null) {
      if (part.heading_numbering !== "none") numbered += 1;
      out.push(withTag(headingLine(part as LayoutPart & { heading: string }, numbered), tagAt("type", field)));
      if (partLines.length > 0) out.push("", ...partLines);
    } else if (partLines.length > 0) {
      out.push(withTag(partLines[0], tagAt("type", field)), ...partLines.slice(1));
    }
    if (out.length > 0) {
      lines.push("", ...out);
      body.push(...partLines);
    }
  });

  const recipients = fetchFilingRecipients(ctx.dbPath, ctx.filing, ctx.parties);
  const sent = recipients.filter((r) => r.role !== "bcc");
  // #1234: a Writing whose layout declares `recipients` and has no 'to' row, a cc-only one included,
  // prints a mockup-only gap line where its To lines go. It never joins `unwritten`, so the filed
  // render is not refused on it: the Job Board and the pre-send hold carry it.
  const declaresRecipients = Array.isArray(layout.goal_criteria) && layout.goal_criteria.includes("recipients");
  const noTo =
    declaresRecipients && !sent.some((r) => r.role === "to") ? [gap(ctx, state, "no To recipient", { table: NO_TO_RECIPIENT_TABLE, id: ctx.filing.id })] : [];
  if (noTo.length + sent.length > 0) lines.push("", ...noTo, ...sent.map((r) => recipientEntry(r, r.role === "to" ? "To" : "cc")));

  // The four optional header fields, each a list printed only while it has items. The filed face
  // drops the whole header, so none reaches the sent face.
  const authorities = fetchFilingLaw(ctx.dbPath, ctx.filing.id);
  // #1231: a plain line, no glyph, so `open-items` does not count it. It prints only while the
  // Writing's authority confirmation is NULL.
  const authorityItems = [...(authorityUnconfirmed(ctx.filing, layout) ? [UNCONFIRMED_AUTHORITY_LINE] : []), ...authorities.map((row) => authorityCitedLine(ctx, row))];

  const pageLimit = scalarValue(layout.page_limit);
  const pageBudget =
    pageLimit === undefined
      ? []
      : [withTag(`Limit: ${pageLimit} pages; estimate: ${Math.ceil(wordCount([title, ...body]) / 300)} pages`, tagAt("type", "page_limit"))];

  const unplaced = cited.filter((s) => !placed.has(s) && tagOf(s) !== "");
  const openFiles = [...new Set(cited.filter(firmOpen).map((s) => s.file))];
  const confirmation = [
    ...openFiles.map((file) => {
      const state = cited.find((s) => s.file === file)!;
      return notice(venueLabel === "" ? "No venue" : venueLabel, title, state.learned, state.header);
    }),
    ...unplaced.map((s) => `${s.block === "venue" ? "venue " : ""}${s.field} ${tagOf(s)}`),
  ];

  const blind = recipients.filter((r) => r.role === "bcc").map((r) => recipientEntry(r, "bcc"));

  const header = frontmatterHeader({
    clientName: ctx.clientName,
    clientNo: ctx.clientNo,
    matterNo: ctx.matterNo,
    matterDescription: ctx.matterDescription,
    venue: venueLabel,
    proceedingFileNo: ctx.proceeding.file_number ?? "",
    documentType: generalDocumentName(title, ctx.filing.title),
    documentName: ctx.filing.title,
    documentDate: date === "" ? BLANK_UNDERLINE : date,
    revision: ctx.revision,
    rendered: ctx.rendered,
    lists: [
      { label: "Authorities cited", items: authorityItems },
      { label: "Page budget", items: pageBudget },
      { label: "Layout confirmation", items: confirmation },
      { label: "Blind copies", items: blind },
    ],
  });

  return { markdown: [header, ...lines].join("\n").trimEnd() + "\n", unwritten: [...new Set(state.unwritten)], currency_withheld: state.currency_withheld, prose_format: state.prose_format };
}
