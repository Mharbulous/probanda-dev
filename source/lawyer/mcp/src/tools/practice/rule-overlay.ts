// Firm rule overlay (deadline-rule-overlay spec §6). A court-rule change is stored as one
// record per deadline-type row per effective period, and every deadline calculation
// resolves the shipped rule files against these records. The overlay is firm-wide and
// matter-free. The record is plugin-made cross data: it travels to Probanda's Cloud as it
// is, which checks its contract (R9), after this machine has refused any string in it
// matching the client matter-code pattern (L3, practice/ops.ts). Phase 2 (legal-commons
// sharing) reuses the record unchanged.

import { randomUUID } from "node:crypto";

import { ValidationError } from "../../errors.js";
import type { PracticeStore } from "../../practice/store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The record's vocabularies, which the tool's input schema lists (schema-gen.ts).
export const RULE_OVERLAY_STATUSES = ["verified", "unverified", "superseded_by_shipped", "conflict"];
export const OFFSET_UNITS = ["days", "business_days", "months", "years"];
export const OFFSET_DIRECTIONS = ["before", "after"];
// The counting methods the rule files already define.
export const COUNTING_METHODS = [
  "calendar",
  "forward_n_business_days",
  "backward_n_business_days",
  "backward_full_business_days",
];
export const SEMANTICS = ["mandatory", "earliest_permissible", "latest_permissible", "permissive"];
export const SOURCE_KINDS = ["oic_pdf", "consolidation", "regulation"];

type Fields = Record<string, unknown>;

// Writes the record: a new one, or the one with the same record_id replaced. Returns the stored record.
export async function upsert_rule_overlay(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Fields> {
  const input = args.record;
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ValidationError("record must be an object");
  const given = (input as Fields).record_id;
  if (given !== undefined && given !== null && (typeof given !== "string" || !UUID.test(given))) {
    throw new ValidationError("record.record_id must be a UUID, or omitted on a first write");
  }
  const { record_id: _given, ...fields } = input as Fields;
  const record: Fields = { record_id: typeof given === "string" ? given.toLowerCase() : randomUUID(), ...fields };
  const id = String(record.record_id);
  const instrument = record.amending_instrument as Fields | null | undefined;

  const { items } = await store.write("upsert_rule_overlay", {}, [{
    op: "upsert", id, kind: "rule_overlay",
    state: record.status as string | undefined,
    tags: { deadline_type: record.deadline_type, amending_reg: instrument?.reg },
    crossTags: ["amending_reg"],
    data: { record },
    cross: record,
  }]);
  return items.get(id)?.data.record as Fields;
}

function compare(a: unknown, b: unknown): number {
  const [x, y] = [String(a ?? ""), String(b ?? "")];
  return x < y ? -1 : x > y ? 1 : 0;
}

// Every overlay record, optionally filtered, sorted by deadline_type then effective_from.
export async function rule_overlay(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ records: Fields[] }> {
  const records = store.rows("rule_overlay")
    .filter((row) => ["deadline_type", "amending_reg", "status"].every((key) => !args[key] || row[key] === String(args[key])))
    .map((row) => row.record as Fields);
  records.sort((a, b) => compare(a.deadline_type, b.deadline_type) || compare(a.effective_from, b.effective_from));
  return { records };
}
