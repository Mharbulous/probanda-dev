import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalPracticeAdmin } = await import("../build/practice/backend.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");
const invoicesTool = await import("../build/tools/practice/invoices.js");

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

test("LocalPracticeAdmin adds the billable column to a legacy practice_matters table, defaulting true", async (t) => {
  const dbPath = tempDatabase(t, "legacy-matters");
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
INSERT INTO practice_clients (id, name, client_num) VALUES ('client-old', 'Legacy Client', '1000');
INSERT INTO practice_matters (id, client_id, matt_num, status)
VALUES ('matter-old', 'client-old', 'L0001', 'active');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const { rows } = await reads.matter_lookup(admin, OWNER, { matt_num: "L0001" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].billable, true, "legacy rows default to billable, and it is a real boolean");
});

test("upsert_client_matter creates a non-billable matter, preserves it on re-upsert, and can flip it back", async (t) => {
  const dbPath = tempDatabase(t, "billable-upsert");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const created = await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9001",
    name: "Firm Internal",
    matt_num: "LIF001",
    description: "LIF professional-liability file",
    billable: false,
  });
  {
    const { rows } = await reads.matter_lookup(admin, OWNER, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, false);
  }

  // A routine re-upsert (e.g. CSV re-import) omitting billable must not flip it back on.
  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9001",
    matt_num: "LIF001",
    description: "LIF professional-liability file",
  });
  {
    const { rows } = await reads.matter_lookup(admin, OWNER, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, false, "omitting billable on update leaves it untouched");
  }

  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9001",
    matt_num: "LIF001",
    billable: true,
  });
  {
    const { rows } = await reads.matter_lookup(admin, OWNER, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, true, "billable: true flips it back");
  }
  assert.equal(created.matter_created, true);
});

test("non-billable matter is excluded from the all-matters wip_hours and ar_data sweeps, but stays reachable directly", async (t) => {
  const dbPath = tempDatabase(t, "billable-sweeps");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const billable = await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9002", name: "Client A", matt_num: "L2000",
  });
  const nonBillable = await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9003", name: "Firm Internal", matt_num: "LIF002", billable: false,
  });

  await writes.insert_time_entry(admin, OWNER, {
    matter_id: billable.matter_id, entry_date: "2026-08-01", hours: 2, description: "Billable work",
  });
  await writes.insert_time_entry(admin, OWNER, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-01", hours: 3, description: "LIF work",
  });

  const sweep = await reads.wip_hours(admin, OWNER, {});
  const sweepByMatter = new Map(sweep.rows.map((r) => [r.matter_id, r]));
  assert.ok(sweepByMatter.has(billable.matter_id), "billable matter appears in the sweep");
  assert.ok(!sweepByMatter.has(nonBillable.matter_id), "non-billable matter is excluded from the sweep");

  // The entry inherited the matter's flag, so the targeted call has no billable
  // hours to report -- the matter itself is still reachable (below).
  const targeted = await reads.wip_hours(admin, OWNER, { matt_num: "LIF002" });
  assert.equal(targeted.rows.length, 0, "a targeted call reports no billable hours for it");

  // An entry explicitly marked billable on that same matter does come back.
  await writes.insert_time_entry(admin, OWNER, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-02", hours: 1.5,
    description: "Chargeable work on the internal file", billable: true,
  });
  const targetedAgain = await reads.wip_hours(admin, OWNER, { matt_num: "LIF002" });
  assert.equal(targetedAgain.rows.length, 1, "a targeted call returns the non-billable matter's billable entries");
  assert.equal(targetedAgain.rows[0].total_hours, 1.5);

  const ar = await reads.ar_data(admin, OWNER);
  const arIds = new Set(ar.rows.map((r) => r.id));
  assert.ok(arIds.has(billable.matter_id));
  assert.ok(!arIds.has(nonBillable.matter_id), "non-billable matter is excluded from ar_data");

  // Ordinary matter operations still work on it.
  const { rows: lookupRows } = await reads.matter_lookup(admin, OWNER, { matt_num: "LIF002" });
  assert.equal(lookupRows.length, 1);
  const { rows: trustRows } = await reads.trust_summary(admin, OWNER, { matt_num: "LIF002" });
  assert.equal(trustRows.length, 1);
});

test("import_invoices refuses rows resolving to a non-billable matter", async (t) => {
  const dbPath = tempDatabase(t, "billable-invoices");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9004", name: "Firm Internal", matt_num: "LIF003", billable: false,
  });

  const result = await invoicesTool.import_invoices(admin, OWNER, {
    rows: [{ matt_num: "LIF003", invoice_number: "INV-1", issue_date: "2026-08-01", amount: 500 }],
  });
  assert.equal(result.imported, 0);
  assert.equal(result.skipped_non_billable, 1);

  const { rows } = await invoicesTool.invoices_query(admin, OWNER, { matt_num: "LIF003" });
  assert.equal(rows.length, 0, "no invoice was written for the non-billable matter");
});

test("LocalPracticeAdmin adds billable/batch_tag to a legacy practice_time_entries table, backfilling from the matter, idempotently", async (t) => {
  const dbPath = tempDatabase(t, "legacy-entries");
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
  billable INTEGER NOT NULL DEFAULT 1,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_time_entries (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, description TEXT, entry_date TEXT,
  hours REAL, created_at TEXT, updated_at TEXT
);
INSERT INTO practice_clients (id, name, client_num) VALUES ('client-old', 'Legacy Client', '1000');
INSERT INTO practice_matters (id, client_id, matt_num, status, billable)
VALUES ('matter-bill', 'client-old', 'L0001', 'active', 1),
       ('matter-nonbill', 'client-old', 'LIF900', 'active', 0);
INSERT INTO practice_time_entries (id, matter_id, entry_date, hours)
VALUES ('e-bill', 'matter-bill', '2026-05-01', 2.0),
       ('e-nonbill', 'matter-nonbill', '2026-05-01', 3.0);
""")
db.commit()
db.close()
`, dbPath);

  const readEntries = () => JSON.parse(runPython(String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
rows = db.execute("SELECT id, billable, batch_tag FROM practice_time_entries ORDER BY id").fetchall()
idx = [r[1] for r in db.execute("PRAGMA index_list('practice_time_entries')").fetchall()]
print(json.dumps({"rows": rows, "indexes": idx}))
db.close()
`, dbPath));

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  await reads.matter_lookup(admin, OWNER, { matt_num: "L0001" });

  const first = readEntries();
  assert.deepEqual(first.rows, [["e-bill", 1, null], ["e-nonbill", 0, null]],
    "existing entries inherit their matter's billable flag once; batch_tag starts null");
  assert.ok(first.indexes.includes("idx_practice_time_entries_batch_tag"), "batch_tag index created");

  // A later flip of the entry must survive the next connection: the backfill runs
  // only on the pass that adds the column.
  await writes.set_time_entries_billable(admin, OWNER, { entry_ids: ["e-nonbill"], billable: true });
  const admin2 = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  await reads.matter_lookup(admin2, OWNER, { matt_num: "L0001" });
  const second = readEntries();
  assert.deepEqual(second.rows, [["e-bill", 1, null], ["e-nonbill", 1, null]],
    "re-connecting does not re-backfill from the matter");
});

test("insert_time_entry inherits the matter's billable flag and honours an explicit override and batch_tag", async (t) => {
  const dbPath = tempDatabase(t, "entry-billable-default");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const billable = await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9100", name: "Client B", matt_num: "L3000",
  });
  const nonBillable = await writes.upsert_client_matter(admin, OWNER, {
    client_num: "9101", name: "Firm Internal", matt_num: "LIF300", billable: false,
  });

  await writes.insert_time_entry(admin, OWNER, {
    matter_id: billable.matter_id, entry_date: "2026-08-01", hours: 1, description: "Default billable",
  });
  await writes.insert_time_entry(admin, OWNER, {
    matter_id: billable.matter_id, entry_date: "2026-08-02", hours: 1, description: "Note-up",
    billable: false, batch_tag: "retire:7:2026-08-02",
  });
  await writes.insert_time_entry(admin, OWNER, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-03", hours: 1, description: "Internal",
  });

  const { rows } = await reads.time_entries_query(admin, OWNER, { matt_num: "L3000" });
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Default billable").billable, true, "defaults to the matter's flag");
  assert.equal(byDescription.get("Default billable").batch_tag, null);
  assert.equal(byDescription.get("Note-up").billable, false, "explicit false wins on a billable matter");
  assert.equal(byDescription.get("Note-up").batch_tag, "retire:7:2026-08-02");

  const internal = await reads.time_entries_query(admin, OWNER, { matt_num: "LIF300" });
  assert.equal(internal.rows[0].billable, false, "a non-billable matter's entries default to false");

  // The non-billable entry is out of WIP even though its matter is billable.
  const sweep = await reads.wip_hours(admin, OWNER, {});
  const wipRow = sweep.rows.find((row) => row.matter_id === billable.matter_id);
  assert.equal(wipRow.total_hours, 1, "wip_hours counts only the billable entry");

  const ar = await reads.ar_data(admin, OWNER);
  const arRow = ar.rows.find((row) => row.id === billable.matter_id);
  assert.equal(arRow.wip_hours, 1, "ar_data counts only the billable entry");
});
