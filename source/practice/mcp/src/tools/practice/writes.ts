import { UnscopedAdmin, exactlyOne } from "../../db/scope.js";
import { NotFoundError, ValidationError } from "../../errors.js";
import { practiceEntityFor } from "../../practice-registry.js";
import {
  ensureDefaultPolicies,
  insertRow,
  isBillable,
  newId,
  normalizeMattNum,
  normalizeParty,
  nowIso,
  patchById,
  requireMatter,
  upsertByKey,
  asString,
} from "./shared.js";

const clients = practiceEntityFor("practice_clients");
const matters = practiceEntityFor("practice_matters");
const timeEntries = practiceEntityFor("practice_time_entries");
const tasks = practiceEntityFor("practice_tasks");
const retainerNotices = practiceEntityFor("practice_retainer_notices");
const anchors = practiceEntityFor("practice_anchors");
const anchorSources = practiceEntityFor("practice_anchor_sources");
const deadlines = practiceEntityFor("practice_deadlines");
const paymentInFlight = practiceEntityFor("practice_payment_in_flight");
const matterSignals = practiceEntityFor("practice_matter_signals");
const courtCalendarCoverage = practiceEntityFor("practice_court_calendar_coverage");
const courtCalendarDays = practiceEntityFor("practice_court_calendar_days");

export async function upsert_client_matter(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ client_id: string; matter_id: string; client_created: boolean; matter_created: boolean }> {
  const clientNum = asString(args.client_num, "client_num");
  if (!args.file_number && !args.matt_num) {
    throw new ValidationError("upsert_client_matter requires a matter key (file_number or matt_num)");
  }
  // The CSV export emits the `{client}.{matter}` separator with an empty client
  // prefix (`.L8443`); the matter number is what follows it.
  const mattNum = args.matt_num ? normalizeMattNum(args.matt_num) : args.matt_num;

  const client = await upsertByKey(admin, ownerId, clients, { client_num: `eq.${clientNum}` }, {
    name: args.name,
    client_num: clientNum,
    orig_lawyer: args.orig_lawyer,
    resp_lawyer: args.resp_lawyer,
    type_of_law: args.type_of_law,
    major_client: args.major_client,
  });
  const clientId = String(client.row.id);

  const matterKey: Record<string, string> = args.file_number
    ? { file_number: `eq.${String(args.file_number)}` }
    : { matt_num: `eq.${String(mattNum)}` };

  const matter = await upsertByKey(admin, ownerId, matters, matterKey, {
    client_id: clientId,
    description: args.description,
    file_number: args.file_number,
    matt_num: mattNum,
    orig_lawyer: args.orig_lawyer,
    resp_lawyer: args.resp_lawyer,
    status: args.status,
    type_of_law: args.type_of_law,
    billable: typeof args.billable === "boolean" ? args.billable : undefined,
    regular_trust: args.regular_trust,
    term_trust: args.term_trust,
    last_trust_date: args.last_trust_date,
  });

  return {
    client_id: clientId,
    matter_id: String(matter.row.id),
    client_created: client.created,
    matter_created: matter.created,
  };
}

export async function insert_time_entry(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ id: string }> {
  const matter = await requireMatter(admin, ownerId, args);
  const row = await insertRow(admin, ownerId, timeEntries, {
    matter_id: matter.id,
    entry_date: args.entry_date,
    hours: args.hours,
    description: args.description,
    // The entry inherits the matter's billable flag unless the caller says
    // otherwise: work recorded against a billable matter that is not itself
    // billable (e.g. a retirement note-up) passes billable: false explicitly.
    billable: typeof args.billable === "boolean" ? args.billable : isBillable(matter.row),
    batch_tag: args.batch_tag,
  });
  return { id: String(row.id) };
}

// Flip the billable flag on entries already recorded -- named individually, or as
// the whole batch sharing one batch_tag. The two selectors are mutually exclusive
// so a caller never half-addresses a batch.
export async function set_time_entries_billable(
  admin: UnscopedAdmin,
  ownerId: string,
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

  // An optional matter ref narrows a batch_tag sweep to one matter; it never
  // widens or reassigns anything.
  const matterId = args.matt_num || args.matter_id ? (await requireMatter(admin, ownerId, args)).id : null;

  let targetIds: string[];
  if (ids) {
    targetIds = ids;
  } else {
    const filters: Record<string, string> = { batch_tag: `eq.${batchTag}` };
    if (matterId) filters.matter_id = `eq.${matterId}`;
    const rows = await admin.query(timeEntries, filters);
    if (rows.length === 0) throw new NotFoundError(`No time entries carry batch_tag "${batchTag}"`);
    targetIds = rows.map((row) => String(row.id));
  }

  for (const id of targetIds) {
    await patchById(admin, ownerId, timeEntries, id, { billable: args.billable });
  }
  return { updated: targetIds.length, ids: targetIds };
}

export async function upsert_task(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let matterId: string | undefined;
  if (args.matt_num || args.matter_id) {
    matterId = (await requireMatter(admin, ownerId, args)).id;
  }

  if (args.nudge_interval_days !== undefined && args.nudge_interval_days !== null) {
    const interval = Number(args.nudge_interval_days);
    if (!Number.isFinite(interval) || interval < 1) {
      throw new ValidationError("nudge_interval_days must be a whole number of days >= 1");
    }
  }

  // An update reads its row once, for the pointer's matter and the one-open-to-do check below.
  const current = args.id ? (await admin.query(tasks, { id: `eq.${String(args.id)}` }, { limit: 1 }))[0] : undefined;

  // ADR 0021 D5: a filing or pre-filing proceeding in the task's own matter's submission
  // database, so a task with no matter can point nowhere. Null clears it.
  if (args.filing_ref !== undefined && args.filing_ref !== null) {
    if (!/^(filing|proceeding):[1-9]\d*$/.test(String(args.filing_ref))) {
      throw new ValidationError(`filing_ref must be "filing:<id>" or "proceeding:<id>", not ${JSON.stringify(args.filing_ref)}`);
    }
    if (!matterId && !current?.matter_id) {
      throw new ValidationError("filing_ref names a filing in the task's own matter, so the task needs a matter (matt_num or matter_id)");
    }
  }

  // Explicit null clears a nudge field (leaving the rotation); undefined leaves it
  // untouched, since the update path only writes the keys it is given.
  const fields: Record<string, unknown> = {
    matter_id: matterId,
    task_type: args.task_type,
    description: args.description,
    time_estimate_hours: args.time_estimate_hours,
    deadline_date: args.deadline_date,
    status: args.status,
    next_nudge_date: args.next_nudge_date,
    nudge_interval_days: args.nudge_interval_days,
    last_nudged_at: args.last_nudged_at,
    filing_ref: args.filing_ref,
  };

  // An id that matches no row skips the check, so patchById's not-found answers.
  if (!args.id || current) await refuseSecondOpenTodo(admin, ownerId, args, matterId, current);

  if (args.id) {
    return patchById(admin, ownerId, tasks, String(args.id), fields);
  }
  if (!args.task_type) throw new ValidationError("upsert_task requires task_type when creating a task");
  if (!args.description) throw new ValidationError("upsert_task requires description when creating a task");
  return insertRow(admin, ownerId, tasks, fields);
}

// ADR 0023 D4: a matter holds at most one open to-do per filing reference. A write that would
// leave a second one open is refused, naming the to-do that holds the reference: a create, a
// re-point, a move to another matter, or re-opening a completed, paused or withdrawn one. Only an
// open to-do holds a reference. An update supplying none of matter, pointer or status is not
// checked, so a nudge advance on two to-dos that already share a reference still lands.
async function refuseSecondOpenTodo(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>,
  matterId: string | undefined,
  current: Record<string, unknown> | undefined
): Promise<void> {
  if (args.id && matterId === undefined && args.filing_ref === undefined && args.status === undefined) return;
  const matter = matterId ?? current?.matter_id;
  const filingRef = args.filing_ref !== undefined ? args.filing_ref : current?.filing_ref;
  const status = args.status ?? current?.status ?? "open";
  if (status !== "open" || !filingRef || !matter) return;

  const open = await admin.query(tasks, { matter_id: `eq.${String(matter)}`, filing_ref: `eq.${String(filingRef)}`, status: "eq.open" }, { limit: 2 });
  const holder = open.find((row) => String(row.id) !== String(args.id));
  if (!holder) return;
  const { id, description } = holder;
  throw new ValidationError(
    `${String(filingRef)} already has an open to-do in this matter: ${String(id)} "${String(description)}". ` +
    "A filing has at most one open to-do, so fold this work into that one, or withdraw or complete it first."
  );
}

export async function complete_task(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = asString(args.id, "id");
  return patchById(admin, ownerId, tasks, id, {
    status: "completed",
    completed_at: nowIso(),
    actual_hours: args.actual_hours,
  });
}

export async function record_retainer_notice(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ id: string }> {
  const matter = await requireMatter(admin, ownerId, args);
  const row = await insertRow(admin, ownerId, retainerNotices, {
    matter_id: matter.id,
    sent_at: asString(args.sent_at, "sent_at"),
  });
  return { id: String(row.id) };
}

// One anchor row per (matter, anchor_type, party_label, proceeding_label) key.
// The anchor carries the single authoritative date; competing documents are
// recorded as sources under it. Behaviour (#189, docket-clerk workflows
// 1 & 4):
//   - no anchor            -> create it active, record a confirmed source
//   - date agrees          -> record a confirmed source, anchor unchanged
//   - date differs         -> record a *conflicted source under the same anchor*
//                             (no new row) and flag the anchor conflicted; the
//                             authoritative anchor_date is left unchanged
//   - resolve              -> the incoming date becomes authoritative, anchor
//                             returns to active, and every source is re-marked
//                             confirmed/conflicted by asserted_date match.
//   - amend                -> the incoming date replaces the authoritative date;
//                             prior authoritative sources become superseded.
//   - occurred             -> the anchored event happened as scheduled: the
//                             confirming source is recorded and the anchor moves
//                             to the terminal 'occurred' status (#230 4.1). Only
//                             an active anchor at its authoritative date can be
//                             marked; resolve or amend return it to active.
// Resolution fires on an explicit resolve:true, or implicitly when a conflicted
// anchor is re-asserted with its own current date.
export async function upsert_anchor(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ anchor: Record<string, unknown>; conflict: boolean }> {
  const matter = await requireMatter(admin, ownerId, args);
  const anchorType = asString(args.anchor_type, "anchor_type");
  const anchorDate = asString(args.anchor_date, "anchor_date");
  const partyLabel = normalizeParty(args.party_label);
  const proceedingLabel = normalizeParty(args.proceeding_label);
  const resolve = args.resolve === true;
  const amend = args.amend === true;
  const occurred = args.occurred === true;
  if ((resolve ? 1 : 0) + (amend ? 1 : 0) + (occurred ? 1 : 0) > 1) {
    throw new ValidationError("upsert_anchor resolve, amend, and occurred are mutually exclusive");
  }
  // The filing the anchored event is for, in the anchor's own matter's submission database (ADR
  // 0013, second 2026-10-04 amendment): its deadlines become that filing's Goal criteria. Null
  // clears it; omitted leaves it as it is.
  const filingRef = args.filing_ref;
  if (filingRef !== undefined && filingRef !== null && !/^filing:[1-9]\d*$/.test(String(filingRef))) {
    throw new ValidationError(`filing_ref must be "filing:<id>", not ${JSON.stringify(filingRef)}`);
  }
  const linked = async (row: Record<string, unknown>): Promise<Record<string, unknown>> =>
    filingRef === undefined || (row.filing_ref ?? null) === filingRef
      ? row
      : patchById(admin, ownerId, anchors, String(row.id), { filing_ref: filingRef });

  // Match the key WITHOUT a status filter (#189 D2): a conflicted anchor must
  // still be found so a re-assert reconciles it rather than spawning a duplicate.
  const existing = await admin.query(anchors, {
    matter_id: `eq.${matter.id}`,
    anchor_type: `eq.${anchorType}`,
  });
  // Only rows sharing both discriminators compete (#24, #73); superseded rows are
  // tombstones and never reconcile.
  const sameScope = existing
    .filter((row) =>
      normalizeParty(row.party_label) === partyLabel &&
      normalizeParty(row.proceeding_label) === proceedingLabel &&
      row.status !== "superseded");
  if (sameScope.length > 1) {
    throw new ValidationError(
      `${sameScope.length} anchor rows share the key (matter, ${anchorType}, party, proceeding) -- clean up the duplicates before upserting`
    );
  }
  const anchor = sameScope[0];

  if (!anchor) {
    if (amend) throw new ValidationError("upsert_anchor amend requires an existing anchor");
    if (occurred) throw new ValidationError("upsert_anchor occurred requires an existing anchor");
    const created = await insertRow(admin, ownerId, anchors, {
      matter_id: matter.id,
      anchor_type: anchorType,
      anchor_date: anchorDate,
      party_label: args.party_label ?? null,
      proceeding_label: args.proceeding_label ?? null,
      status: "active",
      filing_ref: filingRef ?? null,
    });
    await insertSource(admin, ownerId, String(created.id), args, anchorDate, "confirmed");
    return { anchor: created, conflict: false };
  }

  const anchorId = String(anchor.id);

  if (occurred) {
    // Terminal marking (#230 4.1): the event happened as scheduled. Only an
    // active anchor at its authoritative date qualifies -- a conflicted anchor
    // must be resolved first, and a moved event is an amendment, not an
    // occurrence. The confirming source (with any outcome in source_excerpt,
    // e.g. "judgment reserved") is recorded before the status flips.
    if (anchor.status === "conflicted") {
      throw new ValidationError("upsert_anchor occurred requires an unconflicted anchor -- resolve the conflict first");
    }
    if (anchorDate !== anchor.anchor_date) {
      throw new ValidationError(
        "upsert_anchor occurred requires the anchor's authoritative date -- if the event actually moved, amend instead"
      );
    }
    await insertSource(admin, ownerId, anchorId, args, anchorDate, "confirmed");
    const updated = await patchAnchorStatus(admin, ownerId, anchorId, "occurred");
    return { anchor: await linked(updated), conflict: false };
  }

  if (amend) {
    if (anchorDate === anchor.anchor_date) {
      throw new ValidationError("upsert_anchor amend requires a changed anchor_date");
    }
    const priorAuthoritativeDate = String(anchor.anchor_date);
    const sources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 1000 });
    const incoming = sources.find((source) =>
      source.source_document === args.source_document && source.asserted_date === anchorDate);

    if (incoming) {
      if (incoming.status !== "confirmed") {
        await patchById(admin, ownerId, anchorSources, String(incoming.id), { status: "confirmed" });
      }
    } else {
      await insertSource(admin, ownerId, anchorId, args, anchorDate, "confirmed");
    }

    for (const source of sources) {
      if (source.asserted_date === priorAuthoritativeDate && source.status !== "superseded") {
        await patchById(admin, ownerId, anchorSources, String(source.id), { status: "superseded" });
      }
    }

    const updated = await patchById(admin, ownerId, anchors, anchorId, {
      anchor_date: anchorDate,
      status: "active",
    });
    return { anchor: await linked(updated), conflict: false };
  }

  const resolving = resolve || (anchor.status === "conflicted" && anchorDate === anchor.anchor_date);

  if (resolving) {
    const updated = await patchById(admin, ownerId, anchors, anchorId, {
      anchor_date: anchorDate,
      status: "active",
    });
    const existingSources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 1000 });
    const sourceAlreadyRecorded = existingSources.some((source) => {
      return source.source_document === args.source_document && source.asserted_date === anchorDate;
    });
    if (!sourceAlreadyRecorded) {
      await insertSource(admin, ownerId, anchorId, args, anchorDate, "confirmed");
    }
    await remarkSources(admin, ownerId, anchorId, anchorDate);
    return { anchor: await linked(updated), conflict: false };
  }

  if (anchorDate !== anchor.anchor_date) {
    const flagged = await patchAnchorStatus(admin, ownerId, anchorId, "conflicted");
    await insertSource(admin, ownerId, anchorId, args, anchorDate, "conflicted");
    return { anchor: await linked(flagged), conflict: true };
  }

  await insertSource(admin, ownerId, anchorId, args, anchorDate, "confirmed");
  return { anchor: await linked(anchor), conflict: false };
}

function insertSource(
  admin: UnscopedAdmin,
  ownerId: string,
  anchorId: string,
  args: Record<string, unknown>,
  assertedDate: string,
  status: "confirmed" | "conflicted" | "pending" | "superseded"
): Promise<Record<string, unknown>> {
  return insertRow(admin, ownerId, anchorSources, {
    anchor_id: anchorId,
    source_document: args.source_document,
    source_excerpt: args.source_excerpt ?? null,
    stated_date: asString(args.stated_date, "stated_date"),
    asserted_date: assertedDate,
    status,
  });
}

// Re-mark every source of an anchor against a now-authoritative date: those whose
// normalized asserted_date matches are confirmed, the rest conflicted. A source
// missing asserted_date is flagged pending rather than silently confirmed (#189).
async function remarkSources(
  admin: UnscopedAdmin,
  ownerId: string,
  anchorId: string,
  authoritativeDate: string
): Promise<void> {
  const rows = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 1000 });
  for (const source of rows) {
    if (source.status === "superseded") continue;
    const asserted = source.asserted_date;
    const status = asserted == null
      ? "pending"
      : asserted === authoritativeDate ? "confirmed" : "conflicted";
    if (source.status !== status) {
      await patchById(admin, ownerId, anchorSources, String(source.id), { status });
    }
  }
}

function patchAnchorStatus(
  admin: UnscopedAdmin,
  ownerId: string,
  id: string,
  status: string
): Promise<Record<string, unknown>> {
  return patchById(admin, ownerId, anchors, id, { status });
}

// Hygiene op (#190): remove an anchor entered in error, cascading to its sources
// and derived deadlines. Routed through /practice-data like every other write so
// erroneous rows never require a gatekeeper-bypassing SQL delete.
export async function delete_anchor(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ deleted_anchor: string; deleted_sources: number; deleted_deadlines: number }> {
  const anchorId = asString(args.anchor_id, "anchor_id");
  const found = await admin.query(anchors, { id: `eq.${anchorId}` }, { limit: 1 });
  if (found.length === 0) throw new NotFoundError(`No anchor ${anchorId}`);

  const sources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 1000 });
  const linkedDeadlines = await admin.query(deadlines, { anchor_id: `eq.${anchorId}` }, { limit: 1000 });

  // Children first: the sources/deadlines FKs reference the anchor.
  await admin.delete(anchorSources, { anchor_id: `eq.${anchorId}` });
  await admin.delete(deadlines, { anchor_id: `eq.${anchorId}` });
  await admin.delete(anchors, { id: `eq.${anchorId}` });

  return {
    deleted_anchor: anchorId,
    deleted_sources: sources.length,
    deleted_deadlines: linkedDeadlines.length,
  };
}

/** The deadline key's label fields. */
const LABELS = ["party_label", "proceeding_label", "scenario_label"] as const;

export async function upsert_deadline(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let matterId: string | undefined;
  if (args.matt_num || args.matter_id) {
    matterId = (await requireMatter(admin, ownerId, args)).id;
  }

  const fields: Record<string, unknown> = {
    matter_id: matterId,
    anchor_id: args.anchor_id,
    source_document: args.source_document,
    deadline_type: args.deadline_type,
    deadline_date: args.deadline_date,
    rule_ref: args.rule_ref,
    rule_description: args.rule_description,
    source_type: args.source_type,
    status: args.status,
    review_flag: args.review_flag,
    review_note: args.review_note,
    expiry_notified_at: args.expiry_notified_at,
  };

  if (args.id) {
    // An update changes only what it names: a key label the caller left out
    // stays as it is, so a status change by id (dismiss, met) keeps the row in
    // its key. Only an explicit null clears one.
    for (const label of LABELS) if (label in args) fields[label] = args[label] ?? null;
    // Resolving an alternative (clearing its scenario_label) never clears a
    // rule_stale block: the row must be recalculated first.
    if ("scenario_label" in args && !args.scenario_label && args.review_flag !== "rule_stale") {
      const [row] = await admin.query(deadlines, { id: `eq.${String(args.id)}` }, { limit: 1 });
      if (row?.review_flag === "rule_stale") {
        throw new ValidationError(
          "upsert_deadline cannot resolve a rule_stale alternative: recalculate it once the rule is re-verified, then resolve"
        );
      }
    }
    return patchById(admin, ownerId, deadlines, String(args.id), fields);
  }

  for (const label of LABELS) fields[label] = args[label] ?? null;
  // A provisional alternative (practitioner_choice) is named by its scenario,
  // and only an alternative carries one.
  const choice = args.review_flag === "practitioner_choice";
  if (choice && (!args.scenario_label || !args.review_note)) {
    throw new ValidationError(
      "review_flag 'practitioner_choice' requires scenario_label (naming this alternative) and review_note (the open question and this alternative's basis)"
    );
  }
  if (!choice && args.scenario_label) {
    throw new ValidationError("scenario_label names a provisional alternative, so it requires review_flag 'practitioner_choice'");
  }

  // Natural-key upsert (matter, anchor, deadline_type, party, proceeding,
  // scenario): supersede any existing active row sharing this key before
  // inserting the replacement -- documented by the tool description but
  // previously unimplemented (#24); proceeding added so concurrent same-typed
  // proceedings on one matter don't supersede each other (#73); scenario so
  // the provisional alternatives of one deadline don't either.
  const deadlineType = asString(args.deadline_type, "deadline_type");
  const partyLabel = normalizeParty(args.party_label);
  const proceedingLabel = normalizeParty(args.proceeding_label);
  const scenarioLabel = normalizeParty(args.scenario_label);
  const keyFilters: Record<string, string> = { status: "eq.active", deadline_type: `eq.${deadlineType}` };
  if (matterId) keyFilters.matter_id = `eq.${matterId}`;
  keyFilters.anchor_id = args.anchor_id ? `eq.${String(args.anchor_id)}` : "is.null";

  const existing = await admin.query(deadlines, keyFilters, { limit: 1000 });
  const match = existing
    .find((row) =>
      normalizeParty(row.party_label) === partyLabel &&
      normalizeParty(row.proceeding_label) === proceedingLabel &&
      normalizeParty(row.scenario_label) === scenarioLabel);
  if (match) {
    await patchById(admin, ownerId, deadlines, String(match.id), { status: "superseded" });
  }

  return insertRow(admin, ownerId, deadlines, fields);
}

export async function manage_payment_in_flight(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const action = asString(args.action, "action");

  if (action === "record") {
    const matter = await requireMatter(admin, ownerId, args);
    const row = await insertRow(admin, ownerId, paymentInFlight, {
      matter_id: matter.id,
      amount: args.amount,
      recorded_at: args.recorded_at ?? nowIso(),
      expected_clear_by: args.expected_clear_by,
      notes: args.notes ?? null,
      cleared: false,
    });
    return row;
  }

  if (action === "clear") {
    const id = asString(args.id, "id");
    return patchById(admin, ownerId, paymentInFlight, id, { cleared: true });
  }

  if (action === "query") {
    const filters: Record<string, string> = { cleared: "eq.false" };
    if (args.matt_num || args.matter_id) {
      const matter = await requireMatter(admin, ownerId, args);
      filters.matter_id = `eq.${matter.id}`;
    }
    const rows = await admin.query(paymentInFlight, filters, { limit: 1000 });
    return { rows };
  }

  throw new ValidationError(`Unknown manage_payment_in_flight action "${action}"`);
}

export async function upsert_signal(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const matter = await requireMatter(admin, ownerId, args);
  const signalKey = asString(args.signal_key, "signal_key");

  // Keyed by (matter_id, signal_key), both plaintext — query then PATCH/INSERT to
  // keep the row id stable across re-upserts (P-D9), never PostgREST on_conflict.
  const existing = await admin.query(matterSignals, {
    matter_id: `eq.${matter.id}`,
    signal_key: `eq.${signalKey}`,
  }, { limit: 2 });

  const fields: Record<string, unknown> = {
    matter_id: matter.id,
    signal_key: signalKey,
    state: args.state,
    confirmed_at: args.confirmed_at,
    note: args.note,
  };

  if (existing.length === 1) {
    return patchById(admin, ownerId, matterSignals, String(existing[0].id), fields);
  }
  return insertRow(admin, ownerId, matterSignals, fields);
}

// Upserts the year's coverage row, then replaces (delete + insert) that year's
// exception-day rows in one call. `days` is omitted/empty when status is
// "unavailable" (the year's PDF isn't published yet).
export async function ingest_court_calendar_year(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ coverage: Record<string, unknown>; days_count: number }> {
  const year = Number(args.year);
  if (!Number.isInteger(year)) throw new ValidationError("ingest_court_calendar_year requires an integer year");
  const status = asString(args.status, "status");
  if (status !== "confirmed" && status !== "unavailable") {
    throw new ValidationError('ingest_court_calendar_year status must be "confirmed" or "unavailable"');
  }
  const days = Array.isArray(args.days) ? (args.days as Record<string, unknown>[]) : [];
  if (status === "confirmed" && days.length === 0) {
    throw new ValidationError("ingest_court_calendar_year requires at least one day when status is confirmed");
  }

  // Validate every day before any write, so a bad row cannot leave the year
  // marked confirmed with its day set already deleted.
  const rows = days.map((day) => {
    const calendarDate = asString(day.calendar_date, "calendar_date");
    if (!calendarDate.startsWith(`${year}-`)) {
      throw new ValidationError(`day ${calendarDate} does not fall within year ${year}`);
    }
    return {
      id: newId(),
      owner_id: ownerId,
      calendar_date: calendarDate,
      status_category: asString(day.status_category, "status_category"),
      status_label: asString(day.status_label, "status_label"),
      courthouse_scope: day.courthouse_scope ?? null,
      source_document: day.source_document ?? args.source_document ?? null,
    };
  });

  const coverage = await upsertByKey(admin, ownerId, courtCalendarCoverage, { year: `eq.${year}` }, {
    year,
    status,
    source_document: args.source_document ?? null,
    checked_at: nowIso(),
  });

  await admin.delete(courtCalendarDays, { calendar_date: `like.${year}-*` });

  const inserted = rows.length > 0 ? await admin.insertMany(courtCalendarDays, rows) : [];

  return { coverage: coverage.row, days_count: inserted.length };
}

export async function set_status(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ matter_id: string; old_status: unknown; new_status: string }> {
  await ensureDefaultPolicies(admin, ownerId);
  const matter = await requireMatter(admin, ownerId, args);
  const statusLabel = asString(args.status_label, "status_label");
  const oldStatus = matter.row.status ?? null;

  const updated = await admin.update(matters, { id: `eq.${matter.id}` }, { status: statusLabel });
  exactlyOne(updated, "practice_matters", "update");
  return { matter_id: matter.id, old_status: oldStatus, new_status: statusLabel };
}
