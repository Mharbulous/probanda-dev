// Local practice-data backend (B4 — three-layer re-architecture, spec §5).
//
// Serves the `practice_data__*` tool surface from a local SQLite
// database, reached through the host Python `sqlite3` module (the ratified §10
// runtime-SQLite exception: shell-out to host Python keeps the Node >=20 pin and
// the "may use Node 20" wording intact — no node:sqlite, no npm dependency, no
// build step). LocalPracticeAdmin exposes the exact query/insert/insertMany/
// update/delete surface the practice tools already call on UnscopedAdmin, so the
// tool bodies run unchanged; it subclasses UnscopedAdmin only so it drops into
// the `admin: UnscopedAdmin` parameters without retyping 25 functions.
//
// Storage discipline (§10): the helper opens the DB per call under DELETE journal
// mode and closes it before returning — no live handle is ever left on the
// SharePoint-synced `0. CASE DATA` tree. spawnSync serializes DB access within
// this process.

import { join } from "node:path";

import { resolveCaseDataRoot } from "./case-data-root.js";
import { UnscopedAdmin, type SelectOptions } from "../db/scope.js";
import { ValidationError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import type { EntityDefinition } from "../registry.js";

// Moved to ./case-data-root.ts; re-exported for the modules that import it from here.
export { resolveCaseDataRoot };

// The local practice schema. This runtime is the practice-data backend, so it
// owns the DDL (the /practice-data skill holds no schema by the encapsulation
// rule). Mechanical SQLite translation of the 14 cloud practice_ tables:
// uuid->TEXT (PKs kept verbatim, no remap), timestamptz->TEXT, numeric->REAL,
// boolean->INTEGER; every *_enc/*_iv/*_hmac column, owner_id, and all RLS
// machinery dropped; plaintext content and CHECK/NOT NULL/enum constraints kept.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (client_id) REFERENCES practice_clients (id)
);
CREATE TABLE IF NOT EXISTS practice_time_entries (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, description TEXT, entry_date TEXT,
  hours REAL, billable INTEGER NOT NULL DEFAULT 1, batch_tag TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_invoices (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, invoice_number TEXT, issue_date TEXT,
  date_to TEXT, amount REAL CHECK (amount >= 0), amount_paid REAL, status TEXT, last_import_at TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_tasks (
  id TEXT PRIMARY KEY, matter_id TEXT, description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('client', 'admin', 'professional')),
  time_estimate_hours REAL, actual_hours REAL, deadline_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'paused', 'withdrawn')),
  completed_at TEXT, next_nudge_date TEXT, nudge_interval_days INTEGER, last_nudged_at TEXT,
  created_at TEXT, updated_at TEXT, filing_ref TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_retainer_notices (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, sent_at TEXT NOT NULL,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_anchors (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded', 'occurred')),
  party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT, filing_ref TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_anchor_sources (
  id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, source_document TEXT, source_excerpt TEXT,
  stated_date TEXT NOT NULL, asserted_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'conflicted', 'superseded')),
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
CREATE TABLE IF NOT EXISTS practice_deadlines (
  id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
  deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
  rule_description TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded', 'not_applicable', 'dismissed', 'met')),
  review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale', 'practitioner_choice')),
  review_note TEXT, party_label TEXT, proceeding_label TEXT, scenario_label TEXT, expiry_notified_at TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
  FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
);
CREATE TABLE IF NOT EXISTS practice_payment_in_flight (
  id TEXT PRIMARY KEY, matter_id TEXT, notes TEXT, amount REAL, recorded_at TEXT,
  expected_clear_by TEXT, cleared INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_matter_signals (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, note TEXT, signal_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('confirmed', 'unconfirmed', 'absent')),
  confirmed_at TEXT, created_at TEXT, updated_at TEXT,
  UNIQUE (matter_id, signal_key),
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE IF NOT EXISTS practice_status_policies (
  id TEXT PRIMARY KEY, status_label TEXT NOT NULL, required_signals TEXT NOT NULL,
  blocking_signals TEXT, auto_advance INTEGER NOT NULL DEFAULT 1, description TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_court_calendar_coverage (
  id TEXT PRIMARY KEY, year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'unavailable')),
  source_document TEXT, checked_at TEXT NOT NULL, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_court_calendar_days (
  id TEXT PRIMARY KEY, calendar_date TEXT NOT NULL,
  status_category TEXT NOT NULL CHECK (status_category IN ('full_closure', 'limited', 'regional_exception')),
  status_label TEXT NOT NULL, courthouse_scope TEXT, source_document TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_rule_overlay (
  id TEXT PRIMARY KEY, deadline_type TEXT NOT NULL, rule_ref TEXT NOT NULL,
  amending_reg TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'superseded_by_shipped', 'conflict')),
  record TEXT NOT NULL, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_practice_time_entries_matter ON practice_time_entries (matter_id);
CREATE INDEX IF NOT EXISTS idx_practice_invoices_matter ON practice_invoices (matter_id);
CREATE INDEX IF NOT EXISTS idx_practice_time_entries_batch_tag ON practice_time_entries (batch_tag);
`.trim();

// Bundle-safe: the helper is embedded as a string and materialized to a temp
// file per process (dist ships as one JS file, so a sibling .py could not be
// resolved). Reads one JSON request on stdin, returns {rows|error} on stdout.
const PY_HELPER = String.raw`
import json, os, sqlite3, sys, datetime

BOOL_COLUMNS = {"cleared", "auto_advance", "billable"}

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def anchor_source_schema(con):
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_anchor_sources'"
    ).fetchone()
    return row[0] if row else None

def migrate_anchor_sources(con):
    current = anchor_source_schema(con)
    if current is None or "'superseded'" in current:
        return

    con.execute("BEGIN IMMEDIATE")
    try:
        current = anchor_source_schema(con)
        if current is None or "'superseded'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_anchor_sources").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_anchor_sources__upgrade"')
        con.execute("""
            CREATE TABLE practice_anchor_sources__upgrade (
              id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, source_document TEXT, source_excerpt TEXT,
              stated_date TEXT NOT NULL, asserted_date TEXT NOT NULL,
              status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'conflicted', 'superseded')),
              created_at TEXT, updated_at TEXT,
              FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
            )
        """)
        con.execute("""
            INSERT INTO practice_anchor_sources__upgrade
              (id, anchor_id, source_document, source_excerpt, stated_date, asserted_date,
               status, created_at, updated_at)
            SELECT id, anchor_id, source_document, source_excerpt, stated_date, asserted_date,
                   status, created_at, updated_at
            FROM practice_anchor_sources
        """)
        copied_count = con.execute("SELECT count(*) FROM practice_anchor_sources__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_anchor_sources upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_anchor_sources")
        con.execute("ALTER TABLE practice_anchor_sources__upgrade RENAME TO practice_anchor_sources")
        final_count = con.execute("SELECT count(*) FROM practice_anchor_sources").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_anchor_sources upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'superseded'" not in (anchor_source_schema(con) or ""):
            raise RuntimeError("practice_anchor_sources upgrade did not widen the status constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_anchor_sources__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_anchor_sources upgrade left its temporary table behind")
        if con.execute("PRAGMA foreign_key_check('practice_anchor_sources')").fetchall():
            raise RuntimeError("practice_anchor_sources upgrade failed its foreign-key check")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

def anchors_schema(con):
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_anchors'"
    ).fetchone()
    return row[0] if row else None

def migrate_anchor_status(con):
    # Widen the anchors status CHECK to admit the 'occurred' terminal state.
    # Table rebuild (SQLite cannot alter a CHECK); practice_anchors is a parent
    # of anchor_sources and deadlines, so FK enforcement is suspended for the
    # rebuild and both children are foreign_key_checked before commit.
    current = anchors_schema(con)
    if current is None or "'occurred'" in current:
        return

    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("BEGIN IMMEDIATE")
    try:
        current = anchors_schema(con)
        if current is None or "'occurred'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_anchors").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_anchors__upgrade"')
        con.execute("""
            CREATE TABLE practice_anchors__upgrade (
              id TEXT PRIMARY KEY, matter_id TEXT, anchor_type TEXT NOT NULL, anchor_date TEXT NOT NULL,
              status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'superseded', 'occurred')),
              party_label TEXT, proceeding_label TEXT, created_at TEXT, updated_at TEXT,
              FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
            )
        """)
        con.execute("""
            INSERT INTO practice_anchors__upgrade
              (id, matter_id, anchor_type, anchor_date, status, party_label, proceeding_label,
               created_at, updated_at)
            SELECT id, matter_id, anchor_type, anchor_date, status, party_label, proceeding_label,
                   created_at, updated_at
            FROM practice_anchors
        """)
        copied_count = con.execute("SELECT count(*) FROM practice_anchors__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_anchors upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_anchors")
        con.execute("ALTER TABLE practice_anchors__upgrade RENAME TO practice_anchors")
        final_count = con.execute("SELECT count(*) FROM practice_anchors").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_anchors upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'occurred'" not in (anchors_schema(con) or ""):
            raise RuntimeError("practice_anchors upgrade did not widen the status constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_anchors__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_anchors upgrade left its temporary table behind")
        for child in ("practice_anchors", "practice_anchor_sources", "practice_deadlines"):
            if not con.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='%s'" % child
            ).fetchone()[0]:
                continue
            if con.execute("PRAGMA foreign_key_check('%s')" % child).fetchall():
                raise RuntimeError("practice_anchors upgrade failed the %s foreign-key check" % child)
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.execute("PRAGMA foreign_keys = ON")

def deadlines_schema(con):
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_deadlines'"
    ).fetchone()
    return row[0] if row else None

def migrate_deadline_status(con):
    # Widen the deadlines status CHECK to admit 'not_applicable' (the other
    # side's obligation -- no pre-expiry reminders, exactly one post-expiry
    # notice) and 'dismissed' (practitioner wants no further notifications;
    # the row is retained, never deleted). Table rebuild (SQLite cannot alter
    # a CHECK); practice_deadlines is a leaf (nothing references it by FK), so
    # only its own two outgoing foreign keys need re-checking after the rebuild.
    current = deadlines_schema(con)
    if current is None or "'not_applicable'" in current:
        return

    con.execute("BEGIN IMMEDIATE")
    try:
        current = deadlines_schema(con)
        if current is None or "'not_applicable'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_deadlines__upgrade"')
        con.execute("""
            CREATE TABLE practice_deadlines__upgrade (
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
            )
        """)
        con.execute("""
            INSERT INTO practice_deadlines__upgrade
              (id, matter_id, anchor_id, source_document, deadline_type, deadline_date, rule_ref,
               rule_description, source_type, status, review_flag, review_note, party_label,
               proceeding_label, created_at, updated_at)
            SELECT id, matter_id, anchor_id, source_document, deadline_type, deadline_date, rule_ref,
                   rule_description, source_type, status, review_flag, review_note, party_label,
                   proceeding_label, created_at, updated_at
            FROM practice_deadlines
        """)
        copied_count = con.execute("SELECT count(*) FROM practice_deadlines__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_deadlines upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_deadlines")
        con.execute("ALTER TABLE practice_deadlines__upgrade RENAME TO practice_deadlines")
        final_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_deadlines upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'not_applicable'" not in (deadlines_schema(con) or ""):
            raise RuntimeError("practice_deadlines upgrade did not widen the status constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_deadlines__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_deadlines upgrade left its temporary table behind")
        if con.execute("PRAGMA foreign_key_check('practice_deadlines')").fetchall():
            raise RuntimeError("practice_deadlines upgrade failed its foreign-key check")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

def migrate_deadline_met_status(con):
    # Widen the deadlines status CHECK to admit 'met' (the practitioner marks a
    # deadline done; active-deadlines returns it only on include_met). Same
    # rebuild as migrate_deadline_status, which runs first, but it copies every
    # column the old table has, expiry_notified_at included when present.
    current = deadlines_schema(con)
    if current is None or "'met'" in current:
        return

    con.execute("BEGIN IMMEDIATE")
    try:
        current = deadlines_schema(con)
        if current is None or "'met'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_deadlines__upgrade"')
        con.execute("""
            CREATE TABLE practice_deadlines__upgrade (
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
            )
        """)
        upgraded = set(columns(con, "practice_deadlines__upgrade"))
        copied = ", ".join('"%s"' % c for c in columns(con, "practice_deadlines") if c in upgraded)
        con.execute("INSERT INTO practice_deadlines__upgrade (%s) SELECT %s FROM practice_deadlines" % (copied, copied))
        copied_count = con.execute("SELECT count(*) FROM practice_deadlines__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_deadlines met upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_deadlines")
        con.execute("ALTER TABLE practice_deadlines__upgrade RENAME TO practice_deadlines")
        final_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_deadlines met upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'met'" not in (deadlines_schema(con) or ""):
            raise RuntimeError("practice_deadlines met upgrade did not widen the status constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_deadlines__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_deadlines met upgrade left its temporary table behind")
        if con.execute("PRAGMA foreign_key_check('practice_deadlines')").fetchall():
            raise RuntimeError("practice_deadlines met upgrade failed its foreign-key check")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

def migrate_deadline_scenario(con):
    # Widen the review_flag CHECK to admit 'practitioner_choice' (one of several
    # provisional alternative dates the practitioner must choose between; never
    # valid) and add scenario_label, which names each alternative so the
    # alternatives of one deadline do not supersede each other. NULL on every
    # existing row. Same rebuild as migrate_deadline_met_status, which runs first.
    current = deadlines_schema(con)
    if current is None or "'practitioner_choice'" in current:
        return

    con.execute("BEGIN IMMEDIATE")
    try:
        current = deadlines_schema(con)
        if current is None or "'practitioner_choice'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_deadlines__upgrade"')
        con.execute("""
            CREATE TABLE practice_deadlines__upgrade (
              id TEXT PRIMARY KEY, matter_id TEXT, anchor_id TEXT, source_document TEXT,
              deadline_type TEXT NOT NULL, deadline_date TEXT NOT NULL, rule_ref TEXT NOT NULL,
              rule_description TEXT NOT NULL,
              source_type TEXT NOT NULL CHECK (source_type IN ('bc_rules', 'order_term', 'manual')),
              status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'superseded', 'not_applicable', 'dismissed', 'met')),
              review_flag TEXT CHECK (review_flag IN ('shift_pending', 'limited_day', 'rule_stale', 'practitioner_choice')),
              review_note TEXT, party_label TEXT, proceeding_label TEXT, scenario_label TEXT, expiry_notified_at TEXT,
              created_at TEXT, updated_at TEXT,
              FOREIGN KEY (matter_id) REFERENCES practice_matters (id),
              FOREIGN KEY (anchor_id) REFERENCES practice_anchors (id)
            )
        """)
        upgraded = set(columns(con, "practice_deadlines__upgrade"))
        copied = ", ".join('"%s"' % c for c in columns(con, "practice_deadlines") if c in upgraded)
        con.execute("INSERT INTO practice_deadlines__upgrade (%s) SELECT %s FROM practice_deadlines" % (copied, copied))
        copied_count = con.execute("SELECT count(*) FROM practice_deadlines__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_deadlines scenario upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_deadlines")
        con.execute("ALTER TABLE practice_deadlines__upgrade RENAME TO practice_deadlines")
        final_count = con.execute("SELECT count(*) FROM practice_deadlines").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_deadlines scenario upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'practitioner_choice'" not in (deadlines_schema(con) or ""):
            raise RuntimeError("practice_deadlines scenario upgrade did not widen the review_flag constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_deadlines__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_deadlines scenario upgrade left its temporary table behind")
        if con.execute("PRAGMA foreign_key_check('practice_deadlines')").fetchall():
            raise RuntimeError("practice_deadlines scenario upgrade failed its foreign-key check")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

def migrate_anchor_filing_ref_column(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains the anchor's filing_ref here. NULL = the anchor is linked
    # to no filing. Runs after migrate_anchor_status, whose rebuild predates it.
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_anchors'"
    ).fetchone()[0]:
        return
    if "filing_ref" in columns(con, "practice_anchors"):
        return
    con.execute('ALTER TABLE practice_anchors ADD COLUMN "filing_ref" TEXT')
    con.commit()

TASK_NUDGE_COLUMNS = (
    ("next_nudge_date", "TEXT"),
    ("nudge_interval_days", "INTEGER"),
    ("last_nudged_at", "TEXT"),
)

def migrate_task_nudge_columns(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains the nudge columns here. NULL everywhere = not in rotation.
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_tasks'"
    ).fetchone()[0]:
        return
    existing = set(columns(con, "practice_tasks"))
    missing = [(n, d) for n, d in TASK_NUDGE_COLUMNS if n not in existing]
    if not missing:
        return
    for name, decl in missing:
        con.execute('ALTER TABLE practice_tasks ADD COLUMN "%s" %s' % (name, decl))
    con.commit()

def migrate_task_filing_ref_column(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains filing_ref here (ADR 0021 D5). NULL = the to-do points
    # at no filing.
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_tasks'"
    ).fetchone()[0]:
        return
    if "filing_ref" in columns(con, "practice_tasks"):
        return
    con.execute('ALTER TABLE practice_tasks ADD COLUMN "filing_ref" TEXT')
    con.commit()

def tasks_schema(con):
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_tasks'"
    ).fetchone()
    return row[0] if row else None

def migrate_task_status(con):
    # Widen the tasks status CHECK to admit 'withdrawn' (ADR 0023 D6: a to-do
    # entered in error or merged into another, kept, never open and never
    # completed). Table rebuild (SQLite cannot alter a CHECK); practice_tasks is
    # a leaf (nothing references it by FK), so only its own outgoing foreign key
    # needs re-checking after the rebuild. Runs after the nudge and filing_ref
    # column migrations, so every column it copies already exists.
    current = tasks_schema(con)
    if current is None or "'withdrawn'" in current:
        return

    con.execute("BEGIN IMMEDIATE")
    try:
        current = tasks_schema(con)
        if current is None or "'withdrawn'" in current:
            con.execute("COMMIT")
            return

        before_count = con.execute("SELECT count(*) FROM practice_tasks").fetchone()[0]
        con.execute('DROP TABLE IF EXISTS "practice_tasks__upgrade"')
        con.execute("""
            CREATE TABLE practice_tasks__upgrade (
              id TEXT PRIMARY KEY, matter_id TEXT, description TEXT,
              task_type TEXT NOT NULL CHECK (task_type IN ('client', 'admin', 'professional')),
              time_estimate_hours REAL, actual_hours REAL, deadline_date TEXT,
              status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'paused', 'withdrawn')),
              completed_at TEXT, next_nudge_date TEXT, nudge_interval_days INTEGER, last_nudged_at TEXT,
              created_at TEXT, updated_at TEXT, filing_ref TEXT,
              FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
            )
        """)
        con.execute("""
            INSERT INTO practice_tasks__upgrade
              (id, matter_id, description, task_type, time_estimate_hours, actual_hours,
               deadline_date, status, completed_at, next_nudge_date, nudge_interval_days,
               last_nudged_at, created_at, updated_at, filing_ref)
            SELECT id, matter_id, description, task_type, time_estimate_hours, actual_hours,
                   deadline_date, status, completed_at, next_nudge_date, nudge_interval_days,
                   last_nudged_at, created_at, updated_at, filing_ref
            FROM practice_tasks
        """)
        copied_count = con.execute("SELECT count(*) FROM practice_tasks__upgrade").fetchone()[0]
        if copied_count != before_count:
            raise RuntimeError(
                "practice_tasks upgrade row-count mismatch: %s != %s" % (copied_count, before_count)
            )

        con.execute("DROP TABLE practice_tasks")
        con.execute("ALTER TABLE practice_tasks__upgrade RENAME TO practice_tasks")
        final_count = con.execute("SELECT count(*) FROM practice_tasks").fetchone()[0]
        if final_count != before_count:
            raise RuntimeError(
                "practice_tasks upgrade final row-count mismatch: %s != %s" % (final_count, before_count)
            )
        if "'withdrawn'" not in (tasks_schema(con) or ""):
            raise RuntimeError("practice_tasks upgrade did not widen the status constraint")
        if con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_tasks__upgrade'"
        ).fetchone()[0] != 0:
            raise RuntimeError("practice_tasks upgrade left its temporary table behind")
        if con.execute("PRAGMA foreign_key_check('practice_tasks')").fetchall():
            raise RuntimeError("practice_tasks upgrade failed its foreign-key check")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

def migrate_invoice_date_to_column(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains date_to here. NULL = billing-period-end unknown (the
    # issue_date proxy still applies for that invoice).
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_invoices'"
    ).fetchone()[0]:
        return
    if "date_to" in columns(con, "practice_invoices"):
        return
    con.execute('ALTER TABLE practice_invoices ADD COLUMN "date_to" TEXT')
    con.commit()

def migrate_matter_billable_column(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains billable here. DEFAULT 1 = every existing matter stays
    # billable (they are all real client/trust matters today).
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_matters'"
    ).fetchone()[0]:
        return
    if "billable" in columns(con, "practice_matters"):
        return
    con.execute('ALTER TABLE practice_matters ADD COLUMN "billable" INTEGER NOT NULL DEFAULT 1')
    con.commit()

def migrate_time_entry_billable_columns(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains the per-entry billable flag and batch_tag here. Existing
    # entries inherit their matter's billable flag on the one pass that adds the
    # column -- after that the entry's own value is authoritative and is never
    # rewritten from the matter again.
    if not con.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='practice_time_entries'"
    ).fetchone()[0]:
        return
    existing = columns(con, "practice_time_entries")
    if "billable" not in existing:
        con.execute('ALTER TABLE practice_time_entries ADD COLUMN "billable" INTEGER NOT NULL DEFAULT 1')
        if "billable" in columns(con, "practice_matters"):
            con.execute(
                'UPDATE practice_time_entries SET "billable" = 0 WHERE matter_id IN '
                '(SELECT id FROM practice_matters WHERE billable = 0)'
            )
    if "batch_tag" not in existing:
        con.execute('ALTER TABLE practice_time_entries ADD COLUMN "batch_tag" TEXT')
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_practice_time_entries_batch_tag "
        "ON practice_time_entries (batch_tag)"
    )
    con.commit()

def migrate_rule_overlay_table(con):
    # Additive, idempotent: SCHEMA_SQL only runs on a fresh DB, so an existing
    # practice.db gains the rule overlay table here. Firm-wide and matter-free
    # by design: no matter column. record holds the full validated record JSON.
    con.execute("""
        CREATE TABLE IF NOT EXISTS practice_rule_overlay (
          id TEXT PRIMARY KEY, deadline_type TEXT NOT NULL, rule_ref TEXT NOT NULL,
          amending_reg TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
          status TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'superseded_by_shipped', 'conflict')),
          record TEXT NOT NULL, created_at TEXT, updated_at TEXT
        )
    """)
    con.commit()

def connect(db_path, schema):
    d = os.path.dirname(os.path.abspath(db_path))
    if d:
        os.makedirs(d, exist_ok=True)
    fresh = not os.path.exists(db_path)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode = DELETE")
    con.execute("PRAGMA foreign_keys = ON")
    if fresh and schema:
        con.executescript(schema)
    migrate_anchor_sources(con)
    migrate_anchor_status(con)
    migrate_anchor_filing_ref_column(con)
    migrate_deadline_status(con)
    migrate_deadline_met_status(con)
    migrate_deadline_scenario(con)
    migrate_task_nudge_columns(con)
    migrate_task_filing_ref_column(con)
    migrate_task_status(con)
    migrate_invoice_date_to_column(con)
    migrate_matter_billable_column(con)
    migrate_time_entry_billable_columns(con)
    migrate_rule_overlay_table(con)
    return con

def columns(con, table):
    return [r[1] for r in con.execute("PRAGMA table_info('%s')" % table).fetchall()]

def where(filters):
    clauses, params = [], []
    for col, spec in (filters or {}).items():
        op, _, rest = str(spec).partition(".")
        if op == "is" and rest == "null":
            clauses.append('"%s" IS NULL' % col); continue
        sql_op = {"eq": "=", "neq": "!=", "lt": "<", "lte": "<=",
                  "gt": ">", "gte": ">=", "like": "LIKE"}.get(op)
        if sql_op is None:
            raise SystemExit("unsupported filter operator: %s" % op)
        val = rest
        if op == "like":
            val = val.replace("*", "%")
        elif col in BOOL_COLUMNS:
            val = 1 if rest == "true" else 0 if rest == "false" else rest
        clauses.append('"%s" %s ?' % (col, sql_op)); params.append(val)
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

def coerce(row, cols):
    out = {}
    for k, v in row.items():
        if k not in cols:
            continue
        if isinstance(v, bool):
            v = int(v)
        out[k] = v
    return out

def dump(con, table, rowids):
    if not rowids:
        return []
    q = 'SELECT * FROM "%s" WHERE _rowid_ IN (%s)' % (table, ",".join("?" * len(rowids)))
    return read_rows(con, q, rowids)

def read_rows(con, sql, params):
    rows = []
    for r in con.execute(sql, params).fetchall():
        d = dict(r)
        for b in BOOL_COLUMNS:
            if b in d and d[b] is not None:
                d[b] = bool(d[b])
        rows.append(d)
    return rows

def main():
    req = json.load(sys.stdin)
    con = connect(req["db_path"], req.get("schema", ""))
    try:
        op = req["op"]
        table = req["table"]
        cols = columns(con, table)
        if op == "query":
            clause, params = where(req.get("filters"))
            sql = 'SELECT * FROM "%s"%s' % (table, clause)
            if req.get("limit") is not None:
                sql += " LIMIT %d" % int(req["limit"])
            return {"rows": read_rows(con, sql, params)}
        if op in ("insert", "insertMany"):
            rowids = []
            con.execute("BEGIN")
            for raw in req["rows"]:
                row = coerce(raw, cols)
                if "created_at" in cols and not row.get("created_at"):
                    row["created_at"] = now_iso()
                if "updated_at" in cols:
                    row["updated_at"] = now_iso()
                keys = list(row.keys())
                sql = 'INSERT INTO "%s" (%s) VALUES (%s)' % (
                    table, ",".join('"%s"' % k for k in keys), ",".join("?" * len(keys)))
                cur = con.execute(sql, [row[k] for k in keys])
                rowids.append(cur.lastrowid)
            out = dump(con, table, rowids)
            con.execute("COMMIT")
            return {"rows": out}
        if op == "update":
            body = coerce(req["row"], cols)
            body.pop("id", None)
            if "updated_at" in cols:
                body["updated_at"] = now_iso()
            clause, wparams = where(req.get("filters"))
            sets = ",".join('"%s" = ?' % k for k in body.keys())
            con.execute("BEGIN")
            con.execute('UPDATE "%s" SET %s%s' % (table, sets, clause),
                        [body[k] for k in body.keys()] + wparams)
            out = read_rows(con, 'SELECT * FROM "%s"%s' % (table, clause), wparams)
            con.execute("COMMIT")
            return {"rows": out}
        if op == "delete":
            clause, wparams = where(req.get("filters"))
            con.execute("BEGIN")
            con.execute('DELETE FROM "%s"%s' % (table, clause), wparams)
            con.execute("COMMIT")
            return {"rows": []}
        raise SystemExit("unknown op: %s" % op)
    finally:
        con.close()

print(json.dumps(main()))
`.trim();

function helperFile(): string {
  return pythonDriverFile("practice-sqlite", PY_HELPER);
}

type SqliteOp = "query" | "insert" | "insertMany" | "update" | "delete";

interface SqliteRequest {
  op: SqliteOp;
  table: string;
  filters?: Record<string, string>;
  rows?: Record<string, unknown>[];
  row?: Record<string, unknown>;
  limit?: number;
}

/** Issue #693. Every write is one transaction, so a kill leaves it whole or absent. */
export function practiceTimeoutMs(op: SqliteOp, env: NodeJS.ProcessEnv = process.env): number {
  return pythonTimeoutMs(env, op === "query" ? READ_TIMEOUT_MS : EXECUTE_TIMEOUT_MS, "COCLERK_PRACTICE_PYTHON_TIMEOUT_MS");
}

// The helper writes in DELETE journal mode, one transaction per call: a kill before COMMIT is
// rolled back when the database next opens, and a kill after it leaves the write in place.
const KILLED_WRITE_ADVICE =
  "The write may already have committed: verify it by reading it back before retrying (/practice-data Conventions).";


// Resolves the practice.db path (spec §5): COCLERK_DB_PATH wins (test override);
// otherwise the Roaming coclerk.json `case_data_root` + `_practice\<name>`.
export function resolvePracticeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_DB_PATH) return env.COCLERK_DB_PATH;
  const root = resolveCaseDataRoot(env);
  return join(root, "_practice", env.COCLERK_DB_NAME || "practice.db");
}

export class LocalPracticeAdmin extends UnscopedAdmin {
  private dbPath: string | undefined;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    // Every data method is overridden below; the base bodies are never reached.
    super();
  }

  private path(): string {
    if (!this.dbPath) this.dbPath = resolvePracticeDbPath(this.env);
    return this.dbPath;
  }

  private exec(request: SqliteRequest): Record<string, unknown>[] {
    const payload = JSON.stringify({ db_path: this.path(), schema: SCHEMA_SQL, ...request });
    const timeoutMs = practiceTimeoutMs(request.op, this.env);
    const parsed = runPythonDriver({
      label: "practice-data sqlite helper",
      driver: helperFile(),
      payload,
      env: this.env,
      timeoutMs,
      timeoutAdvice: request.op === "query" ? undefined : KILLED_WRITE_ADVICE,
    }) as { rows?: Record<string, unknown>[]; error?: string };
    if (parsed.error) throw new ValidationError(`practice sqlite: ${parsed.error}`);
    return parsed.rows ?? [];
  }

  override async query(
    entity: EntityDefinition,
    filters: Record<string, string> = {},
    options: SelectOptions = {}
  ): Promise<Record<string, unknown>[]> {
    return this.exec({ op: "query", table: entity.table, filters, limit: options.limit });
  }

  override async insert(
    entity: EntityDefinition,
    row: Record<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    return this.exec({ op: "insert", table: entity.table, rows: [row] });
  }

  override async insertMany(
    entity: EntityDefinition,
    rows: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    return this.exec({ op: "insertMany", table: entity.table, rows });
  }

  override async update(
    entity: EntityDefinition,
    filters: Record<string, string>,
    row: Record<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    return this.exec({ op: "update", table: entity.table, filters, row });
  }

  override async delete(
    entity: EntityDefinition,
    filters: Record<string, string>
  ): Promise<Record<string, unknown>[]> {
    return this.exec({ op: "delete", table: entity.table, filters });
  }
}
