// The practice writes. Each runs its interface checks, resolves its matter locally (L4),
// builds its ops and hands them to the one write sequence (practice/store.ts). The rules
// those ops must satisfy are Probanda's Cloud's: a refused write returns its question and
// changes nothing.

import { NotFoundError, ValidationError } from "../../errors.js";
import { flatten, rowsOf, type Item, type Row } from "../../practice/items.js";
import type { OpSpec } from "../../practice/ops.js";
import type { PracticeStore } from "../../practice/store.js";
import { asString, newId, normalizeMattNum, nowIso, requireMatter } from "./shared.js";

/** The empty labels that are sent as null, never as the hash of "". */
const LABELS = ["party_label", "proceeding_label", "scenario_label"];

function rowOf(items: Map<string, Item>, id: string): Row {
  const item = items.get(id);
  if (!item) throw new NotFoundError(`Item ${id} is not in practice.db after the write`);
  return flatten(id, item);
}

export async function upsert_client_matter(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ client_id: string; matter_id: string; client_created: boolean; matter_created: boolean }> {
  const clientNum = asString(args.client_num, "client_num");
  if (!args.file_number && !args.matt_num) {
    throw new ValidationError("upsert_client_matter requires a matter key (file_number or matt_num)");
  }
  // The CSV export emits the `{client}.{matter}` separator with an empty client
  // prefix (`.L8443`); the matter number is what follows it.
  const mattNum = args.matt_num ? normalizeMattNum(args.matt_num) : args.matt_num;

  const clientOp = newId();
  const matterOp = newId();
  const { ops } = await store.write("upsert_client_matter", {}, [
    {
      op: "upsert", id: clientOp, kind: "client",
      data: {
        name: args.name,
        client_num: clientNum,
        orig_lawyer: args.orig_lawyer,
        resp_lawyer: args.resp_lawyer,
        type_of_law: args.type_of_law,
        major_client: args.major_client,
      },
    },
    {
      op: "upsert", id: matterOp, kind: "matter",
      state: args.status as string | undefined,
      tags: { billable: typeof args.billable === "boolean" ? args.billable : undefined },
      links: { client: clientOp },
      data: {
        description: args.description,
        file_number: args.file_number,
        matt_num: mattNum,
        orig_lawyer: args.orig_lawyer,
        resp_lawyer: args.resp_lawyer,
        type_of_law: args.type_of_law,
        regular_trust: args.regular_trust,
        term_trust: args.term_trust,
        last_trust_date: args.last_trust_date,
      },
    },
  ]);
  return {
    client_id: ops[0].as,
    matter_id: ops[1].as,
    client_created: ops[0].as === clientOp,
    matter_created: ops[1].as === matterOp,
  };
}

export async function insert_time_entry(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ id: string }> {
  const matter = requireMatter(store.items(), args);
  const id = newId();
  await store.write("insert_time_entry", {}, [{
    op: "create", id, kind: "time_entry",
    // The entry takes the matter's billable flag unless the caller says otherwise.
    tags: { billable: typeof args.billable === "boolean" ? args.billable : undefined },
    links: { matter: matter.id },
    data: { description: args.description, entry_date: args.entry_date, hours: args.hours, batch_tag: args.batch_tag },
  }]);
  return { id };
}

// Flip the billable flag on entries already recorded -- named individually, or as
// the whole batch sharing one batch_tag, resolved to ids here so the tag never leaves
// the machine. The two selectors are mutually exclusive so a caller never half-addresses a batch.
export async function set_time_entries_billable(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ updated: number; ids: string[] }> {
  const ids = Array.isArray(args.entry_ids) ? args.entry_ids.map((value) => String(value)) : null;
  const batchTag = typeof args.batch_tag === "string" && args.batch_tag ? args.batch_tag : null;
  if (ids && batchTag) {
    throw new ValidationError("set_time_entries_billable takes entry_ids or batch_tag, not both");
  }
  if (!ids && !batchTag) {
    throw new ValidationError("set_time_entries_billable requires entry_ids or batch_tag");
  }
  if (ids && ids.length === 0) {
    throw new ValidationError("entry_ids must name at least one entry");
  }
  if (typeof args.billable !== "boolean") {
    throw new ValidationError("set_time_entries_billable requires billable (true or false)");
  }

  const items = store.items();
  // An optional matter ref narrows a batch_tag sweep to one matter; it never
  // widens or reassigns anything.
  const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : null;

  let targetIds: string[];
  if (ids) {
    targetIds = ids;
  } else {
    targetIds = rowsOf(items, "time_entry")
      .filter((row) => row.batch_tag === batchTag && (!matterId || row.matter_id === matterId))
      .map((row) => String(row.id));
    if (targetIds.length === 0) throw new NotFoundError(`No time entries carry batch_tag "${batchTag}"`);
  }

  await store.write("set_time_entries_billable", {}, targetIds.map((id) => ({
    op: "update", id, kind: "time_entry", tags: { billable: args.billable },
  })));
  return { updated: targetIds.length, ids: targetIds };
}

export async function upsert_task(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Row> {
  const items = store.items();
  const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : undefined;

  if (args.nudge_interval_days !== undefined && args.nudge_interval_days !== null) {
    const interval = Number(args.nudge_interval_days);
    if (!Number.isFinite(interval) || interval < 1) {
      throw new ValidationError("nudge_interval_days must be a whole number of days >= 1");
    }
  }

  // ADR 0021 D5: a filing or pre-filing proceeding in the task's own matter's submission
  // database. Null clears it.
  if (args.filing_ref !== undefined && args.filing_ref !== null) {
    if (!/^(filing|proceeding):[1-9]\d*$/.test(String(args.filing_ref))) {
      throw new ValidationError(`filing_ref must be "filing:<id>" or "proceeding:<id>", not ${JSON.stringify(args.filing_ref)}`);
    }
  }

  const creating = !args.id;
  if (creating && !args.task_type) throw new ValidationError("upsert_task requires task_type when creating a task");
  if (creating && !args.description) throw new ValidationError("upsert_task requires description when creating a task");

  // Explicit null clears a field (a nudge field leaves the rotation); undefined leaves it as it is.
  const id = creating ? newId() : String(args.id);
  const { items: after } = await store.write("upsert_task", {}, [{
    op: creating ? "create" : "update", id, kind: "task",
    state: args.status as string | undefined,
    tags: { task_type: args.task_type },
    links: { matter: matterId, filing: args.filing_ref as string | null | undefined },
    data: {
      description: args.description,
      time_estimate_hours: args.time_estimate_hours,
      actual_hours: creating ? null : undefined,
      deadline_date: args.deadline_date,
      completed_at: creating ? null : undefined,
      next_nudge_date: args.next_nudge_date,
      nudge_interval_days: args.nudge_interval_days,
      last_nudged_at: args.last_nudged_at,
    },
  }]);
  return rowOf(after, id);
}

export async function complete_task(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Row> {
  const id = asString(args.id, "id");
  const { items } = await store.write("complete_task", {}, [{
    op: "update", id, kind: "task", state: "completed",
    data: { completed_at: nowIso(), actual_hours: args.actual_hours },
  }]);
  return rowOf(items, id);
}

export async function record_retainer_notice(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ id: string }> {
  const matter = requireMatter(store.items(), args);
  const id = newId();
  await store.write("record_retainer_notice", {}, [{
    op: "create", id, kind: "retainer_notice", links: { matter: matter.id }, data: { sent_at: asString(args.sent_at, "sent_at") },
  }]);
  return { id };
}

// One anchor per (matter, anchor_type, party_label, proceeding_label), written by an upsert
// that carries the source asserting its date. How the source and the anchor's state follow
// (agree, conflict, resolve, amend, occurred) is the cloud's (#189, #194, #230 4.1); the reply
// names the anchor the write landed on, and its state says whether it is now conflicted.
export async function upsert_anchor(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ anchor: Row; conflict: boolean }> {
  const matter = requireMatter(store.items(), args);
  const anchorType = asString(args.anchor_type, "anchor_type");
  const anchorDate = asString(args.anchor_date, "anchor_date");
  const statedDate = asString(args.stated_date, "stated_date");
  const resolve = args.resolve === true;
  const amend = args.amend === true;
  const occurred = args.occurred === true;
  if ((resolve ? 1 : 0) + (amend ? 1 : 0) + (occurred ? 1 : 0) > 1) {
    throw new ValidationError("upsert_anchor resolve, amend, and occurred are mutually exclusive");
  }
  // The filing the anchored event is for (ADR 0013, second 2026-10-04 amendment). Null
  // clears it; omitted leaves it as it is.
  const filingRef = args.filing_ref;
  if (filingRef !== undefined && filingRef !== null && !/^filing:[1-9]\d*$/.test(String(filingRef))) {
    throw new ValidationError(`filing_ref must be "filing:<id>", not ${JSON.stringify(filingRef)}`);
  }

  const anchorOp = newId();
  const sourceOp = newId();
  const { ops, items } = await store.write("upsert_anchor", { resolve, amend, occurred }, [
    {
      op: "upsert", id: anchorOp, kind: "anchor",
      tags: { anchor_type: anchorType },
      links: { matter: matter.id, filing: filingRef as string | null | undefined },
      data: { anchor_date: anchorDate, party_label: args.party_label ?? null, proceeding_label: args.proceeding_label ?? null },
      blank: LABELS,
    },
    {
      op: "create", id: sourceOp, kind: "anchor_source",
      links: { anchor: anchorOp },
      data: {
        source_document: args.source_document,
        source_excerpt: args.source_excerpt ?? null,
        stated_date: statedDate,
        asserted_date: anchorDate,
      },
    },
  ]);
  const anchor = rowOf(items, ops[0].as);
  return { anchor, conflict: anchor.status === "conflicted" };
}

// Hygiene op (#190): remove an anchor entered in error. The cloud deletes its sources and
// derived deadlines with it; the counts are of what practice.db held before.
export async function delete_anchor(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ deleted_anchor: string; deleted_sources: number; deleted_deadlines: number }> {
  const anchorId = asString(args.anchor_id, "anchor_id");
  const items = store.items();
  if (items.get(anchorId)?.kind !== "anchor") throw new NotFoundError(`No anchor ${anchorId}`);
  const linked = (kind: string) => rowsOf(items, kind).filter((row) => row.anchor_id === anchorId).length;
  const counts = { deleted_sources: linked("anchor_source"), deleted_deadlines: linked("deadline") };

  await store.write("delete_anchor", {}, [{ op: "delete", id: anchorId, kind: "anchor" }]);
  return { deleted_anchor: anchorId, ...counts };
}

export async function upsert_deadline(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Row> {
  const matterId = args.matt_num || args.matter_id ? requireMatter(store.items(), args).id : undefined;
  const creating = !args.id;
  if (creating) asString(args.deadline_type, "deadline_type");

  // An update changes only what it names: a key label the caller left out stays as it is,
  // so a status change by id (dismiss, met) keeps the row in its key. Only an explicit null
  // clears one. A new deadline takes every label, null when not given.
  const labels = Object.fromEntries(LABELS.map((label) => [label, creating ? args[label] ?? null : label in args ? args[label] ?? null : undefined]));
  const id = creating ? newId() : String(args.id);
  const { items } = await store.write("upsert_deadline", {}, [{
    op: creating ? "create" : "update", id, kind: "deadline",
    state: args.status as string | undefined,
    tags: {
      deadline_type: args.deadline_type,
      source_type: args.source_type,
      review_flag: creating ? args.review_flag ?? undefined : args.review_flag,
    },
    links: { matter: matterId, anchor: args.anchor_id as string | null | undefined },
    data: {
      source_document: args.source_document,
      deadline_date: args.deadline_date,
      rule_ref: args.rule_ref,
      rule_description: args.rule_description,
      review_note: args.review_note,
      ...labels,
      expiry_notified_at: args.expiry_notified_at,
    },
    blank: LABELS,
  }]);
  return rowOf(items, id);
}

export async function manage_payment_in_flight(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const action = asString(args.action, "action");

  if (action === "record") {
    const matter = requireMatter(store.items(), args);
    const id = newId();
    const { items } = await store.write("manage_payment_in_flight", { action }, [{
      op: "create", id, kind: "payment", state: "false",
      links: { matter: matter.id },
      data: {
        notes: args.notes ?? null,
        amount: args.amount,
        recorded_at: args.recorded_at ?? nowIso(),
        expected_clear_by: args.expected_clear_by,
      },
    }]);
    return rowOf(items, id);
  }

  if (action === "clear") {
    const id = asString(args.id, "id");
    const { items } = await store.write("manage_payment_in_flight", { action }, [{ op: "update", id, kind: "payment", state: "true" }]);
    return rowOf(items, id);
  }

  if (action === "query") {
    const items = store.items();
    const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : null;
    const rows = rowsOf(items, "payment").filter((row) => row.cleared === false && (!matterId || row.matter_id === matterId));
    return { rows };
  }

  throw new ValidationError(`Unknown manage_payment_in_flight action "${action}"`);
}

export async function upsert_signal(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<Row> {
  const matter = requireMatter(store.items(), args);
  const signalKey = asString(args.signal_key, "signal_key");
  const { ops, items } = await store.write("upsert_signal", {}, [{
    op: "upsert", id: newId(), kind: "signal",
    state: args.state as string | undefined,
    tags: { signal_key: signalKey },
    links: { matter: matter.id },
    data: { note: args.note, confirmed_at: args.confirmed_at },
  }]);
  return rowOf(items, ops[0].as);
}

// Upserts the year's coverage and replaces that year's exception days in one write.
// `days` is omitted/empty when status is "unavailable" (the year's PDF isn't published yet).
export async function ingest_court_calendar_year(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ coverage: Row; days_count: number }> {
  const year = Number(args.year);
  if (!Number.isInteger(year)) throw new ValidationError("ingest_court_calendar_year requires an integer year");
  const status = asString(args.status, "status");
  if (status !== "confirmed" && status !== "unavailable") {
    throw new ValidationError('ingest_court_calendar_year status must be "confirmed" or "unavailable"');
  }
  const days = Array.isArray(args.days) ? (args.days as Record<string, unknown>[]) : [];

  // Check every day before anything is sent.
  const yearOp = newId();
  const dayOps: OpSpec[] = days.map((day) => {
    const calendarDate = asString(day.calendar_date, "calendar_date");
    if (!calendarDate.startsWith(`${year}-`)) {
      throw new ValidationError(`day ${calendarDate} does not fall within year ${year}`);
    }
    return {
      op: "create", id: newId(), kind: "calendar_day",
      tags: { status_category: asString(day.status_category, "status_category") },
      links: { calendar_year: yearOp },
      data: {
        calendar_date: calendarDate,
        status_label: asString(day.status_label, "status_label"),
        courthouse_scope: day.courthouse_scope ?? null,
        source_document: day.source_document ?? args.source_document ?? null,
      },
    };
  });

  const items = store.items();
  const priorDays: OpSpec[] = rowsOf(items, "calendar_day")
    .filter((row) => String(row.calendar_date ?? "").startsWith(`${year}-`))
    .map((row) => ({ op: "delete", id: String(row.id), kind: "calendar_day" }));

  const { ops, items: after } = await store.write("ingest_court_calendar_year", {}, [
    {
      op: "upsert", id: yearOp, kind: "calendar_year", state: status,
      data: { year, source_document: args.source_document ?? null, checked_at: nowIso() },
    },
    ...priorDays,
    ...dayOps,
  ]);
  return { coverage: rowOf(after, ops[0].as), days_count: dayOps.length };
}

export async function set_status(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ matter_id: string; old_status: unknown; new_status: string }> {
  const matter = requireMatter(store.items(), args);
  const statusLabel = asString(args.status_label, "status_label");
  const oldStatus = matter.row.status ?? null;
  await store.write("set_status", {}, [{ op: "update", id: matter.id, kind: "matter", state: statusLabel }]);
  return { matter_id: matter.id, old_status: oldStatus, new_status: statusLabel };
}
