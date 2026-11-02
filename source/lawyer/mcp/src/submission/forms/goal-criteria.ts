// The Goal card's stock and declared completion criteria, and how a render's inventory counts them.

import { DataServerError } from "../../errors.js";
import { storedLayout } from "./layout-snapshot.js";
import { proposalKey, type GlyphInstance, type InventoryEntry, type NonGeneratingGlyph, type ProposalSlug } from "./proposal-inventory.js";
import type { FilingRow } from "./query.js";
import { NO_TO_RECIPIENT_TABLE } from "./render-general.js";
import type { CriterionId, GoalCriterion } from "./work-board-data.js";

// ---------------------------------------------------------------------------------------------
// The Goal card (planning/1. Design/2026-09-21_goal-card-and-prepare-design.md §2). Derived here,
// in the render call that derives the Proposals and from the same inventory, and never stored.
// ---------------------------------------------------------------------------------------------

/** Whether one inventory entry is a member of a criterion (design §2.6, §2.7). */
type Member = (e: InventoryEntry) => boolean;

const slugs =
  (...members: ProposalSlug[]): Member =>
  (e) =>
    e.generating && members.includes(e.slug);

/** A glyph that never generates; with `instances`, only those instances of it. */
const glyph =
  (marker: NonGeneratingGlyph, ...instances: GlyphInstance[]): Member =>
  (e) =>
    !e.generating && e.marker === marker && (instances.length === 0 || (e.instance !== undefined && instances.includes(e.instance)));

/** Every non-generating ⬜ but the instance a declared orders criterion counts (design §2.7). */
const unchosenExcept =
  (instance: GlyphInstance): Member =>
  (e) =>
    !e.generating && e.marker === "⬜" && e.instance !== instance;

const anyOf =
  (...members: Member[]): Member =>
  (e) =>
    members.some((m) => m(e));

/** One inventory criterion. Every one counts only the documents that go to the forum. */
export interface StockCriterion {
  id: CriterionId;
  text: string;
  members: Member;
}

const PRIMARY_AUTHORITY: StockCriterion = {
  id: "primary-authority",
  text: "Every proposition of law rests on primary authority",
  members: anyOf(slugs("doctrinal-basis", "primary-authority", "authority-rating"), glyph("🏅"), glyph("🚧", "proposition"), glyph("📖", "proposition")),
};
const EXCERPTS: StockCriterion = {
  id: "excerpts",
  text: "Every excerpt is quoted, pinpointed and checked",
  members: anyOf(slugs("authority-excerpt", "authority-pinpoint", "scrutinize"), glyph("🔬"), glyph("👃", "law")),
};
const NOTING_UP: StockCriterion = {
  id: "noting-up",
  text: "Note up all cited authorities",
  // 📇's non-generating instances: a statute, regulation or rule found repealed or archived (#1628),
  // and a citation in the text that no authorities row tracks (citation-scan.ts).
  members: anyOf(slugs("note-up"), glyph("📇")),
};
const EVIDENCE: StockCriterion = {
  id: "evidence",
  text: "Every fact is proved by evidence in hand",
  members: anyOf(
    slugs("exhibit-excerpt", "testimony-excerpt", "exhibit-pinpoint", "testimony-pinpoint", "interview", "draft-it", "sign-it", "swear-it", "serve-it", "enter-it"),
    glyph("👤"),
    glyph("👃", "fact"),
    glyph("🏆"),
    glyph("🚧", "fact")
  ),
};
const OPEN_ITEMS_TEXT = "Nothing is left open on the form";
/** Open items' members on every type, bar the ⬜ instance and the ↩️ other declared criteria may count. */
const OPEN_ITEMS_COMMON = anyOf(slugs("loose-thread", "factual-basis", "proposition", "not-recorded", "unchosen", "choose-template"), glyph("🧩"), glyph("🕵️"));
const COUNSEL_REVIEW: StockCriterion = { id: "counsel-review", text: "Counsel has reviewed every paragraph", members: glyph("🧐") };
/** The 🧩 line a general Writing declaring `recipients` prints with no To recipient (#1234). */
const NO_TO_RECIPIENT: Member = (e) => glyph("🧩")(e) && e.table === NO_TO_RECIPIENT_TABLE;

/** Every declared criterion but `open-items`, whose members depend on what else is declared. A Map,
 * so a stored name such as "constructor" finds nothing rather than a prototype member. */
const DECLARABLE_LIST: StockCriterion[] = [
  {
    id: "orders-sought",
    text: "Every order asked for has a legal basis and a submission behind it",
    members: anyOf(slugs("jurisdictional-basis", "unserved-petitum"), glyph("⬜", "associate-judge"), glyph("🚧", "order")),
  },
  { id: "orders-positioned", text: "Every order the applicant asks for has a position", members: glyph("⬜", "unpositioned-order") },
  PRIMARY_AUTHORITY,
  EXCERPTS,
  NOTING_UP,
  EVIDENCE,
  { id: "opposing-points", text: "Every opposing point is answered", members: glyph("↩️") },
  COUNSEL_REVIEW,
  // 📌 and 📍 on clause rows (shared/declared-layout.md section 6).
  { id: "terms-traced", text: "Every clause traces to the offer or acceptance", members: (e) => e.table === "clauses" && (e.marker === "📑" || e.marker === "📌" || e.marker === "📍") },
  { id: "recipients", text: "The Writing is addressed to a recipient", members: NO_TO_RECIPIENT },
];
const DECLARABLE = new Map<string, StockCriterion>(DECLARABLE_LIST.map((c) => [c.id, c]));

/** Open items: every ⬜ but the instance a declared orders criterion counts, ↩️ unless opposing
 * points counts it, and every 🧩 but the one a declared `recipients` counts, so no work marker on a
 * forum document goes uncounted, or counted twice (design §2.7). */
function openItems(declared: readonly string[]): StockCriterion {
  const counted = declared.includes("orders-sought") ? "associate-judge" : declared.includes("orders-positioned") ? "unpositioned-order" : null;
  const unchosen = counted === null ? glyph("⬜") : unchosenExcept(counted);
  const common: Member = declared.includes("recipients") ? (e) => OPEN_ITEMS_COMMON(e) && !NO_TO_RECIPIENT(e) : OPEN_ITEMS_COMMON;
  return {
    id: "open-items",
    text: OPEN_ITEMS_TEXT,
    members: declared.includes("opposing-points") ? anyOf(common, unchosen) : anyOf(common, unchosen, glyph("↩️")),
  };
}

/** The Writing's goal criteria: its stored layout's `goal_criteria`, in their declared order
 * (spec §5 "Work Board"; shared/declared-layout.md sections 5-6). Empty where the type declares
 * none, and on a row with no stored layout (a seeded test row; every real database is snapshotted
 * since v30). A name outside the vocabulary fails hard, naming the filing. `hearing-date` is
 * skipped: it is not an inventory criterion (hearingDateCriterion). */
export function declaredCriteria(filing: FilingRow): StockCriterion[] {
  if (filing.layout_snapshot === null) return [];
  const raw = storedLayout(filing).layout.goal_criteria;
  if (raw === undefined) return [];
  const bad = (why: string): never => {
    throw new DataServerError(`"${filing.title}": its stored completion criteria ${why}`, "invalid_layout_snapshot");
  };
  if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) return bad("is not an array of names");
  const declared = raw as string[];
  return declared
    .filter((name) => name !== "hearing-date")
    .map((name) => (name === "open-items" ? openItems(declared) : DECLARABLE.get(name) ?? bad(`names "${name}", which is not a goal criterion`)));
}

/** The doc tag forms.ts stamps on the reserve inventory's entries (recordReserveInventory), which no
 * document prints. Kept as the retired brief's documentType because render manifests already
 * on disk carry it, and an older copy of the plugin reading a newer manifest filters by this name. */
export const RESERVE_INVENTORY_DOC = "Counsel_brief";

/** The inventory tags that never go to the forum (design §2.2): the one list. The Goal card filters
 * the inventory by it. */
export const NEVER_DELIVERED_DOCS: ReadonlySet<string> = new Set([RESERVE_INVENTORY_DOC, "Work_board"]);

/** Whether one inventory entry is work the `evidence` criterion counts, on a document that goes to
 * the forum: the Material Facts and Procedural History pages read it per statement of fact (facts-pages.ts). */
export function isEvidenceWork(e: InventoryEntry): boolean {
  return !NEVER_DELIVERED_DOCS.has(e.doc) && EVIDENCE.members(e);
}

/** Met when no forum-document entry matches; pending with no inventory (design §2.4). Matches count
 * once per keyed row: a generating entry per (slug, row), as a Proposal does, and only while its key
 * is in `current` -- a row at a later rung of its ladder is not counted twice -- and any other per
 * (glyph, row), since one glyph is recorded once per edge and once per forum document printing its
 * line. A shelved Proposal's entries count as met and are named as such -- bar a note-up, which
 * stays open because /draft makes noting up mandatory before filing. A suppressed 👤 (schema v69)
 * counts as met too, listed last as 🤫 and named as suppressed. */
export function inventoryCriterion(
  def: StockCriterion,
  forum: readonly InventoryEntry[] | null,
  shelved: ReadonlySet<string>,
  current: ReadonlySet<string>
): GoalCriterion {
  if (forum === null) return { id: def.id, text: def.text, state: "pending", outstanding: 0, items: [], source: "inventory" };
  const matches = new Map<string, InventoryEntry>();
  for (const e of forum) {
    if (!def.members(e)) continue;
    if (e.generating && !current.has(proposalKey(e))) continue;
    const key = e.generating ? proposalKey(e) : `${e.marker}:${e.table}:${e.id}`;
    if (!matches.has(key)) matches.set(key, e);
  }
  const open: [string, string][] = [];
  const shelvedItems: [string, string][] = [];
  const suppressed: [string, InventoryEntry][] = [];
  for (const [key, e] of matches) {
    if (e.generating && e.slug !== "note-up" && shelved.has(key)) shelvedItems.push([key, `${e.item} — shelved by you`]);
    else if (!e.generating && e.suppressed) suppressed.push([key, e]);
    else open.push([key, e.item]);
  }
  const listed: [string, string][] = [...open, ...shelvedItems, ...suppressed.map(([key, e]): [string, string] => [key, `🤫 ${e.item} — suppressed by you`])];
  const items = listed.map(([, item]) => item);
  return {
    id: def.id,
    text: def.text,
    state: open.length === 0 ? "met" : "unmet",
    outstanding: open.length,
    items,
    source: "inventory",
    ...(suppressed.length > 0
      ? { replaces: [...new Array<null>(open.length + shelvedItems.length).fill(null), ...suppressed.map(([, e]) => e.marker)] }
      : {}),
    ...(new Set(items).size < items.length ? { locators: listed.map(([key]) => key) } : {}),
  };
}
