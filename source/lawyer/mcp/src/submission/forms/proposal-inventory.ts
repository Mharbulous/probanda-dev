// The render's marker inventory (Work Board Proposals design §8; Phase D of
// planning/2. Plan/2026-09-15_work-board-proposals-implementation-plan.md).
//
// Every generating work-marker glyph a mockup render emits is recorded here, at
// its emit site, on the row the work is done on. `buildWorkBoardData` turns that
// inventory into the board's proposed / Shelved lanes, and
// `render-manifest.json` saves it so a stamp hit derives the same lanes without
// re-rendering.
//
// Two rules the design fixes and this module exists to keep:
//   * Never a second predicate pass. `recordGlyphs` reads the glyph string the
//     emit site itself just computed -- not a re-run of markers.ts, which would
//     drift from renderer-local filters (the lead-and-killed filter before
//     doctrinalSlotMarker, say).
//   * Never a markdown scan. Several rendered lines merge glyphs from more than
//     one keyed row under one trace comment, so a scan cannot recover the key.
//     Every merged site calls recordGlyphs per source row BEFORE its own
//     dedupeLineMarkers, which is where the per-row token still exists.
//
// The Goal card (planning/1. Design/2026-09-21_goal-card-and-prepare-design.md §2.2) amends the
// collector twice. Every entry names `doc`, the document that emitted it, so a criterion can count
// only the documents that go to the forum. And the glyphs a criterion counts although they never
// generate are recorded too, flagged `generating: false`; deriveProposals drops them first.

import { dedupeLineMarkers, jurisdictionEdgeMarkers, LEGISLATION_KINDS, type JurisdictionRequiresEdge } from "./markers.js";
import { CITATION_MISSING } from "./render-vaniac-submissions.js";
import { PLACEMENTS, SYMBOLS } from "./symbol-table.js";

/** Design §4's table, in its own order -- which is the Work Board's card order (design §8). */
export type ProposalSlug =
  | "doctrinal-basis" | "primary-authority" | "jurisdictional-basis"
  | "authority-excerpt" | "authority-pinpoint" | "scrutinize" | "note-up" | "authority-rating"
  | "exhibit-excerpt" | "testimony-excerpt" | "exhibit-pinpoint" | "testimony-pinpoint"
  | "interview" | "draft-it" | "sign-it" | "swear-it" | "serve-it" | "enter-it"
  | "factual-basis" | "proposition" | "unserved-petitum" | "loose-thread" | "not-recorded" | "unchosen" | "choose-template";

/** The glyphs a Goal-card criterion counts although they never generate a Proposal (Goal card
 * design §2.7, its "count although they never generate" sentence). 🔬 and 🏅 are the proposition
 * line's instances only: each generates on the statement line. 📖 is the proposition line's
 * instance while a statement of the proposition has failed scrutiny (schema v46) only: it
 * generates otherwise. ⬜ is every instance but the
 * requisition checklist's and a live Form 8 provision's. 🧐 is printed by the forum renderers since
 * practitioner-review plan Phase 5, and its entry may carry `changed`. 📇 is a statute, regulation
 * or rule found repealed or archived only (#1628): it generates otherwise. */
export const NON_GENERATING_GLYPHS = ["🧩", "🕵️", "⬜", "👤", "🚧", "👃", "↩️", "🏆", "🧐", "🏅", "🔬", "📖", "📇"] as const;
export type NonGeneratingGlyph = (typeof NON_GENERATING_GLYPHS)[number];

/** Which instance of a non-generating glyph an entry is, where a criterion places one glyph by
 * instance (design §2.6, §2.7): 🚧 by what it sits on (`proposition`, `order`, `fact`), 👃 by
 * domain (`fact`, `law`), ⬜ by instance (`associate-judge`, `unpositioned-order`, `other`), and 🔬,
 * 🏅 and 📖 by line (`proposition`, the one line where they do not generate; 📖 only while a
 * statement of the proposition has failed scrutiny). Absent on the rest. */
export type GlyphInstance = "proposition" | "order" | "fact" | "law" | "associate-judge" | "unpositioned-order" | "other";

/** One generating glyph, on the row its work is done on, as one emit site printed it (design §8). */
export interface ProposalEntry {
  generating: true;
  slug: ProposalSlug;
  table: string;            // the keyed table (design §4)
  id: number;
  qualifier?: string;       // requisition checklist only: "order" | "affidavit"
  marker: string;           // the glyph as printed, one glyph
  item: string;             // count-free row identity (design §8)
  witness_id?: number;      // statements_of_fact-keyed entries, and documents-keyed sign-it/swear-it entries
  instrument_id?: number;   // statements_of_fact-keyed entries, and witnesses-keyed interview entries
  statement_id?: number;    // witnesses-keyed entries: the statements_of_fact row that emitted it (fact count)
  cleared?: boolean;        // note-up entries only: this statement has cleared 📜 📍 🔬
  provision?: string | null; // note-up entries on a statute, regulation or rule only: the statement's pinpoint, null with none
  doc: string;              // the emitting document's documentType; "" until stampDoc names it
}

/** One glyph a criterion counts that never generates a Proposal (Goal card design §2.2), on the row
 * it sits on. It carries no slug, because no Proposal is keyed on it. */
export interface CriterionEntry {
  generating: false;
  marker: NonGeneratingGlyph;
  instance?: GlyphInstance;
  table: string;
  id: number;
  item: string;             // count-free row identity, as a Proposal's item is
  doc: string;              // as ProposalEntry.doc
  /** 🧐 only: present when the object has an earlier approval whose snapshot no longer matches
   * (practitioner-review design §5, plan "Names this plan fixes"); absent on a never-approved object. */
  changed?: true;
  /** The fact-side 👤 only: counsel has suppressed it on this line (schema v69), so it printed as 🤫
   * and its criterion counts it met. Absent otherwise. */
  suppressed?: true;
}

export type InventoryEntry = ProposalEntry | CriterionEntry;

export type MarkerInventory = InventoryEntry[];

/** `<slug>:<table>:<id>`, with a fourth `:<qualifier>` segment only for the requisition
 * checklist (design §6). Characters stay `a-z 0-9 _ - :` -- no glyph, no content hash. */
export function proposalKey(e: Pick<ProposalEntry, "slug" | "table" | "id" | "qualifier">): string {
  return `${e.slug}:${e.table}:${e.id}` + (e.qualifier ? `:${e.qualifier}` : "");
}

/** The Work Board's card order: design §4's table, in its own order (design §8). Slugs only. Each
 * title, and each glyph's slug, is written once, on its row in symbol-table.ts. */
const CARD_ORDER: readonly ProposalSlug[] = [
  "doctrinal-basis", "primary-authority", "jurisdictional-basis",
  "authority-excerpt", "authority-pinpoint", "scrutinize", "note-up", "authority-rating",
  "exhibit-excerpt", "testimony-excerpt", "exhibit-pinpoint", "testimony-pinpoint",
  "interview", "draft-it", "sign-it", "swear-it", "serve-it", "enter-it",
  "factual-basis", "proposition", "unserved-petitum", "loose-thread", "not-recorded", "unchosen", "choose-template",
];

/** Every symbol-table row that carries a slug: symbol rows, and placement rows for a second sense of
 * a glyph that generates its own Proposal (the Form 8 ⬜'s choose-template). */
const SLUGGED_ROWS = [...SYMBOLS, ...PLACEMENTS].filter((r) => r.slug !== undefined);
for (const r of SLUGGED_ROWS) {
  if (!CARD_ORDER.includes(r.slug as ProposalSlug)) {
    throw new Error(`proposal-inventory: symbol-table.ts row ${r.glyph} carries slug "${r.slug}", which CARD_ORDER lacks`);
  }
}

function titleOf(slug: ProposalSlug): string {
  const titles = [...new Set(SLUGGED_ROWS.filter((r) => r.slug === slug).map((r) => r.title))];
  if (titles.length !== 1 || titles[0] === undefined) {
    throw new Error(`proposal-inventory: slug "${slug}" needs exactly one title in symbol-table.ts, found ${JSON.stringify(titles)}`);
  }
  return titles[0];
}

/** Design §4's "Work name" column, from symbol-table.ts, keyed in card order. A ticket title needs
 * an act, so each is a verb phrase. */
export const WORK_NAMES = Object.fromEntries(CARD_ORDER.map((slug) => [slug, titleOf(slug)])) as Record<ProposalSlug, string>;

/** Which slug each generating glyph carries (design §4), from symbol-table.ts's symbol rows, in card
 * order. 🥉 and 🥈 share one slug, so a queued 🥉 ticket keeps hiding its Proposal when the line
 * turns 🥈 (design §4). A placement row's slug is not here: the Form 8 ⬜'s choose-template is
 * recorded by render-requisition.ts directly. Every glyph here must also be in markers.ts's
 * ALL_MARKER_GLYPHS -- proposal-inventory.unit.test.mjs asserts it. */
export const GLYPH_SLUGS: ReadonlyMap<string, ProposalSlug> = new Map<string, ProposalSlug>(
  CARD_ORDER.flatMap((slug) => SYMBOLS.filter((s) => s.slug === slug).map((s): [string, ProposalSlug] => [s.glyph, slug]))
);

/**
 * Records every glyph in `glyphs` (a space-joined string an emit site just computed) that is in
 * `only`, onto one keyed row. Splits on " " exactly as dedupeLineMarkers does.
 *
 * `only` is the site's own list of what it may generate from that token -- never the whole glyph
 * set. It also fixes the emission order, so one site's entries land in a stable order whatever
 * order the renderer happened to compose the string in.
 */
export function recordGlyphs(
  inv: MarkerInventory,
  glyphs: string,
  only: readonly string[],
  row: Omit<ProposalEntry, "generating" | "slug" | "marker" | "doc">
): void {
  if (!glyphs) return;
  const printed = new Set(glyphs.split(" ").filter(Boolean));
  for (const glyph of only) {
    if (!printed.has(glyph)) continue;
    const slug = GLYPH_SLUGS.get(glyph);
    if (slug === undefined) continue;
    inv.push({ generating: true, slug, marker: glyph, ...row, doc: "" });
  }
}

/**
 * recordGlyphs's twin for the glyphs a criterion counts although they never generate (Goal card
 * design §2.2): records every glyph in `only` that `glyphs` carries, onto one row, flagged
 * `generating: false`. `only` is the site's own list, as for recordGlyphs.
 *
 * Containment, not recordGlyphs's whole-token match: sourceRungMarker prints the proposition
 * line's 🏅 fused to its rung with no space between (🥈🏅, 🥉🏅), so no space-split token is 🏅
 * alone. No glyph NON_GENERATING_GLYPHS lists occurs inside another marker glyph, so containment
 * finds exactly the listed glyphs printed, fused to a neighbour or not.
 */
export function recordCriterionGlyphs(
  inv: MarkerInventory,
  glyphs: string,
  only: readonly NonGeneratingGlyph[],
  row: Omit<CriterionEntry, "generating" | "marker" | "doc">
): void {
  if (!glyphs) return;
  for (const glyph of only) {
    if (glyphs.includes(glyph)) inv.push({ generating: false, marker: glyph, ...row, doc: "" });
  }
}

/** Names `doc` on every entry recorded since `from` (Goal card design §2.2). forms.ts calls it once
 * per document render, with the documentType it gives that document, so no emit site needs to know
 * which document it prints into -- the shared submission body prints into four. */
export function stampDoc(inv: MarkerInventory, from: number, doc: string): void {
  for (let i = from; i < inv.length; i++) inv[i].doc = doc;
}

/** Element guard for readManifest: a hand-edited or older manifest reads as no manifest rather
 * than crashing derivation. `hasOwn`, not `in`: `in` walks the prototype chain, so a slug of
 * "constructor" would pass and then title itself from a function's source. A manifest written
 * before entries named their document fails on `doc`, so its render misses and records them again. */
export function isInventoryEntry(v: unknown): v is InventoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.table !== "string" || typeof e.id !== "number" || typeof e.item !== "string" || typeof e.marker !== "string") return false;
  if (typeof e.doc !== "string" || e.doc === "") return false;
  if (e.generating === true) return typeof e.slug === "string" && Object.hasOwn(WORK_NAMES, e.slug);
  if (e.generating === false) return (NON_GENERATING_GLYPHS as readonly string[]).includes(e.marker);
  return false;
}

/** The item for a `statements_of_law`- or `authorities`-keyed entry (design §8): the authority's
 * style of cause and citation, with the same placeholder the renderers print for a missing one. */
export function lawItem(row: { authority_title: string | null; authority_citation: string | null }): string {
  const citation = row.authority_citation ?? CITATION_MISSING;
  return row.authority_title === null ? citation : `${row.authority_title}, ${citation}`;
}

/** 📇's gating state (design §5: an authority is noted up once at least one statement of it has
 * cleared 📜, 📍 and 🔬). Recorded per statement; `deriveProposals` takes the disjunction across
 * the authority's entries. A settled statement (schema v47) has cleared 🔬 by counsel's confirmed
 * close, and stays subject to note-up as a verified one is.
 *
 * Reads no killed state, and must not: the caller has already excluded killed authorities,
 * because since #796 a killed item's lines print no 📇 for recordGlyphs to key on. Called
 * directly on a killed row this returns true, which would mark a rejected authority noted up --
 * a killed filter belongs at the emit site, never here (design §8, never a second predicate
 * pass). */
export function noteUpCleared(row: {
  excerpt: string | null;
  pinpoint: string | null;
  verification: string | null;
}): boolean {
  return (
    row.excerpt !== null && row.excerpt !== "" &&
    row.pinpoint !== null && row.pinpoint !== "" &&
    (row.verification === "verified" || row.verification === "settled")
  );
}

/** One statement-of-law line's keyed rows: 📜 📍 🔬 on the statement, 📇 and 🏅 on its authority
 * (design §4; 🏅 by Goal card design §4.4, item as for 📇). Shared by the doctrinal statement line
 * and the jurisdictional ladder, which run the identical 📜 → 📍 → 🔬 → 📇 rungs (design §5). The
 * treatment glyphs never generate. 👃 never generates either, and is recorded for the Excerpts
 * criterion on the statement (Goal card design §2.7). A dropped authority's line prints none of
 * these, so it records nothing here, 🏅 included -- the same reason noteUpCleared gives. */
export interface LawStatementRow {
  statement_id: number;
  authority_id: number | null;
  authority_title: string | null;
  authority_citation: string | null;
  excerpt: string | null;
  pinpoint: string | null;
  verification: string | null;
  authority_kind: string | null;
  currency_status: string | null;
}

export function recordLawStatementGlyphs(inv: MarkerInventory, glyphs: string, row: LawStatementRow): void {
  const item = lawItem(row);
  recordGlyphs(inv, glyphs, ["📜", "📍", "🔬"], { table: "statements_of_law", id: row.statement_id, item });
  recordCriterionGlyphs(inv, glyphs, ["👃"], { table: "statements_of_law", id: row.statement_id, item, instance: "law" });
  if (row.authority_id !== null) {
    // A statute, regulation or rule found repealed or archived still prints 📇, but its note-up --
    // the statute-currency check -- is finished, and replacing or killing the authority is the
    // practitioner's work (#1628). Its entry is recorded, as printed, and never proposes; a criterion
    // entry keeps the noting-up row (and so the pre-send hold) open until the authority is replaced.
    const legislation = row.authority_kind !== null && LEGISLATION_KINDS.has(row.authority_kind);
    const checkFinished = legislation && (row.currency_status === "repealed" || row.currency_status === "archived");
    // A statute, regulation or rule is noted up provision by provision, so its entry carries the
    // statement's pinpoint for the job's steps (withNoteUpSteps).
    const provision = legislation ? { provision: row.pinpoint?.trim() || null } : {};
    recordGlyphs(inv, glyphs, ["📇"], { table: "authorities", id: row.authority_id, item, cleared: !checkFinished && noteUpCleared(row), ...provision });
    if (checkFinished) recordCriterionGlyphs(inv, glyphs, ["📇"], { table: "authorities", id: row.authority_id, item });
    recordGlyphs(inv, glyphs, ["🏅"], { table: "authorities", id: row.authority_id, item });
  }
}

/**
 * The three jurisdictional-ladder emit sites in one place (Notice of Application Part 1, the
 * Written Arguments relief block, and the reserve inventory's reserved orders): records per edge, then
 * returns the deduped string the site prints. The predicate still runs exactly once per rendered
 * line -- jurisdictionEdgeMarkers is the per-edge half of jurisdictionLadderMarker, not a second
 * pass over it. `deployed` is false only for the reserve inventory's reserved order, deployed on no live
 * Writing (spec R6, schema v47), whose edges then raise no 🔬.
 */
export function recordJurisdictionLadder(
  inv: MarkerInventory,
  orderId: number,
  orderItem: string,
  edges: readonly JurisdictionRequiresEdge[],
  deployed = true
): string {
  const perEdge = jurisdictionEdgeMarkers(edges, deployed);
  perEdge.forEach((glyphs, i) => {
    recordGlyphs(inv, glyphs, ["🏛️"], { table: "order_sought", id: orderId, item: orderItem });
    // A 'dead_end' edge's 🚧 sits on the order's line, which the Orders criterion counts.
    recordCriterionGlyphs(inv, glyphs, ["🚧"], { table: "order_sought", id: orderId, item: orderItem, instance: "order" });
    const edge = edges[i];
    // No edge at all: jurisdictionEdgeMarkers returned the single synthetic "🏛️" for "no basis
    // recorded". The order's own 🏛️ is recorded above; there is no statement behind it.
    if (edge === undefined || edge.statement_id === null) return;
    recordLawStatementGlyphs(inv, glyphs, { ...edge, statement_id: edge.statement_id });
  });
  return dedupeLineMarkers(perEdge);
}

/** One statement-of-fact line's three keyed rows (design §4): the capture and locator glyphs on
 * the statement, 🗣️/✍️ on the witness, 🖋️/✒️ on the instrument document. Shared by every fact
 * line that prints them -- the shared submission body, and the Notice of Application, Application
 * Response and BCCA fact parts. 👃 and 🏆 never generate, and are recorded for the Evidence
 * criterion (Goal card design §2.7): 👃 on the statement, 🏆 on the instrument whose copy it marks. */
export interface FactStatementKeys {
  statement_id: number;
  witness_id: number;
  witness_name: string;
  instrument_id: number | null;
  instrument_label: string | null;
}

export function recordFactStatementGlyphs(
  inv: MarkerInventory,
  glyphs: string,
  row: FactStatementKeys,
  factPostulate: string
): void {
  if (!glyphs) return;
  const instrument = row.instrument_id === null ? {} : { instrument_id: row.instrument_id };
  const statementItem = `${row.witness_name}: ${factPostulate}`;
  recordGlyphs(inv, glyphs, ["📑", "💬", "📌", "🧷"], {
    table: "statements_of_fact",
    id: row.statement_id,
    item: statementItem,
    witness_id: row.witness_id,
    ...instrument,
  });
  recordCriterionGlyphs(inv, glyphs, ["👃"], { table: "statements_of_fact", id: row.statement_id, item: statementItem, instance: "fact" });
  recordGlyphs(inv, glyphs, ["🗣️", "✍️"], {
    table: "witnesses",
    id: row.witness_id,
    item: row.witness_name,
    statement_id: row.statement_id,
    ...instrument,
  });
  if (row.instrument_id !== null) {
    recordGlyphs(inv, glyphs, ["🖋️", "✒️"], {
      table: "documents",
      id: row.instrument_id,
      item: row.instrument_label ?? "",
      witness_id: row.witness_id,
    });
    recordCriterionGlyphs(inv, glyphs, ["🏆"], { table: "documents", id: row.instrument_id, item: row.instrument_label ?? "" });
  }
}

/** The live ticket holding a key, and the title of the filing it sits on -- null when that filing
 * is the board's own, so the shell prints "ticketed on X" without deriving anything (plan A2). */
export interface ProposalHolder {
  ticket_id: number;
  ticketed_on: string | null;
}

/** One `proposal_rejections` row as derivation reads it: `ticket_id` null for a direct rejection,
 * set for a snapshot row that only hides the Proposal (design §7). */
export interface ProposalRejection {
  ticket_id: number | null;
  marker: string;
  item: string;
}

/** One board Proposal: a keyed row's current rung, with the lane the server assigned it. */
export interface Proposal {
  key: string;
  slug: ProposalSlug;
  marker: string;
  table: string;
  id: number;
  qualifier?: string;
  item: string;
  /** The item's short name in the title (itemLabel); a note-up's is its item whole. */
  label: string;
  title: string;
  lane: "proposed" | "held" | "rejected";
  holder: ProposalHolder | null;
  count?: number; // witnesses-keyed only: distinct statements behind the line (design §8)
  /** A note-up of a statute, regulation or rule only: the job's fixed step texts, one per provision
   * the filing cites, empty when it cites none (withNoteUpSteps). Absent on every other Proposal. */
  steps?: string[];
}

const SLUG_ORDER = Object.fromEntries(
  (Object.keys(WORK_NAMES) as ProposalSlug[]).map((slug, i) => [slug, i])
) as Record<ProposalSlug, number>;

/** The singular noun a long item's record is named by. Written once more, as a table, in
 * `/drafting-data`'s filing-checklists.md §6a, which a session reads to build the same label. */
const RECORD_NOUNS: Readonly<Record<string, string>> = {
  submissions: "submission",
  facts: "fact",
  statements_of_fact: "statement of fact",
  statements_of_law: "statement of law",
  law_assertions: "law assertion",
  order_sought: "order",
  admissions: "admission",
  clauses: "clause",
};

/** An item's short name for a title: the item itself when it is 80 characters or fewer on one
 * line, else its record's noun and id (and qualifier), then its first eight words. The rule is
 * stated for sessions in filing-checklists.md §6a; change both together. */
export function itemLabel(table: string, id: number, qualifier: string | undefined, item: string): string {
  if (item.length <= 80 && !/[\r\n]/.test(item)) return item;
  const noun = Object.hasOwn(RECORD_NOUNS, table) ? RECORD_NOUNS[table] : table.replaceAll("_", " ");
  const words = item.trim().split(/\s+/).slice(0, 8).join(" ");
  return `${noun} ${id}${qualifier === undefined ? "" : `, ${qualifier}`}, "${words}…"`;
}

/** Design §5's ladders, read off the key set alone (decision c): a rung generates work only while
 * no later rung of its own ladder also printed. 📇 is the one positive condition -- an authority
 * is noted up once some statement of it has cleared 📜 📍 🔬. Every slug not named here is its own
 * rung, and the emit sites already print it only when it is due. */
function isCurrentRung(
  entries: readonly ProposalEntry[],
  has: (slug: ProposalSlug, table: string, id: number | undefined) => boolean
): boolean {
  const first = entries[0];
  switch (first.slug) {
    case "authority-pinpoint":
      // A clause's 📍 (the `terms` projection) is its own rung: the 📜 → 📍 ladder is a statement's,
      // keyed on statements_of_law ids, which a clause id must never be read against.
      return first.table !== "statements_of_law" || !has("authority-excerpt", "statements_of_law", first.id);
    case "scrutinize":
      return !has("authority-excerpt", "statements_of_law", first.id) && !has("authority-pinpoint", "statements_of_law", first.id);
    case "primary-authority":
      return !has("doctrinal-basis", "law_assertions", first.id);
    case "draft-it":
      return !has("interview", "witnesses", first.id);
    case "sign-it":
    case "swear-it":
      // Per witness, not per document (design §5 as amended): each 🖋️/✒️ entry carries the witness
      // of the statement that printed it, and any one of them still owing an interview holds the
      // signature back.
      return entries.every((e) => !has("interview", "witnesses", e.witness_id));
    case "testimony-excerpt":
    case "testimony-pinpoint":
      return entries.every(
        (e) =>
          !has("interview", "witnesses", e.witness_id) &&
          !has("draft-it", "witnesses", e.witness_id) &&
          !has("sign-it", "documents", e.instrument_id) &&
          !has("swear-it", "documents", e.instrument_id)
      );
    case "note-up":
      return entries.some((e) => e.cleared === true);
    default:
      return true;
  }
}

/**
 * The board's Proposals and lapsed keys, from one render's inventory plus the proceeding's ticket
 * and rejection state (design §7, §8). Pure: the caller owns every database read, so this is unit-
 * testable without one (plan A1).
 *
 * `holders` maps a key to the queued/wip unrejected ticket holding it; `rejections` maps a key to
 * its `proposal_rejections` row. Both are keyed by `proposalKey`, which is proceeding-wide by
 * construction.
 */
export function deriveProposals(
  inventory: readonly InventoryEntry[],
  holders: ReadonlyMap<string, ProposalHolder>,
  rejections: ReadonlyMap<string, ProposalRejection>
): { proposals: Proposal[]; lapsed_keys: string[] } {
  // A glyph that never generates is in the inventory for the Goal card's criteria alone (Goal card
  // design §2.2), so it is dropped before anything else reads the entries. Proposals ignore `doc`.
  const generating = inventory.filter((e): e is ProposalEntry => e.generating !== false);
  // One Proposal per key; the first entry printed wins every derived field, so a line that turned
  // 🥈 after a 🥉 keeps the glyph the mockup shows first (design §4).
  const groups = new Map<string, ProposalEntry[]>();
  for (const e of generating) {
    const list = groups.get(proposalKey(e));
    if (list === undefined) groups.set(proposalKey(e), [e]);
    else list.push(e);
  }
  const has = (slug: ProposalSlug, table: string, id: number | undefined): boolean =>
    id !== undefined && groups.has(`${slug}:${table}:${id}`);

  const proposals: Proposal[] = [];
  const lapsed_keys: string[] = [];
  for (const [key, entries] of groups) {
    if (!isCurrentRung(entries, has)) continue;
    const first = entries[0];
    const rejection = rejections.get(key);
    const holder = holders.get(key) ?? null;
    let lane: Proposal["lane"] = holder === null ? "proposed" : "held";
    if (rejection !== undefined) {
      if (rejection.marker !== first.marker || rejection.item !== first.item) {
        // A stale row: it no longer describes the work, so it hides nothing and the next Opening
        // deletes it (assumption A5 -- reported whatever lane the Proposal took).
        lapsed_keys.push(key);
      } else if (holder === null) {
        // A snapshot row (ticket_id set) only hides the Proposal behind its ticket; a direct
        // rejection (ticket_id null) puts it in Shelved (design §7).
        if (rejection.ticket_id !== null) continue;
        lane = "rejected";
      }
    }
    // A note-up keeps its item whole: the authority's name is what one job per Act groups on, and
    // withNoteUpSteps builds each step from the title.
    const label = first.slug === "note-up" ? first.item : itemLabel(first.table, first.id, first.qualifier, first.item);
    proposals.push({
      key,
      slug: first.slug,
      marker: first.marker,
      table: first.table,
      id: first.id,
      ...(first.qualifier === undefined ? {} : { qualifier: first.qualifier }),
      item: first.item,
      label,
      title: `${WORK_NAMES[first.slug]}: ${label}`,
      lane,
      holder,
      ...(first.table === "witnesses" ? { count: new Set(entries.map((e) => e.statement_id)).size } : {}),
    });
  }

  // Card order first (design §4's table), then the keyed row, so the pick list reads as the cards
  // do (assumption A10).
  proposals.sort(
    (a, b) =>
      SLUG_ORDER[a.slug] - SLUG_ORDER[b.slug] ||
      a.table.localeCompare(b.table) ||
      a.id - b.id ||
      (a.qualifier ?? "").localeCompare(b.qualifier ?? "")
  );
  return { proposals, lapsed_keys };
}

/** The keys of the note-up Proposals in the Proposed lane: unheld and unshelved. A render reports
 * them as `note_up_due`, and the session writes them into the Writing's one `Note up all cited
 * authorities` job or adds them to it (`/drafting-data` jobs-create.md §3k). */
export function noteUpDue(proposals: readonly Proposal[]): string[] {
  return proposals.filter((p) => p.slug === "note-up" && p.lane === "proposed").map((p) => p.key);
}

/** A provision as a pinpoint or running text cites it: a rule or section word, then its number --
 * "r. 9-6(3)", "Rule 14-1(12)", "s 21(1)(a)". */
const PROVISION = /(?<![\w'’])((?:sub)?(?:rule|section)s?\s+|(?:rr?|ss?)(?:\.\s*|\s+))(\d+(?:[-.]\d+)*(?:\([0-9a-z.]+\))*)/gi;

/** Each provision `text` cites, as written. `identity` is the provision ("r:9-6(3)"), and
 * `signature` its form, the word and the number's shape ("r:N-N"), which "r. 9-6(3)" and
 * "Rule 14-1(12)" share. */
function provisionsIn(text: string): { text: string; identity: string; signature: string }[] {
  return [...text.matchAll(PROVISION)].map((m) => {
    const word = /^(?:sub)?r/i.test(m[1]) ? "r" : "s";
    return { text: m[0], identity: `${word}:${m[2].toLowerCase()}`, signature: `${word}:${m[2].replace(/\(.*$/, "").replace(/\d+/g, "N")}` };
  });
}

/**
 * A note-up of a statute, regulation or rule is done provision by provision, so its Proposal
 * carries one fixed step per provision the filing cites, `<title>, <provision>`: first each
 * pinpoint the filing printed 📇 on, then each provision cited only in a contention of the filing,
 * as written there. A contention's provision belongs to the one authority whose statements of law
 * (`pinpoints`, the proceeding's legislation) cite provisions of its form, and to none when no
 * authority or several do. `steps` is empty when the filing cites no provision. A case's Proposal,
 * and one recorded before entries carried `provision`, is returned unchanged.
 */
export function withNoteUpSteps(
  proposals: readonly Proposal[],
  inventory: readonly InventoryEntry[],
  pinpoints: readonly { authority_id: number; pinpoint: string }[],
  contentions: readonly string[]
): Proposal[] {
  const owners = new Map<string, Set<number>>();
  for (const p of pinpoints) {
    for (const c of provisionsIn(p.pinpoint)) owners.set(c.signature, (owners.get(c.signature) ?? new Set()).add(p.authority_id));
  }
  const cited = contentions.flatMap(provisionsIn);
  return proposals.map((proposal) => {
    const entries = inventory.filter(
      (e): e is ProposalEntry => e.generating !== false && e.provision !== undefined && proposalKey(e) === proposal.key
    );
    if (proposal.slug !== "note-up" || entries.length === 0) return proposal;
    const steps = new Map<string, string>(); // identity, or the pinpoint as written when it names none -> as written
    for (const e of entries) {
      if (!e.provision) continue;
      const identity = provisionsIn(e.provision)[0]?.identity ?? e.provision;
      if (!steps.has(identity)) steps.set(identity, e.provision);
    }
    for (const c of cited) {
      const by = owners.get(c.signature);
      if (by?.size === 1 && by.has(proposal.id) && !steps.has(c.identity)) steps.set(c.identity, c.text);
    }
    return { ...proposal, steps: [...steps.values()].map((p) => `${proposal.title}, ${p}`) };
  });
}
