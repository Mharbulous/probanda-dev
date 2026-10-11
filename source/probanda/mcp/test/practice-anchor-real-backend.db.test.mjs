import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalPracticeAdmin } = await import("../build/practice/backend.js");
const { practiceEntityFor } = await import("../build/practice-registry.js");
const writes = await import("../build/tools/practice/writes.js");

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const anchors = practiceEntityFor("practice_anchors");
const anchorSources = practiceEntityFor("practice_anchor_sources");

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

test("Path 2b resolve re-citing the original source does not duplicate its physical row", async (t) => {
  const dbPath = tempDatabase(t, "path-2b");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "C-113E",
    name: "Path 2b client",
    matt_num: ".L113E",
    file_number: "F-113E",
    description: "Anchor reconciliation regression",
  });

  const base = { matt_num: ".L113E", anchor_type: "trial_date" };
  const created = await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "2026-09-01",
  });
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-10-15",
    source_document: "Amended Notice of Trial",
    stated_date: "2026-10-15",
  });
  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "2026-09-01",
    resolve: true,
  });

  const anchorId = String(created.anchor.id);
  const storedAnchors = await admin.query(anchors, { id: `eq.${anchorId}` }, { limit: 10 });
  assert.equal(storedAnchors.length, 1, "Path 2b retains exactly one physical anchor row");
  assert.equal(storedAnchors[0].status, "active");
  assert.equal(storedAnchors[0].anchor_date, "2026-09-01");

  const storedSources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 10 });
  assert.equal(storedSources.length, 2, "Path 2b retains exactly two physical source rows");

  const originalSources = storedSources.filter((row) => row.source_document === "Notice of Trial");
  assert.equal(originalSources.length, 1, "resolve re-marks rather than duplicates the original source");
  assert.equal(originalSources[0].asserted_date, "2026-09-01");
  assert.equal(originalSources[0].status, "confirmed");

  const amendedSources = storedSources.filter((row) => row.source_document === "Amended Notice of Trial");
  assert.equal(amendedSources.length, 1);
  assert.equal(amendedSources[0].asserted_date, "2026-10-15");
  assert.equal(amendedSources[0].status, "conflicted");
});

test("Path 4 amend supersedes the prior authoritative source and preserves its tombstone on resolve", async (t) => {
  const dbPath = tempDatabase(t, "path-4");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "C-PATH-4",
    name: "Path 4 client",
    matt_num: ".L-PATH-4",
    file_number: "F-PATH-4",
    description: "Adjourned trial regression",
  });

  const base = { matt_num: ".L-PATH-4", anchor_type: "trial_date" };
  const created = await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-09-01",
    source_document: "Notice of Trial",
    stated_date: "September 1, 2026",
  });
  const amended = await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-10-15",
    source_document: "Amended Notice of Trial",
    stated_date: "October 15, 2026",
    amend: true,
  });

  assert.equal(amended.conflict, false);
  assert.equal(amended.anchor.id, created.anchor.id, "amend updates the existing physical anchor");
  assert.equal(amended.anchor.status, "active");
  assert.equal(amended.anchor.anchor_date, "2026-10-15");

  const anchorId = String(created.anchor.id);
  const amendedSources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 10 });
  assert.equal(amendedSources.length, 2);
  assert.equal(amendedSources.find((row) => row.source_document === "Notice of Trial")?.status, "superseded");
  assert.equal(amendedSources.find((row) => row.source_document === "Amended Notice of Trial")?.status, "confirmed");
  assert.equal(amendedSources.some((row) => row.status === "conflicted"), false);

  await writes.upsert_anchor(admin, OWNER, {
    ...base,
    anchor_date: "2026-10-15",
    source_document: "Amended Notice of Trial",
    stated_date: "October 15, 2026",
    resolve: true,
  });
  const resolvedSources = await admin.query(anchorSources, { anchor_id: `eq.${anchorId}` }, { limit: 10 });
  assert.equal(resolvedSources.length, 2, "resolve reuses the amended source");
  assert.equal(resolvedSources.find((row) => row.source_document === "Notice of Trial")?.status, "superseded");
});

test("LocalPracticeAdmin upgrades the legacy anchor-source CHECK without losing rows", async (t) => {
  const dbPath = tempDatabase(t, "legacy-anchor-sources");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (client_id) REFERENCES practice_clients (id)
);
CREATE TABLE practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_anchor_sources (
  id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, source_document TEXT, source_excerpt TEXT,
  stated_date TEXT NOT NULL, asserted_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'conflicted')),
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
INSERT INTO practice_clients VALUES ('client-old', 'Legacy client', 'C-OLD', NULL, NULL, NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
INSERT INTO practice_matters VALUES ('matter-old', 'client-old', 'Legacy matter', 'F-OLD', 'L-OLD', NULL, NULL, 'active', NULL, NULL, NULL, NULL, '2025-01-03T00:00:00Z', '2025-01-04T00:00:00Z');
INSERT INTO practice_anchors VALUES ('anchor-old', 'matter-old', 'trial_date', '2026-09-01', 'active', NULL, NULL, '2025-01-05T00:00:00Z', '2025-01-06T00:00:00Z');
INSERT INTO practice_anchor_sources VALUES ('source-old', 'anchor-old', 'Notice of Trial', 'Legacy excerpt', 'September 1, 2026', '2026-09-01', 'confirmed', '2025-01-07T00:00:00Z', '2025-01-08T00:00:00Z');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const migratedRows = await admin.query(anchorSources, {}, { limit: 10 });
  assert.deepEqual(migratedRows, [{
    id: "source-old",
    anchor_id: "anchor-old",
    source_document: "Notice of Trial",
    source_excerpt: "Legacy excerpt",
    stated_date: "September 1, 2026",
    asserted_date: "2026-09-01",
    status: "confirmed",
    created_at: "2025-01-07T00:00:00Z",
    updated_at: "2025-01-08T00:00:00Z",
  }]);

  const inspection = JSON.parse(runPython(String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_anchor_sources'").fetchone()[0]
temps = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_anchor_sources__upgrade'").fetchone()[0]
fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
print(json.dumps({"schema": schema, "temps": temps, "fk_errors": fk_errors}))
db.close()
`, dbPath));
  assert.match(inspection.schema, /'superseded'/);
  assert.equal(inspection.temps, 0);
  assert.deepEqual(inspection.fk_errors, []);

  await writes.upsert_anchor(admin, OWNER, {
    matt_num: ".L-OLD",
    anchor_type: "trial_date",
    anchor_date: "2026-10-15",
    source_document: "Amended Notice of Trial",
    stated_date: "October 15, 2026",
    amend: true,
  });
  const afterAmend = await admin.query(anchorSources, { anchor_id: "eq.anchor-old" }, { limit: 10 });
  assert.equal(afterAmend.length, 2);
  assert.equal(afterAmend.find((row) => row.id === "source-old")?.status, "superseded");
  assert.equal(afterAmend.find((row) => row.source_document === "Amended Notice of Trial")?.status, "confirmed");
});

test("occurred lifecycle persists through the real backend", async (t) => {
  const dbPath = tempDatabase(t, "occurred");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  await writes.upsert_client_matter(admin, OWNER, {
    client_num: "C-OCC",
    name: "Occurred client",
    matt_num: ".L-OCC",
    file_number: "F-OCC",
    description: "Spent-anchor lifecycle",
  });

  const base = { matt_num: ".L-OCC", anchor_type: "application_hearing_date" };
  const created = await writes.upsert_anchor(admin, OWNER, {
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
    source_excerpt: "Hearing held, not adjourned; judgment reserved",
    occurred: true,
  });
  assert.equal(marked.anchor.id, created.anchor.id);
  assert.equal(marked.anchor.status, "occurred");

  const stored = await admin.query(anchors, { id: `eq.${String(created.anchor.id)}` }, { limit: 10 });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "occurred");
});

test("LocalPracticeAdmin widens the legacy anchors status CHECK without losing rows", async (t) => {
  const dbPath = tempDatabase(t, "legacy-anchor-status");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (client_id) REFERENCES practice_clients (id)
);
CREATE TABLE practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_anchor_sources (
  id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, source_document TEXT, source_excerpt TEXT,
  stated_date TEXT NOT NULL, asserted_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'conflicted', 'superseded')),
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
CREATE TABLE practice_deadlines (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
  deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded')),
  review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale')),
  review_note TEXT, party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
INSERT INTO practice_clients VALUES ('client-old', 'Legacy client', 'C-OLD', NULL, NULL, NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
INSERT INTO practice_matters VALUES ('matter-old', 'client-old', 'Legacy matter', 'F-OLD', 'L-OLD', NULL, NULL, 'active', NULL, NULL, NULL, NULL, '2025-01-03T00:00:00Z', '2025-01-04T00:00:00Z');
INSERT INTO practice_anchors VALUES ('anchor-old', 'matter-old', 'application_hearing_date', '2026-07-17', 'active', NULL, NULL, '2025-01-05T00:00:00Z', '2025-01-06T00:00:00Z');
INSERT INTO practice_anchor_sources VALUES ('source-old', 'anchor-old', 'Notice of Application', NULL, 'July 17, 2026', '2026-07-17', 'confirmed', '2025-01-07T00:00:00Z', '2025-01-08T00:00:00Z');
INSERT INTO practice_deadlines VALUES ('deadline-old', 'matter-old', 'anchor-old', NULL, 'application_response', '2026-07-10', 'R. 8-1', 'Application response', 'bc_rules', 'active', NULL, NULL, NULL, NULL, '2025-01-09T00:00:00Z', '2025-01-10T00:00:00Z');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const migrated = await admin.query(anchors, {}, { limit: 10 });
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, "anchor-old");
  assert.equal(migrated[0].status, "active");

  const inspection = JSON.parse(runPython(String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_anchors'").fetchone()[0]
temps = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_anchors__upgrade'").fetchone()[0]
fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
fk_on = db.execute("PRAGMA foreign_keys").fetchone()[0]
print(json.dumps({"schema": schema, "temps": temps, "fk_errors": fk_errors, "fk_on": fk_on}))
db.close()
`, dbPath));
  assert.match(inspection.schema, /'occurred'/);
  assert.match(inspection.schema, /filing_ref/, "the anchor's filing_ref column is added after the rebuild");
  assert.equal(migrated[0].filing_ref, null);
  assert.equal(inspection.temps, 0);
  assert.deepEqual(inspection.fk_errors, []);

  const marked = await writes.upsert_anchor(admin, OWNER, {
    matt_num: "L-OLD",
    anchor_type: "application_hearing_date",
    anchor_date: "2026-07-17",
    source_document: "Practitioner confirmation",
    stated_date: "July 17, 2026",
    occurred: true,
    filing_ref: "filing:4",
  });
  assert.equal(marked.anchor.status, "occurred");
  assert.equal(marked.anchor.filing_ref, "filing:4");
});

test("LocalPracticeAdmin widens the legacy deadlines status CHECK and adds expiry_notified_at without losing rows", async (t) => {
  const dbPath = tempDatabase(t, "legacy-deadline-status");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (client_id) REFERENCES practice_clients (id)
);
CREATE TABLE practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded', 'occurred')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_deadlines (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
  deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded')),
  review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale')),
  review_note TEXT, party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
INSERT INTO practice_clients VALUES ('client-old', 'Legacy client', 'C-OLD', NULL, NULL, NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
INSERT INTO practice_matters VALUES ('matter-old', 'client-old', 'Legacy matter', 'F-OLD', 'L-OLD', NULL, NULL, 'active', NULL, NULL, NULL, NULL, '2025-01-03T00:00:00Z', '2025-01-04T00:00:00Z');
INSERT INTO practice_anchors VALUES ('anchor-old', 'matter-old', 'arbitration_counterclaim', '2026-07-01', 'active', NULL, NULL, '2025-01-05T00:00:00Z', '2025-01-06T00:00:00Z');
INSERT INTO practice_deadlines VALUES ('deadline-old', 'matter-old', 'anchor-old', NULL, 'arbitration_counterclaim', '2026-07-01', 'VanIAC R. 24(e)', 'Counterclaim deadline', 'bc_rules', 'active', NULL, NULL, NULL, NULL, '2025-01-09T00:00:00Z', '2025-01-10T00:00:00Z');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const deadlines = practiceEntityFor("practice_deadlines");
  const migrated = await admin.query(deadlines, {}, { limit: 10 });
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, "deadline-old");
  assert.equal(migrated[0].status, "active");
  assert.equal(migrated[0].expiry_notified_at ?? null, null, "the new column reads as null on a migrated row");

  const inspection = JSON.parse(runPython(String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_deadlines'").fetchone()[0]
temps = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_deadlines__upgrade'").fetchone()[0]
fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
print(json.dumps({"schema": schema, "temps": temps, "fk_errors": fk_errors}))
db.close()
`, dbPath));
  assert.match(inspection.schema, /'not_applicable'/);
  assert.match(inspection.schema, /'dismissed'/);
  assert.match(inspection.schema, /'met'/);
  assert.match(inspection.schema, /expiry_notified_at/);
  assert.equal(inspection.temps, 0);
  assert.deepEqual(inspection.fk_errors, []);

  const dismissed = await writes.upsert_deadline(admin, OWNER, {
    id: "deadline-old",
    status: "dismissed",
  });
  assert.equal(dismissed.status, "dismissed");
  const stored = await admin.query(deadlines, { id: "eq.deadline-old" }, { limit: 10 });
  assert.equal(stored.length, 1, "dismissing a migrated row retains it");
  assert.equal(stored[0].status, "dismissed");
});

test("LocalPracticeAdmin widens the deadlines status CHECK to admit met, keeping every column's value", async (t) => {
  const dbPath = tempDatabase(t, "legacy-deadline-met");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_matters (id TEXT PRIMARY KEY, client_id TEXT, matt_num TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded', 'occurred')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_deadlines (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
  deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded', 'not_applicable', 'dismissed')),
  review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale')),
  review_note TEXT, party_label TEXT, proceeding_label TEXT, expiry_notified_at TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
INSERT INTO practice_matters VALUES ('matter-old', NULL, 'L-OLD', NULL, NULL);
INSERT INTO practice_anchors VALUES ('anchor-old', 'matter-old', 'application_hearing_date', '2026-07-17', 'active', NULL, NULL, NULL, NULL);
INSERT INTO practice_deadlines VALUES ('deadline-old', 'matter-old', 'anchor-old', NULL, 'application_reply', '2026-07-10', 'R. 8-1', 'Reply', 'bc_rules', 'not_applicable', NULL, NULL, NULL, NULL, '2026-07-11T09:00:00.000Z', '2025-01-09T00:00:00Z', '2025-01-10T00:00:00Z');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const deadlines = practiceEntityFor("practice_deadlines");
  const [migrated] = await admin.query(deadlines, {}, { limit: 10 });
  assert.equal(migrated.status, "not_applicable");
  assert.equal(migrated.expiry_notified_at, "2026-07-11T09:00:00.000Z", "the rebuild keeps expiry_notified_at");
  assert.equal(migrated.created_at, "2025-01-09T00:00:00Z");

  const met = await writes.upsert_deadline(admin, OWNER, { id: "deadline-old", status: "met" });
  assert.equal(met.status, "met");
});

test("LocalPracticeAdmin widens review_flag to admit practitioner_choice and adds scenario_label, keeping every row", async (t) => {
  const dbPath = tempDatabase(t, "legacy-deadline-scenario");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_matters (id TEXT PRIMARY KEY, client_id TEXT, matt_num TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded', 'occurred')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_deadlines (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
  deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded', 'not_applicable', 'dismissed', 'met')),
  review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale')),
  review_note TEXT, party_label TEXT, proceeding_label TEXT, expiry_notified_at TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
INSERT INTO practice_matters VALUES ('matter-old', NULL, 'L-OLD', NULL, NULL);
INSERT INTO practice_anchors VALUES ('anchor-old', 'matter-old', 'discovery_date', '2028-03-01', 'active', NULL, NULL, NULL, NULL);
INSERT INTO practice_deadlines VALUES ('deadline-old', 'matter-old', 'anchor-old', NULL, 'basic_limitation', '2030-03-01', 's. 6', '2 years', 'bc_rules', 'active', 'shift_pending', 'Beyond horizon', 'Defendant A', 'Court action', NULL, '2025-01-09T00:00:00Z', '2025-01-10T00:00:00Z');
""")
db.commit()
db.close()
`, dbPath);

  const deadlines = practiceEntityFor("practice_deadlines");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const [migrated] = await admin.query(deadlines, {}, { limit: 10 });
  assert.equal(migrated.review_flag, "shift_pending");
  assert.equal(migrated.party_label, "Defendant A");
  assert.equal(migrated.proceeding_label, "Court action");
  assert.equal(migrated.created_at, "2025-01-09T00:00:00Z");
  assert.equal(migrated.scenario_label ?? null, null, "the new column is NULL on a migrated row");

  const inspect = () => JSON.parse(runPython(String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_deadlines'").fetchone()[0]
temps = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_deadlines__upgrade'").fetchone()[0]
print(json.dumps({"schema": schema, "temps": temps, "fk_errors": db.execute("PRAGMA foreign_key_check").fetchall()}))
db.close()
`, dbPath));
  const first = inspect();
  assert.match(first.schema, /'practitioner_choice'/);
  assert.match(first.schema, /scenario_label/);
  assert.equal(first.temps, 0);
  assert.deepEqual(first.fk_errors, []);

  // Two alternatives store side by side through the real backend; an update by id keeps their labels.
  const choice = { matter_id: "matter-old", anchor_id: "anchor-old", deadline_type: "basic_limitation", rule_ref: "s. 6", rule_description: "2 years",
    source_type: "bc_rules", review_flag: "practitioner_choice", review_note: "Turns on the extension", party_label: "Defendant A", proceeding_label: "Court action" };
  const a = await writes.upsert_deadline(admin, OWNER, { ...choice, deadline_date: "2030-03-01", scenario_label: "Extension invalid" });
  const b = await writes.upsert_deadline(admin, OWNER, { ...choice, deadline_date: "2030-03-13", scenario_label: "Extension valid" });
  await writes.upsert_deadline(admin, OWNER, { id: a.id, status: "dismissed" });
  const rows = new Map((await admin.query(deadlines, {}, { limit: 10 })).map((row) => [row.id, row]));
  assert.equal(rows.get("deadline-old").status, "active", "a scenario-less row is not superseded by an alternative");
  assert.equal(rows.get(b.id).status, "active");
  assert.equal(rows.get(a.id).status, "dismissed");
  assert.equal(rows.get(a.id).party_label, "Defendant A", "a by-id status change keeps the key labels");
  assert.equal(rows.get(a.id).scenario_label, "Extension invalid");

  // A second open is a no-op.
  const reopened = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  assert.equal((await reopened.query(deadlines, {}, { limit: 10 })).length, 3);
  assert.equal(inspect().schema, first.schema);
});
