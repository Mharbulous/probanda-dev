import { randomUUID } from "node:crypto";

import { UnscopedAdmin, exactlyOne } from "../../db/scope.js";
import { AmbiguousMatchError, NotFoundError, ValidationError } from "../../errors.js";
import { practiceEntityFor } from "../../practice-registry.js";
import type { EntityDefinition } from "../../registry.js";

export interface MatterRef {
  matt_num?: unknown;
  file_number?: unknown;
  matter_id?: unknown;
}

export interface ResolvedMatter {
  id: string;
  row: Record<string, unknown>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

function omit(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const blocked = new Set(fields);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !blocked.has(key)));
}

// Insert a fresh row: generate the client uuid and stamp owner_id.
export async function insertRow(
  admin: UnscopedAdmin,
  ownerId: string,
  entity: EntityDefinition,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = newId();
  const inserted = await admin.insert(entity, { ...fields, id, owner_id: ownerId });
  return exactlyOne(inserted, entity.table, "insert");
}

// PATCH an existing row by id: write the provided fields under the existing id
// (never send id/owner_id/created_at). Undefined fields are dropped by JSON
// serialization, so only provided columns change.
export async function patchById(
  admin: UnscopedAdmin,
  ownerId: string,
  entity: EntityDefinition,
  id: string,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const body = omit(fields, ["id", "owner_id", "created_at"]);
  const updated = await admin.update(entity, { id: `eq.${id}` }, body);
  return exactlyOne(updated, entity.table, "update");
}

// Natural-key upsert (P-D9): look up by the key filters → PATCH the existing row
// under its stable id, else INSERT with a new uuid. Never PostgREST on_conflict
// (crypto trap 2 / F2 / F3).
export async function upsertByKey(
  admin: UnscopedAdmin,
  ownerId: string,
  entity: EntityDefinition,
  keyFilters: Record<string, string>,
  fields: Record<string, unknown>
): Promise<{ row: Record<string, unknown>; created: boolean }> {
  const existing = await admin.query(entity, keyFilters, { limit: 2 });
  if (existing.length > 1) {
    throw new AmbiguousMatchError(`${existing.length} ${entity.table} rows matched the natural key`);
  }
  if (existing.length === 1) {
    const id = String(existing[0].id);
    return { row: await patchById(admin, ownerId, entity, id, fields), created: false };
  }
  return { row: await insertRow(admin, ownerId, entity, fields), created: true };
}

// The firm's matter reference is `{client}.{matter}` (e.g. `8575.L8443`), so a
// leading `2575.` or bare `.` is the client prefix and separator, not part of the
// matter number. Stored values carry none; normalizing every inbound matt_num
// keeps `8575.L8443`, `.L8443` and `L8443` resolving to the same matter (#883).
export function normalizeMattNum(value: unknown): string {
  return String(value).replace(/^\d*\./, "");
}

// A matter is billable unless explicitly flagged otherwise; an undefined/missing
// matter (e.g. a row not yet loaded) also counts as billable, matching
// prior behavior for callers that only recently started checking this flag.
export function isBillable(matter: Record<string, unknown> | undefined): boolean {
  return matter?.billable !== false;
}

// Resolve a matter by uuid, matt_num, or file_number.
// Returns null when no ref is given or nothing matches (absence-is-unknown).
export async function resolveMatter(
  admin: UnscopedAdmin,
  ownerId: string,
  ref: MatterRef
): Promise<ResolvedMatter | null> {
  const matters = practiceEntityFor("practice_matters");
  let filters: Record<string, string> | null = null;
  if (ref.matter_id) filters = { id: `eq.${String(ref.matter_id)}` };
  else if (ref.matt_num) filters = { matt_num: `eq.${normalizeMattNum(ref.matt_num)}` };
  else if (ref.file_number) filters = { file_number: `eq.${String(ref.file_number)}` };
  if (!filters) return null;

  const rows = await admin.query(matters, filters, { limit: 2 });
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new AmbiguousMatchError("Matter reference matched more than one matter");
  return { id: String(rows[0].id), row: rows[0] };
}

export async function requireMatter(
  admin: UnscopedAdmin,
  ownerId: string,
  ref: MatterRef
): Promise<ResolvedMatter> {
  const resolved = await resolveMatter(admin, ownerId, ref);
  if (!resolved) throw new NotFoundError("No matter matched the supplied reference");
  return resolved;
}

// Load all of the owner's clients, keyed by id — practice_clients is a
// tiny table, so a single fetch beats per-matter round-trips (P-D5).
export async function loadClientsById(
  admin: UnscopedAdmin,
  ownerId: string
): Promise<Map<string, Record<string, unknown>>> {
  const clients = practiceEntityFor("practice_clients");
  const rows = await admin.query(clients, {});
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    map.set(String(row.id), row);
  }
  return map;
}

export function clientContext(
  client: Record<string, unknown> | undefined
): { client_name: unknown; client_num: unknown } {
  return {
    client_name: client?.name ?? null,
    client_num: client?.client_num ?? null,
  };
}

// The 8 default lifecycle policies, verbatim from practice-data/SKILL.md.
const DEFAULT_POLICIES: Array<Record<string, unknown>> = [
  { status_label: "prospective", required_signals: "[]", blocking_signals: '["conflict_check_completed"]', auto_advance: true, description: "File opened; conflict check not yet completed" },
  { status_label: "intake", required_signals: '["conflict_check_completed"]', blocking_signals: '["retainer_agreement_signed"]', auto_advance: true, description: "Conflict check done; retainer agreement not yet signed" },
  { status_label: "active", required_signals: '["retainer_agreement_signed","deposit_received"]', blocking_signals: null, auto_advance: true, description: "Retainer signed and deposit received; work in progress" },
  { status_label: "retainer_warning", required_signals: '["retainer_agreement_signed"]', blocking_signals: null, auto_advance: true, description: "Active matter; retainer balance at or below replenishment threshold" },
  { status_label: "retainer_depleted", required_signals: '["retainer_agreement_signed"]', blocking_signals: null, auto_advance: true, description: "Active matter; retainer balance confirmed zero" },
  { status_label: "closing", required_signals: "[]", blocking_signals: null, auto_advance: false, description: "Work substantially complete; representation not yet formally ended" },
  { status_label: "closed", required_signals: '["representation_ended"]', blocking_signals: null, auto_advance: true, description: "Representation formally ended" },
  { status_label: "declined", required_signals: '["conflict_check_completed"]', blocking_signals: null, auto_advance: false, description: "Conflict identified or matter not accepted" },
];

// Insert-if-absent the default policies for this owner. Ids may be
// DB-generated. Idempotent: only inserts labels not already present.
export async function ensureDefaultPolicies(admin: UnscopedAdmin, ownerId: string): Promise<void> {
  const policies = practiceEntityFor("practice_status_policies");
  const existing = await admin.query(policies, {}, { limit: 1000 });
  const present = new Set(existing.map((row) => String(row.status_label)));
  const missing = DEFAULT_POLICIES.filter((policy) => !present.has(String(policy.status_label)));
  if (missing.length === 0) return;
  const rows = missing.map((policy) => ({ ...policy, owner_id: ownerId }));
  await admin.insertMany(policies, rows);
}

export interface InvoiceCutoffRow {
  issue_date?: unknown;
  date_to?: unknown;
}

export interface EffectiveCutoff {
  cutoff_date: string;
  cutoff_source: "date_to" | "issue_date";
}

// Adds whole calendar days to an ISO 8601 date-only string ("YYYY-MM-DD"),
// returning the same format. UTC arithmetic avoids local-timezone DST
// surprises since these are date-only values with no time component.
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// The latest date through which a matter's billed time is accounted for,
// derived from its invoices (Step 2 cutoff migration, 2026-08-26): an
// invoice with `date_to` set contributes `date_to + 1 day` (the actual
// billing-period end); one without it falls back to `issue_date` (the
// pre-existing proxy). Returns the MAXIMUM candidate across all invoices,
// not the row with the latest issue_date -- a later-issued invoice can cover
// an earlier period than a prior invoice's date_to, and issue_date itself
// may be NULL, so row selection by issue_date alone can miss a real date_to.
// Ties prefer the date_to-derived candidate (the more precise source).
// Returns null when no invoice yields a candidate (no invoices, or every
// invoice has both fields NULL).
export function effectiveCutoff(rows: InvoiceCutoffRow[]): EffectiveCutoff | null {
  let best: EffectiveCutoff | null = null;
  for (const row of rows) {
    let candidate: EffectiveCutoff | null = null;
    if (typeof row.date_to === "string" && row.date_to) {
      candidate = { cutoff_date: addDaysIso(row.date_to, 1), cutoff_source: "date_to" };
    } else if (typeof row.issue_date === "string" && row.issue_date) {
      candidate = { cutoff_date: row.issue_date, cutoff_source: "issue_date" };
    }
    if (!candidate) continue;
    const better =
      !best ||
      candidate.cutoff_date > best.cutoff_date ||
      (candidate.cutoff_date === best.cutoff_date && candidate.cutoff_source === "date_to" && best.cutoff_source !== "date_to");
    if (better) best = candidate;
  }
  return best;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new ValidationError(`${label} is required`);
  return value;
}

// Normalizes the optional party discriminator for comparison: null, undefined,
// and "" all mean "no party" (the single-party default), so omitting
// party_label everywhere preserves pre-existing single-party behavior.
export function normalizeParty(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "";
}
