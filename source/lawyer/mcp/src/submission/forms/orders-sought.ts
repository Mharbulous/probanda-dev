// The order_sought rows a filing document deploys, with their jurisdictional-basis edges.

import { submissionDataQuery } from "../backend.js";
import type { JurisdictionRequiresEdge } from "./markers.js";
import type { PointerDocument } from "./submission-reads.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** One order_sought row deployed by one filing document, its jurisdictional-basis edges
 * (order_sought_requires, 0..N -- schema v10 #380 replaced the old single jurisdiction_slot_state
 * column) attached. `crossed_out_on` (📅⊕∅) is the pursued axis; `hasServedBy` backs 🦵 unserved
 * petitum -- callers on a document that doesn't want that glyph (the requisition renderers, which
 * never called jurisdictionLadderMarker either) can simply not read it. Shared by every renderer
 * that shows order_sought (VanIAC's Written Argument, the NoA's Part 1, the requisition
 * renderers), one query shape instead of three drifting copies. */
export interface OrderSoughtRow {
  id: number;
  wording: string;
  wording_override: string | null;
  amount: number | null;
  template_key: string | null;
  template_values: string | null;
  crossed_out_on: string | null;
  filing_ordinal: number;
  /** filing_orders.id -- 🧵 loose-thread keys on the venue form's pointer row, not the order
   * (design §4). Read by the Proposal inventory alone; nothing rendered uses it. */
  pointer_id: number;
  hasServedBy: boolean;
  requires: JurisdictionRequiresEdge[];
}

export function fetchOrdersSought(dbPath: string, filingId: number, document: PointerDocument): OrderSoughtRow[] {
  const orders = rows<{
    id: number;
    wording: string;
    wording_override: string | null;
    amount: number | null;
    template_key: string | null;
    template_values: string | null;
    crossed_out_on: string | null;
    filing_ordinal: number;
    pointer_id: number;
    has_served_by: number;
  }>(
    dbPath,
    `SELECT o.id, o.wording, fo.wording_override, o.amount, o.template_key, o.template_values,
            o.crossed_out_on, fo.ordinal AS filing_ordinal, fo.id AS pointer_id,
            EXISTS(
              SELECT 1 FROM order_sought_served_by sb
              JOIN submissions s ON s.id = sb.submission_id
              WHERE sb.order_sought_id = o.id AND s.killed_on IS NULL
            ) AS has_served_by
     FROM filing_orders fo
     JOIN order_sought o ON o.id = fo.order_sought_id
     WHERE fo.filing_id = ? AND fo.document = ?
     ORDER BY fo.ordinal`,
    [filingId, document]
  );
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const edgesByOrder = fetchJurisdictionEdges(dbPath, ids);
  return orders.map((o) => ({ ...o, hasServedBy: o.has_served_by === 1, requires: edgesByOrder.get(o.id) ?? [] }));
}

/** order_sought_requires edges for a set of orders, grouped by order id (schema v10, #380). Shared by
 * fetchOrdersSought (venue faces) and the reserve inventory's proceeding-wide orders. */
export function fetchJurisdictionEdges(dbPath: string, orderIds: number[]): Map<number, JurisdictionRequiresEdge[]> {
  const edgesByOrder = new Map<number, JurisdictionRequiresEdge[]>();
  if (orderIds.length === 0) return edgesByOrder;
  const placeholders = orderIds.map(() => "?").join(",");
  const edges = rows<{ order_sought_id: number } & JurisdictionRequiresEdge>(
    dbPath,
    `SELECT req.order_sought_id, req.basis_state, sl.id AS statement_id, sl.excerpt, sl.pinpoint, sl.source, sl.verification,
            auth.treatment, auth.kind AS authority_kind, auth.currency_status, auth.currency_checked_on, auth.killed_on AS authority_killed_on,
            auth.id AS authority_id, auth.style_of_cause_or_title AS authority_title, auth.citation AS authority_citation
     FROM order_sought_requires req
     LEFT JOIN statements_of_law sl ON sl.id = req.excerpt_id
     LEFT JOIN authorities auth ON auth.id = sl.authority_id
     WHERE req.order_sought_id IN (${placeholders})`,
    orderIds
  );
  for (const e of edges) {
    const list = edgesByOrder.get(e.order_sought_id) ?? [];
    list.push(e);
    edgesByOrder.set(e.order_sought_id, list);
  }
  return edgesByOrder;
}
