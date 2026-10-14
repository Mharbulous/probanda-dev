import assert from "node:assert/strict";
import test from "node:test";

const index = await import("../build/index.js");
const practiceIndex = await import("../build/tools/practice/index.js");
const shared = await import("../build/tools/practice/shared.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");
const invoices = await import("../build/tools/practice/invoices.js");
const schemaGen = await import("../build/schema-gen.js");
const practiceRegistry = await import("../build/practice-registry.js");

const OWNER = "00000000-0000-4000-8000-0000000000aa";

// Minimal in-memory UnscopedAdmin implementing the PostgREST filter subset the
// practice tools use (eq., neq., lt., gte., is.null).
function fakeAdmin() {
  const tables = new Map();
  const rowsFor = (entity) => {
    if (!tables.has(entity.table)) tables.set(entity.table, []);
    return tables.get(entity.table);
  };
  const matchOne = (rowVal, expr) => {
    if (expr === "is.null") return rowVal === null || rowVal === undefined;
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot);
    const val = expr.slice(dot + 1);
    if (op === "eq") return String(rowVal ?? "") === val;
    if (op === "neq") return String(rowVal ?? "") !== val;
    if (op === "lt") return Number(rowVal) < Number(val);
    if (op === "gte") return String(rowVal ?? "") >= val;
    if (op === "like") {
      const pattern = val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").split("*").join(".*");
      return new RegExp(`^${pattern}$`).test(String(rowVal ?? ""));
    }
    return false;
  };
  const matchRow = (row, filters) => {
    for (const [key, expr] of Object.entries(filters)) {
      if (key === "select") continue;
      if (!matchOne(row[key], expr)) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    async query(entity, filters = {}, options = {}) {
      let rows = rowsFor(entity).filter((row) => matchRow(row, filters));
      if (options.limit !== undefined) rows = rows.slice(0, options.limit);
      return rows.map((row) => ({ ...row }));
    },
    async insert(entity, row) {
      const stored = { ...row };
      rowsFor(entity).push(stored);
      return [{ ...stored }];
    },
    async insertMany(entity, rows) {
      const out = [];
      for (const row of rows) {
        const stored = { ...row };
        rowsFor(entity).push(stored);
        out.push({ ...stored });
      }
      return out;
    },
    async update(entity, filters, body) {
      // Mirrors the real backend's JSON-serialization drop of undefined-valued
      // keys (see patchById's comment): an id-based patch that omits a field
      // must leave that column alone, not overwrite it with undefined.
      const provided = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      const updated = [];
      for (const row of rowsFor(entity)) {
        if (matchRow(row, filters)) {
          Object.assign(row, provided);
          updated.push({ ...row });
        }
      }
      return updated;
    },
    async delete(entity, filters) {
      const list = rowsFor(entity);
      const removed = [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (matchRow(list[i], filters)) removed.push(...list.splice(i, 1));
      }
      return removed;
    },
  };
}

async function seedMatter(admin, extra = {}) {
  return writes.upsert_client_matter(admin, OWNER, {
    client_num: "C-1",
    name: "Acme Co",
    matt_num: ".L100",
    file_number: "F-100",
    description: "Contract dispute",
    regular_trust: -500,
    ...extra,
  });
}

const PRACTICE_TOOL_NAMES = [
  "practice_data__matter_lookup",
  "practice_data__trust_summary",
  "practice_data__wip_hours",
  "practice_data__open_tasks",
  "practice_data__active_deadlines",
  "practice_data__ar_data",
  "practice_data__read_signals",
  "practice_data__time_entries_query",
  "practice_data__upsert_client_matter",
  "practice_data__insert_time_entry",
  "practice_data__set_time_entries_billable",
  "practice_data__upsert_task",
  "practice_data__complete_task",
  "practice_data__record_retainer_notice",
  "practice_data__upsert_anchor",
  "practice_data__delete_anchor",
  "practice_data__upsert_deadline",
  "practice_data__manage_payment_in_flight",
  "practice_data__upsert_signal",
  "practice_data__set_status",
  "practice_data__ingest_court_calendar_year",
  "practice_data__court_calendar_coverage",
  "practice_data__court_calendar_days",
  "practice_data__import_invoices",
  "practice_data__invoices_query",
  "practice_data__upsert_rule_overlay",
  "practice_data__rule_overlay",
];

test("upsert_anchor schema exposes amend and anchor sources allow superseded status (#194)", () => {
  const definition = schemaGen.practiceToolDefinitions().find((tool) => tool.name === "practice_data__upsert_anchor");
  assert.deepEqual(definition.inputSchema.properties.amend, { type: "boolean" });
  assert.match(definition.description, /Pass amend=true/);

  const status = practiceRegistry.practiceEntityFor("practice_anchor_sources").fields.find((field) => field.name === "status");
  assert.deepEqual(status.enum, ["pending", "confirmed", "conflicted", "superseded"]);
});

test("every practice tool name routes (no unknown-tool error)", async () => {
  const admin = fakeAdmin();
  for (const name of PRACTICE_TOOL_NAMES) {
    const args = name === "practice_data__import_invoices" ? { rows: [] } : {};
    try {
      await practiceIndex.callPracticeTool(admin, OWNER, name, args);
    } catch (err) {
      assert.doesNotMatch(String(err.message), /Unknown practice tool/, name);
    }
  }
});

test("practice tools route to the local backend without any cloud auth/unlock gate (B4/B5)", async () => {
  // B4 flipped practice to local SQLite; B5 removed the cloud auth/crypto surface
  // entirely. A routine practice read/write routes straight to the local backend
  // (PP-3).
  const practiceDb = fakeAdmin();
  const ctx = { practiceDb, legalCommons: {} };
  const result = await index.callTool(ctx, "practice_data__upsert_task", { task_type: "admin", description: "x" });
  assert.ok(result && result.id, "practice tool returned a created task");
  assert.equal(practiceDb._tables.get("practice_tasks").length, 1, "wrote to the local backend");
});

test("ensureDefaultPolicies inserts 8 rows once and is idempotent", async () => {
  const admin = fakeAdmin();
  await shared.ensureDefaultPolicies(admin, OWNER);
  await shared.ensureDefaultPolicies(admin, OWNER);
  const rows = admin._tables.get("practice_status_policies");
  assert.equal(rows.length, 8);
});

test("upsert_anchor: a conflicting date attaches a conflicted source under the ONE anchor (#189 D1)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const clean = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "trial_date",
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "2026-09-01",
  });
  assert.equal(clean.conflict, false);
  assert.equal(clean.anchor.status, "active");

  const conflicted = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "trial_date",
    anchor_date: "2026-10-15",
    source_document: "TMC Order",
    stated_date: "2026-10-15",
  });
  assert.equal(conflicted.conflict, true);

  const anchors = admin._tables.get("practice_anchors");
  assert.equal(anchors.length, 1, "no duplicate anchor row is created on conflict");
  assert.equal(anchors[0].status, "conflicted");
  assert.equal(anchors[0].anchor_date, "2026-09-01", "the authoritative date is unchanged by a conflicting source");

  const sources = admin._tables.get("practice_anchor_sources");
  assert.equal(sources.length, 2, "both documents are recorded as sources under the one anchor");
  const byDoc = new Map(sources.map((row) => [String(row.source_document ?? row.source_document_enc), row]));
  const confirmed = sources.filter((row) => row.status === "confirmed");
  const conflictedSources = sources.filter((row) => row.status === "conflicted");
  assert.equal(confirmed.length, 1, "the agreeing source stays confirmed");
  assert.equal(confirmed[0].asserted_date, "2026-09-01");
  assert.equal(conflictedSources.length, 1, "the differing source is conflicted");
  assert.equal(conflictedSources[0].asserted_date, "2026-10-15");
});

test("upsert_anchor: re-asserting the anchor's own date resolves a conflict (#189 D2/D3)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const base = { matt_num: ".L100", anchor_type: "trial_date" };
  await writes.upsert_anchor(admin, OWNER, { ...base, anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01" });
  await writes.upsert_anchor(admin, OWNER, { ...base, anchor_date: "2026-10-15", source_document: "TMC Order", stated_date: "2026-10-15" });

  // Re-assert the original authoritative date -> auto-resolves (no resolve flag needed).
  const resolved = await writes.upsert_anchor(admin, OWNER, { ...base, anchor_date: "2026-09-01", source_document: "Registrar confirmation", stated_date: "2026-09-01" });
  assert.equal(resolved.conflict, false);
  assert.equal(resolved.anchor.status, "active", "resolution returns the anchor to active");

  const anchors = admin._tables.get("practice_anchors");
  assert.equal(anchors.length, 1, "resolution never spawns a fresh active anchor (D2)");
  assert.equal(anchors[0].anchor_date, "2026-09-01");

  const sources = admin._tables.get("practice_anchor_sources");
  const confirmed = sources.filter((row) => row.asserted_date === "2026-09-01");
  const stillConflicted = sources.filter((row) => row.asserted_date === "2026-10-15");
  assert.ok(confirmed.every((row) => row.status === "confirmed"), "all 2026-09-01 sources are confirmed");
  assert.ok(stillConflicted.every((row) => row.status === "conflicted"), "the losing source stays conflicted for audit");
});

test("upsert_anchor: resolve=true to the later date re-marks sources by asserted_date (#189)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const base = { matt_num: ".L100", anchor_type: "trial_date" };
  await writes.upsert_anchor(admin, OWNER, { ...base, anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01" });
  await writes.upsert_anchor(admin, OWNER, { ...base, anchor_date: "2026-10-15", source_document: "Amended Notice of Trial", stated_date: "2026-10-15" });

  // The later document wins: practitioner declares 2026-10-15 authoritative.
  const resolved = await writes.upsert_anchor(admin, OWNER, {
    ...base, anchor_date: "2026-10-15", source_document: "Amended Notice of Trial", stated_date: "2026-10-15", resolve: true,
  });
  assert.equal(resolved.conflict, false);
  assert.equal(resolved.anchor.status, "active");
  assert.equal(resolved.anchor.anchor_date, "2026-10-15", "the chosen date becomes authoritative");

  const sources = admin._tables.get("practice_anchor_sources");
  assert.equal(sources.length, 2, "resolution does not duplicate an already-recorded source");
  const amendedSources = sources.filter((row) => row.source_document === "Amended Notice of Trial");
  assert.equal(amendedSources.length, 1, "the amended notice has exactly one source row");
  assert.equal(amendedSources[0].status, "confirmed", "the amended notice is confirmed");
  const originalSources = sources.filter((row) => row.source_document === "Notice of Trial");
  assert.equal(originalSources.length, 1);
  assert.equal(originalSources[0].status, "conflicted", "the original notice flips to conflicted");
});

test("upsert_anchor: amend=true supersedes prior authoritative sources and preserves them through resolve (#194)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const base = { matt_num: ".L100", anchor_type: "trial_date" };
  const created = await writes.upsert_anchor(admin, OWNER, {
    ...base, anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01",
  });
  const amended = await writes.upsert_anchor(admin, OWNER, {
    ...base, anchor_date: "2026-10-15", source_document: "Amended Notice of Trial", stated_date: "2026-10-15", amend: true,
  });

  assert.equal(amended.conflict, false);
  assert.equal(amended.anchor.id, created.anchor.id);
  assert.equal(amended.anchor.anchor_date, "2026-10-15");
  assert.equal(amended.anchor.status, "active");
  const sources = admin._tables.get("practice_anchor_sources");
  assert.equal(sources.length, 2);
  assert.equal(sources.find((row) => row.source_document === "Notice of Trial").status, "superseded");
  assert.equal(sources.find((row) => row.source_document === "Amended Notice of Trial").status, "confirmed");
  assert.equal(sources.some((row) => row.status === "conflicted"), false);

  await writes.upsert_anchor(admin, OWNER, {
    ...base, anchor_date: "2026-10-15", source_document: "Amended Notice of Trial", stated_date: "2026-10-15", resolve: true,
  });
  assert.equal(sources.length, 2);
  assert.equal(sources.find((row) => row.source_document === "Notice of Trial").status, "superseded");
});

test("upsert_anchor: amend validation rejects resolve, a missing anchor, and an unchanged date (#194)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const base = {
    matt_num: ".L100",
    anchor_type: "trial_date",
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "2026-09-01",
  };

  await assert.rejects(
    () => writes.upsert_anchor(admin, OWNER, { ...base, amend: true, resolve: true }),
    /mutually exclusive/
  );
  await assert.rejects(
    () => writes.upsert_anchor(admin, OWNER, { ...base, amend: true }),
    /requires an existing anchor/
  );
  await writes.upsert_anchor(admin, OWNER, base);
  await assert.rejects(
    () => writes.upsert_anchor(admin, OWNER, { ...base, amend: true }),
    /requires a changed anchor_date/
  );
});

test("delete_anchor cascades to sources and derived deadlines (#190)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const created = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "trial_date",
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "2026-09-01",
  });
  const anchorId = String(created.anchor.id);
  await writes.upsert_deadline(admin, OWNER, {
    matt_num: ".L100",
    anchor_id: anchorId,
    deadline_type: "trial_management_conference",
    deadline_date: "2026-08-04",
    rule_ref: "R. 12-2(1)",
    rule_description: "TMC 28 days before trial",
    source_type: "bc_rules",
    status: "active",
  });

  const result = await writes.delete_anchor(admin, OWNER, { anchor_id: anchorId });
  assert.equal(result.deleted_anchor, anchorId);
  assert.equal(result.deleted_sources, 1);
  assert.equal(result.deleted_deadlines, 1);

  assert.equal(admin._tables.get("practice_anchors").length, 0);
  assert.equal(admin._tables.get("practice_anchor_sources").length, 0);
  assert.equal(admin._tables.get("practice_deadlines").length, 0);

  await assert.rejects(() => writes.delete_anchor(admin, OWNER, { anchor_id: anchorId }), /No anchor/);
});

test("upsert_anchor: different party_label on the same anchor_type never collides (#24)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const defendantA = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "nocc_served",
    anchor_date: "2026-09-01",
    source_document: "Affidavit of Service - Defendant A",
    stated_date: "2026-09-01",
    party_label: "Defendant A",
  });
  assert.equal(defendantA.conflict, false);
  assert.equal(defendantA.anchor.status, "active");

  const defendantB = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "nocc_served",
    anchor_date: "2026-09-20",
    source_document: "Affidavit of Service - Defendant B",
    stated_date: "2026-09-20",
    party_label: "Defendant B",
  });
  assert.equal(defendantB.conflict, false, "a different party's anchor must not trip a false conflict");
  assert.equal(defendantB.anchor.status, "active");

  const anchors = admin._tables.get("practice_anchors");
  assert.equal(anchors.length, 2);
  assert.ok(anchors.every((row) => row.status === "active"), "neither defendant's anchor is marked conflicted");
});

test("upsert_anchor: same party_label with a different date still conflicts", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "nocc_served",
    anchor_date: "2026-09-01",
    source_document: "Affidavit of Service",
    stated_date: "2026-09-01",
    party_label: "Defendant A",
  });
  const conflicted = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "nocc_served",
    anchor_date: "2026-09-05",
    source_document: "Amended Affidavit of Service",
    stated_date: "2026-09-05",
    party_label: "Defendant A",
  });
  assert.equal(conflicted.conflict, true);
});

test("upsert_deadline: supersedes the same party's prior row but leaves other parties alone (#24)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const deadlineFields = {
    matt_num: ".L100",
    deadline_type: "response_to_civil_claim",
    rule_ref: "R. 3-3(3)",
    rule_description: "21-day tier",
    source_type: "bc_rules",
    status: "active",
  };

  const firstA = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-09-22",
    party_label: "Defendant A",
  });
  const firstB = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-10-11",
    party_label: "Defendant B",
  });

  const revisedA = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-09-23",
    rule_description: "21-day tier, corrected service date",
    party_label: "Defendant A",
  });

  assert.notEqual(revisedA.id, firstA.id, "a re-upsert inserts a fresh row, not a mutation in place");

  const rows = admin._tables.get("practice_deadlines");
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(firstA.id).status, "superseded", "the same party's prior row is superseded");
  assert.equal(byId.get(firstB.id).status, "active", "a different party's row is untouched");
  assert.equal(byId.get(revisedA.id).status, "active");
});

// Provisional alternative dates (planning/1. Design/2026-10-06_provisional-alternative-dates-spec.md).
const alternativeFields = {
  matt_num: ".L100",
  deadline_type: "basic_limitation",
  rule_ref: "Limitation Act s. 6",
  rule_description: "2 years from discovery",
  source_type: "bc_rules",
  status: "active",
  review_flag: "practitioner_choice",
  review_note: "Turns on whether the written extension was validly agreed",
};

test("upsert_deadline: two practitioner_choice alternatives coexist and both return from active_deadlines (spec AT1)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const plain = await writes.upsert_deadline(admin, OWNER, {
    ...alternativeFields, review_flag: undefined, review_note: undefined, deadline_type: "ultimate_limitation", deadline_date: "2040-01-01",
  });
  const early = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-01", scenario_label: "Extension invalid" });
  const late = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-13", scenario_label: "Extension valid" });

  const { deadlines: out } = await reads.active_deadlines(admin, OWNER, { matt_num: ".L100" });
  const alternatives = out.filter((row) => row.deadline_type === "basic_limitation");
  assert.deepEqual(
    alternatives.map((row) => [row.scenario_label, row.review_flag, row.deadline_date]).sort(),
    [["Extension invalid", "practitioner_choice", "2030-03-01"], ["Extension valid", "practitioner_choice", "2030-03-13"]]
  );
  assert.equal(out.find((row) => row.id === plain.id).scenario_label, null, "a plain row carries no scenario");

  // Re-storing one scenario supersedes only that scenario's row.
  const lateAgain = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-14", scenario_label: "Extension valid" });
  const byId = new Map(admin._tables.get("practice_deadlines").map((row) => [row.id, row]));
  assert.equal(byId.get(late.id).status, "superseded");
  assert.equal(byId.get(early.id).status, "active", "another scenario is never superseded");
  assert.equal(byId.get(lateAgain.id).status, "active");

  // A plain (scenario-less) row of the same type neither supersedes nor is superseded by an alternative.
  const authoritative = await writes.upsert_deadline(admin, OWNER, {
    ...alternativeFields, review_flag: undefined, review_note: undefined, deadline_date: "2030-03-01",
  });
  const after = new Map(admin._tables.get("practice_deadlines").map((row) => [row.id, row]));
  assert.equal(after.get(early.id).status, "active");
  assert.equal(after.get(lateAgain.id).status, "active");
  assert.equal(after.get(authoritative.id).status, "active");
});

test("upsert_deadline: practitioner_choice needs scenario_label and review_note, and scenario_label needs practitioner_choice", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await assert.rejects(
    writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-01" }),
    /requires scenario_label/
  );
  await assert.rejects(
    writes.upsert_deadline(admin, OWNER, { ...alternativeFields, review_note: undefined, deadline_date: "2030-03-01", scenario_label: "Extension valid" }),
    /review_note/
  );
  await assert.rejects(
    writes.upsert_deadline(admin, OWNER, { ...alternativeFields, review_flag: "shift_pending", deadline_date: "2030-03-01", scenario_label: "Extension valid" }),
    /requires review_flag 'practitioner_choice'/
  );
  assert.equal((admin._tables.get("practice_deadlines") ?? []).length, 0, "a refused write stores nothing");
});

test("upsert_deadline: an update by id keeps the key labels it does not name", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const row = await writes.upsert_deadline(admin, OWNER, {
    ...alternativeFields, deadline_date: "2030-03-01", scenario_label: "Extension valid", party_label: "Defendant A", proceeding_label: "Court action",
  });
  await writes.upsert_deadline(admin, OWNER, { id: row.id, status: "dismissed" });
  const stored = admin._tables.get("practice_deadlines").find((r) => r.id === row.id);
  assert.equal(stored.status, "dismissed");
  assert.equal(stored.party_label, "Defendant A");
  assert.equal(stored.proceeding_label, "Court action");
  assert.equal(stored.scenario_label, "Extension valid");

  await writes.upsert_deadline(admin, OWNER, { id: row.id, party_label: null });
  assert.equal(admin._tables.get("practice_deadlines").find((r) => r.id === row.id).party_label, null, "an explicit null clears a label");
});

test("resolving alternatives leaves the chosen row active and unflagged and the other dismissed but retrievable (spec AT2)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const chosen = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-13", scenario_label: "Extension valid" });
  const other = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-01", scenario_label: "Extension invalid" });

  await writes.upsert_deadline(admin, OWNER, {
    id: chosen.id, review_flag: null, scenario_label: null, review_note: "Practitioner chose: extension valid",
  });
  await writes.upsert_deadline(admin, OWNER, { id: other.id, status: "dismissed" });

  const { deadlines: active } = await reads.active_deadlines(admin, OWNER, { matt_num: ".L100" });
  assert.deepEqual(active.map((row) => [row.id, row.status, row.review_flag, row.scenario_label]), [[chosen.id, "active", null, null]]);

  const { deadlines: withDismissed } = await reads.active_deadlines(admin, OWNER, { matt_num: ".L100", include_dismissed: true });
  const dismissed = withDismissed.find((row) => row.id === other.id);
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.scenario_label, "Extension invalid", "the losing alternative keeps its basis");

  // The resolved row is now the deadline's one authoritative row: a later cascade (no scenario) supersedes it.
  const recalculated = await writes.upsert_deadline(admin, OWNER, {
    ...alternativeFields, review_flag: undefined, review_note: undefined, deadline_date: "2030-03-16",
  });
  const byId = new Map(admin._tables.get("practice_deadlines").map((row) => [row.id, row]));
  assert.equal(byId.get(chosen.id).status, "superseded");
  assert.equal(byId.get(recalculated.id).status, "active");
});

test("resolving a rule_stale alternative is refused until it is recalculated", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const row = await writes.upsert_deadline(admin, OWNER, { ...alternativeFields, deadline_date: "2030-03-13", scenario_label: "Extension valid" });
  await writes.upsert_deadline(admin, OWNER, { id: row.id, review_flag: "rule_stale", review_note: "s. 6 amended" });
  await assert.rejects(
    writes.upsert_deadline(admin, OWNER, { id: row.id, review_flag: null, scenario_label: null }),
    /cannot resolve a rule_stale alternative/
  );
  const stored = admin._tables.get("practice_deadlines").find((r) => r.id === row.id);
  assert.equal(stored.review_flag, "rule_stale");
  assert.equal(stored.scenario_label, "Extension valid");
});

test("upsert_anchor: same anchor_type in a different proceeding never collides (#73)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  // Same matter, same anchor_type (award/order date), two concurrent proceedings.
  const arbitration = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "order_pronounced",
    anchor_date: "2026-09-01",
    source_document: "Arbitral Award",
    stated_date: "2026-09-01",
    proceeding_label: "Arbitration",
  });
  assert.equal(arbitration.conflict, false);

  const courtAction = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "order_pronounced",
    anchor_date: "2026-10-20",
    source_document: "Court Order",
    stated_date: "2026-10-20",
    proceeding_label: "Court action",
  });
  assert.equal(courtAction.conflict, false, "a concurrent proceeding's same-typed anchor must not trip a false conflict");

  const anchors = admin._tables.get("practice_anchors");
  assert.equal(anchors.length, 2);
  assert.ok(anchors.every((row) => row.status === "active"), "neither proceeding's anchor is marked conflicted");
});

test("upsert_anchor: same proceeding_label with a different date still conflicts (#73)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "order_pronounced",
    anchor_date: "2026-09-01",
    source_document: "Arbitral Award",
    stated_date: "2026-09-01",
    proceeding_label: "Arbitration",
  });
  const conflicted = await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L100",
    anchor_type: "order_pronounced",
    anchor_date: "2026-09-05",
    source_document: "Corrected Award",
    stated_date: "2026-09-05",
    proceeding_label: "Arbitration",
  });
  assert.equal(conflicted.conflict, true);
});

test("upsert_deadline: supersedes within a proceeding but leaves a concurrent proceeding alone (#73)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const deadlineFields = {
    matt_num: ".L100",
    deadline_type: "award_set_aside_application",
    rule_ref: "Arbitration Act s. 60(1)",
    rule_description: "30 days from receipt",
    source_type: "bc_rules",
    status: "active",
  };

  const arb1 = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-10-01",
    proceeding_label: "Arbitration A",
  });
  const arb2 = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-11-01",
    proceeding_label: "Arbitration B",
  });

  const revised1 = await writes.upsert_deadline(admin, OWNER, {
    ...deadlineFields,
    deadline_date: "2026-10-02",
    rule_description: "30 days from receipt, corrected receipt date",
    proceeding_label: "Arbitration A",
  });

  assert.notEqual(revised1.id, arb1.id);

  const rows = admin._tables.get("practice_deadlines");
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(arb1.id).status, "superseded", "the same proceeding's prior row is superseded");
  assert.equal(byId.get(arb2.id).status, "active", "a concurrent proceeding's row is untouched");
  assert.equal(byId.get(revised1.id).status, "active");
});

test("upsert_signal re-upsert keeps the row id stable (P-D9)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const first = await writes.upsert_signal(admin, OWNER, {
    matt_num: ".L100",
    signal_key: "conflict_check_completed",
    state: "confirmed",
  });
  const second = await writes.upsert_signal(admin, OWNER, {
    matt_num: ".L100",
    signal_key: "conflict_check_completed",
    state: "unconfirmed",
  });

  assert.equal(first.id, second.id);
  assert.equal(second.state, "unconfirmed");
  assert.equal(admin._tables.get("practice_matter_signals").length, 1);
});

test("import_invoices: negative skip, no-matter skip, NULL dedup, and stable-id re-import (P-D9)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const first = await invoices.import_invoices(admin, OWNER, {
    rows: [
      { matt_num: ".L100", invoice_number: "INV-1", amount: 100, status: "Outstanding" },
      { matt_num: ".L100", amount: -5 },
      { matt_num: "NOPE", amount: 10 },
      { matt_num: ".L100", invoice_number: null, amount: 50 },
    ],
  });
  assert.equal(first.imported, 2);
  assert.equal(first.skipped_negative, 1);
  assert.equal(first.skipped_no_matter, 1);

  const invRows = admin._tables.get("practice_invoices");
  const inv1 = invRows.find((row) => row.invoice_number === "INV-1");
  assert.ok(inv1, "INV-1 stored");
  const inv1Id = inv1.id;

  // Re-import: non-NULL PATCHes the same id; NULL dedup keeps a single NULL row.
  const second = await invoices.import_invoices(admin, OWNER, {
    rows: [
      { matt_num: ".L100", invoice_number: "INV-1", amount: 175, status: "Partial" },
      { matt_num: ".L100", invoice_number: null, amount: 60 },
    ],
  });
  assert.equal(second.imported, 2);

  const after = admin._tables.get("practice_invoices");
  const inv1After = after.filter((row) => row.invoice_number === "INV-1");
  assert.equal(inv1After.length, 1, "INV-1 not duplicated");
  assert.equal(inv1After[0].id, inv1Id, "INV-1 id stable across re-import");
  assert.equal(inv1After[0].amount, 175, "INV-1 amount updated");

  const nullRows = after.filter((row) => row.invoice_number === null || row.invoice_number === undefined);
  assert.equal(nullRows.length, 1, "NULL-number rows deduped");
  assert.equal(nullRows[0].amount, 60);
});

test("time_entries_query filters by date range and enriches with matter/client context", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  for (const [entry_date, hours, description] of [
    ["2026-01-10", 1.5, "Early entry"],
    ["2026-03-15", 2.0, "Mid entry"],
    ["2026-06-20", 0.5, "Late entry"],
  ]) {
    await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date, hours, description });
  }

  // Full matter query: all three rows, decrypted and enriched.
  const all = await reads.time_entries_query(admin, OWNER, { matt_num: ".L100" });
  assert.equal(all.rows.length, 3);
  assert.equal(all.rows[0].matt_num, "L100");
  assert.equal(all.rows[0].client_name, "Acme Co");
  assert.equal(all.rows[0].client_num, "C-1");
  assert.ok(all.rows.some((row) => row.description === "Mid entry"), "descriptions decrypted");

  // Date range: from_date (server-side gte) + to_date (post-decrypt) keeps only the mid entry.
  const windowed = await reads.time_entries_query(admin, OWNER, {
    matt_num: ".L100",
    from_date: "2026-02-01",
    to_date: "2026-05-01",
  });
  assert.equal(windowed.rows.length, 1);
  assert.equal(windowed.rows[0].description, "Mid entry");

  // Unknown matter raises (requireMatter), matching the other read tools' contract.
  await assert.rejects(
    () => reads.time_entries_query(admin, OWNER, { matt_num: ".L999" }),
    /No matter matched/
  );
});

test("ingest_court_calendar_year stores coverage + exception days, and re-ingesting replaces the prior day set", async () => {
  const admin = fakeAdmin();

  const first = await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2026,
    status: "confirmed",
    source_document: "CourtCalendar2026.pdf",
    days: [
      { calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" },
      { calendar_date: "2026-03-16", status_category: "limited", status_label: "Reading Break" },
    ],
  });
  assert.equal(first.coverage.status, "confirmed");
  assert.equal(first.days_count, 2);
  assert.equal(admin._tables.get("practice_court_calendar_days").length, 2);

  // Re-ingesting the same year replaces its day rows rather than appending.
  const second = await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2026,
    status: "confirmed",
    source_document: "CourtCalendar2026.pdf",
    days: [
      { calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" },
    ],
  });
  assert.equal(second.days_count, 1);
  assert.equal(admin._tables.get("practice_court_calendar_coverage").length, 1, "coverage row id stays stable across re-ingest");
  assert.equal(admin._tables.get("practice_court_calendar_days").length, 1);

  // A different year's days are untouched by the replace.
  await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2027,
    status: "unavailable",
  });
  const coverage = await reads.court_calendar_coverage(admin, OWNER, {});
  assert.equal(coverage.rows.length, 2);
  const y2027 = coverage.rows.find((row) => row.year === 2027);
  assert.equal(y2027.status, "unavailable");
  assert.equal(admin._tables.get("practice_court_calendar_days").length, 1, "2027 ingest with no days does not touch 2026's rows");
});

test("ingest_court_calendar_year rejects a day outside the given year and status=confirmed with no days", async () => {
  const admin = fakeAdmin();
  await assert.rejects(
    () => writes.ingest_court_calendar_year(admin, OWNER, { year: 2026, status: "confirmed", days: [] }),
    /requires at least one day/
  );
  await assert.rejects(
    () => writes.ingest_court_calendar_year(admin, OWNER, {
      year: 2026,
      status: "confirmed",
      days: [{ calendar_date: "2027-01-01", status_category: "full_closure", status_label: "New Year's Day" }],
    }),
    /does not fall within year/
  );
});

test("ingest_court_calendar_year writes nothing when a day row is invalid", async () => {
  const admin = fakeAdmin();
  await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2026,
    status: "unavailable",
  });
  await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2026,
    status: "confirmed",
    days: [{ calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" }],
  });

  for (const badDay of [
    { calendar_date: "2027-01-01", status_category: "full_closure", status_label: "New Year's Day" },
    { calendar_date: "2026-03-16", status_category: "limited" },
  ]) {
    await assert.rejects(
      () => writes.ingest_court_calendar_year(admin, OWNER, {
        year: 2026,
        status: "confirmed",
        source_document: "Replacement.pdf",
        days: [
          { calendar_date: "2026-12-25", status_category: "full_closure", status_label: "Christmas Day" },
          badDay,
        ],
      })
    );
    const days = admin._tables.get("practice_court_calendar_days");
    assert.deepEqual(days.map((row) => row.calendar_date), ["2026-01-01"], "prior day set survives a rejected ingest");
    const [coverage] = admin._tables.get("practice_court_calendar_coverage");
    assert.notEqual(coverage.source_document, "Replacement.pdf", "coverage is not rewritten by a rejected ingest");
  }
});

test("court_calendar_days filters by date range; absent dates are ordinary open days", async () => {
  const admin = fakeAdmin();
  await writes.ingest_court_calendar_year(admin, OWNER, {
    year: 2026,
    status: "confirmed",
    days: [
      { calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" },
      { calendar_date: "2026-12-25", status_category: "full_closure", status_label: "Christmas Day" },
    ],
  });

  const all = await reads.court_calendar_days(admin, OWNER, {});
  assert.equal(all.rows.length, 2);

  const ranged = await reads.court_calendar_days(admin, OWNER, { from_date: "2026-02-01", to_date: "2026-12-31" });
  assert.deepEqual(ranged.rows.map((row) => row.calendar_date), ["2026-12-25"]);
});

test("matter_lookup by matt_num returns the client-joined matter; unknown returns empty", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const found = await practiceIndex.callPracticeTool(admin, OWNER, "practice_data__matter_lookup", { matt_num: ".L100" });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].matt_num, "L100");
  assert.equal(found.rows[0].client_name, "Acme Co");
  assert.equal(found.rows[0].client_num, "C-1");

  const missing = await practiceIndex.callPracticeTool(admin, OWNER, "practice_data__matter_lookup", { matt_num: ".L999" });
  assert.deepEqual(missing.rows, []);
});

test("matt_num: the {client}.{matter} separator is stripped on write and either spelling resolves", async () => {
  const admin = fakeAdmin();
  // Seeded with the dotted CSV spelling `.L100`.
  await seedMatter(admin);
  const stored = await admin.query(practiceRegistry.practiceEntityFor("practice_matters"), {});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].matt_num, "L100");

  for (const spelling of [".L100", "L100"]) {
    const looked = await reads.matter_lookup(admin, OWNER, { matt_num: spelling });
    assert.equal(looked.rows.length, 1, `matter_lookup missed ${spelling}`);
    const trust = await reads.trust_summary(admin, OWNER, { matt_num: spelling });
    assert.equal(trust.rows.length, 1, `trust_summary missed ${spelling}`);
    const resolved = await shared.resolveMatter(admin, OWNER, { matt_num: spelling });
    assert.equal(resolved.id, stored[0].id, `resolveMatter missed ${spelling}`);
  }

  // Re-importing the dotted spelling on the matt_num key path updates the same
  // row rather than inserting a duplicate matter.
  await seedMatter(admin, { file_number: undefined, regular_trust: -750 });
  const after = await admin.query(practiceRegistry.practiceEntityFor("practice_matters"), {});
  assert.equal(after.length, 1);
  assert.equal(after[0].matt_num, "L100");
  assert.equal(after[0].regular_trust, -750);
});

test("matter_lookup by matter_id round-trips the id active_deadlines returns", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await writes.upsert_anchor(admin, OWNER, {
    matt_num: "L100",
    anchor_type: "application_hearing_date",
    anchor_date: "2026-07-17",
    source_document: "Notice of Application",
    stated_date: "July 17, 2026",
  });

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.equal(sweep.anchors.length, 1);
  const matterId = String(sweep.anchors[0].matter_id);

  const found = await reads.matter_lookup(admin, OWNER, { matter_id: matterId });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].matt_num, "L100");
  assert.equal(found.rows[0].client_name, "Acme Co");

  const missing = await reads.matter_lookup(admin, OWNER, { matter_id: "no-such-id" });
  assert.deepEqual(missing.rows, []);
});

test("active_deadlines rows carry matter identity on both anchors and deadlines", async () => {
  const admin = fakeAdmin();
  const seeded = await seedMatter(admin);
  await writes.upsert_anchor(admin, OWNER, {
    matt_num: "L100",
    anchor_type: "trial_date",
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "September 1, 2026",
  });
  await writes.upsert_deadline(admin, OWNER, {
    matter_id: seeded.matter_id,
    deadline_type: "trial_brief",
    deadline_date: "2026-08-04",
    rule_ref: "R. 12-1",
    rule_description: "Trial brief",
    source_type: "bc_rules",
    status: "active",
  });

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.equal(sweep.anchors.length, 1);
  assert.equal(sweep.anchors[0].matt_num, "L100");
  assert.equal(sweep.anchors[0].file_number, "F-100");
  assert.equal(sweep.anchors[0].matter_description, "Contract dispute");
  assert.equal(sweep.anchors[0].client_name, "Acme Co");
  assert.equal(sweep.anchors[0].client_num, "C-1");
  assert.equal(sweep.deadlines.length, 1);
  assert.equal(sweep.deadlines[0].matt_num, "L100");
  assert.equal(sweep.deadlines[0].matter_description, "Contract dispute");
  assert.equal(sweep.deadlines[0].client_name, "Acme Co");
});

test("occurred marks a spent anchor terminal and drops it from sweeps unless asked for", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const base = { matt_num: "L100", anchor_type: "application_hearing_date" };
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-17",
    source_document: "Notice of Application",
    stated_date: "July 17, 2026",
  });

  const marked = await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-17",
    source_document: "Practitioner confirmation",
    stated_date: "July 17, 2026",
    source_excerpt: "Hearing held, not adjourned; leave to amend NOCC and substituted service granted",
    occurred: true,
  });
  assert.equal(marked.conflict, false);
  assert.equal(marked.anchor.status, "occurred");

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.deepEqual(sweep.anchors, [], "occurred anchor is excluded from the default sweep");

  const withOccurred = await reads.active_deadlines(admin, OWNER, { include_occurred: true });
  assert.equal(withOccurred.anchors.length, 1);
  assert.equal(withOccurred.anchors[0].status, "occurred");
  const confirmation = withOccurred.anchors[0].sources.find(
    (row) => row.source_document === "Practitioner confirmation"
  );
  assert.equal(confirmation?.status, "confirmed");
  assert.match(String(confirmation?.source_excerpt), /not adjourned/);
});

test("not_applicable deadline: suppressed until overdue, surfaces once, then drops out once notified", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const created = await writes.upsert_deadline(admin, OWNER, {
    matt_num: ".L100",
    deadline_type: "arbitration_counterclaim",
    deadline_date: "2026-07-01",
    rule_ref: "VanIAC R. 24(e)",
    rule_description: "Counterclaim -- other side's obligation",
    source_type: "bc_rules",
    status: "not_applicable",
  });
  assert.equal(created.status, "not_applicable");

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.equal(sweep.deadlines.length, 1, "an unnotified not_applicable deadline surfaces by default");
  assert.equal(sweep.deadlines[0].status, "not_applicable");
  assert.equal(sweep.deadlines[0].expiry_notified_at ?? null, null);

  await writes.upsert_deadline(admin, OWNER, { id: String(created.id), expiry_notified_at: "2026-07-02T09:00:00.000Z" });

  const afterNotice = await reads.active_deadlines(admin, OWNER, {});
  assert.deepEqual(afterNotice.deadlines, [], "a notified not_applicable deadline drops out of the default sweep");

  const withNotified = await reads.active_deadlines(admin, OWNER, { include_notified: true });
  assert.equal(withNotified.deadlines.length, 1, "include_notified still surfaces it on request");
  assert.equal(withNotified.deadlines[0].expiry_notified_at, "2026-07-02T09:00:00.000Z");
});

test("dismissed deadline: never surfaces by default, retained and queryable via include_dismissed", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const created = await writes.upsert_deadline(admin, OWNER, {
    matt_num: ".L100",
    deadline_type: "witness_list",
    deadline_date: "2026-04-14",
    rule_ref: "R. 11-6(3)",
    rule_description: "Witness list",
    source_type: "bc_rules",
    status: "active",
  });
  await writes.upsert_deadline(admin, OWNER, { id: String(created.id), status: "dismissed" });

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.deepEqual(sweep.deadlines, [], "a dismissed deadline never surfaces by default");

  const withDismissed = await reads.active_deadlines(admin, OWNER, { include_dismissed: true });
  assert.equal(withDismissed.deadlines.length, 1);
  assert.equal(withDismissed.deadlines[0].status, "dismissed");
  assert.equal(admin._tables.get("practice_deadlines").length, 1, "dismissed rows are retained, never deleted");
});

test("met deadline: excluded by default, returned with include_met, and the enums admit it", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  const created = await writes.upsert_deadline(admin, OWNER, {
    matt_num: ".L100",
    deadline_type: "application_response",
    deadline_date: "2026-04-14",
    rule_ref: "R. 8-1(9)",
    rule_description: "Application response",
    source_type: "bc_rules",
    status: "active",
  });
  await writes.upsert_deadline(admin, OWNER, { id: String(created.id), status: "met" });

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.deepEqual(sweep.deadlines, [], "a met deadline never surfaces by default");
  const withMet = await reads.active_deadlines(admin, OWNER, { include_met: true });
  assert.equal(withMet.deadlines.length, 1);
  assert.equal(withMet.deadlines[0].status, "met");

  const status = practiceRegistry.practiceEntityFor("practice_deadlines").fields.find((field) => field.name === "status");
  assert.ok(status.enum.includes("met"));
  const tools = schemaGen.practiceToolDefinitions();
  assert.ok(tools.find((tool) => tool.name === "practice_data__upsert_deadline").inputSchema.properties.status.enum.includes("met"));
  assert.deepEqual(tools.find((tool) => tool.name === "practice_data__active_deadlines").inputSchema.properties.include_met, { type: "boolean" });
});

test("upsert_anchor filing_ref: a filing only, kept by an upsert that omits it, cleared by null, and returned by active_deadlines", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const base = { matt_num: "L100", anchor_type: "application_hearing_date", anchor_date: "2026-07-17", source_document: "Notice of Hearing", stated_date: "July 17, 2026" };

  for (const bad of ["proceeding:2", "filing:0", "filing:x", "2", ""]) {
    await assert.rejects(writes.upsert_anchor(admin, OWNER, { ...base, filing_ref: bad }), /filing_ref must be "filing:<id>"/, JSON.stringify(bad));
  }
  assert.equal(admin._tables.get("practice_anchors")?.length ?? 0, 0, "a refused filing_ref writes no anchor");

  const created = await writes.upsert_anchor(admin, OWNER, { ...base, filing_ref: "filing:3" });
  assert.equal(created.anchor.filing_ref, "filing:3");
  const kept = await writes.upsert_anchor(admin, OWNER, { ...base, source_document: "Practitioner confirmation" });
  assert.equal(kept.anchor.filing_ref, "filing:3", "an upsert that omits filing_ref leaves it");

  const sweep = await reads.active_deadlines(admin, OWNER, { matt_num: "L100" });
  assert.equal(sweep.anchors[0].filing_ref, "filing:3");

  const cleared = await writes.upsert_anchor(admin, OWNER, { ...base, source_document: "Practitioner confirmation", filing_ref: null });
  assert.equal(cleared.anchor.filing_ref, null);
  assert.equal(admin._tables.get("practice_anchors").length, 1, "linking never adds an anchor row");
  assert.deepEqual(schemaGen.practiceToolDefinitions().find((tool) => tool.name === "practice_data__upsert_anchor").inputSchema.properties.filing_ref, { type: "string" });
});

test("occurred guards: missing anchor, conflicted anchor, moved date, exclusive intents", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const base = { matt_num: "L100", anchor_type: "application_hearing_date" };

  await assert.rejects(
    writes.upsert_anchor(admin, OWNER, {
      ...base,
      anchor_date: "2026-07-17",
      source_document: "Practitioner confirmation",
      stated_date: "July 17, 2026",
      occurred: true,
    }),
    /requires an existing anchor/
  );

  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-17",
    source_document: "Notice of Application",
    stated_date: "July 17, 2026",
  });

  await assert.rejects(
    writes.upsert_anchor(admin, OWNER, {
      ...base,
      anchor_date: "2026-07-18",
      source_document: "Practitioner confirmation",
      stated_date: "July 18, 2026",
      occurred: true,
    }),
    /authoritative date/
  );

  await assert.rejects(
    writes.upsert_anchor(admin, OWNER, {
      ...base,
      anchor_date: "2026-07-17",
      source_document: "Practitioner confirmation",
      stated_date: "July 17, 2026",
      occurred: true,
      amend: true,
    }),
    /mutually exclusive/
  );

  // Conflict the anchor, then confirm occurred is refused until resolved.
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-24",
    source_document: "Requisition",
    stated_date: "July 24, 2026",
  });
  await assert.rejects(
    writes.upsert_anchor(admin, OWNER, {
      ...base,
      anchor_date: "2026-07-17",
      source_document: "Practitioner confirmation",
      stated_date: "July 17, 2026",
      occurred: true,
    }),
    /resolve the conflict first/
  );
});

test("amend returns an occurred anchor to active when the event turns out to have moved", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const base = { matt_num: "L100", anchor_type: "application_hearing_date" };
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-17",
    source_document: "Notice of Application",
    stated_date: "July 17, 2026",
  });
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-07-17",
    source_document: "Practitioner confirmation",
    stated_date: "July 17, 2026",
    occurred: true,
  });

  const amended = await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-09-04",
    source_document: "Order made at hearing",
    stated_date: "September 4, 2026",
    amend: true,
  });
  assert.equal(amended.anchor.status, "active");
  assert.equal(amended.anchor.anchor_date, "2026-09-04");

  const sweep = await reads.active_deadlines(admin, OWNER, {});
  assert.equal(sweep.anchors.length, 1, "amended anchor is live again");
});

test("set_time_entries_billable flips entries by id", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const a = await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "A" });
  const b = await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-08-02", hours: 2, description: "B" });

  const result = await writes.set_time_entries_billable(admin, OWNER, { entry_ids: [a.id], billable: false });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.ids, [a.id]);

  const { rows } = await reads.time_entries_query(admin, OWNER, { matt_num: ".L100" });
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(a.id).billable, false);
  assert.equal(byId.get(b.id).billable, true, "the other entry is untouched");
});

test("set_time_entries_billable flips a whole batch by batch_tag", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  for (const description of ["Note-up 1", "Note-up 2"]) {
    await writes.insert_time_entry(admin, OWNER, {
      matt_num: ".L100", entry_date: "2026-08-01", hours: 0.5, description,
      billable: false, batch_tag: "retire:7:2026-08-01",
    });
  }
  const untagged = await writes.insert_time_entry(admin, OWNER, {
    matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "Ordinary",
  });

  const result = await writes.set_time_entries_billable(admin, OWNER, {
    batch_tag: "retire:7:2026-08-01", billable: true,
  });
  assert.equal(result.updated, 2);

  const { rows } = await reads.time_entries_query(admin, OWNER, { matt_num: ".L100" });
  assert.ok(rows.filter((row) => row.batch_tag === "retire:7:2026-08-01").every((row) => row.billable === true));
  assert.equal(rows.find((row) => row.id === untagged.id).billable, true);
});

test("set_time_entries_billable refuses both selectors and refuses neither", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const entry = await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "A" });

  await assert.rejects(
    () => writes.set_time_entries_billable(admin, OWNER, { entry_ids: [entry.id], batch_tag: "t", billable: false }),
    /not both/
  );
  await assert.rejects(
    () => writes.set_time_entries_billable(admin, OWNER, { billable: false }),
    /requires entry_ids or batch_tag/
  );
});

test("set_time_entries_billable raises NotFoundError when a batch_tag matches nothing", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await assert.rejects(
    () => writes.set_time_entries_billable(admin, OWNER, { batch_tag: "retire:99:2026-08-01", billable: false }),
    /No time entries carry batch_tag/
  );
});

test("set_time_entries_billable narrows a batch_tag sweep to the given matter", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await seedMatter(admin, { matt_num: ".L200", file_number: "F-200", client_num: "C-2", name: "Beta Co" });
  const mine = await writes.insert_time_entry(admin, OWNER, {
    matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "Mine", billable: false, batch_tag: "shared-tag",
  });
  const theirs = await writes.insert_time_entry(admin, OWNER, {
    matt_num: ".L200", entry_date: "2026-08-01", hours: 1, description: "Theirs", billable: false, batch_tag: "shared-tag",
  });

  const result = await writes.set_time_entries_billable(admin, OWNER, {
    batch_tag: "shared-tag", billable: true, matt_num: ".L100",
  });
  assert.deepEqual(result.ids, [mine.id]);

  const other = await reads.time_entries_query(admin, OWNER, { matt_num: ".L200" });
  assert.equal(other.rows.find((row) => row.id === theirs.id).billable, false, "the other matter's entry is untouched");
});

test("set_time_entries_billable flips every entry in a batch_tag sweep larger than 1000", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  for (let i = 0; i < 1001; i += 1) {
    await writes.insert_time_entry(admin, OWNER, {
      matt_num: ".L100", entry_date: "2026-08-01", hours: 0.1, description: `Entry ${i}`,
      billable: false, batch_tag: "big-batch",
    });
  }

  const result = await writes.set_time_entries_billable(admin, OWNER, { batch_tag: "big-batch", billable: true });
  assert.equal(result.updated, 1001);
  const stored = admin._tables.get("practice_time_entries").filter((row) => row.batch_tag === "big-batch");
  assert.equal(stored.length, 1001);
  assert.ok(stored.every((row) => row.billable === true), "no entry past the 1000th is left unflipped");
});
