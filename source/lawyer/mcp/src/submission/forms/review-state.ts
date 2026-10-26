// The 🧐 review snapshot a render reads, and the marker printed from it.

import { counselReviewMarker, REVIEW_SNAPSHOT_FIELDS, reviewKey, reviewSnapshotSql, type ReviewedTable } from "./markers.js";
import type { OrderSoughtRow } from "./orders-sought.js";
import { recordCriterionGlyphs, type MarkerInventory } from "./proposal-inventory.js";
import { rhetoricHeld, treatmentNoteHeld } from "./query.js";
import { rows } from "../query-rows.js";

/** Every reviewed object's current snapshot and its latest approval (review.md). Keyed `${table}:${id}`. */
export interface ReviewState {
  current: ReadonlyMap<string, string>;
  approved: ReadonlyMap<string, string>;
}

/** One read per map. `current` computes each of the proceeding's reviewed rows' snapshot with the
 * same json_object expression the approval writer stores, so equality is byte equality (review.md,
 * "Snapshot fields"). `approved` is the latest approval per object -- greatest `id`, the table being
 * append-only -- across the whole database, since review_approvals carries no proceeding_id and ids
 * are unique per table. filing_prose and filing_orders have no proceeding_id: a prose slot's or a
 * filing's order row's proceeding is its filing's. A database held below v71 has no
 * rhetorical_paragraphs table, so the read skips it there. */
export function fetchReviewState(dbPath: string, proceedingId: number): ReviewState {
  const held = rhetoricHeld(dbPath);
  const tables = (Object.keys(REVIEW_SNAPSHOT_FIELDS) as ReviewedTable[]).filter((t) => held || t !== "rhetorical_paragraphs");
  const scope = (t: ReviewedTable) =>
    t === "filing_prose" || t === "filing_orders" ? "filing_id IN (SELECT id FROM filings WHERE proceeding_id = ?)" : "proceeding_id = ?";
  const noteHeld = treatmentNoteHeld(dbPath);
  const current = rows<{ entity: string; entity_id: number; snapshot: string }>(
    dbPath,
    tables
      .map((t) => `SELECT '${t}' AS entity, id AS entity_id, ${reviewSnapshotSql(t, noteHeld)} AS snapshot FROM ${t} WHERE ${scope(t)}`)
      .join(" UNION ALL "),
    Array(tables.length).fill(proceedingId)
  );
  const approved = rows<{ entity: string; entity_id: number; snapshot: string }>(
    dbPath,
    `SELECT entity, entity_id, snapshot FROM review_approvals ra
     WHERE ra.id = (SELECT MAX(id) FROM review_approvals WHERE entity = ra.entity AND entity_id = ra.entity_id)`
  );
  return {
    current: new Map(current.map((r) => [reviewKey(r.entity, r.entity_id), r.snapshot])),
    approved: new Map(approved.map((r) => [reviewKey(r.entity, r.entity_id), r.snapshot])),
  };
}

/** 🧐 for one object on one forum line: the predicate over the line's other glyphs (design §3), recorded
 * on the object with `changed` when an earlier approval exists. Returns "🧐" or "". A caller with no
 * review state (the reserve inventory) gets "" and records nothing. */
export function reviewMarkerFor(
  review: ReviewState | undefined,
  inv: MarkerInventory | undefined,
  lineGlyphs: string,
  table: ReviewedTable,
  id: number,
  item: string
): string {
  if (review === undefined) return "";
  const key = reviewKey(table, id);
  const current = review.current.get(key);
  if (current === undefined) return ""; // not a row of this proceeding: nothing to review
  const approved = review.approved.get(key) ?? null;
  const glyph = counselReviewMarker(lineGlyphs, current, approved);
  if (glyph && inv) recordCriterionGlyphs(inv, glyph, ["🧐"], { table, id, item, ...(approved === null ? {} : { changed: true as const }) });
  return glyph;
}

/** 🧐 on an order line (review.md, "Snapshot fields"): the order's own, or this filing's
 * `filing_orders` row's while that row holds the filing's own wording. A NULL override raises
 * nothing by itself. Each object records its own entry; the line prints one 🧐. */
export function orderReviewMarkerFor(
  review: ReviewState | undefined,
  inv: MarkerInventory | undefined,
  lineGlyphs: string,
  order: Pick<OrderSoughtRow, "id" | "pointer_id" | "wording" | "wording_override">
): string {
  const own = reviewMarkerFor(review, inv, lineGlyphs, "order_sought", order.id, order.wording);
  const override = order.wording_override === null ? "" : reviewMarkerFor(review, inv, lineGlyphs, "filing_orders", order.pointer_id, order.wording);
  return own || override;
}
