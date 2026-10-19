import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { AmbiguousMatchError, NotFoundError, ValidationError } from "../../errors.js";
import { rowsOf, type Item, type Row } from "../../practice/items.js";
import { resolveCaseDataRoot } from "../../practice/matter-data-root.js";

/** The litigation library: the folder holding "0. CASE DATA" and the matter folders. A matter's
 * `folder` data field is relative to it, so a synced practice.db reads right on every device. */
export function litigationLibrary(env: NodeJS.ProcessEnv): string {
  return dirname(resolveCaseDataRoot(env));
}

export interface MatterRef {
  matt_num?: unknown;
  file_number?: unknown;
  matter_id?: unknown;
}

export interface ResolvedMatter {
  id: string;
  row: Row;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
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

// Resolve a matter by uuid, matt_num, or file_number (L4: matter references stay local).
// Returns null when no ref is given or nothing matches (absence-is-unknown).
export function resolveMatter(items: Map<string, Item>, ref: MatterRef): ResolvedMatter | null {
  let match: ((row: Row) => boolean) | null = null;
  if (ref.matter_id) match = (row) => row.id === String(ref.matter_id);
  else if (ref.matt_num) match = (row) => row.matt_num === normalizeMattNum(ref.matt_num);
  else if (ref.file_number) match = (row) => row.file_number === String(ref.file_number);
  if (!match) return null;

  const rows = rowsOf(items, "matter").filter(match);
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new AmbiguousMatchError("Matter reference matched more than one matter");
  return { id: String(rows[0].id), row: rows[0] };
}

export function requireMatter(items: Map<string, Item>, ref: MatterRef): ResolvedMatter {
  const resolved = resolveMatter(items, ref);
  if (!resolved) throw new NotFoundError("No matter matched the supplied reference");
  return resolved;
}

// Every client, keyed by id.
export function loadClientsById(items: Map<string, Item>): Map<string, Row> {
  return new Map(rowsOf(items, "client").map((row) => [String(row.id), row]));
}

export function clientContext(
  client: Record<string, unknown> | undefined
): { client_name: unknown; client_num: unknown } {
  return {
    client_name: client?.name ?? null,
    client_num: client?.client_num ?? null,
  };
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
