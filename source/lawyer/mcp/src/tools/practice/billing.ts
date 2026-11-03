// The records that defend a bill (docs/Specs/2026-11-03_defensible-time-entries-spec.md §4.2).
// Time entries are written when their lines are vetted, and stay open until the invoice issues.
// The invoice, its lines and its adjustments are first written when it issues, in the one write
// that locks the entries, so an unsigned draft never moves the matter's billing cutoff.

import { NotFoundError, ValidationError } from "../../errors.js";
import { rowsOf, type Item, type Row } from "../../practice/items.js";
import type { OpSpec } from "../../practice/ops.js";
import type { PracticeStore } from "../../practice/store.js";
import { asString, newId, requireMatter } from "./shared.js";

type Args = Record<string, unknown>;

const PROVENANCE = ["tracker", "estimate"];
const ADJUSTMENT_KINDS = ["trim", "write_off", "restoration", "credit"];
const LINE_KINDS = ["fee", "disbursement"];

function objects(value: unknown, label: string): Args[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw new ValidationError(`${label} must be a list of objects`);
  }
  return value as Args[];
}

function entriesOf(items: Map<string, Item>, matterId: string): Row[] {
  return rowsOf(items, "time_entry").filter((row) => row.matter_id === matterId);
}

function invoiceOf(items: Map<string, Item>, matterId: string, number: string): Row | undefined {
  return rowsOf(items, "invoice").find((row) => row.matter_id === matterId && row.invoice_number === number);
}

// Upserts by source_key, so vetting a matter again updates its entries rather than adding to them.
// An entry already on an issued invoice is left alone and reported.
export async function upsert_time_entries(
  store: PracticeStore,
  args: Args
): Promise<{ saved: number; locked_unchanged: string[] }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  const locked = new Set(entriesOf(items, matter.id).filter((row) => row.status === "locked").map((row) => row.source_key));
  const ops: OpSpec[] = [];
  const lockedUnchanged: string[] = [];
  for (const entry of objects(args.entries, "entries")) {
    const sourceKey = asString(entry.source_key, "entries[].source_key");
    if (locked.has(sourceKey)) {
      lockedUnchanged.push(sourceKey);
      continue;
    }
    if (!PROVENANCE.includes(String(entry.provenance))) {
      throw new ValidationError(`Entry ${sourceKey}: provenance must be one of ${PROVENANCE.join(", ")}`);
    }
    if (typeof entry.billed_seconds !== "number") throw new ValidationError(`Entry ${sourceKey}: billed_seconds must be a number`);
    ops.push({
      op: "upsert", id: newId(), kind: "time_entry", state: "open",
      tags: { billable: typeof entry.billable === "boolean" ? entry.billable : undefined },
      links: { matter: matter.id },
      data: {
        source_key: sourceKey,
        description: asString(entry.description, `entries[${sourceKey}].description`),
        entry_date: asString(entry.entry_date, `entries[${sourceKey}].entry_date`),
        hours: entry.billed_seconds / 3600,
        timekeeper: asString(entry.timekeeper, `entries[${sourceKey}].timekeeper`),
        start: entry.start ?? null,
        end: entry.end ?? null,
        tracked_seconds: entry.tracked_seconds ?? null,
        billed_seconds: entry.billed_seconds,
        provenance: entry.provenance,
        proposal_ids: entry.proposal_ids ?? [],
        determination_ids: entry.determination_ids ?? [],
        tracker_ids: entry.tracker_ids ?? [],
        estimate: entry.estimate ?? null,
        batch_tag: args.batch_tag,
      },
    });
  }
  if (ops.length) await store.write("upsert_time_entries", {}, ops);
  return { saved: ops.length, locked_unchanged: lockedUnchanged };
}

export async function upsert_rate(store: PracticeStore, args: Args): Promise<{ saved: true }> {
  const matter = requireMatter(store.items(), args);
  if (typeof args.rate !== "number") throw new ValidationError("upsert_rate requires rate as a number");
  await store.write("upsert_rate", {}, [{
    op: "upsert", id: newId(), kind: "rate",
    links: { matter: matter.id },
    data: {
      timekeeper: asString(args.timekeeper, "timekeeper"),
      effective_date: asString(args.effective_date, "effective_date"),
      rate: args.rate,
      source_document: asString(args.source_document, "source_document"),
    },
  }]);
  return { saved: true };
}

export async function rates_query(store: PracticeStore, args: Args): Promise<{ rows: Row[] }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  return { rows: rowsOf(items, "rate").filter((row) => row.matter_id === matter.id) };
}

function adjustmentOp(matterId: string, input: Args, links: Record<string, string | undefined>): OpSpec {
  if (!ADJUSTMENT_KINDS.includes(String(input.kind))) {
    throw new ValidationError(`An adjustment's kind must be one of ${ADJUSTMENT_KINDS.join(", ")}`);
  }
  return {
    op: "create", id: newId(), kind: "adjustment",
    links: { matter: matterId, ...links },
    data: {
      adjustment_key: input.adjustment_key ?? null,
      adjustment_kind: input.kind,
      seconds: input.seconds ?? null,
      amount: input.amount ?? null,
      reason: asString(input.reason, "adjustment reason"),
      marker: input.marker ?? null,
      decided_by: asString(input.decided_by, "adjustment decided_by"),
      decided_at: asString(input.decided_at, "adjustment decided_at"),
    },
  };
}

function entryIdOf(entries: Row[], sourceKey: unknown, invoice: string): string {
  const row = entries.find((entry) => entry.source_key === sourceKey);
  if (!row) throw new NotFoundError(`Invoice ${invoice} names a time entry that is not recorded for this matter: ${String(sourceKey)}`);
  return String(row.id);
}

// A later correction to an issued invoice. Recording the same adjustment_key again saves nothing.
export async function record_adjustment(store: PracticeStore, args: Args): Promise<{ saved: boolean }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  const key = asString(args.adjustment_key, "adjustment_key");
  if (rowsOf(items, "adjustment").some((row) => row.matter_id === matter.id && row.adjustment_key === key)) return { saved: false };
  const entry = args.entry_source_key === undefined ? undefined : entryIdOf(entriesOf(items, matter.id), args.entry_source_key, "correction");
  await store.write("record_adjustment", {}, [adjustmentOp(matter.id, args, { time_entry: entry, invoice_line: args.invoice_line_id as string | undefined })]);
  return { saved: true };
}

// One write: the invoice, its lines and adjustments, and the lock on every entry they name.
export async function issue_invoice(
  store: PracticeStore,
  args: Args
): Promise<{ invoice_number: string; lines: number; locked_entries: number }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  const number = asString(args.invoice_number, "invoice_number");
  if (invoiceOf(items, matter.id, number)?.issue_state === "issued") throw new ValidationError(`Invoice ${number} is already issued`);

  const entries = entriesOf(items, matter.id);
  const invoiceId = newId();
  const ops: OpSpec[] = [{
    op: "upsert", id: invoiceId, kind: "invoice", state: "issued",
    links: { matter: matter.id },
    data: {
      invoice_number: number,
      issue_date: asString(args.issue_date, "issue_date"),
      date_to: asString(args.date_to, "date_to"),
      amount: args.amount,
      signed_copy_path: asString(args.signed_copy_path, "signed_copy_path"),
      signed_copy_hash: asString(args.signed_copy_hash, "signed_copy_hash"),
      snapshot_path: asString(args.snapshot_path, "snapshot_path"),
      snapshot_hash: asString(args.snapshot_hash, "snapshot_hash"),
      trust_application: args.trust_application ?? null,
    },
  }];

  const lockLinks = new Map<string, string | undefined>();
  const lineIds = new Map<string, string>();
  for (const line of objects(args.lines, "lines")) {
    const key = asString(line.line_key, "lines[].line_key");
    if (!LINE_KINDS.includes(String(line.line_kind))) throw new ValidationError(`Line ${key}: line_kind must be one of ${LINE_KINDS.join(", ")}`);
    const named = line.line_kind === "fee" ? line.entry_source_keys : [];
    if (!Array.isArray(named) || (line.line_kind === "fee" && named.length === 0)) {
      throw new ValidationError(`Fee line ${key} names no time entries, so nothing supports it`);
    }
    if (line.line_kind === "disbursement" && !line.receipt_hash) {
      throw new ValidationError(`Disbursement line ${key} names no receipt, so nothing supports it`);
    }
    const lineId = newId();
    lineIds.set(key, lineId);
    ops.push({
      op: "create", id: lineId, kind: "invoice_line",
      links: { matter: matter.id, invoice: invoiceId },
      data: {
        line_key: key, line_kind: line.line_kind, entry_date: line.entry_date ?? null, timekeeper: line.timekeeper ?? null,
        description: asString(line.description, `lines[${key}].description`), hours: line.hours ?? null, rate: line.rate ?? null,
        rate_source: line.rate_source ?? null, amount: line.amount, provenance: line.provenance ?? null,
        receipt_hash: line.receipt_hash ?? null, entry_source_keys: named,
      },
    });
    for (const sourceKey of named) lockLinks.set(entryIdOf(entries, sourceKey, number), lineId);
  }

  for (const adjustment of objects(args.adjustments ?? [], "adjustments")) {
    const entryId = adjustment.entry_source_key === undefined ? undefined : entryIdOf(entries, adjustment.entry_source_key, number);
    if (entryId && !lockLinks.has(entryId)) lockLinks.set(entryId, undefined);
    ops.push(adjustmentOp(matter.id, adjustment, {
      time_entry: entryId,
      invoice_line: adjustment.line_key === undefined ? undefined : lineIds.get(String(adjustment.line_key)),
    }));
  }

  for (const [id, line] of lockLinks) {
    ops.push({ op: "update", id, kind: "time_entry", state: "locked", links: { invoice_line: line } });
  }
  await store.write("issue_invoice", {}, ops);
  return { invoice_number: number, lines: lineIds.size, locked_entries: lockLinks.size };
}

export async function record_invoice_sent(store: PracticeStore, args: Args): Promise<{ saved: true }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  const number = asString(args.invoice_number, "invoice_number");
  const invoice = invoiceOf(items, matter.id, number);
  if (!invoice) throw new NotFoundError(`Invoice ${number} is not recorded for this matter`);
  await store.write("record_invoice_sent", {}, [{
    op: "update", id: String(invoice.id), kind: "invoice",
    data: { sent_date: asString(args.sent_date, "sent_date"), sent_copy_path: asString(args.sent_copy_path, "sent_copy_path") },
  }]);
  return { saved: true };
}

// An issued invoice with its lines, the entries behind each line, and every adjustment on any of them.
export async function invoice_lines_query(
  store: PracticeStore,
  args: Args
): Promise<{ invoice: Row; lines: (Row & { entries: Row[] })[]; adjustments: Row[] }> {
  const items = store.items();
  const matter = requireMatter(items, args);
  const number = asString(args.invoice_number, "invoice_number");
  const invoice = invoiceOf(items, matter.id, number);
  if (!invoice) throw new NotFoundError(`Invoice ${number} is not recorded for this matter`);
  const entries = entriesOf(items, matter.id);
  const lines = rowsOf(items, "invoice_line").filter((row) => row.invoice_id === invoice.id);
  const lineIds = new Set(lines.map((line) => line.id));
  const entryIds = new Set(entries.filter((entry) => lineIds.has(entry.invoice_line_id)).map((entry) => entry.id));
  return {
    invoice,
    lines: lines.map((line) => ({ ...line, entries: entries.filter((entry) => entry.invoice_line_id === line.id) })),
    adjustments: rowsOf(items, "adjustment").filter((row) => lineIds.has(row.invoice_line_id) || entryIds.has(row.time_entry_id)),
  };
}
