// The practice item as practice.db keeps it, and the one generic flattening
// that turns it back into the row the practice tools have always returned
// (docs/Plans/2026-10-14_practice-db-conversion.md, "How each current table maps").

/** One item under the `item` namespace, keyed by its UUID. */
export interface Item {
  kind: string;
  /** Every field the cloud never sees in clear. */
  data: Record<string, unknown>;
  /** Vocabulary values, as the cloud last returned them. */
  tags: Record<string, unknown>;
  state: string | null;
  /** Role to item id (or, for `filing`, the filing reference). */
  links: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type Row = Record<string, unknown>;

// The state's field name in the old row, where it is not `status`.
const STATE_FIELD: Record<string, string> = { signal: "state", payment: "cleared" };

function stateValue(field: string, state: string): unknown {
  return field === "cleared" ? state === "true" : state;
}

/** id, every data field, each tag, the state under its old field name, and each link as `<role>_id` (filing as filing_ref). */
export function flatten(id: string, item: Item): Row {
  const row: Row = { id, ...item.data, ...item.tags };
  if (item.state !== null && item.state !== undefined) {
    const field = STATE_FIELD[item.kind] ?? "status";
    row[field] = stateValue(field, item.state);
  }
  for (const [role, target] of Object.entries(item.links)) row[role === "filing" ? "filing_ref" : `${role}_id`] = target;
  row.created_at = item.created_at;
  row.updated_at = item.updated_at;
  return row;
}

/** Every item of one kind, flattened, oldest first. */
export function rowsOf(items: Map<string, Item>, kind: string): Row[] {
  const rows: Row[] = [];
  for (const [id, item] of items) if (item.kind === kind) rows.push(flatten(id, item));
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

/** How a question names an item: its id and the first descriptive field it holds. */
export function describe(id: string, item: { data?: Record<string, unknown>; tags?: Record<string, unknown> } | undefined): string {
  const data = item?.data ?? {};
  const label = [data.description, data.name, data.rule_description, data.status_label, data.source_document]
    .find((value) => typeof value === "string" && value !== "");
  if (label !== undefined) return `${id} "${String(label)}"`;
  const tags = Object.values(item?.tags ?? {}).filter((value) => typeof value === "string");
  return tags.length ? `${id} (${tags.join(", ")})` : id;
}
