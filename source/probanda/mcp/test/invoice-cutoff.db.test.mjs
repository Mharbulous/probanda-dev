import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const shared = await import("../build/tools/practice/shared.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");
const invoicesTool = await import("../build/tools/practice/invoices.js");
const { LocalPracticeAdmin } = await import("../build/practice/backend.js");

const OWNER = "00000000-0000-4000-8000-0000000000aa";

function tempDatabase(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  return dbPath;
}

function runPython(script, dbPath) {
  const candidates = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);
  let lastError;
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", script, dbPath], { encoding: "utf-8" });
    if (result.error?.code === "ENOENT") {
      lastError = result.error;
      continue;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  throw lastError ?? new Error("No Python interpreter found");
}

// ---- Minimal in-memory UnscopedAdmin, same shape as practice-tools.unit.test.mjs ----
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

// ---- effectiveCutoff ----

test("effectiveCutoff: empty input or all-NULL rows return null", () => {
  assert.equal(shared.effectiveCutoff([]), null);
  assert.equal(shared.effectiveCutoff([{ issue_date: null, date_to: null }]), null);
});

test("effectiveCutoff: date_to yields cutoff_date = date_to + 1 day, source date_to", () => {
  const result = shared.effectiveCutoff([{ issue_date: "2026-03-01", date_to: "2026-02-28" }]);
  assert.deepEqual(result, { cutoff_date: "2026-03-01", cutoff_source: "date_to" });
});

test("effectiveCutoff: no date_to falls back to issue_date, source issue_date", () => {
  const result = shared.effectiveCutoff([{ issue_date: "2026-03-01", date_to: null }]);
  assert.deepEqual(result, { cutoff_date: "2026-03-01", cutoff_source: "issue_date" });
});

test("effectiveCutoff: +1 day crosses month and year boundaries correctly", () => {
  assert.equal(shared.addDaysIso("2026-01-31", 1), "2026-02-01");
  assert.equal(shared.addDaysIso("2026-12-31", 1), "2027-01-01");
});

test("effectiveCutoff: picks the MAXIMUM candidate across invoices, not the row with the latest issue_date", () => {
  // A NULL issue_date row with a real date_to must still win if its
  // date_to-derived candidate is later than another row's issue_date.
  const result = shared.effectiveCutoff([
    { issue_date: "2026-04-15", date_to: null },
    { issue_date: null, date_to: "2026-04-20" },
  ]);
  assert.deepEqual(result, { cutoff_date: "2026-04-21", cutoff_source: "date_to" });
});

test("effectiveCutoff: a later-issued invoice covering an earlier period does not falsely win", () => {
  const result = shared.effectiveCutoff([
    { issue_date: "2026-05-01", date_to: "2026-03-31" }, // candidate 2026-04-01
    { issue_date: "2026-02-01", date_to: "2026-04-30" }, // candidate 2026-05-01, later despite earlier issue_date
  ]);
  assert.deepEqual(result, { cutoff_date: "2026-05-01", cutoff_source: "date_to" });
});

test("effectiveCutoff: a tie between date_to and issue_date candidates prefers date_to", () => {
  const result = shared.effectiveCutoff([
    { issue_date: "2026-04-21", date_to: null },
    { issue_date: null, date_to: "2026-04-20" }, // candidate also 2026-04-21
  ]);
  assert.equal(result.cutoff_source, "date_to");
  assert.equal(result.cutoff_date, "2026-04-21");
});

// ---- import_invoices: date_to write semantics ----

test("import_invoices: date_to is written on first import and preserved on a re-import that omits it", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);

  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, issue_date: "2026-04-15", date_to: "2026-03-31" }],
  });
  let rows = admin._tables.get("practice_invoices");
  assert.equal(rows.find((r) => r.invoice_number === "INV-1").date_to, "2026-03-31");

  // Re-import without date_to at all: the stored value must survive.
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 150, issue_date: "2026-04-16" }],
  });
  rows = admin._tables.get("practice_invoices");
  const inv1 = rows.find((r) => r.invoice_number === "INV-1");
  assert.equal(inv1.date_to, "2026-03-31", "date_to preserved when the re-import row omits the key");
  assert.equal(inv1.amount, 150);
});

test("import_invoices: an explicit null clears a stored date_to", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-03-31" }],
  });
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: null }],
  });
  const rows = admin._tables.get("practice_invoices");
  assert.equal(rows.find((r) => r.invoice_number === "INV-1").date_to, null);
});

// ---- import_invoices: cutoff-regression gate ----

test("import_invoices: a first-ever import never trips the regression gate", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  const result = await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-15" }],
  });
  assert.equal(result.imported, 1);
});

test("import_invoices: refuses a backward cutoff move and writes nothing", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-03-31" }],
  });
  const beforeCount = admin._tables.get("practice_invoices").length;

  // Re-import the SAME invoice with an earlier date_to -- a correction that
  // genuinely moves this matter's effective cutoff backward (a brand-new
  // invoice_number would just add another candidate alongside INV-1's
  // existing, still-higher one, and never regress).
  await assert.rejects(
    () =>
      invoicesTool.import_invoices(admin, OWNER, {
        rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-31" }],
      }),
    (err) => {
      assert.match(err.message, /backward/i);
      assert.match(err.message, /L100/);
      assert.match(err.message, /confirm_regression/);
      return true;
    }
  );
  const rows = admin._tables.get("practice_invoices");
  assert.equal(rows.length, beforeCount, "no row written on refusal");
  assert.equal(rows.find((r) => r.invoice_number === "INV-1").date_to, "2026-03-31", "original value untouched");
});

test("import_invoices: confirm_regression: true proceeds despite a backward move", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-03-31" }],
  });

  const result = await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-31" }],
    confirm_regression: true,
  });
  assert.equal(result.imported, 1);
  const rows = admin._tables.get("practice_invoices");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date_to, "2026-01-31", "the correction was applied once confirmed");
});

test("import_invoices: a forward cutoff move never requires confirmation", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-31" }],
  });
  const result = await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-03-31" }],
  });
  assert.equal(result.imported, 1);
});

// ---- wip_hours: per-matter cutoff derivation ----

test("wip_hours: no invoices sums everything, cutoff_date/cutoff_source null", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-01-01", hours: 1, description: "old" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-06-01", hours: 2, description: "new" });

  const { rows } = await reads.wip_hours(admin, OWNER, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_hours, 3);
  assert.equal(rows[0].cutoff_date, null);
  assert.equal(rows[0].cutoff_source, null);
});

test("wip_hours: derives the cutoff from date_to + 1 day and excludes entries before it", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-03-31" }],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-03-15", hours: 5, description: "billed already" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-01", hours: 2, description: "on cutoff" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-10", hours: 1, description: "after cutoff" });

  const { rows } = await reads.wip_hours(admin, OWNER, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cutoff_date, "2026-04-01");
  assert.equal(rows[0].cutoff_source, "date_to");
  assert.equal(rows[0].total_hours, 3, "only the on/after-cutoff entries count");
});

test("wip_hours: falls back to issue_date as cutoff_source when no invoice has date_to", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, issue_date: "2026-04-15" }],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-20", hours: 1, description: "after" });
  const { rows } = await reads.wip_hours(admin, OWNER, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cutoff_date, "2026-04-15");
  assert.equal(rows[0].cutoff_source, "issue_date");
});

test("wip_hours: an explicit cutoff_date overrides uniformly for every matter (cutoff_source explicit)", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await seedMatter(admin, { matt_num: ".L200", file_number: "F-200", client_num: "C-2", name: "Beta Co" });
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-31" }],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-02-01", hours: 1, description: "a" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L200", entry_date: "2026-02-01", hours: 4, description: "b" });

  const { rows } = await reads.wip_hours(admin, OWNER, { cutoff_date: "2026-02-01" });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.cutoff_date, "2026-02-01");
    assert.equal(row.cutoff_source, "explicit");
  }
});

test("wip_hours: two matters with different invoice histories get independently derived cutoffs", async () => {
  const admin = fakeAdmin();
  await seedMatter(admin);
  await seedMatter(admin, { matt_num: ".L200", file_number: "F-200", client_num: "C-2", name: "Beta Co" });
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [
      { matt_num: ".L100", invoice_number: "INV-1", amount: 100, date_to: "2026-01-31" },
      { matt_num: ".L200", invoice_number: "INV-2", amount: 100, date_to: "2026-03-31" },
    ],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-02-15", hours: 3, description: "a" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L200", entry_date: "2026-02-15", hours: 3, description: "b" });

  const { rows } = await reads.wip_hours(admin, OWNER, {});
  const l100 = rows.find((r) => r.matt_num === "L100");
  const l200 = rows.find((r) => r.matt_num === "L200");
  assert.equal(l100.cutoff_date, "2026-02-01");
  assert.equal(l100.total_hours, 3, "L100's entry is after its own cutoff");
  assert.equal(l200.cutoff_date, "2026-04-01");
  assert.equal(l200.total_hours, 0, "L200's entry predates its own (later) cutoff");
});

// ---- ar_data: same per-matter cutoff as wip_hours (#1357) ----

test("ar_data: a date_to cutoff leaves out entries on or before date_to and matches wip_hours", async () => {
  const admin = fakeAdmin();
  const matter = await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, issue_date: "2026-04-15", date_to: "2026-03-31" }],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-03-31", hours: 5, description: "billed already" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-01", hours: 2, description: "on cutoff" });

  const { rows } = await reads.ar_data(admin, OWNER);
  const row = rows.find((r) => r.id === matter.matter_id);
  assert.equal(row.wip_hours, 2);
  assert.equal(row.cutoff_date, "2026-04-01");
  assert.equal(row.cutoff_source, "date_to");

  const wip = (await reads.wip_hours(admin, OWNER, { matt_num: ".L100" })).rows[0];
  assert.deepEqual(
    { wip_hours: row.wip_hours, cutoff_date: row.cutoff_date, cutoff_source: row.cutoff_source },
    { wip_hours: wip.total_hours, cutoff_date: wip.cutoff_date, cutoff_source: wip.cutoff_source }
  );
});

test("ar_data: an issue_date-only invoice leaves out entries before issue_date and matches wip_hours", async () => {
  const admin = fakeAdmin();
  const matter = await seedMatter(admin);
  await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: ".L100", invoice_number: "INV-1", amount: 100, issue_date: "2026-04-15" }],
  });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-14", hours: 4, description: "before" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-04-15", hours: 1, description: "on issue date" });

  const { rows } = await reads.ar_data(admin, OWNER);
  const row = rows.find((r) => r.id === matter.matter_id);
  assert.equal(row.wip_hours, 1);
  assert.equal(row.cutoff_date, "2026-04-15");
  assert.equal(row.cutoff_source, "issue_date");

  const wip = (await reads.wip_hours(admin, OWNER, { matt_num: ".L100" })).rows[0];
  assert.deepEqual(
    { wip_hours: row.wip_hours, cutoff_date: row.cutoff_date, cutoff_source: row.cutoff_source },
    { wip_hours: wip.total_hours, cutoff_date: wip.cutoff_date, cutoff_source: wip.cutoff_source }
  );
});

test("ar_data: a matter with no invoices keeps all billable hours with a null cutoff", async () => {
  const admin = fakeAdmin();
  const matter = await seedMatter(admin);
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-01-01", hours: 1, description: "old" });
  await writes.insert_time_entry(admin, OWNER, { matt_num: ".L100", entry_date: "2026-06-01", hours: 2, description: "new" });

  const { rows } = await reads.ar_data(admin, OWNER);
  const row = rows.find((r) => r.id === matter.matter_id);
  assert.equal(row.wip_hours, 3);
  assert.equal(row.cutoff_date, null);
  assert.equal(row.cutoff_source, null);

  const wip = (await reads.wip_hours(admin, OWNER, { matt_num: ".L100" })).rows[0];
  assert.equal(row.wip_hours, wip.total_hours);
});

// ---- Schema migration ----

test("LocalPracticeAdmin adds date_to to a legacy practice_invoices table", async (t) => {
  const dbPath = tempDatabase(t, "legacy-invoices");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
CREATE TABLE practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_invoices (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, invoice_number TEXT, issue_date TEXT,
  amount REAL CHECK (amount >= 0), amount_paid REAL, status TEXT, last_import_at TEXT,
  created_at TEXT, updated_at TEXT
);
INSERT INTO practice_invoices (id, matter_id, invoice_number, issue_date, amount)
VALUES ('inv-old', 'matter-old', 'INV-OLD', '2026-01-01', 100);
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const result = await invoicesTool.invoices_query(admin, OWNER, {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "inv-old");
  assert.equal(result.rows[0].date_to, null, "legacy row gains date_to as NULL, not dropped");
});
