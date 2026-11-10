"""Tests for the /drafting-data migrate engine's pre-migration backup (#353).

Assertion goals fixed by the ticket: a timestamped backup file appears when
migrating a pre-existing older-version database, and a fresh create makes
none. Plus one content check: the backup is the PRE-migration file (a copy
taken after the hops would satisfy the existence assertion while protecting
nothing).

Run: python -m unittest discover -s source/skills/drafting-data/tests
"""

import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import migrate_engine as engine  # noqa: E402


def schema_version(db_path):
    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT value FROM db_meta WHERE key = 'schema_version'"
        ).fetchone()
        return int(row[0]) if row else None
    finally:
        con.close()


def backups_of(db_path):
    return sorted(db_path.parent.glob(db_path.name + ".bak-*"))


class TestPreMigrationBackup(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_create_makes_no_backup(self):
        result = engine.run({"db_path": str(self.db_path)})
        self.assertEqual(result["schema_version"], engine.TARGET_SCHEMA_VERSION)
        self.assertEqual(backups_of(self.db_path), [])

    def test_existing_older_database_is_backed_up_before_hops(self):
        # Build a genuine v1 database via the engine's own 0->1 hop.
        engine.migrate(str(self.db_path), target_version=1)
        self.assertEqual(backups_of(self.db_path), [])  # fresh create: none

        result = engine.run({"db_path": str(self.db_path)})
        self.assertEqual(result["schema_version"], engine.TARGET_SCHEMA_VERSION)
        self.assertEqual(result["applied"][0], {"from": 1, "to": 2})

        backups = backups_of(self.db_path)
        self.assertEqual(len(backups), 1)
        # The copy was taken BEFORE any hop ran: it is still v1 inside.
        self.assertEqual(schema_version(backups[0]), 1)

    def test_noop_run_on_current_database_makes_no_backup(self):
        engine.run({"db_path": str(self.db_path)})
        result = engine.run({"db_path": str(self.db_path)})
        self.assertEqual(result["applied"], [])
        self.assertEqual(backups_of(self.db_path), [])


class TestV15TicketTables(unittest.TestCase):
    """Schema hop 14->15 (ticket-driven /draft-submission sessions, ADR 0009)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_migrate_creates_the_six_ticket_tables(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            names = {
                row[0]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name IN ('tickets', 'ticket_steps', 'ticket_scope', "
                    "'ticket_blocks', 'ticket_conflicts', 'seeds')"
                )
            }
        finally:
            con.close()
        self.assertEqual(
            names,
            {"tickets", "ticket_steps", "ticket_scope", "ticket_blocks", "ticket_conflicts", "seeds"},
        )


class TestV18RetirementReasonDecided(unittest.TestCase):
    """Schema hop 17->18: 'decided' joins filings.retirement_reason's closed
    set (practitioner decision, 2026-09-10) -- retiring a decided filing no
    longer requires first proving appeal rights are exhausted."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_migrate_accepts_decided_and_rejects_unknown(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.execute(
                "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC')"
            )
            con.execute(
                "INSERT INTO filings (id, proceeding_id, kind, title, retired_on, retirement_reason) "
                "VALUES (1, 1, 'notice_of_application', 'A', '2026-09-10', 'decided')"
            )
            con.commit()

            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO filings (id, proceeding_id, kind, title, retirement_reason) "
                    "VALUES (2, 1, 'requisition_default_judgment', 'B', 'bogus')"
                )

            self.assertEqual(schema_version(self.db_path), engine.TARGET_SCHEMA_VERSION)
            index_row = con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' "
                "AND name = 'idx_filings_proceeding'"
            ).fetchone()
            self.assertIsNotNone(index_row)
        finally:
            con.close()

    def test_v17_database_hops_to_v18_with_children_intact(self):
        engine.migrate(str(self.db_path), target_version=17)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO filings (id, proceeding_id, kind, title, retired_on, retirement_reason)
                VALUES (1, 1, 'notice_of_application', 'A', '2026-09-01', 'appeal_expired');
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (2, 1, 'requisition', 'B');
            INSERT INTO hearing_details (id, filing_id) VALUES (1, 2);
            INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
                VALUES (1, 1, 2, 't', 'i', 'work', 'L0000', '2026-09-10');
            INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea)
                VALUES (1, 1, 2, '2026-09-10', 's', 'x');
            INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'p');
            INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal)
                VALUES (1, 2, 1, 'form', 'part2', 1);
            INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'd');
            INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role)
                VALUES (1, 2, 1, 1, 'other');
            """
        )
        con.commit()

        before = {
            "filings": con.execute("SELECT * FROM filings ORDER BY id").fetchall(),
            "hearing_details": con.execute("SELECT * FROM hearing_details ORDER BY id").fetchall(),
            "tickets": con.execute("SELECT * FROM tickets ORDER BY id").fetchall(),
            "seeds": con.execute("SELECT * FROM seeds ORDER BY id").fetchall(),
            "filing_facts": con.execute("SELECT * FROM filing_facts ORDER BY id").fetchall(),
            "filing_documents": con.execute("SELECT * FROM filing_documents ORDER BY id").fetchall(),
        }
        con.close()

        # Pinned to the one hop this test is about. Later hops add columns of
        # their own, which would widen the SELECT * rows compared below and
        # fail this test for a reason that has nothing to do with the rebuild.
        applied = engine.migrate(str(self.db_path), target_version=18)
        self.assertEqual(applied, [(17, 18)])
        self.assertEqual(schema_version(self.db_path), 18)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            for table, rows in before.items():
                after = con.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                self.assertEqual(after, rows, f"{table} rows changed across the hop")

            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

            # The child's foreign key re-bound to the rebuilt filings table by name --
            # an orphan reference is still refused, proving no dangling FK survived the rebuild.
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (9, 999)")
        finally:
            con.close()

    def test_decided_is_recoverable_with_the_standard_idiom(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.execute(
                "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC')"
            )
            con.execute(
                "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'requisition_default_judgment', 'A')"
            )
            con.commit()

            con.execute(
                "UPDATE filings SET retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1"
            )
            con.commit()

            # The existing recovery idiom (filing-checklists.md section 11) must continue to
            # work unchanged for a filing retired with reason 'decided'.
            con.execute(
                "UPDATE filings SET retired_on = NULL, retirement_reason = NULL WHERE id = ?", (1,)
            )
            con.commit()

            row = con.execute(
                "SELECT retired_on, retirement_reason FROM filings WHERE id = 1"
            ).fetchone()
            self.assertEqual(row, (None, None))
        finally:
            con.close()


class TestV19FilingsEnteredOn(unittest.TestCase):
    """Schema hop 18->19: filings.entered_on, the 'Entered' lifecycle state
    between Decided and Appeal period expired (practitioner decision,
    2026-09-10). Additive column -- no CHECK and no table rebuild, so this
    hop needs far less proving than the v17->v18 rebuild did."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_migrate_accepts_an_entry_date(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.execute(
                "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA')"
            )
            con.execute(
                "INSERT INTO filings (id, proceeding_id, kind, title, decided_on, entered_on) "
                "VALUES (1, 1, 'bcca_stay_response', 'A', '2026-09-02', '2026-09-09')"
            )
            con.commit()

            row = con.execute(
                "SELECT decided_on, entered_on FROM filings WHERE id = 1"
            ).fetchone()
            self.assertEqual(row, ("2026-09-02", "2026-09-09"))
            self.assertEqual(schema_version(self.db_path), engine.TARGET_SCHEMA_VERSION)
        finally:
            con.close()

    def test_v18_database_hops_to_v19_leaving_entered_on_null(self):
        engine.migrate(str(self.db_path), target_version=18)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO filings (id, proceeding_id, kind, title, filed_on, decided_on)
                VALUES (1, 1, 'notice_of_application', 'A', '2026-08-14', '2026-09-02');
            """
        )
        con.commit()
        con.close()

        applied = engine.migrate(str(self.db_path), target_version=19)
        self.assertEqual(applied, [(18, 19)])
        self.assertEqual(schema_version(self.db_path), 19)

        con = sqlite3.connect(str(self.db_path))
        try:
            # An existing decided filing carries forward untouched, and the new
            # column reads NULL -- "not entered yet", never a fabricated date.
            row = con.execute(
                "SELECT filed_on, decided_on, entered_on FROM filings WHERE id = 1"
            ).fetchone()
            self.assertEqual(row, ("2026-08-14", "2026-09-02", None))
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        finally:
            con.close()

    def test_entered_on_clears_back_to_null(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.execute(
                "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA')"
            )
            con.execute(
                "INSERT INTO filings (id, proceeding_id, kind, title, entered_on) "
                "VALUES (1, 1, 'bcca_stay_response', 'A', '2026-09-09')"
            )
            con.commit()

            # The undo idiom (filing-checklists.md section 11) -- clearing the date
            # is how an entry recorded in error is taken back.
            con.execute("UPDATE filings SET entered_on = NULL WHERE id = ?", (1,))
            con.commit()

            row = con.execute("SELECT entered_on FROM filings WHERE id = 1").fetchone()
            self.assertEqual(row, (None,))
        finally:
            con.close()


class TestV20AssociateJudgeUndetermined(unittest.TestCase):
    """Schema hop 19->20 (#451): hearing_details.associate_judge becomes
    nullable, NULL = not yet determined. The old 0 default was also what the
    filing checklist told drafters to leave when undecided, so every existing
    0 migrates to NULL (practitioner decision, 2026-09-13); 1 stays 1."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_migrate_defaults_to_undetermined_and_rejects_other_values(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.executescript(
                """
                INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
                INSERT INTO filings (id, proceeding_id, kind, title)
                    VALUES (1, 1, 'notice_of_application', 'A'), (2, 1, 'notice_of_application', 'B'),
                           (3, 1, 'notice_of_application', 'C');
                INSERT INTO hearing_details (id, filing_id) VALUES (1, 1);
                INSERT INTO hearing_details (id, filing_id, associate_judge) VALUES (2, 2, 1);
                """
            )
            con.commit()

            rows = con.execute("SELECT id, associate_judge FROM hearing_details ORDER BY id").fetchall()
            self.assertEqual(rows, [(1, None), (2, 1)])
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id, associate_judge) VALUES (3, 3, 2)")
            self.assertEqual(schema_version(self.db_path), engine.TARGET_SCHEMA_VERSION)
        finally:
            con.close()

    def test_v19_database_hops_to_v20_converting_zero_to_undetermined(self):
        engine.migrate(str(self.db_path), target_version=19)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO filings (id, proceeding_id, kind, title)
                VALUES (1, 1, 'notice_of_application', 'A'), (2, 1, 'notice_of_application', 'B');
            INSERT INTO hearing_details (id, filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
                VALUES (1, 1, '2026-09-01', '9:45 am', 45, 0), (2, 2, NULL, NULL, NULL, 1);
            """
        )
        con.commit()
        con.close()

        applied = engine.migrate(str(self.db_path), target_version=20)
        self.assertEqual(applied, [(19, 20)])
        self.assertEqual(schema_version(self.db_path), 20)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            rows = con.execute("SELECT * FROM hearing_details ORDER BY id").fetchall()
            self.assertEqual(
                rows,
                [(1, 1, "2026-09-01", "9:45 am", 45, None), (2, 2, None, None, None, 1)],
            )
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (9, 999)")
        finally:
            con.close()


class TestV21RevisionTriggers(unittest.TestCase):
    """Schema hop 20->21 (#607, decided in #581): db_meta.revision moves in the
    database, not by skill-text convention. Three triggers per table --
    rev_<table>_ins|upd|del -- on every table but db_meta itself and the eight
    ticket tables exempted by schema v15 / ADR 0009 (six then; v25 added two).

    The non-exempt list is read from the live database, never hardcoded, so a
    future hop that ADDS a table without triggers fails here too -- not only
    one that rebuilds a table and drops its triggers on the way."""

    # Eight ticket tables since v25 (work-board-proposals design section 10):
    # ticket_proposals and proposal_rejections join the six, so a conversion,
    # rejection or restore never bumps db_meta.revision and never archives a mockup.
    # v27 adds review_approvals and review_points (practitioner-review design
    # sections 5 and 7), ten exempt tables in all: approving or discussing
    # changes no substance. v52 adds ticket_answers, eleven: saving an answer
    # for a job changes no substance either. v57 adds paragraph_revisions,
    # twelve: the audit row is append-only, and the substance UPDATE written
    # beside it moves the revision through its own table's triggers. v67 adds
    # board_attachments, thirteen: attaching a draft to a board changes no
    # mockup, only the Work Board pages (ADR 0042, migrations.sql 66 -> 67).
    # v73 adds the rules-position tables, seventeen: where a session stands on
    # its rules map, and which rules it was served, change no substance.
    # v76 adds ticket_sources, eighteen: recording or closing a source a job
    # is about to get changes no substance (migrations.sql 75 -> 76).
    # v80 adds kv_store, nineteen: it holds job or process state only
    # (migrations.sql 79 -> 80).
    EXEMPT = frozenset(
        {
            "kv_store",
            "board_attachments",
            "session_position",
            "job_position",
            "rule_served",
            "out_of_bounds_visit",
            "db_meta",
            "tickets",
            "ticket_steps",
            "ticket_scope",
            "ticket_blocks",
            "ticket_conflicts",
            "seeds",
            "ticket_proposals",
            "proposal_rejections",
            "ticket_answers",
            "ticket_sources",
            "review_approvals",
            "review_points",
            "paragraph_revisions",
        }
    )

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _tables_and_triggers(con):
        tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        triggers = {
            row[0]: row[1]
            # Revision triggers only: the forum guards are asserted by TestV30WritingModel.
            for row in con.execute("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND substr(name, 1, 4) = 'rev_'")
        }
        return tables, triggers

    def test_every_non_exempt_table_has_all_three_triggers(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            tables, triggers = self._tables_and_triggers(con)
        finally:
            con.close()

        missing = sorted(
            f"rev_{table}_{suffix}"
            for table in tables - self.EXEMPT
            for suffix in ("ins", "upd", "del")
            if triggers.get(f"rev_{table}_{suffix}") != table
        )
        self.assertEqual(missing, [], "tables without a full revision-trigger set")

    def test_exempt_tables_carry_no_trigger(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            tables, triggers = self._tables_and_triggers(con)
        finally:
            con.close()

        on_exempt = sorted(name for name, tbl in triggers.items() if tbl in self.EXEMPT)
        self.assertEqual(on_exempt, [], "the ticket tables and db_meta must stay trigger-free")
        # No stray trigger on a table that no longer exists, and none beyond the set above.
        self.assertEqual(
            len(triggers), 3 * len(tables - self.EXEMPT), "unexpected extra or orphaned triggers"
        )

    def test_substance_write_moves_revision_and_a_ticket_write_does_not(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        try:
            con.execute("PRAGMA foreign_keys = ON")
            con.executescript(
                """
                INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
                INSERT INTO filings (id, proceeding_id, kind, title)
                    VALUES (1, 1, 'notice_of_application', 'A');
                INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
                """
            )
            con.commit()
            after_substance = self._revision(con)
            self.assertGreater(after_substance, 0, "a substance INSERT must move the revision")

            con.execute(
                "INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created) "
                "VALUES (1, 1, 1, 'T', 'i', 'work', 'anchor', '2026-09-14')"
            )
            con.execute("UPDATE tickets SET priority = 5 WHERE id = 1")
            con.execute("INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'step')")
            con.commit()
            self.assertEqual(self._revision(con), after_substance, "ticket writes must leave the revision alone")

            con.execute("UPDATE parties SET name = 'Y' WHERE id = 1")
            con.commit()
            self.assertEqual(self._revision(con), after_substance + 1, "a substance UPDATE must move it")

            con.execute("DELETE FROM parties WHERE id = 1")
            con.commit()
            self.assertEqual(self._revision(con), after_substance + 2, "a substance DELETE must move it")
        finally:
            con.close()

    def test_v20_database_hops_to_v21_with_rows_intact(self):
        engine.migrate(str(self.db_path), target_version=20)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
            """
        )
        con.commit()
        con.close()

        self.assertEqual(engine.migrate(str(self.db_path), target_version=21), [(20, 21)])
        self.assertEqual(schema_version(self.db_path), 21)

        con = sqlite3.connect(str(self.db_path))
        try:
            self.assertEqual(con.execute("SELECT count(*) FROM parties").fetchone()[0], 1)
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(self._revision(con), 0, "installing the triggers must not itself move the revision")
        finally:
            con.close()

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])


class TestV22BccaFactum(unittest.TestCase):
    """Schema hop 21->22 (#648): 'bcca_factum' joins filings.kind (a filings
    rebuild that must carry its revision triggers), plus filing_chronology and
    filing_prose for the factum parts no existing table holds."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_fresh_migrate_accepts_a_factum_and_its_parts(self):
        # Pinned to v32, the last version whose filing_prose.slot is closed: v33 opens it.
        engine.migrate(str(self.db_path), target_version=32)
        self.assertEqual(schema_version(self.db_path), 32)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            con.executescript(
                """
                INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA');
                INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'bcca_factum', 'F');
                INSERT INTO filing_chronology (filing_id, event_date, event, ordinal)
                    VALUES (1, '2026-07-28', 'Notice of appeal filed', 1);
                INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'opening_statement', 'o');
                INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'facts_position', 'p');
                INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'signing_place', 'Vancouver');
                """
            )
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'signing_place', 'x')")
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'nope', 'x')")
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO filing_chronology (filing_id, event_date, event, ordinal) VALUES (999, '2026-01-01', 'e', 1)")
        finally:
            con.close()

    def test_v21_database_hops_to_v22_with_children_and_triggers_intact(self):
        engine.migrate(str(self.db_path), target_version=21)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcca');
            INSERT INTO filings (id, proceeding_id, kind, title, decided_on, entered_on)
                VALUES (1, 1, 'bcca_stay_response', 'A', '2026-09-04', '2026-09-09');
            INSERT INTO hearing_details (id, filing_id) VALUES (1, 1);
            INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'p');
            INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal)
                VALUES (1, 1, 1, 'form', 'part2', 1);
            """
        )
        con.commit()
        before = {
            "filings": con.execute("SELECT * FROM filings ORDER BY id").fetchall(),
            "hearing_details": con.execute("SELECT * FROM hearing_details ORDER BY id").fetchall(),
            "filing_facts": con.execute("SELECT * FROM filing_facts ORDER BY id").fetchall(),
        }
        con.close()

        applied = engine.migrate(str(self.db_path), target_version=22)
        self.assertEqual(applied, [(21, 22)])
        self.assertEqual(schema_version(self.db_path), 22)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            for table, rows in before.items():
                after = con.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                self.assertEqual(after, rows, f"{table} rows changed across the hop")
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

            triggers = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
            for table in ("filings", "filing_chronology", "filing_prose"):
                for suffix in ("ins", "upd", "del"):
                    self.assertIn(f"rev_{table}_{suffix}", triggers)

            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute("INSERT INTO filings (id, proceeding_id, kind, title) VALUES (2, 1, 'bcca_factum', 'F')")
            self.assertEqual(
                int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), rev + 1
            )
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (9, 999)")
        finally:
            con.close()

    def test_v22_database_hops_to_v23_with_forum_nullable_and_children_intact(self):
        engine.migrate(str(self.db_path), target_version=22)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum, registry, access_restrictions)
                VALUES (1, 'L0000', 'bcsc', 'Vancouver', 'ban');
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');
            INSERT INTO tickets (id, proceeding_id, kind, title, intent, priority, status, created)
                VALUES (1, 1, 'charting', 'T', 'i', 1, 'queued', '2026-09-19T10:00');
            """
        )
        con.commit()
        before = {
            "proceedings": con.execute("SELECT * FROM proceedings ORDER BY id").fetchall(),
            "filings": con.execute("SELECT * FROM filings ORDER BY id").fetchall(),
            "tickets": con.execute("SELECT * FROM tickets ORDER BY id").fetchall(),
        }
        con.close()

        applied = engine.migrate(str(self.db_path), target_version=23)
        self.assertEqual(applied, [(22, 23)])
        self.assertEqual(schema_version(self.db_path), 23)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            for table, rows in before.items():
                after = con.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                self.assertEqual(after, rows, f"{table} rows changed across the hop")
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            triggers = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
            for suffix in ("ins", "upd", "del"):
                self.assertIn(f"rev_proceedings_{suffix}", triggers)
        finally:
            con.close()


class TestV25ProposalsAndVerification(unittest.TestCase):
    """Schema hop 24->25 (work-board-proposals design sections 3, 9 and 10, plus
    the goal-card plan's fold): verification moves from authorities onto
    statements_of_law as a NOT NULL column with no third state; statements_of_fact
    gains exhibit_excerpt/exhibit_pinpoint; tickets gains rejected_at and
    superseded_marker_gone_at; ticket_proposals and proposal_rejections join the
    exempt ticket tables, trigger-free."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    V24_SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, verification)
            VALUES (1, 1, 'Lead Authority v. X', '2021 BCSC 1', 'case', 'lead'),
                   (2, 1, 'Unmarked Authority v. Y', '2022 BCSC 2', 'case', NULL),
                   (3, 1, 'Verified Authority v. Z', '2023 BCCA 3', 'case', 'verified');
        INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES
            (1, 1, 'p1'), (2, 1, 'p2'), (3, 1, 'p3');
        INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt)
            VALUES (1, 1, 1, 1, 'para 1', 'e1', 'primary', NULL),
                   (2, 1, 2, 1, 'para 2', 'e2', NULL, 'd2'),
                   (3, 1, 3, 2, 'para 3', 'e3', 'secondary', NULL),
                   (4, 1, NULL, 2, 'para 4', 'e4', NULL, NULL),
                   (5, 1, 1, 3, 'para 5', 'e5', 'primary', NULL);
        INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'an order');
        INSERT INTO order_sought_requires (id, order_sought_id, excerpt_id, basis_state)
            VALUES (1, 1, 4, 'filled');
        INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'W');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'f1');
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'Ex. A');
        INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, exhibit_id, pinpoint)
            VALUES (1, 1, 1, 1, 1, 's. 2.3');
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
            VALUES (1, 1, 1, 'T', 'i', 'work', 'L0000', '2026-09-21');
    """

    def _seeded_v24(self):
        engine.migrate(str(self.db_path), target_version=24)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.V24_SEED)
        con.commit()
        con.close()

    def test_v24_database_hops_to_v25_moving_verification_onto_statements(self):
        self._seeded_v24()
        # run(), not migrate(): the pre-migration backup is what keeps the
        # defaulted-from-NULL list recoverable after authorities.verification is gone.
        result = engine.run({"db_path": str(self.db_path)})
        # run() carries the database to the current target, so later hops follow this one.
        self.assertEqual(result["applied"][0], {"from": 24, "to": 25})
        self.assertEqual(result["schema_version"], engine.TARGET_SCHEMA_VERSION)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            # Every statement of the 'lead' authority and of the NULL authority reads 'lead';
            # only the verified authority's statement reads 'verified'. No third state exists.
            self.assertEqual(
                con.execute("SELECT id, verification FROM statements_of_law ORDER BY id").fetchall(),
                [(1, "lead"), (2, "lead"), (3, "lead"), (4, "lead"), (5, "verified")],
            )
            self.assertEqual(
                con.execute(
                    "SELECT count(*) FROM statements_of_law WHERE verification IS NULL"
                ).fetchone()[0],
                0,
            )
            # The authority column is gone.
            self.assertNotIn(
                "verification",
                {row[1] for row in con.execute("PRAGMA table_info(authorities)")},
            )
            # The statement column is NOT NULL, CHECK-guarded, and carries no default,
            # so an insert that omits it fails loudly rather than drifting in as a lead.
            sol = {row[1]: row for row in con.execute("PRAGMA table_info(statements_of_law)")}
            self.assertEqual(sol["verification"][3], 1, "statements_of_law.verification must be NOT NULL")
            self.assertIsNone(sol["verification"][4], "statements_of_law.verification must carry no default")
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) "
                    "VALUES (9, 1, 1, 'unsure')"
                )
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO statements_of_law (id, proceeding_id, authority_id) VALUES (9, 1, 1)"
                )

            # Every other column, and every row, survived the rebuild.
            self.assertEqual(
                con.execute(
                    "SELECT id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt "
                    "FROM statements_of_law ORDER BY id"
                ).fetchall(),
                [
                    (1, 1, 1, 1, "para 1", "e1", "primary", None),
                    (2, 1, 2, 1, "para 2", "e2", None, "d2"),
                    (3, 1, 3, 2, "para 3", "e3", "secondary", None),
                    (4, 1, None, 2, "para 4", "e4", None, None),
                    (5, 1, 1, 3, "para 5", "e5", "primary", None),
                ],
            )
            for table in ("authorities", "law_assertions", "statements_of_fact", "order_sought_requires", "tickets"):
                self.assertGreater(con.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

            # The rebuild recreated the three revision triggers and the three indexes.
            triggers = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
            for suffix in ("ins", "upd", "del"):
                self.assertIn(f"rev_statements_of_law_{suffix}", triggers)
            indexes = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
            for name in ("proceeding", "assertion", "authority"):
                self.assertIn(f"idx_statements_of_law_{name}", indexes)
            # The child FK re-bound to the rebuilt table by name.
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO order_sought_requires (id, order_sought_id, excerpt_id, basis_state) "
                    "VALUES (9, 1, 999, 'filled')"
                )
        finally:
            con.close()

    def test_an_insert_into_the_rebuilt_statements_of_law_moves_the_revision(self):
        self._seeded_v24()
        engine.run({"db_path": str(self.db_path)})

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute(
                "INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, verification) "
                "VALUES (6, 1, 1, 1, 'lead')"
            )
            self.assertEqual(
                int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]),
                rev + 1,
                "the rebuilt table's recreated triggers must still move the revision",
            )
        finally:
            con.close()

    def test_the_defaulted_from_null_list_is_recoverable_from_the_backup(self):
        self._seeded_v24()
        engine.run({"db_path": str(self.db_path)})

        backups = backups_of(self.db_path)
        self.assertEqual(len(backups), 1)
        self.assertEqual(schema_version(backups[0]), 24)

        con = sqlite3.connect(str(backups[0]))
        try:
            defaulted = [
                row[0]
                for row in con.execute(
                    "SELECT sl.id FROM statements_of_law sl "
                    "JOIN authorities a ON a.id = sl.authority_id "
                    "WHERE a.verification IS NULL ORDER BY sl.id"
                )
            ]
        finally:
            con.close()
        # Statements 3 and 4 sit on the authority that was never marked: they are
        # the ones the practitioner must sort, and they read 'lead' now.
        self.assertEqual(defaulted, [3, 4])

    def test_fact_statement_and_ticket_columns_arrive_empty(self):
        self._seeded_v24()
        engine.run({"db_path": str(self.db_path)})

        con = sqlite3.connect(str(self.db_path))
        try:
            self.assertEqual(
                con.execute(
                    "SELECT exhibit_id, pinpoint, exhibit_excerpt, exhibit_pinpoint FROM statements_of_fact WHERE id = 1"
                ).fetchone(),
                (1, "s. 2.3", None, None),
                "the hop moves no value: pinpoint stays the instrument's locator",
            )
            tickets = {row[1] for row in con.execute("PRAGMA table_info(tickets)")}
            self.assertIn("rejected_at", tickets)
            self.assertIn("superseded_marker_gone_at", tickets)
            self.assertEqual(
                con.execute(
                    "SELECT count(*) FROM tickets WHERE rejected_at IS NOT NULL "
                    "OR superseded_marker_gone_at IS NOT NULL"
                ).fetchone()[0],
                0,
                "both new ticket columns must be NULL on every existing row",
            )
        finally:
            con.close()

    def test_the_two_new_ticket_tables_are_trigger_free_and_item_is_not_null(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            names = {
                row[0]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name IN ('ticket_proposals', 'proposal_rejections')"
                )
            }
            self.assertEqual(names, {"ticket_proposals", "proposal_rejections"})

            item = {row[1]: row for row in con.execute("PRAGMA table_info(ticket_proposals)")}["item"]
            self.assertEqual(item[3], 1, "ticket_proposals.item must be NOT NULL")

            on_new = sorted(
                row[0]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' "
                    "AND tbl_name IN ('ticket_proposals', 'proposal_rejections')"
                )
            )
            self.assertEqual(on_new, [], "neither new ticket table may carry a trigger")

            con.executescript(
                """
                INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
                INSERT INTO tickets (id, proceeding_id, title, intent, kind, billing_anchor, created)
                    VALUES (1, 1, 'T', 'i', 'work', 'L0000', '2026-09-21');
                """
            )
            con.commit()
            before = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute(
                "INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (1, 'note-up:authorities:3', 'Smith v. Jones, 2023 BCCA 1')"
            )
            con.execute(
                "INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at) "
                "VALUES ('scrutinize:statements_of_law:7', NULL, '🔬', 'Smith v. Jones, 2023 BCCA 1', '2026-09-21T10:00')"
            )
            con.execute("UPDATE tickets SET rejected_at = '2026-09-21T10:00' WHERE id = 1")
            con.execute("UPDATE tickets SET superseded_marker_gone_at = '2026-09-21T10:00' WHERE id = 1")
            con.commit()
            self.assertEqual(
                int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]),
                before,
                "a write confined to the ticket tables must never bump the revision",
            )

            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO ticket_proposals (ticket_id, proposal_key) VALUES (1, 'k')")
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (999, 'k', 'i')"
                )
        finally:
            con.close()


class TestPreFilingProceeding(unittest.TestCase):
    """ADR 0018: a proceeding may exist before its forum is chosen. Which Writings it may
    hold is the v30 needs-forum fact, asserted by TestV30WritingModel."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"
        engine.run({"db_path": str(self.db_path)})
        self.con = sqlite3.connect(str(self.db_path))
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.execute("INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000')")

    def test_forum_defaults_to_null(self):
        self.assertIsNone(self.con.execute("SELECT forum FROM proceedings WHERE id = 1").fetchone()[0])

    def test_pre_filing_proceeding_holds_tickets_and_seeds(self):
        self.con.execute(
            "INSERT INTO tickets (id, proceeding_id, kind, title, intent, priority, status, created) "
            "VALUES (1, 1, 'charting', 'Choose the forum', 'i', 1, 'queued', '2026-09-19T10:00')"
        )
        self.con.execute(
            "INSERT INTO seeds (proceeding_id, created, surfaced_by, idea) VALUES (1, '2026-09-19T10:00', 'practitioner', 'x')"
        )


class TestV26KilledRename(unittest.TestCase):
    """v26: the v16 'dropped' axis is renamed 'killed' (#796, point 1). Only the
    column name moves -- submissions.dropped_on / authorities.dropped_on become
    killed_on -- and every stored date, every other column and every trigger
    survives the hop unchanged."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_v25_database_hops_to_v26_renaming_dropped_on_to_killed_on(self):
        engine.migrate(str(self.db_path), target_version=25)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO submissions (id, proceeding_id, contention, ordinal, dropped_on)
                VALUES (1, 1, 'live', 1, NULL), (2, 1, 'rejected', 2, '2026-09-06');
            INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, dropped_on)
                VALUES (1, 1, 'Live v. A', '2020 BCSC 1', 'case', NULL),
                       (2, 1, 'Rejected v. B', '2020 BCSC 2', 'case', '2026-09-06');
            """
        )
        con.commit()
        con.close()

        self.assertEqual(engine.migrate(str(self.db_path), target_version=26), [(25, 26)])
        self.assertEqual(schema_version(self.db_path), 26)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            for table in ("submissions", "authorities"):
                cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
                self.assertIn("killed_on", cols, table)
                self.assertNotIn("dropped_on", cols, table)
            self.assertEqual(
                con.execute("SELECT id, killed_on FROM submissions ORDER BY id").fetchall(),
                [(1, None), (2, "2026-09-06")],
            )
            self.assertEqual(
                con.execute("SELECT id, killed_on FROM authorities ORDER BY id").fetchall(),
                [(1, None), (2, "2026-09-06")],
            )
            # Restoring is still "clear the date", and the write still moves the revision.
            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute("UPDATE authorities SET killed_on = NULL WHERE id = 2")
            self.assertGreater(
                int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), rev
            )
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        finally:
            con.close()


class TestV27ReviewTables(unittest.TestCase):
    """v27: review_approvals and review_points (practitioner-review design
    sections 5 and 7). Both are revision-exempt -- approving or discussing
    changes no substance -- so neither carries a trigger and a write to either
    leaves db_meta.revision where it was."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v26(self):
        engine.migrate(str(self.db_path), target_version=26)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');
            INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
            INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
                VALUES (1, 1, 1, 'Counsel''s review of A', 'i', 'work', 'L0000', '2026-09-22');
            INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea)
                VALUES (1, 1, '2026-09-22T10:00', 'Counsel''s review of A', 'reword para 3');
            """
        )
        con.commit()
        con.close()
        # Pinned to the one hop this class is about, as the other hop tests are.
        self.assertEqual(engine.migrate(str(self.db_path), target_version=27), [(26, 27)])
        self.assertEqual(schema_version(self.db_path), 27)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        self.addCleanup(con.close)
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_v26_database_hops_to_v27_with_both_tables(self):
        con = self._hop_from_v26()
        self.assertEqual(schema_version(self.db_path), 27)
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(review_approvals)")],
            ["id", "entity", "entity_id", "approved_at", "session_token", "practitioner", "revision", "snapshot"],
        )
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(review_points)")],
            ["id", "filing_id", "ticket_id", "entity", "entity_id", "created", "comment",
             "resolution", "resolved_at", "seed_id"],
        )
        for table in ("parties", "filings", "tickets", "seeds"):
            self.assertEqual(con.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 1, table)
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_neither_table_carries_a_trigger(self):
        con = self._hop_from_v26()
        self.assertEqual(
            con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' "
                "AND tbl_name IN ('review_approvals', 'review_points')"
            ).fetchall(),
            [],
        )

    def test_resolution_is_a_closed_set_or_null(self):
        con = self._hop_from_v26()
        insert = (
            "INSERT INTO review_points (filing_id, ticket_id, entity, entity_id, created, comment, resolution) "
            "VALUES (1, 1, 'submissions', 1, '2026-09-22T10:00', 'c', ?)"
        )
        for value in (None, "answered", "change_wanted", "leave_it"):
            con.execute(insert, (value,))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(insert, ("rejected",))

    def test_writes_to_either_table_leave_the_revision_alone(self):
        con = self._hop_from_v26()
        before = self._revision(con)
        con.execute(
            "INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot) "
            "VALUES ('parties', 1, '2026-09-22T10:00', 'tok', 'Brahm', ?, '{\"name\": \"X\"}')",
            (before,),
        )
        con.execute(
            "INSERT INTO review_points (filing_id, ticket_id, entity, entity_id, created, comment) "
            "VALUES (1, 1, 'parties', 1, '2026-09-22T10:00', 'why X?')"
        )
        con.execute(
            "UPDATE review_points SET resolution = 'change_wanted', resolved_at = '2026-09-22T10:05', seed_id = 1"
        )
        con.commit()
        self.assertEqual(self._revision(con), before)


class TestV28ForumTreeKey(unittest.TestCase):
    """v28: proceedings.forum becomes the knowledge-tree key (spec section 5
    "Migrations"). Each stored value is resolved through /draft's jurisdiction
    index -- a venue row's code ignoring case, or one of its aliases -- so the
    rewrite is one-to-one, and a value naming no venue or more than one is
    refused naming the row. The CHECK closing forum to three values is gone."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _index(self, venues):
        path = Path(self._tmp.name) / "venues.json"
        path.write_text(json.dumps({"jurisdiction": "BC", "name": "British Columbia", "venues": venues, "not_venues": []}), encoding="utf-8")
        return path

    def _v27(self, seed):
        engine.migrate(str(self.db_path), target_version=27)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(seed)
        con.commit()
        con.close()

    def _rows(self, sql):
        con = sqlite3.connect(str(self.db_path))
        try:
            return con.execute(sql).fetchall()
        finally:
            con.close()

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum, registry, file_number)
            VALUES (1, 'L0000', 'bcsc', 'Vancouver', 'S-1'), (2, 'L0000', 'vaniac', NULL, NULL),
                   (3, 'L0000', 'bcca', 'Vancouver', 'CA1'), (4, 'L0000', NULL, NULL, NULL);
        INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES
            (1, 1, 'notice_of_application', NULL, 'A'), (2, 2, 'submissions_package', NULL, 'B'),
            (3, 3, 'bcca_factum', NULL, 'C');
        INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1), (2, 3, 'Y', 'Appellant', 1);
        INSERT INTO tickets (id, proceeding_id, kind, title, intent, priority, status, created)
            VALUES (1, 4, 'charting', 'Choose the forum', 'i', 1, 'queued', '2026-09-25T10:00');
    """

    def test_the_shipped_index_rewrites_each_forum_one_to_one(self):
        self._v27(self.SEED)
        before = {table: self._rows(f"SELECT * FROM {table} ORDER BY id") for table in ("filings", "parties", "tickets")}
        other_columns = self._rows("SELECT id, matter_reference, registry, file_number FROM proceedings ORDER BY id")

        self.assertEqual(engine.migrate(str(self.db_path), target_version=28), [(27, 28)])
        self.assertEqual(schema_version(self.db_path), 28)
        self.assertEqual(
            self._rows("SELECT id, forum FROM proceedings ORDER BY id"),
            [
                (1, "CAN/BC/BCSC"),
                (2, "CAN/BC/Vancouver-International-Arbitration-Centre"),
                (3, "CAN/BC/BCCA"),
                (4, None),
            ],
        )
        self.assertEqual(self._rows("SELECT id, matter_reference, registry, file_number FROM proceedings ORDER BY id"), other_columns)
        for table, rows in before.items():
            self.assertEqual(self._rows(f"SELECT * FROM {table} ORDER BY id"), rows, table)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertIsNone(con.execute("SELECT name FROM sqlite_temp_master WHERE name = 'forum_tree_keys'").fetchone())
            # The ADR 0018 guards were recreated and still hold.
            with self.assertRaisesRegex(sqlite3.IntegrityError, "forum"):
                con.execute("INSERT INTO filings (proceeding_id, kind, title) VALUES (4, 'notice_of_application', 'D')")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "forum"):
                con.execute("UPDATE filings SET proceeding_id = 4 WHERE id = 1")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "forum"):
                con.execute("UPDATE proceedings SET forum = NULL WHERE id = 1")
            # The forum is open text now, and a proceedings write still moves the revision.
            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute("UPDATE proceedings SET forum = 'CAN/BC/BCPC' WHERE id = 4")
            self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), rev + 1)
            # The child foreign keys re-bound to the rebuilt table by name.
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO parties (proceeding_id, name, role, ordinal) VALUES (999, 'Z', 'Plaintiff', 1)")
        finally:
            con.close()

    def test_the_key_comes_from_the_index_not_from_the_stored_value(self):
        self._v27("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc'), (2, 'L0000', 'vaniac');")
        index = self._index([
            {"code": "Supreme-Court", "name": "S", "aliases": [{"name": "BCSC"}]},
            {"code": "VANIAC", "name": "V", "aliases": []},
        ])
        engine.migrate(str(self.db_path), target_version=28, venues_index_path=index)
        self.assertEqual(
            self._rows("SELECT id, forum FROM proceedings ORDER BY id"),
            [(1, "CAN/BC/Supreme-Court"), (2, "CAN/BC/VANIAC")],
        )

    def test_a_forum_naming_no_venue_is_refused_naming_the_row(self):
        self._v27("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc'), (2, 'L0000', 'bcca');")
        index = self._index([{"code": "BCSC", "name": "S", "aliases": []}])
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=28, venues_index_path=index)
        self.assertEqual(caught.exception.code, "forum_unresolved")
        self.assertIn("proceedings row 2", caught.exception.message)
        self.assertIn("'bcca'", caught.exception.message)
        self.assertEqual(caught.exception.details["id"], 2)
        self.assertEqual(schema_version(self.db_path), 27)
        self.assertEqual(self._rows("SELECT id, forum FROM proceedings ORDER BY id"), [(1, "bcsc"), (2, "bcca")])

    def test_a_forum_naming_two_venues_is_refused_naming_the_row(self):
        self._v27("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'vaniac');")
        index = self._index([
            {"code": "Vancouver-International-Arbitration-Centre", "name": "V", "aliases": [{"name": "vaniac"}]},
            {"code": "Another-Centre", "name": "A", "aliases": [{"name": "VanIAC"}]},
        ])
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=28, venues_index_path=index)
        self.assertEqual(caught.exception.code, "forum_unresolved")
        self.assertIn("proceedings row 1", caught.exception.message)
        self.assertIn("2 venues", caught.exception.message)
        self.assertEqual(schema_version(self.db_path), 27)

    def test_a_missing_venues_index_is_refused_naming_the_path(self):
        self._v27("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'bcsc');")
        index = Path(self._tmp.name) / "no-such-venues.json"
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=28, venues_index_path=index)
        self.assertEqual(caught.exception.code, "venues_index_unreadable")
        self.assertEqual(caught.exception.details, {"path": str(index)})
        self.assertIn(str(index), caught.exception.message)
        self.assertEqual(schema_version(self.db_path), 27)


class TestV29KindSplit(unittest.TestCase):
    """v29: the kind migration (spec section 5 "Migrations"). Every stored kind
    stays but 'requisition', which splits by subkind into
    'requisition_default_judgment' and 'requisition_consent'; a requisition with
    no subkind is refused naming the row. The CHECK closing kind is gone."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, subkind, title, filed_on) VALUES
            (1, 1, 'requisition', 'default_judgment', 'A', NULL),
            (2, 1, 'requisition', 'consent', 'B', NULL),
            (3, 1, 'notice_of_application', NULL, 'C', NULL),
            (4, 1, 'application_response', NULL, 'D', NULL);
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'd');
        INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role) VALUES (1, 4, 1, 1, 'other');
        UPDATE filings SET filed_on = '2026-09-01' WHERE id = 4;
        INSERT INTO hearing_details (id, filing_id) VALUES (1, 3);
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
            VALUES (1, 1, 2, 't', 'i', 'work', 'L0000', '2026-09-25');
    """

    def _v28(self, seed):
        engine.migrate(str(self.db_path), target_version=28)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(seed)
        con.commit()
        con.close()

    def _rows(self, sql):
        con = sqlite3.connect(str(self.db_path))
        try:
            return con.execute(sql).fetchall()
        finally:
            con.close()

    def test_requisitions_split_by_subkind_and_every_other_kind_stays(self):
        self._v28(self.SEED)
        before = {table: self._rows(f"SELECT * FROM {table} ORDER BY id") for table in ("filing_documents", "hearing_details", "tickets")}
        other_columns = self._rows("SELECT id, proceeding_id, subkind, round, title, filed_on FROM filings ORDER BY id")

        self.assertEqual(engine.migrate(str(self.db_path), target_version=29), [(28, 29)])
        self.assertEqual(schema_version(self.db_path), 29)
        self.assertEqual(
            self._rows("SELECT id, kind FROM filings ORDER BY id"),
            [(1, "requisition_default_judgment"), (2, "requisition_consent"), (3, "notice_of_application"), (4, "application_response")],
        )
        self.assertEqual(self._rows("SELECT id, proceeding_id, subkind, round, title, filed_on FROM filings ORDER BY id"), other_columns)
        for table, rows in before.items():
            self.assertEqual(self._rows(f"SELECT * FROM {table} ORDER BY id"), rows, table)

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertIsNotNone(con.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_filings_proceeding'").fetchone())
            # Every trigger naming filings was recreated and still holds.
            with self.assertRaisesRegex(sqlite3.IntegrityError, "exhibits"):
                con.execute("DELETE FROM filing_documents WHERE id = 1")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "forum"):
                con.execute("UPDATE proceedings SET forum = NULL WHERE id = 1")
            con.execute("INSERT INTO proceedings (id, matter_reference) VALUES (2, 'L0000')")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "forum"):
                con.execute("INSERT INTO filings (proceeding_id, kind, title) VALUES (2, 'notice_of_application', 'E')")
            # The kind is open text now, and a filings write still moves the revision.
            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute("INSERT INTO filings (id, proceeding_id, kind, title) VALUES (5, 1, 'letter', 'F')")
            self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), rev + 1)
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (9, 999)")
        finally:
            con.close()

    def test_a_requisition_with_no_subkind_is_refused_naming_the_row(self):
        self._v28(
            "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');"
            "INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES"
            " (1, 1, 'requisition', 'consent', 'A'), (2, 1, 'requisition', NULL, 'B');"
        )
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=29)
        self.assertEqual(caught.exception.code, "requisition_without_subkind")
        self.assertIn("filings row 2", caught.exception.message)
        self.assertEqual(caught.exception.details, {"table": "filings", "id": 2})
        self.assertEqual(schema_version(self.db_path), 28)
        self.assertEqual(self._rows("SELECT id, kind, subkind FROM filings ORDER BY id"), [(1, "requisition", "consent"), (2, "requisition", None)])


class TestV30WritingModel(unittest.TestCase):
    """v30: the Writing model (spec section 5; ADR 0024 D6 and D8). filings stores the
    needs-forum fact, which replaces the three ADR 0018 guards; the layout snapshot,
    backfilled from /draft's shipped type file and venue.md with both blocks copied
    verbatim; the signer; and the sent copy. recipients and filing_recipients hold the
    service list, and the recipient defaults are the two idioms in filing-checklists.md
    section 13, run here as written."""

    DRAFT_TREE = Path(__file__).resolve().parents[2] / "draft" / "references"
    CHECKLISTS = Path(__file__).resolve().parents[1] / "references" / "filing-checklists.md"

    # Each stored kind's venue folder and type file, as the shipped kinds indexes map them.
    SHIPPED = {
        "notice_of_application": ("BCSC", "notice-of-application"),
        "application_response": ("BCSC", "application-response"),
        "requisition_default_judgment": ("BCSC", "requisition-default-judgment"),
        "requisition_consent": ("BCSC", "requisition-consent"),
        "submissions_package": ("Vancouver-International-Arbitration-Centre", "submissions-package"),
        "bcca_stay_response": ("BCCA", "stay-response-book"),
        "bcca_factum": ("BCCA", "respondent-factum"),
    }

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES
            (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0000', 'CAN/BC/Vancouver-International-Arbitration-Centre'),
            (3, 'L0000', 'CAN/BC/BCCA'), (4, 'L0000', NULL);
        INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES
            (1, 1, 'notice_of_application', NULL, NULL, 'A'), (2, 1, 'application_response', NULL, NULL, 'B'),
            (3, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'C'),
            (4, 1, 'requisition_consent', 'consent', NULL, 'D'), (5, 2, 'submissions_package', NULL, 'opening', 'E'),
            (6, 3, 'bcca_stay_response', NULL, NULL, 'F'), (7, 3, 'bcca_factum', NULL, NULL, 'G');
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 2, 'd');
        INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role) VALUES (1, 5, 1, 1, 'evidence');
        UPDATE filings SET filed_on = '2026-09-15' WHERE id = 5;
        INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
        INSERT INTO tickets (id, proceeding_id, kind, title, intent, priority, status, created)
            VALUES (1, 4, 'charting', 'Choose the forum', 'i', 1, 'queued', '2026-09-25T10:00');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _v29(self, seed, db_path=None):
        db_path = db_path or self.db_path
        engine.migrate(str(db_path), target_version=29)
        con = sqlite3.connect(str(db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(seed)
        con.commit()
        con.close()

    def _rows(self, sql, db_path=None):
        con = sqlite3.connect(str(db_path or self.db_path))
        try:
            return con.execute(sql).fetchall()
        finally:
            con.close()

    def _v30(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _block(path):
        text = Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")
        return re.search(r"^```json\n(.*?)\n```$", text, re.S | re.M).group(1)

    def _tree(self, type_block):
        """A one-venue /draft tree holding a 'letter' kind whose type block is given."""
        venue = Path(self._tmp.name) / "tree" / "CAN" / "BC" / "BCSC"
        (venue / "Documents").mkdir(parents=True)
        (venue / "venue.md").write_text('```json\n{ "display_label": "Test" }\n```\n\n# Test venue\n', encoding="utf-8")
        (venue / "Documents" / "kinds.json").write_text(
            json.dumps({"kinds": [{"file": "letter", "name": "Letter", "aliases": [{"name": "letter"}]}]}), encoding="utf-8"
        )
        (venue / "Documents" / "letter.md").write_text(f"---\nsources: []\n---\n\n```json\n{type_block}\n```\n\n# Letter\n", encoding="utf-8")
        return Path(self._tmp.name) / "tree"

    def test_v29_database_hops_to_v30_snapshotting_every_filing_verbatim(self):
        self._v29(self.SEED)
        before = {table: self._rows(f"SELECT * FROM {table} ORDER BY id") for table in ("proceedings", "documents", "filing_documents", "parties", "tickets")}
        old_columns = "id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on"
        filings_before = self._rows(f"SELECT {old_columns} FROM filings ORDER BY id")
        revision = self._rows("SELECT value FROM db_meta WHERE key = 'revision'")

        self.assertEqual(engine.migrate(str(self.db_path), target_version=30), [(29, 30)])
        self.assertEqual(schema_version(self.db_path), 30)
        self.assertEqual(self._rows(f"SELECT {old_columns} FROM filings ORDER BY id"), filings_before)
        for table, rows in before.items():
            self.assertEqual(self._rows(f"SELECT * FROM {table} ORDER BY id"), rows, table)
        self.assertEqual(self._rows("SELECT value FROM db_meta WHERE key = 'revision'"), revision, "the backfill must not move the revision")

        for filing_id, kind, needs_forum, snapshot in self._rows("SELECT id, kind, needs_forum_parts, layout_snapshot FROM filings ORDER BY id"):
            venue, stem = self.SHIPPED[kind]
            type_block = self._block(self.DRAFT_TREE / "CAN" / "BC" / venue / "Documents" / f"{stem}.md")
            venue_block = self._block(self.DRAFT_TREE / "CAN" / "BC" / venue / "venue.md")
            self.assertEqual(snapshot, f'{{"layout": {type_block}, "venue": {venue_block}, "passage_hashes": {{}}}}', kind)
            self.assertEqual(needs_forum, int(json.loads(type_block)["needs_forum_parts"]), kind)
        self.assertEqual(
            self._rows("SELECT DISTINCT signer_key, signer_party_id, signer_snapshot, sent_copy_id FROM filings"), [(None, None, None, None)]
        )

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            columns = {table: [row[1] for row in con.execute(f"PRAGMA table_info({table})")] for table in ("filings", "recipients", "filing_recipients")}
            self.assertEqual(
                columns["filings"][-6:], ["needs_forum_parts", "layout_snapshot", "signer_key", "signer_party_id", "signer_snapshot", "sent_copy_id"]
            )
            self.assertEqual(columns["recipients"], ["id", "proceeding_id", "name", "capacity", "email", "address", "party_id", "ordinal"])
            self.assertEqual(columns["filing_recipients"], ["id", "filing_id", "recipient_id", "role", "ordinal"])
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertIsNone(con.execute("SELECT name FROM sqlite_temp_master WHERE name = 'filing_layouts'").fetchone())
            # Every trigger naming filings was recreated and still holds.
            with self.assertRaisesRegex(sqlite3.IntegrityError, "exhibits"):
                con.execute("DELETE FROM filing_documents WHERE id = 1")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
                con.execute("UPDATE proceedings SET forum = NULL WHERE id = 1")
            rev = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
            con.execute("UPDATE filings SET layout_snapshot = layout_snapshot WHERE id = 1")
            self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), rev + 1)
        finally:
            con.close()

    def test_needs_forum_parts_and_the_snapshot_come_from_the_tree(self):
        type_block = '{\n  "renderer": "general",\n  "needs_forum_parts": false,\n  "title": "Letter"\n}'
        tree = self._tree(type_block)
        self._v29("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');"
                  "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'letter', 'A');")
        engine.migrate(str(self.db_path), draft_tree_path=tree)
        self.assertEqual(
            self._rows("SELECT needs_forum_parts, layout_snapshot FROM filings"),
            [(0, f'{{"layout": {type_block}, "venue": {{ "display_label": "Test" }}, "passage_hashes": {{}}}}')],
        )

    def test_a_kind_or_forum_with_no_shipped_file_is_refused_naming_the_row(self):
        for forum, kind in (("CAN/BC/BCSC", "letter"), ("CAN/BC/BCPC", "notice_of_application")):
            with self.subTest(forum=forum, kind=kind):
                db_path = Path(self._tmp.name) / f"{kind}.sqlite"
                self._v29(
                    f"INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0000', '{forum}');"
                    f"INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A'), (2, 2, '{kind}', 'B');",
                    db_path,
                )
                with self.assertRaises(engine.MigrateError) as caught:
                    engine.migrate(str(db_path))
                self.assertEqual(caught.exception.code, "layout_unresolved")
                self.assertIn("filings row 2", caught.exception.message)
                self.assertEqual(caught.exception.details["id"], 2)
                self.assertEqual(schema_version(db_path), 29)
                self.assertEqual(self._rows("SELECT id, kind FROM filings ORDER BY id", db_path), [(1, "notice_of_application"), (2, kind)])

    def test_a_block_citing_a_rule_ref_is_refused_naming_the_row(self):
        tree = self._tree('{ "renderer": "general", "needs_forum_parts": false, "title": { "value": "Letter", "rule_ref": "title-1" } }')
        self._v29("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');"
                  "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'letter', 'A');")
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), draft_tree_path=tree)
        self.assertEqual(caught.exception.code, "layout_unresolved")
        self.assertIn("filings row 1", caught.exception.message)
        self.assertIn("'title-1'", caught.exception.message)
        self.assertEqual(schema_version(self.db_path), 29)

    def test_a_type_file_with_two_json_blocks_is_refused_naming_the_file(self):
        type_block = '{ "renderer": "general", "needs_forum_parts": false, "title": "Letter" }'
        tree = self._tree(type_block)
        letter = tree / "CAN" / "BC" / "BCSC" / "Documents" / "letter.md"
        letter.write_text(f"---\nsources: []\n---\n\n```json\n{type_block}\n```\n\n# Letter\n\n```json\n{type_block}\n```\n", encoding="utf-8")
        self._v29("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');"
                  "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'letter', 'A');")
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), draft_tree_path=tree)
        self.assertEqual(caught.exception.code, "layout_unresolved")
        self.assertIn("filings row 1", caught.exception.message)
        self.assertIn("carries 2 fenced json blocks", caught.exception.message)
        self.assertIn(str(letter), caught.exception.message)
        self.assertEqual(caught.exception.details["path"], str(letter))
        self.assertEqual(schema_version(self.db_path), 29)

    def test_the_needs_forum_fact_replaces_the_forum_guards(self):
        con = self._v30()
        con.execute("INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000')")
        con.execute("INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L0000', 'CAN/BC/BCSC'), (3, 'L0000', 'CAN/BC/BCSC')")
        # A needs-forum Writing is refused on a forum-less proceeding, stated or by default.
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
            con.execute("INSERT INTO filings (proceeding_id, kind, title, needs_forum_parts) VALUES (1, 'notice_of_application', 'A', 1)")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
            con.execute("INSERT INTO filings (proceeding_id, kind, title) VALUES (1, 'notice_of_application', 'A')")
        # A Writing that needs no forum parts sits there, and moves on and off it.
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0)")
        con.execute("UPDATE filings SET proceeding_id = 2 WHERE id = 1")
        con.execute("UPDATE filings SET proceeding_id = 1 WHERE id = 1")
        # It cannot become needs-forum there, and a needs-forum Writing cannot move there.
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
            con.execute("UPDATE filings SET needs_forum_parts = 1 WHERE id = 1")
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title) VALUES (2, 2, 'notice_of_application', 'N')")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
            con.execute("UPDATE filings SET proceeding_id = 1 WHERE id = 2")
        # A forum is kept while a needs-forum Writing sits on it, and clears under the others.
        with self.assertRaisesRegex(sqlite3.IntegrityError, "cannot be cleared"):
            con.execute("UPDATE proceedings SET forum = NULL WHERE id = 2")
        con.execute("UPDATE filings SET proceeding_id = 3 WHERE id = 1")
        con.execute("UPDATE proceedings SET forum = NULL WHERE id = 3")
        self.assertEqual(con.execute("SELECT id, proceeding_id FROM filings ORDER BY id").fetchall(), [(1, 3), (2, 2)])

    def test_signer_sent_copy_and_service_list_constraints(self):
        con = self._v30()
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
            INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
            INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'sent copy');
            INSERT INTO filings (id, proceeding_id, kind, title, signer_key, sent_copy_id) VALUES (1, 1, 'letter', 'L', 'jdoe', 1);
            INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, signer_party_id) VALUES (2, 1, 'release', 'R', 0, 1);
            INSERT INTO recipients (id, proceeding_id, name, ordinal) VALUES (1, 1, 'Counsel', 1);
            INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (1, 1, 'cc', 1);
            """
        )
        for sql in (
            "UPDATE filings SET signer_party_id = 1 WHERE id = 1",  # a roster key and a party both
            "UPDATE filings SET signer_party_id = 99 WHERE id = 2",  # no such party
            "UPDATE filings SET sent_copy_id = 99 WHERE id = 1",  # no such document
            "INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (2, 1, 'fax', 1)",
            "INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (1, 1, 'to', 2)",  # twice on one Writing
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)

    def test_the_recipient_default_idioms_as_written(self):
        text = self.CHECKLISTS.read_text(encoding="utf-8").replace("\r\n", "\n")
        forum_idiom, party_idiom = re.findall(r"^```sql\n(.*?)\n```$", text[text.index("### Service list"):text.index("### Clauses")], re.S | re.M)
        con = self._v30()
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0000', 'CAN/BC/BCSC');
            INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client) VALUES
                (1, 1, 'Client', 'Plaintiff', 1, 1), (2, 1, 'R2', 'Defendant', 2, 0), (3, 1, 'R3', 'Defendant', 3, 0);
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (7, 1, 'letter', 'L');
            INSERT INTO recipients (id, proceeding_id, name, capacity, party_id, ordinal) VALUES
                (1, 1, 'Registrar', 'the registry', NULL, 2), (2, 1, NULL, 'counsel for R3', 3, 1),
                (3, 1, NULL, 'the client''s general counsel', 1, 4), (4, 1, NULL, 'counsel for R2', 2, 3),
                (5, 2, 'Elsewhere', 'another proceeding', NULL, 1);
            """
        )
        recipients = "SELECT recipient_id, role, ordinal FROM filing_recipients WHERE filing_id = 7 ORDER BY ordinal"

        # To the forum: the whole service list in its order, less the client-side person.
        con.execute(forum_idiom)
        self.assertEqual(con.execute(recipients).fetchall(), [(2, "to", 1), (1, "to", 2), (4, "to", 3)])

        # To a party: that party's counsel only, never the forum's row (so never a
        # without-prejudice offer's default) and never a client-side person.
        con.execute("DELETE FROM filing_recipients")
        con.execute(party_idiom)
        self.assertEqual(con.execute(recipients).fetchall(), [(2, "to", 1)])
        con.execute("DELETE FROM filing_recipients")
        con.execute(party_idiom.replace("r.party_id = 3", "r.party_id = 1"))
        self.assertEqual(con.execute(recipients).fetchall(), [])

        # v39 (#1234): a person a letter is addressed to who is not on the forum default
        # (a witness, an expert) is never copied by the forum idiom, and the party idiom's
        # result is unchanged.
        con.executescript(
            """
            DELETE FROM filing_recipients;
            INSERT INTO recipients (id, proceeding_id, name, capacity, party_id, ordinal, forum_default) VALUES
                (6, 1, 'Wanda Witness', 'a witness to the accident', NULL, 5, 0),
                (7, 1, 'Dr. Expert', 'the plaintiff''s retained engineer', NULL, 6, 0);
            """
        )
        con.execute(forum_idiom)
        self.assertEqual(con.execute(recipients).fetchall(), [(2, "to", 1), (1, "to", 2), (4, "to", 3)])
        con.execute("DELETE FROM filing_recipients")
        con.execute(party_idiom)
        self.assertEqual(con.execute(recipients).fetchall(), [(2, "to", 1)])


class TestV31Clauses(unittest.TestCase):
    """v31: clause rows with provenance (#1078 items 3 and 4). clauses is proceeding-scoped
    with basis 'express' (a documents row, pinpoint and excerpt) or 'implied' (an optional
    statements_of_law row); filing_clauses selects and orders them per Writing, as
    filing_orders does. Both are substance, so both move the revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'offer');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v30(self):
        engine.migrate(str(self.db_path), target_version=30)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=31), [(30, 31)])
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        self.addCleanup(con.close)
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_v30_database_hops_to_v31_with_both_tables(self):
        con = self._hop_from_v30()
        self.assertEqual(schema_version(self.db_path), 31)
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(clauses)")],
            ["id", "proceeding_id", "wording", "basis", "document_id", "pinpoint", "excerpt", "excerpt_id"],
        )
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(filing_clauses)")],
            ["id", "filing_id", "clause_id", "ordinal", "wording_override"],
        )
        for table in ("proceedings", "filings", "documents"):
            self.assertEqual(con.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 1, table)
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_each_basis_is_held_to_its_own_columns(self):
        con = self._hop_from_v30()
        con.executescript(
            """
            INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, kind) VALUES (1, 1, 'X v Y', 'case');
            INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (1, 1, 1, 'lead');
            """
        )
        insert = "INSERT INTO clauses (proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES (1, 'w', ?, ?, ?, ?, ?)"
        for row in (
            ("express", 1, None, None, None),  # pinpoint and excerpt not yet captured
            ("express", 1, "para 2", "the passage", None),
            ("implied", None, None, None, None),  # resting on no statement of law
            ("implied", None, None, None, 1),
        ):
            con.execute(insert, row)
        for row in (
            ("both", 1, None, None, None),  # basis outside the closed set
            (None, 1, None, None, None),  # basis required
            ("express", None, "para 2", None, None),  # express needs its document
            ("express", 1, None, None, 1),  # express cites no statement of law
            ("implied", 1, None, None, None),  # implied carries no document
            ("implied", None, "para 2", None, None),  # ... no pinpoint of its own
            ("implied", None, None, "the passage", 1),  # ... and no excerpt of its own
            ("express", 99, None, None, None),  # no such document
            ("implied", None, None, None, 99),  # no such statement of law
        ):
            with self.subTest(row=row), self.assertRaises(sqlite3.IntegrityError):
                con.execute(insert, row)

    def test_a_writing_orders_its_clauses_through_the_join(self):
        con = self._hop_from_v30()
        con.executescript(
            """
            INSERT INTO clauses (id, proceeding_id, wording, basis, document_id) VALUES
                (1, 1, 'first', 'express', 1), (2, 1, 'second', 'express', 1), (3, 1, 'third', 'implied', NULL);
            INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES
                (1, 3, 1, NULL), (1, 1, 2, 'first, reworded'), (1, 2, 3, NULL);
            """
        )
        self.assertEqual(
            con.execute(
                "SELECT COALESCE(fc.wording_override, c.wording) FROM filing_clauses fc "
                "JOIN clauses c ON c.id = fc.clause_id WHERE fc.filing_id = 1 ORDER BY fc.ordinal"
            ).fetchall(),
            [("third",), ("first, reworded",), ("second",)],
        )
        for sql in (
            "INSERT INTO filing_clauses (filing_id, clause_id, ordinal) VALUES (1, 1, 4)",  # a clause twice on one Writing
            "INSERT INTO filing_clauses (filing_id, clause_id, ordinal) VALUES (1, 99, 4)",  # no such clause
            "INSERT INTO filing_clauses (filing_id, clause_id, ordinal) VALUES (99, 1, 1)",  # no such Writing
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)

    def test_every_write_to_either_table_moves_the_revision(self):
        con = self._hop_from_v30()
        for sql in (
            "INSERT INTO clauses (id, proceeding_id, wording, basis, document_id) VALUES (1, 1, 'w', 'express', 1)",
            "UPDATE clauses SET pinpoint = 'para 2' WHERE id = 1",
            "INSERT INTO filing_clauses (id, filing_id, clause_id, ordinal) VALUES (1, 1, 1, 1)",
            "UPDATE filing_clauses SET wording_override = 'w2' WHERE id = 1",
            "DELETE FROM filing_clauses WHERE id = 1",
            "DELETE FROM clauses WHERE id = 1",
        ):
            before = self._revision(con)
            con.execute(sql)
            self.assertEqual(self._revision(con), before + 1, sql)


class TestV32DeliveredAndLayoutFreeze(unittest.TestCase):
    """v32: 'delivered' joins filings.retirement_reason's closed set (ADR 0024 D5 as
    reconciled on #1047); a sent or retired Writing's layout_snapshot and needs_forum_parts
    are frozen (spec section 5: re-snapshot only while drafting); and a Writing that needs
    no forum parts takes no hearing, decision or entry date. A filings rebuild."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0000', NULL);
        INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'X', 'Plaintiff', 1);
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'exhibit'), (2, 2, 'sent copy');
        INSERT INTO filings (id, proceeding_id, kind, title, decided_on, entered_on) VALUES
            (1, 1, 'notice_of_application', 'A', '2026-09-20', '2026-09-22');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, layout_snapshot, signer_key, sent_copy_id, filed_on, retired_on, retirement_reason)
            VALUES (2, 2, 'letter_to_opposing_counsel', 'L', 0, '{"layout": {}, "venue": null, "passage_hashes": {}}', 'jdoe', 2, '2026-09-24', '2026-09-24', 'other');
        INSERT INTO hearing_details (id, filing_id, hearing_date) VALUES (1, 1, '2026-09-18');
        INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 1, 'evidence');
        INSERT INTO recipients (id, proceeding_id, name, ordinal) VALUES (1, 2, 'Counsel', 1);
        INSERT INTO filing_recipients (id, filing_id, recipient_id, role, ordinal) VALUES (1, 2, 1, 'to', 1);
        INSERT INTO clauses (id, proceeding_id, wording, basis) VALUES (1, 2, 'w', 'implied');
        INSERT INTO filing_clauses (id, filing_id, clause_id, ordinal) VALUES (1, 2, 1, 1);
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
            VALUES (1, 2, 2, 't', 'i', 'work', 'L0000', '2026-09-25T10:00');
    """
    TABLES = ("proceedings", "parties", "documents", "filings", "hearing_details", "filing_documents",
              "recipients", "filing_recipients", "clauses", "filing_clauses", "tickets")
    SNAPSHOT = '{"layout": {}, "venue": null, "passage_hashes": {}}'

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _rows(self, sql):
        con = sqlite3.connect(str(self.db_path))
        try:
            return con.execute(sql).fetchall()
        finally:
            con.close()

    def _v32(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def test_fresh_migrate_accepts_delivered_and_refuses_a_ninth_value(self):
        con = self._v32()
        con.execute("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC')")
        con.execute(
            "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, filed_on, retired_on, retirement_reason) "
            "VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0, '2026-09-25', '2026-09-25', 'delivered')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO filings (id, proceeding_id, kind, title, retirement_reason) VALUES (2, 1, 'notice_of_application', 'B', 'bogus')")
        self.assertEqual(schema_version(self.db_path), engine.TARGET_SCHEMA_VERSION)
        self.assertIsNotNone(
            con.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_filings_proceeding'").fetchone()
        )

    def test_v31_database_hops_to_v32_with_children_intact(self):
        engine.migrate(str(self.db_path), target_version=31)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        con.close()
        before = {table: self._rows(f"SELECT * FROM {table} ORDER BY id") for table in self.TABLES}
        revision = self._rows("SELECT value FROM db_meta WHERE key = 'revision'")

        self.assertEqual(engine.migrate(str(self.db_path), target_version=32), [(31, 32)])
        self.assertEqual(schema_version(self.db_path), 32)
        for table, rows in before.items():
            self.assertEqual(self._rows(f"SELECT * FROM {table} ORDER BY id"), rows, f"{table} rows changed across the hop")
        self.assertEqual(self._rows("SELECT value FROM db_meta WHERE key = 'revision'"), revision, "the rebuild must not move the revision")

        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        try:
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (9, 999)")
        finally:
            con.close()

    def test_a_sent_or_retired_writings_layout_is_frozen(self):
        con = self._v32()
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
            INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'exhibit');
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');
            """
        )
        write = f"UPDATE filings SET layout_snapshot = '{self.SNAPSHOT}' WHERE id = 1"
        con.execute(write)  # drafting: a re-snapshot is allowed
        con.execute("UPDATE filings SET layout_snapshot = NULL WHERE id = 1")

        con.execute("UPDATE filings SET filed_on = '2026-09-25' WHERE id = 1")
        for sql in (write, "UPDATE filings SET needs_forum_parts = 0 WHERE id = 1"):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, "does not change"):
                con.execute(sql)
        con.execute("UPDATE filings SET layout_snapshot = layout_snapshot WHERE id = 1")  # an unchanged value passes

        con.execute("UPDATE filings SET filed_on = NULL, retired_on = '2026-09-25', retirement_reason = 'settled' WHERE id = 1")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "does not change"):
            con.execute(write)

    def test_sending_or_retiring_in_the_same_update_as_a_layout_change_is_refused(self):
        con = self._v32()
        con.executescript(
            f"""
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
            INSERT INTO filings (id, proceeding_id, kind, title, layout_snapshot) VALUES (1, 1, 'notice_of_application', 'A', '{self.SNAPSHOT}');
            """
        )
        other = '{"layout": {"x": 1}, "venue": null, "passage_hashes": {}}'
        for sql in (
            f"UPDATE filings SET filed_on = '2026-09-25', layout_snapshot = '{other}' WHERE id = 1",
            f"UPDATE filings SET retired_on = '2026-09-25', retirement_reason = 'delivered', layout_snapshot = '{other}' WHERE id = 1",
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, "does not change"):
                con.execute(sql)
        self.assertEqual(con.execute("SELECT filed_on, retired_on, layout_snapshot FROM filings WHERE id = 1").fetchone(),
                         (None, None, self.SNAPSHOT))
        con.execute("UPDATE filings SET filed_on = '2026-09-25' WHERE id = 1")  # sending alone still passes
        self.assertEqual(con.execute("SELECT filed_on FROM filings WHERE id = 1").fetchone(), ("2026-09-25",))

        # The exhibit freeze and the needs-forum guard, recreated by the rebuild, still hold.
        con.execute("UPDATE filings SET filed_on = '2026-09-25' WHERE id = 1")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "exhibits"):
            con.execute("INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'evidence')")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs forum parts"):
            con.execute("UPDATE proceedings SET forum = NULL WHERE id = 1")

    def test_a_no_forum_writing_takes_no_hearing_decision_or_entry_date(self):
        con = self._v32()
        con.execute("INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC')")
        insert = "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, {0}) VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0, '2026-09-25')"
        for column in ("decided_on", "entered_on"):
            with self.subTest(insert=column), self.assertRaisesRegex(sqlite3.IntegrityError, "takes no hearing"):
                con.execute(insert.format(column))
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0)")
        for sql in (
            "UPDATE filings SET decided_on = '2026-09-25' WHERE id = 1",
            "UPDATE filings SET entered_on = '2026-09-25' WHERE id = 1",
            "INSERT INTO hearing_details (filing_id, hearing_date) VALUES (1, '2026-09-25')",
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, "takes no hearing"):
                con.execute(sql)

        # A Writing that needs forum parts takes all three.
        con.execute(
            "INSERT INTO filings (id, proceeding_id, kind, title, decided_on, entered_on) "
            "VALUES (2, 1, 'letter', 'F', '2026-09-20', '2026-09-22')"
        )
        con.execute("INSERT INTO hearing_details (id, filing_id, hearing_date) VALUES (2, 2, '2026-09-18')")
        # A hearing row cannot move onto the no-forum Writing, and a needs-forum Writing holding one cannot switch to 0.
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title) VALUES (3, 1, 'notice_of_application', 'N')")
        con.execute("INSERT INTO hearing_details (id, filing_id) VALUES (3, 3)")
        for sql in (
            "UPDATE hearing_details SET filing_id = 1 WHERE id = 3",
            "UPDATE filings SET needs_forum_parts = 0 WHERE id = 3",
            "UPDATE filings SET needs_forum_parts = 0 WHERE id = 2",
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, "takes no hearing"):
                con.execute(sql)

        # Sending and retiring stay allowed on it, with 'delivered', and the section 11 recovery idiom reopens it.
        con.execute("UPDATE filings SET filed_on = '2026-09-25' WHERE id = 1")
        con.execute("UPDATE filings SET retired_on = '2026-09-25', retirement_reason = 'delivered' WHERE id = 1")
        self.assertEqual(con.execute("SELECT retirement_reason FROM filings WHERE id = 1").fetchone(), ("delivered",))
        con.execute("UPDATE filings SET retired_on = NULL, retirement_reason = NULL WHERE id = ?", (1,))
        self.assertEqual(con.execute("SELECT filed_on, retired_on, retirement_reason FROM filings WHERE id = 1").fetchone(), ("2026-09-25", None, None))


class TestLetterStockJobIdioms(unittest.TestCase):
    """jobs-stock.md section 3b's letter save idiom, run as written: a letter's save writes the
    fixed-text job 'Deliver' alone, blocked by nothing (ADR 0024 D10; no 'Draft the letter' since
    2026-10-23), and a save under the 'Availability letter' job writes 'Deliver' alone, blocked by that job."""

    JOBS = Path(__file__).resolve().parents[1] / "references" / "jobs-stock.md"
    GATE = Path(__file__).resolve().parents[1] / "references" / "jobs-gate.md"
    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8212', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (7, 1, 'notice_of_application', 'N');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (8, 1, 'letter_to_opposing_counsel', 'L', 0);
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created)
            VALUES (19, 1, 7, 'Availability letter', 'Obtain the court''s availability for the hearing of this application by letter.',
                    'work', 'L8212|x', '2026-09-25T10:00');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        text = self.JOBS.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.blocks =re.findall(r"^```sql\n(.*?)\n```$", text[text.index("### Letter save idiom"):text.index("## 3c.")], re.S | re.M)

    def _db(self, name):
        db_path = Path(self._tmp.name) / name
        engine.run({"db_path": str(db_path)})
        con = sqlite3.connect(str(db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        return con

    def test_a_letter_save_writes_deliver_alone_and_no_block(self):
        self.assertEqual(len(self.blocks), 2)
        con = self._db("plain.sqlite")
        con.executescript(self.blocks[0])
        self.assertEqual(
            con.execute("SELECT id, filing_id, title, intent, kind, priority FROM tickets WHERE id > 19 ORDER BY id").fetchall(),
            [(20, 8, "Deliver", "Send this letter to its recipients and record it as sent.", "work", 0)],
        )
        self.assertEqual(con.execute("SELECT count(*) FROM tickets WHERE title = 'Draft the letter'").fetchone(), (0,))
        self.assertEqual(
            con.execute("SELECT ticket_id, ordinal, text FROM ticket_steps ORDER BY ticket_id, ordinal").fetchall(),
            [(20, 1, "Send the letter to its recipients"), (20, 2, "Record the letter as sent")],
        )
        self.assertEqual(
            con.execute("SELECT ticket_id, entity, entity_id FROM ticket_scope ORDER BY id").fetchall(),
            [(20, "filings", 8), (20, "documents", None)],
        )
        self.assertEqual(con.execute("SELECT blocker_id, blocked_id FROM ticket_blocks").fetchall(), [])

    def test_a_save_under_the_availability_letter_job_writes_deliver_alone(self):
        con = self._db("availability.sqlite")
        con.executescript(self.blocks[1])
        self.assertEqual(
            con.execute("SELECT id, title FROM tickets WHERE filing_id = 8 ORDER BY id").fetchall(), [(20, "Deliver")]
        )
        self.assertEqual(con.execute("SELECT count(*) FROM tickets WHERE title = 'Draft the letter'").fetchone(), (0,))
        self.assertEqual(con.execute("SELECT count(*) FROM ticket_steps WHERE ticket_id = 20").fetchone(), (2,))
        self.assertEqual(con.execute("SELECT blocker_id, blocked_id FROM ticket_blocks").fetchall(), [(19, 20)])

    def test_the_gate_jobs_nothing_open_read_leaves_both_out(self):
        gate = self.GATE.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.assertIn("'Draft the letter', 'Deliver', 'Pre-send gate')", gate[gate.index("## 14."):])

    def test_the_gate_jobs_nothing_open_read_leaves_out_every_stock_job_of_amended_rule_8_1(self):
        gate = self.GATE.read_text(encoding="utf-8").replace("\r\n", "\n")
        read = re.findall(r"^```sql\n(.*?)\n```$", gate[gate.index("## 14."):], re.S | re.M)[0]
        con = self._db("gate.sqlite")
        con.execute("DELETE FROM tickets")
        stock = ["Serve the application", "Serve the response", "Set down for hearing", "Reply affidavits",
                 "File the served response", "Reset for hearing", "Application book", "File and serve",
                 "Serve the application on the new defendant", "Serve the response by email"]
        for i, title in enumerate(stock, 30):
            con.execute("INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created) "
                        "VALUES (?, 1, 7, ?, 'x', 'work', 'L8212|x', '2026-10-21T10:00')", (i, title))
        self.assertEqual(con.execute(read).fetchall(), [])
        con.execute("INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created) "
                    "VALUES (50, 1, 7, 'Draft Part 2', 'x', 'work', 'L8212|x', '2026-10-21T10:00')")
        self.assertEqual(con.execute(read).fetchall(), [(50, "Draft Part 2", "queued")])


class TestOwnJobReleaseAndShelve(unittest.TestCase):
    """jobs-run.md section 10's release and jobs-closeout.md section 10a's own-job shelving, run as
    written (ADR 0028): the holder lets go of its own job, and neither write touches a job another
    session took over."""

    RUN = Path(__file__).resolve().parents[1] / "references" / "jobs-run.md"
    CLOSEOUT = Path(__file__).resolve().parents[1] / "references" / "jobs-closeout.md"
    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8443', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (7, 1, 'notice_of_application', 'N');
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, created,
                             locked_by, locked_at, plan_approved_at)
            VALUES (42, 1, 7, 'File and serve', 'File and serve it.', 'wip', 'work', 'L8443|x', '2026-10-02T09:00',
                    'sess-a1', '2026-10-02T09:05', '2026-10-02T09:06');
        INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (42, 1, 'File it', '2026-10-02T09:30');
        INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (42, 2, 'Serve it', NULL);
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        sql = lambda text: re.findall(r"^```sql\n(.*?)\n```$", text, re.S | re.M)
        run = self.RUN.read_text(encoding="utf-8").replace("\r\n", "\n")
        closeout = self.CLOSEOUT.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.release, self.return_to_ready = sql(run[run.index("## 10. Unfinished"):])
        (self.shelve,) = sql(closeout[closeout.index("**The session's own `wip` job**"):closeout.index("**A shelved job also takes")])

    def _db(self, holder):
        db_path = Path(self._tmp.name) / f"{holder}.sqlite"
        engine.run({"db_path": str(db_path)})
        con = sqlite3.connect(str(db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED.replace("'sess-a1'", f"'{holder}'"))
        return con

    def _job(self, con):
        return con.execute("SELECT status, locked_by, locked_at, rejected_at, plan_approved_at FROM tickets WHERE id = 42").fetchone()

    def _steps(self, con):
        return con.execute("SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = 42 ORDER BY ordinal").fetchall()

    def test_a_release_returns_the_job_to_ready_keeping_its_plan_and_stamps(self):
        con = self._db("sess-a1")
        steps = self._steps(con)
        con.executescript(self.release)
        self.assertEqual(self._job(con), ("queued", None, None, None, "2026-10-02T09:06"))
        self.assertEqual(self._steps(con), steps)

    def test_a_release_leaves_a_job_taken_over_by_another_session_alone(self):
        con = self._db("sess-b2")
        before = self._job(con)
        con.executescript(self.release)
        self.assertEqual(self._job(con), before)

    def test_return_to_ready_releases_only_the_holder_on_the_card(self):
        """ADR 0037: the second block, guarded on the card's holder tag 'ss-other'."""
        con = self._db("sess-other")
        steps = self._steps(con)
        con.executescript(self.return_to_ready)
        self.assertEqual(self._job(con), ("queued", None, None, None, "2026-10-02T09:06"))
        self.assertEqual(self._steps(con), steps)
        con = self._db("sess-b2")
        before = self._job(con)
        con.executescript(self.return_to_ready)
        self.assertEqual(self._job(con), before)

    def test_an_own_job_shelving_clears_the_lock_and_snapshots_its_key(self):
        con = self._db("sess-a1")
        con.executescript(self.shelve)
        status, locked_by, locked_at, rejected_at, plan_approved_at = self._job(con)
        self.assertEqual((status, locked_by, locked_at, plan_approved_at), ("queued", None, None, "2026-10-02T09:06"))
        self.assertIsNotNone(rejected_at)
        self.assertEqual(con.execute("SELECT proposal_key, ticket_id FROM proposal_rejections").fetchall(),
                         [("authority-excerpt:statements_of_law:12", 42)])

    def test_an_own_job_shelving_writes_nothing_on_a_job_taken_over(self):
        con = self._db("sess-b2")
        before = self._job(con)
        con.executescript(self.shelve)
        self.assertEqual(self._job(con), before)
        self.assertEqual(con.execute("SELECT count(*) FROM proposal_rejections").fetchone(), (0,))



class TestV33OpenProseSlot(unittest.TestCase):
    """v33: filing_prose.slot is open text (plan Phase 14). A general Writing's slot:<name>,
    addressee and sender parts read filing_prose rows by slot name. The rebuild carries every
    row and UNIQUE (filing_id, slot), and recreates the three revision triggers."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'bcca_factum', 'F');
        INSERT INTO filing_prose (id, filing_id, slot, text) VALUES (1, 1, 'opening_statement', 'o');
        INSERT INTO filing_prose (id, filing_id, slot, text) VALUES (2, 1, 'signing_place', 'Vancouver');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v32(self):
        engine.migrate(str(self.db_path), target_version=32)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.before = con.execute("SELECT * FROM filing_prose ORDER BY id").fetchall()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=33), [(32, 33)])
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        self.addCleanup(con.close)
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_v32_database_hops_to_v33_with_its_rows_intact(self):
        con = self._hop_from_v32()
        self.assertEqual(schema_version(self.db_path), 33)
        self.assertEqual(con.execute("SELECT * FROM filing_prose ORDER BY id").fetchall(), self.before)
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(filing_prose)")],
            ["id", "filing_id", "slot", "text"],
        )
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_slot_outside_the_old_three_inserts(self):
        con = self._hop_from_v32()
        for slot in ("body", "addressee", "sender"):
            con.execute("INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, ?, 'x')", (slot,))
        self.assertEqual(
            [row[0] for row in con.execute("SELECT slot FROM filing_prose ORDER BY id")],
            ["opening_statement", "signing_place", "body", "addressee", "sender"],
        )
        for sql in (
            "INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, 'body', 'again')",  # one row per slot
            "INSERT INTO filing_prose (filing_id, slot, text) VALUES (99, 'body', 'x')",  # no such Writing
            "INSERT INTO filing_prose (filing_id, slot, text) VALUES (1, NULL, 'x')",  # slot required
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)

    def test_the_three_revision_triggers_still_fire(self):
        con = self._hop_from_v32()
        for sql in (
            "INSERT INTO filing_prose (id, filing_id, slot, text) VALUES (3, 1, 'body', 'x')",
            "UPDATE filing_prose SET text = 'y' WHERE id = 3",
            "DELETE FROM filing_prose WHERE id = 3",
        ):
            before = self._revision(con)
            con.execute(sql)
            self.assertEqual(self._revision(con), before + 1, sql)


class TestV34AuthorityCurrency(unittest.TestCase):
    """v34 (#1181): authorities gains currency_status, the statute-currency check's result as
    /legal-research relayed it (closed set, NULL = never checked), and currency_checked_on, the
    date it was relayed. Additive: every row keeps its values and reads NULL in both."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
            VALUES (1, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v33(self):
        engine.migrate(str(self.db_path), target_version=33)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.before = con.execute("SELECT * FROM authorities ORDER BY id").fetchall()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=34), [(33, 34)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_v33_database_hops_to_v34_with_both_columns_null(self):
        con = self._hop_from_v33()
        self.assertEqual(schema_version(self.db_path), 34)
        cols = [row[1] for row in con.execute("PRAGMA table_info(authorities)")]
        self.assertEqual(cols[-2:], ["currency_status", "currency_checked_on"])
        self.assertEqual(
            con.execute("SELECT * FROM authorities ORDER BY id").fetchall(),
            [row + (None, None) for row in self.before],
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_currency_status_takes_only_the_closed_set(self):
        con = self._hop_from_v33()
        for value in ("current", "repealed", "archived", "not-found", "validation_unavailable", None):
            con.execute("UPDATE authorities SET currency_status = ?, currency_checked_on = '2026-09-26' WHERE id = 1", (value,))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE authorities SET currency_status = 'in force' WHERE id = 1")


class TestV35AuthorityCurrencyClearTrigger(unittest.TestCase):
    """v35 (#1188): a trigger clears currency_status and currency_checked_on whenever the
    authority's citation or style_of_cause_or_title changes, since the stored result was for
    the enactment as then named. A write that changes neither leaves the result alone."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind,
                                 currency_status, currency_checked_on)
            VALUES (1, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute', 'current', '2026-09-26');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v34(self):
        engine.migrate(str(self.db_path), target_version=34)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.before = con.execute("SELECT * FROM authorities ORDER BY id").fetchall()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=35), [(34, 35)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def _currency(self, con):
        return con.execute("SELECT currency_status, currency_checked_on FROM authorities WHERE id = 1").fetchone()

    def test_v34_database_hops_to_v35_with_every_row_unchanged(self):
        con = self._hop_from_v34()
        self.assertEqual(schema_version(self.db_path), 35)
        self.assertEqual(con.execute("SELECT * FROM authorities ORDER BY id").fetchall(), self.before)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_fresh_v35_database_has_the_trigger(self):
        engine.migrate(str(self.db_path), target_version=35)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'clear_authorities_currency_on_rename'").fetchone(),
            ("authorities",),
        )

    def test_citation_change_clears_both_columns(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET citation = 'SBC 2012, c 13, s 6' WHERE id = 1")
        self.assertEqual(self._currency(con), (None, None))

    def test_title_change_clears_both_columns(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET style_of_cause_or_title = 'Limitation Act (BC)' WHERE id = 1")
        self.assertEqual(self._currency(con), (None, None))

    def test_rename_and_new_result_in_one_statement_still_ends_cleared(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET citation = 'RSBC 1996, c 266', currency_status = 'repealed', currency_checked_on = '2026-09-27' WHERE id = 1")
        self.assertEqual(self._currency(con), (None, None))

    def test_edit_to_neither_identity_column_leaves_the_result(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET weight = 'binding' WHERE id = 1")
        self.assertEqual(self._currency(con), ("current", "2026-09-26"))

    def test_same_citation_written_back_leaves_the_result(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET citation = 'SBC 2012, c 13' WHERE id = 1")
        self.assertEqual(self._currency(con), ("current", "2026-09-26"))

    def test_recording_a_result_with_no_identity_change_still_works(self):
        con = self._hop_from_v34()
        con.execute("UPDATE authorities SET currency_status = 'repealed', currency_checked_on = '2026-09-27' WHERE id = 1")
        self.assertEqual(self._currency(con), ("repealed", "2026-09-27"))


class TestV37SentWritingContentFreeze(unittest.TestCase):
    """v37 (#1215): once a Writing's filed_on or retired_on is set, its filing_law,
    filing_prose and filing_clauses rows are frozen, as its layout already is, so a later
    edit cannot change what its mockup shows as sent. An update is checked against both
    the old and the new owning Writing. A drafting Writing's rows stay freely writable."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
            VALUES (1, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute');
        INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES
            (1, 1, 1, 'lead'), (2, 1, 1, 'lead'), (3, 1, 1, 'lead');
        INSERT INTO clauses (id, proceeding_id, wording, basis) VALUES (1, 1, 'w1', 'implied'), (2, 1, 'w2', 'implied');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, filed_on, retired_on, retirement_reason) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0, NULL, NULL, NULL),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0, '2026-09-27', NULL, NULL),
            (3, 1, 'letter_to_opposing_counsel', 'retired', 0, NULL, '2026-09-27', 'other');
        INSERT INTO filing_law (id, filing_id, statement_id) VALUES (1, 1, 1), (2, 2, 1), (3, 3, 1);
        INSERT INTO filing_prose (id, filing_id, slot, text) VALUES (1, 1, 'body', 'b'), (2, 2, 'body', 'b'), (3, 3, 'body', 'b');
        INSERT INTO filing_clauses (id, filing_id, clause_id, ordinal) VALUES (1, 1, 1, 1), (2, 2, 1, 1), (3, 3, 1, 1);
    """
    TABLES = ("filing_law", "filing_prose", "filing_clauses")
    FREEZE = "sent or retired Writing"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v36(self):
        engine.migrate(str(self.db_path), target_version=36)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.before = {t: con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall() for t in self.TABLES}
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=37), [(36, 37)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _writes(filing_id, row_id):
        """One insert, update and delete per table, all against the given Writing's rows."""
        return {
            "filing_law": (
                f"INSERT INTO filing_law (filing_id, statement_id) VALUES ({filing_id}, 2)",
                f"UPDATE filing_law SET statement_id = 3 WHERE id = {row_id}",
                f"DELETE FROM filing_law WHERE id = {row_id}",
            ),
            "filing_prose": (
                f"INSERT INTO filing_prose (filing_id, slot, text) VALUES ({filing_id}, 'addressee', 'a')",
                f"UPDATE filing_prose SET text = 'changed' WHERE id = {row_id}",
                f"DELETE FROM filing_prose WHERE id = {row_id}",
            ),
            "filing_clauses": (
                f"INSERT INTO filing_clauses (filing_id, clause_id, ordinal) VALUES ({filing_id}, 2, 2)",
                f"UPDATE filing_clauses SET wording_override = 'changed' WHERE id = {row_id}",
                f"DELETE FROM filing_clauses WHERE id = {row_id}",
            ),
        }

    def test_v36_database_hops_to_v37_with_every_row_unchanged(self):
        con = self._hop_from_v36()
        self.assertEqual(schema_version(self.db_path), 37)
        for t in self.TABLES:
            self.assertEqual(con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall(), self.before[t], t)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_fresh_v37_database_has_the_nine_guards(self):
        engine.migrate(str(self.db_path), target_version=37)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(
            con.execute("SELECT tbl_name, name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'guard_%_frozen_%' ORDER BY name").fetchall(),
            [(t, f"guard_{t}_frozen_{op}") for t in sorted(self.TABLES) for op in ("del", "ins", "upd")],
        )

    def test_sent_writing_refuses_insert_update_and_delete(self):
        con = self._hop_from_v36()
        for sqls in self._writes(2, 2).values():
            for sql in sqls:
                with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FREEZE):
                    con.execute(sql)
        for t in self.TABLES:
            self.assertEqual(con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall(), self.before[t], t)

    def test_retired_only_writing_refuses_insert_update_and_delete(self):
        con = self._hop_from_v36()
        for sqls in self._writes(3, 3).values():
            for sql in sqls:
                with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FREEZE):
                    con.execute(sql)
        for t in self.TABLES:
            self.assertEqual(con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall(), self.before[t], t)

    def test_drafting_writing_accepts_insert_update_and_delete(self):
        con = self._hop_from_v36()
        for sqls in self._writes(1, 1).values():
            for sql in sqls:
                with self.subTest(sql=sql):
                    self.assertEqual(con.execute(sql).rowcount, 1)

    def test_a_row_cannot_leave_or_join_a_frozen_writing(self):
        con = self._hop_from_v36()
        for t in self.TABLES:
            for sql in (f"UPDATE {t} SET filing_id = 1 WHERE id = 2",  # off the sent Writing
                        f"UPDATE {t} SET filing_id = 3 WHERE id = 1"):  # onto the retired Writing
                with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FREEZE):
                    con.execute(sql)


class TestV38SentClauseWordingSnapshot(unittest.TestCase):
    """v38 (#1227): the statement that first sets a Writing's filed_on fills each NULL
    filing_clauses.wording_override with its clause's wording, so a later edit to the shared
    clause leaves the sent Writing's printed text unchanged while drafting Writings follow it.
    Retirement alone snapshots nothing. The hop gives every already-sent Writing the same
    snapshot."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO clauses (id, proceeding_id, wording, basis) VALUES (1, 1, 'w1', 'implied'), (2, 1, 'w2', 'implied');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0),
            (3, 1, 'letter_to_opposing_counsel', 'retired', 0),
            (4, 1, 'letter_to_opposing_counsel', 'drafting too', 0);
        INSERT INTO filing_clauses (id, filing_id, clause_id, ordinal, wording_override) VALUES
            (1, 1, 1, 1, NULL), (2, 2, 1, 1, NULL), (3, 2, 2, 2, 'own words'), (4, 3, 1, 1, NULL), (5, 4, 1, 1, NULL);
        UPDATE filings SET filed_on = '2026-09-27' WHERE id = 2;
        UPDATE filings SET retired_on = '2026-09-27', retirement_reason = 'other' WHERE id = 3;
    """
    PRINTED = "SELECT fc.id, COALESCE(fc.wording_override, c.wording) FROM filing_clauses fc JOIN clauses c ON c.id = fc.clause_id ORDER BY fc.id"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v37(self):
        engine.migrate(str(self.db_path), target_version=37)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.printed_before = con.execute(self.PRINTED).fetchall()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=38), [(37, 38)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _overrides(con):
        return con.execute("SELECT id, wording_override FROM filing_clauses ORDER BY id").fetchall()

    def test_hop_snapshots_only_sent_writings_and_prints_the_same_text(self):
        con = self._hop_from_v37()
        self.assertEqual(schema_version(self.db_path), 38)
        self.assertEqual(self._overrides(con), [(1, None), (2, "w1"), (3, "own words"), (4, None), (5, None)])
        self.assertEqual(con.execute(self.PRINTED).fetchall(), self.printed_before)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_hop_keeps_the_sent_writings_clause_guard(self):
        con = self._hop_from_v37()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "sent or retired Writing"):
            con.execute("UPDATE filing_clauses SET wording_override = 'changed' WHERE id = 2")

    def test_sending_snapshots_and_a_later_shared_edit_reaches_only_drafting_writings(self):
        con = self._hop_from_v37()
        revision = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 1").rowcount, 1)
        self.assertEqual(self._overrides(con)[0], (1, "w1"))
        self.assertGreater(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), revision)
        con.execute("UPDATE clauses SET wording = 'w1 edited' WHERE id = 1")
        self.assertEqual(
            con.execute(self.PRINTED).fetchall(),
            [(1, "w1"), (2, "w1"), (3, "own words"), (4, "w1 edited"), (5, "w1 edited")],
        )

    def test_retiring_without_sending_snapshots_nothing(self):
        con = self._hop_from_v37()
        con.execute("UPDATE filings SET retired_on = '2026-09-28', retirement_reason = 'other' WHERE id = 1")
        self.assertEqual(self._overrides(con)[0], (1, None))

    def test_sending_an_already_retired_writing_is_refused(self):
        con = self._hop_from_v37()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "sent or retired Writing"):
            con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 3")
        self.assertEqual(con.execute("SELECT filed_on FROM filings WHERE id = 3").fetchone(), (None,))

    def test_fresh_v38_database_has_the_snapshot_trigger(self):
        engine.migrate(str(self.db_path), target_version=38)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'snapshot_clause_wording_on_send'").fetchall(),
            [("filings",)],
        )


class TestV39RecipientForumDefault(unittest.TestCase):
    """v39 (#1234): recipients.forum_default says whether a Writing addressed to the forum
    copies the row by default. 1 is the service list, 0 a person a letter is addressed to
    who is not on it (a witness, an expert). Additive: every existing row reads 1."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO recipients (id, proceeding_id, name, capacity, party_id, ordinal) VALUES
            (1, 1, 'Registrar', 'the registry', NULL, 1), (2, 1, 'Counsel', 'counsel for the Defendant', NULL, 2);
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v38(self):
        engine.migrate(str(self.db_path), target_version=38)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.before = con.execute("SELECT * FROM recipients ORDER BY id").fetchall()
        self.revision = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=39), [(38, 39)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_v38_database_hops_to_v39_with_every_row_on_the_forum_default(self):
        con = self._hop_from_v38()
        self.assertEqual(schema_version(self.db_path), 39)
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(recipients)")],
            ["id", "proceeding_id", "name", "capacity", "email", "address", "party_id", "ordinal", "forum_default"],
        )
        self.assertEqual(con.execute("SELECT * FROM recipients ORDER BY id").fetchall(), [row + (1,) for row in self.before])
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_forum_default_takes_only_0_or_1_and_defaults_to_1(self):
        con = self._hop_from_v38()
        con.execute("INSERT INTO recipients (id, proceeding_id, name, ordinal) VALUES (3, 1, 'New counsel', 3)")
        con.execute("INSERT INTO recipients (id, proceeding_id, name, capacity, ordinal, forum_default) VALUES (4, 1, 'Wanda Witness', 'a witness', 4, 0)")
        self.assertEqual(con.execute("SELECT id, forum_default FROM recipients WHERE id IN (3, 4) ORDER BY id").fetchall(), [(3, 1), (4, 0)])
        for value in (2, None):
            with self.subTest(value=value), self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE recipients SET forum_default = ? WHERE id = 4", (value,))

    def test_the_revision_triggers_still_fire(self):
        con = self._hop_from_v38()
        before = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        con.execute("UPDATE recipients SET forum_default = 0 WHERE id = 2")
        self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), before + 1)


class TestV40AuthorityConfirmed(unittest.TestCase):
    """v40 (#1231): filings.authority_confirmed_on records that a Writing links its cited
    authority or cites none. Additive: every existing row reads NULL, so every unsent
    general Writing drafted before the hop is the flagged set."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def test_v39_database_hops_to_v40_with_every_filing_unconfirmed(self):
        engine.migrate(str(self.db_path), target_version=39)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000');
            INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter', 'Second letter', 0);
            """
        )
        con.commit()
        before = con.execute("SELECT * FROM filings ORDER BY id").fetchall()
        revision = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=40), [(39, 40)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(schema_version(self.db_path), 40)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(filings)")][-1], "authority_confirmed_on")
        self.assertEqual(con.execute("SELECT * FROM filings ORDER BY id").fetchall(), [row + (None,) for row in before])
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_the_column_is_settable_and_clearable_on_an_unsent_writing(self):
        engine.migrate(str(self.db_path), target_version=40)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000');
            INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter', 'Second letter', 0);
            """
        )
        con.execute("UPDATE filings SET authority_confirmed_on = '2026-09-29' WHERE id = 1")
        self.assertEqual(con.execute("SELECT authority_confirmed_on FROM filings WHERE id = 1").fetchone(), ("2026-09-29",))
        con.execute("UPDATE filings SET authority_confirmed_on = NULL WHERE id = 1")
        self.assertEqual(con.execute("SELECT authority_confirmed_on FROM filings WHERE id = 1").fetchone(), (None,))


class TestV41PartiesSnapshot(unittest.TestCase):
    """v41 (party/counsel SSOT): parties.case_party_id links a party to its matter-data party,
    and parties_snapshot holds the party rows a Writing printed when it was sent. The
    statement that first sets a Writing's filed_on fills the snapshot from the proceeding's
    current party rows, so a later change of counsel reaches drafting Writings only. The hop
    seeds a snapshot for every Writing already sent, from its current rows."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L0000', 'CAN/BC/BCSC', 'S-1');
        INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, address_for_service, counsel_name,
                             counsel_firm, counsel_phone, counsel_email)
        VALUES (1, 1, 'Ada Client', 'Plaintiff', 1, 1, '1 Firm St', 'L. Lawyer', 'Logica Law', '604-555-0101', 'l@logica.example'),
               (2, 1, 'Bert Other', 'Defendant', 2, 0, '2 X St', 'X. Counsel', 'X LLP', '604-555-0102', 'x@x.example');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0),
            (3, 1, 'letter_to_opposing_counsel', 'retired', 0);
        UPDATE filings SET filed_on = '2026-09-27' WHERE id = 2;
        UPDATE filings SET retired_on = '2026-09-27', retirement_reason = 'other' WHERE id = 3;
    """
    PRINTED = (
        "SELECT party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service, "
        "address_for_service_filed, counsel_name, counsel_firm, counsel_phone, counsel_email, lower_court_role "
        "FROM parties_snapshot WHERE filing_id = ? ORDER BY party_id"
    )
    LIVE = (
        "SELECT id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service, "
        "address_for_service_filed, counsel_name, counsel_firm, counsel_phone, counsel_email, lower_court_role "
        "FROM parties ORDER BY id"
    )

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v40(self):
        engine.migrate(str(self.db_path), target_version=40)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.parties_before = con.execute("SELECT * FROM parties ORDER BY id").fetchall()
        self.revision_before = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=41), [(40, 41)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def test_hop_adds_an_unlinked_case_party_id_and_seeds_only_sent_writings(self):
        con = self._hop_from_v40()
        self.assertEqual(schema_version(self.db_path), 41)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(parties)")][-1], "case_party_id")
        self.assertEqual(con.execute("SELECT * FROM parties ORDER BY id").fetchall(), [row + (None,) for row in self.parties_before])
        self.assertEqual(con.execute("SELECT DISTINCT filing_id FROM parties_snapshot").fetchall(), [(2,)])
        self.assertEqual(con.execute(self.PRINTED, (2,)).fetchall(), con.execute(self.LIVE).fetchall())
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.revision_before, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_sending_snapshots_and_a_later_change_of_counsel_reaches_only_drafting_writings(self):
        con = self._hop_from_v40()
        revision = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 1").rowcount, 1)
        printed = con.execute(self.LIVE).fetchall()
        self.assertEqual(con.execute(self.PRINTED, (1,)).fetchall(), printed)
        self.assertGreater(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), revision)
        con.execute("UPDATE parties SET counsel_name = 'Y. Counsel', counsel_email = NULL WHERE id = 2")
        self.assertEqual(con.execute(self.PRINTED, (1,)).fetchall(), printed)
        self.assertEqual(con.execute(self.PRINTED, (2,)).fetchall(), printed)
        self.assertEqual(con.execute("SELECT counsel_name, counsel_email FROM parties WHERE id = 2").fetchone(), ("Y. Counsel", None))

    def test_retiring_without_sending_snapshots_nothing(self):
        con = self._hop_from_v40()
        con.execute("UPDATE filings SET retired_on = '2026-09-28', retirement_reason = 'other' WHERE id = 1")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM parties_snapshot WHERE filing_id IN (1, 3)").fetchone(), (0,))

    def test_a_filed_on_cleared_and_set_again_keeps_the_first_snapshot(self):
        con = self._hop_from_v40()
        printed = con.execute(self.PRINTED, (2,)).fetchall()
        con.execute("UPDATE filings SET filed_on = NULL WHERE id = 2")
        con.execute("UPDATE parties SET counsel_name = 'Y. Counsel' WHERE id = 2")
        con.execute("UPDATE filings SET filed_on = '2026-09-29' WHERE id = 2")
        self.assertEqual(con.execute(self.PRINTED, (2,)).fetchall(), printed)

    def test_fresh_v41_database_has_the_snapshot_table_trigger_and_revision_triggers(self):
        engine.migrate(str(self.db_path), target_version=41)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'snapshot_parties_on_send'").fetchall(),
            [("filings",)],
        )
        self.assertEqual(
            sorted(row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'parties_snapshot'")),
            ["rev_parties_snapshot_del", "rev_parties_snapshot_ins", "rev_parties_snapshot_upd"],
        )


class TestV42RuntimeWritesThePartiesSnapshot(unittest.TestCase):
    """v42 (party/counsel SSOT): the runtime writes a Writing's parties_snapshot from the matter-data
    read before it sets filed_on, so the copying trigger snapshot_parties_on_send is dropped, and a
    guard refuses to set filed_on on a Writing with no snapshot rows while its proceeding has a
    party. Existing snapshot rows are untouched."""

    SEED = TestV41PartiesSnapshot.SEED
    PRINTED = TestV41PartiesSnapshot.PRINTED
    SNAPSHOT = (
        "INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, "
        "address_for_service_filed, counsel_name) "
        "VALUES (1, 1, 'Ada Client', 'Plaintiff', 1, 1, 0, 0, 'unknown', 'L. Lawyer'), "
        "(1, 2, 'Bert Other', 'Defendant', 2, 0, 0, 0, 'unknown', 'Y. Counsel')"
    )

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v41(self):
        engine.migrate(str(self.db_path), target_version=41)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.snapshot_before = con.execute("SELECT * FROM parties_snapshot ORDER BY id").fetchall()
        self.revision_before = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=42), [(41, 42)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def test_hop_drops_the_copying_trigger_and_keeps_every_snapshot_row(self):
        con = self._hop_from_v41()
        self.assertEqual(schema_version(self.db_path), 42)
        self.assertEqual(len(self.snapshot_before), 2, "the v41 seed gave the sent Writing its snapshot")
        self.assertEqual(con.execute("SELECT * FROM parties_snapshot ORDER BY id").fetchall(), self.snapshot_before)
        self.assertEqual(con.execute("SELECT name FROM sqlite_master WHERE name = 'snapshot_parties_on_send'").fetchall(), [])
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.revision_before, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_setting_filed_on_with_no_snapshot_is_refused_naming_both_tools(self):
        con = self._hop_from_v41()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "submission_data__record_sent.*submission_data__record_filed"):
            con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 1")
        self.assertEqual(con.execute("SELECT filed_on FROM filings WHERE id = 1").fetchone(), (None,))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM parties_snapshot WHERE filing_id = 1").fetchone(), (0,), "nothing copies the parties rows")

    def test_snapshot_rows_written_first_let_filed_on_through_and_a_later_change_reaches_only_drafting(self):
        con = self._hop_from_v41()
        con.execute(self.SNAPSHOT)
        printed = con.execute(self.PRINTED, (1,)).fetchall()
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 1").rowcount, 1)
        con.execute("UPDATE parties SET counsel_name = 'Z. Counsel' WHERE id = 2")
        self.assertEqual(con.execute(self.PRINTED, (1,)).fetchall(), printed)

    def test_a_proceeding_with_no_party_sets_filed_on_with_no_snapshot(self):
        con = self._hop_from_v41()
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference) VALUES (2, 'L0000');
            INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (4, 2, 'letter_to_opposing_counsel', 'no parties', 0);
            """
        )
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 4").rowcount, 1)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM parties_snapshot WHERE filing_id = 4").fetchone(), (0,))

    def test_clearing_filed_on_and_setting_it_again_keeps_the_first_snapshot(self):
        con = self._hop_from_v41()
        printed = con.execute(self.PRINTED, (2,)).fetchall()
        con.execute("UPDATE filings SET filed_on = NULL WHERE id = 2")
        con.execute("UPDATE parties SET counsel_name = 'Z. Counsel' WHERE id = 2")
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-29' WHERE id = 2").rowcount, 1)
        self.assertEqual(con.execute(self.PRINTED, (2,)).fetchall(), printed)

    def test_retiring_without_sending_is_not_refused(self):
        con = self._hop_from_v41()
        con.execute("UPDATE filings SET retired_on = '2026-09-28', retirement_reason = 'other' WHERE id = 1")
        self.assertEqual(con.execute("SELECT retired_on FROM filings WHERE id = 1").fetchone(), ("2026-09-28",))

    def test_fresh_v42_database_has_the_guard_and_not_the_copying_trigger(self):
        engine.migrate(str(self.db_path), target_version=42)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        triggers = [row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'filings' AND name LIKE '%parties%'")]
        self.assertEqual(triggers, ["guard_filings_parties_snapshot"])


class TestV43CounselCopyDropped(unittest.TestCase):
    """v43 (party/counsel SSOT): the submission copy of counsel of record is dropped. parties
    loses its five copied columns; recipients is rebuilt so a party-linked row holds no name,
    email or address of its own and every other row keeps a name. The engine refuses the hop,
    naming the rows and leaving the database at v42, while an unlinked party holds a copied
    value or a sent Writing has no party snapshot."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L0000', 'CAN/BC/BCSC', 'S-1'), (2, 'L0000', NULL, NULL);
        INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, address_for_service, counsel_name,
                             counsel_firm, counsel_phone, counsel_email, lower_court_role, case_party_id)
        VALUES (1, 1, 'Ada Client', 'Plaintiff', 1, 1, '1 Firm St', 'L. Lawyer', 'Logica Law', '604-555-0101', 'l@logica.example', NULL, 11),
               (2, 1, 'Bert Other', 'Defendant', 2, 0, '2 X St', 'X. Counsel', 'X LLP', NULL, 'x@x.example', 'Plaintiff', 12),
               (3, 1, 'Cy Third', 'Defendant', 3, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0);
        INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served,
                                      address_for_service_filed, counsel_name)
        VALUES (2, 1, 'Ada Client', 'Plaintiff', 1, 1, 0, 0, 'unknown', 'L. Lawyer'),
               (2, 2, 'Bert Other', 'Defendant', 2, 0, 0, 0, 'unknown', 'X. Counsel'),
               (2, 3, 'Cy Third', 'Defendant', 3, 0, 0, 0, 'unknown', NULL);
        UPDATE filings SET filed_on = '2026-09-27' WHERE id = 2;
        INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal, forum_default) VALUES
            (1, 1, 'Registrar', 'the registry', 'registry@court.example', '800 Smithe St', NULL, 1, 1),
            (2, 1, 'X. Counsel', 'counsel for the Defendant', 'x@x.example', '2 X St', 2, 2, 1),
            (3, 1, 'Cy Third', 'the Defendant', NULL, NULL, 3, 3, 1),
            (4, 1, 'Wanda Witness', 'a witness', NULL, '4 W St', NULL, 4, 0);
        INSERT INTO filing_recipients (id, filing_id, recipient_id, role, ordinal) VALUES (1, 1, 2, 'to', 1), (2, 1, 1, 'cc', 1);
    """
    KEPT = ("id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, "
            "address_for_service_filed, lower_court_role, case_party_id")
    DROPPED = ("counsel_name", "counsel_firm", "counsel_phone", "counsel_email", "address_for_service")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _v42(self, extra=""):
        engine.migrate(str(self.db_path), target_version=42)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED + extra)
        con.commit()
        self.before = {
            "parties": con.execute(f"SELECT {self.KEPT} FROM parties ORDER BY id").fetchall(),
            "snapshot": con.execute("SELECT * FROM parties_snapshot ORDER BY id").fetchall(),
            "recipients": con.execute("SELECT * FROM recipients ORDER BY id").fetchall(),
            "filing_recipients": con.execute("SELECT * FROM filing_recipients ORDER BY id").fetchall(),
            "revision": con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(),
        }
        con.close()

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=43), [(42, 43)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def _parties_columns(self):
        con = sqlite3.connect(str(self.db_path))
        try:
            return [row[1] for row in con.execute("PRAGMA table_info(parties)")]
        finally:
            con.close()

    def test_hop_drops_the_five_columns_keeping_every_party_row_and_every_snapshot_row(self):
        self._v42()
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 43)
        self.assertEqual(self._parties_columns(), [c.strip() for c in self.KEPT.split(",")])
        self.assertEqual(con.execute(f"SELECT {self.KEPT} FROM parties ORDER BY id").fetchall(), self.before["parties"])
        self.assertEqual(con.execute("SELECT * FROM parties_snapshot ORDER BY id").fetchall(), self.before["snapshot"])
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.before["revision"], "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_party_linked_recipients_lose_their_copies_and_every_other_row_is_unchanged(self):
        self._v42()
        con = self._hop()
        after = con.execute("SELECT * FROM recipients ORDER BY id").fetchall()
        self.assertEqual([row for row in after if row[6] is None], [row for row in self.before["recipients"] if row[6] is None])
        self.assertEqual(
            [row for row in after if row[6] is not None],
            [(r[0], r[1], None, r[3], None, None, r[6], r[7], r[8]) for r in self.before["recipients"] if r[6] is not None],
        )
        self.assertEqual(con.execute("SELECT * FROM filing_recipients ORDER BY id").fetchall(), self.before["filing_recipients"])

    def test_the_rebuilt_recipients_hold_both_checks_its_index_and_its_revision_triggers(self):
        self._v42()
        con = self._hop()
        for sql in (
            "INSERT INTO recipients (proceeding_id, name, party_id, ordinal) VALUES (1, 'Copied name', 1, 5)",
            "INSERT INTO recipients (proceeding_id, email, party_id, ordinal) VALUES (1, 'copied@x.example', 1, 5)",
            "INSERT INTO recipients (proceeding_id, address, party_id, ordinal) VALUES (1, '1 Copied St', 1, 5)",
            "INSERT INTO recipients (proceeding_id, capacity, ordinal) VALUES (1, 'nobody', 5)",
            "UPDATE recipients SET email = 'x@x.example' WHERE id = 2",
            "UPDATE recipients SET name = NULL WHERE id = 1",
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)
        revision = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        con.execute("INSERT INTO recipients (id, proceeding_id, capacity, party_id, ordinal) VALUES (5, 1, 'counsel for the Plaintiff', 1, 5)")
        self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), revision + 1)
        self.assertEqual(
            sorted(row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE tbl_name = 'recipients' AND type IN ('index', 'trigger')")),
            ["idx_recipients_proceeding", "rev_recipients_del", "rev_recipients_ins", "rev_recipients_upd"],
        )

    def test_an_unlinked_party_holding_a_value_is_refused_naming_it_and_the_database_stays_at_v42(self):
        self._v42("UPDATE parties SET case_party_id = NULL WHERE id = 2;")
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=43)
        self.assertEqual(caught.exception.code, "counsel_not_reconciled")
        self.assertEqual(caught.exception.details, {"table": "parties", "ids": [2]})
        self.assertIn("Bert Other", caught.exception.message)
        self.assertEqual(schema_version(self.db_path), 42)
        self.assertIn("counsel_name", self._parties_columns())

    def test_an_unlinked_party_holding_nothing_is_left_to_the_runtime(self):
        self._v42()
        self._hop()
        self.assertEqual(schema_version(self.db_path), 43)

    def test_a_sent_writing_with_no_party_snapshot_is_refused_naming_it(self):
        self._v42(
            "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, filed_on) "
            "VALUES (3, 1, 'letter_to_opposing_counsel', 'inserted sent', 0, '2026-09-28');"
        )
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path), target_version=43)
        self.assertEqual(caught.exception.code, "filed_without_party_snapshot")
        self.assertEqual(caught.exception.details, {"table": "filings", "ids": [3]})
        self.assertEqual(schema_version(self.db_path), 42)

    def test_a_sent_writing_on_a_proceeding_with_no_party_needs_no_snapshot(self):
        self._v42(
            "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, filed_on) "
            "VALUES (3, 2, 'letter_to_opposing_counsel', 'no parties', 0, '2026-09-28');"
        )
        self._hop()
        self.assertEqual(schema_version(self.db_path), 43)

    def test_run_stops_at_a_target_version_and_refuses_one_the_engine_does_not_reach(self):
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 42})["schema_version"], 42)
        for bad in (engine.TARGET_SCHEMA_VERSION + 1, 0, "43"):
            with self.subTest(target_version=bad), self.assertRaises(engine.MigrateError) as caught:
                engine.run({"db_path": str(self.db_path), "target_version": bad})
            self.assertEqual(caught.exception.code, "invalid_request")
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 43})["applied"], [{"from": 42, "to": 43}])

    def test_fresh_v43_database_has_no_copy(self):
        engine.migrate(str(self.db_path))
        columns = self._parties_columns()
        for column in self.DROPPED:
            self.assertNotIn(column, columns)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        recipients = con.execute("SELECT sql FROM sqlite_master WHERE name = 'recipients'").fetchone()[0]
        self.assertIn("CHECK (party_id IS NOT NULL OR name IS NOT NULL)", recipients)
        self.assertIn("CHECK (party_id IS NULL OR (name IS NULL AND email IS NULL AND address IS NULL))", recipients)


class TestV44SentRecipientsFrozen(unittest.TestCase):
    """v44 (#1307): a sent or retired Writing's filing_recipients rows take the v37 freeze guards,
    and the statement that first sets a Writing's filed_on records each of its recipients'
    capacity, party_id, and a no-party recipient's name, email and address in
    recipients_snapshot, so a later service-list edit reaches only drafting Writings. Retirement
    alone snapshots nothing. The hop gives every already-sent Writing the same snapshot."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL);
        INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES
            (1, 1, 'Ada Client', 'Claimant', 1, 1, 11), (2, 1, 'Bert Other', 'Respondent', 2, 0, 12);
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0),
            (3, 1, 'letter_to_opposing_counsel', 'retired', 0);
        INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal, forum_default) VALUES
            (1, 1, 'Dan Registrar', 'the registry', 'registry@court.example', '800 Smithe St', NULL, 1, 1),
            (2, 1, NULL, 'counsel for Bert Other', NULL, NULL, 2, 2, 1),
            (3, 1, 'Wanda Witness', 'a witness', NULL, '4 W St', NULL, 3, 0);
        INSERT INTO filing_recipients (id, filing_id, recipient_id, role, ordinal) VALUES
            (1, 1, 2, 'to', 1), (2, 1, 1, 'cc', 1),
            (3, 2, 2, 'to', 1), (4, 2, 1, 'cc', 1), (5, 2, 3, 'bcc', 1),
            (6, 3, 2, 'to', 1);
        INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed)
        VALUES (2, 1, 'Ada Client', 'Claimant', 1, 1, 0, 0, 'unknown'), (2, 2, 'Bert Other', 'Respondent', 2, 0, 0, 0, 'unknown');
        UPDATE filings SET filed_on = '2026-09-27' WHERE id = 2;
        UPDATE filings SET retired_on = '2026-09-27', retirement_reason = 'other' WHERE id = 3;
    """
    # What a Writing's recipient lines print from: membership, then the values a sent Writing reads.
    LIVE = ("SELECT fr.filing_id, fr.recipient_id, fr.role, fr.ordinal, r.capacity, r.party_id, r.name, r.email, r.address "
            "FROM filing_recipients fr JOIN recipients r ON r.id = fr.recipient_id WHERE fr.filing_id = ? ORDER BY fr.id")
    SENT = ("SELECT fr.filing_id, fr.recipient_id, fr.role, fr.ordinal, s.capacity, s.party_id, s.name, s.email, s.address "
            "FROM filing_recipients fr JOIN recipients_snapshot s ON s.filing_id = fr.filing_id AND s.recipient_id = fr.recipient_id "
            "WHERE fr.filing_id = ? ORDER BY fr.id")
    FROZEN = "sent or retired Writing's recipients do not change"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v43(self):
        engine.migrate(str(self.db_path), target_version=43)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.printed_before = con.execute(self.LIVE, (2,)).fetchall()
        self.revision = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=44), [(43, 44)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _snapshot(con, filing_id):
        return con.execute(
            "SELECT recipient_id, capacity, party_id, name, email, address FROM recipients_snapshot WHERE filing_id = ? ORDER BY recipient_id",
            (filing_id,),
        ).fetchall()

    def test_hop_snapshots_only_sent_writings_and_prints_the_same_values(self):
        con = self._hop_from_v43()
        self.assertEqual(schema_version(self.db_path), 44)
        self.assertEqual(con.execute("SELECT DISTINCT filing_id FROM recipients_snapshot").fetchall(), [(2,)])
        self.assertEqual(con.execute(self.SENT, (2,)).fetchall(), self.printed_before)
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_a_sent_or_retired_writings_recipients_are_frozen_and_a_drafting_ones_are_not(self):
        con = self._hop_from_v43()
        for filing_id, row_id in ((2, 3), (3, 6)):
            for sql in (
                f"INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES ({filing_id}, 3, 'cc', 2)",
                f"UPDATE filing_recipients SET role = 'cc' WHERE id = {row_id}",
                f"DELETE FROM filing_recipients WHERE id = {row_id}",
            ):
                with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FROZEN):
                    con.execute(sql)
        con.execute("INSERT INTO filing_recipients (id, filing_id, recipient_id, role, ordinal) VALUES (7, 1, 3, 'bcc', 1)")
        con.execute("UPDATE filing_recipients SET role = 'cc', ordinal = 2 WHERE id = 7")
        con.execute("DELETE FROM filing_recipients WHERE id = 7")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM filing_recipients").fetchone(), (6,))

    def test_a_row_can_neither_join_nor_leave_a_sent_writing(self):
        con = self._hop_from_v43()
        for sql in ("UPDATE filing_recipients SET filing_id = 2 WHERE id = 2", "UPDATE filing_recipients SET filing_id = 1 WHERE id = 5"):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FROZEN):
                con.execute(sql)

    def test_sending_snapshots_and_a_later_service_list_edit_reaches_only_drafting_writings(self):
        con = self._hop_from_v43()
        revision = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        con.execute("INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed) "
                    "VALUES (1, 2, 'Bert Other', 'Respondent', 2, 0, 0, 0, 'unknown')")
        self.assertEqual(con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 1").rowcount, 1)
        sent = [(1, "the registry", None, "Dan Registrar", "registry@court.example", "800 Smithe St"), (2, "counsel for Bert Other", 2, None, None, None)]
        self.assertEqual(self._snapshot(con, 1), sent)
        self.assertGreater(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), revision)
        con.execute("UPDATE recipients SET name = 'Eve Registrar', email = NULL, address = '1 New St', capacity = 'the new registry' WHERE id = 1")
        con.execute("UPDATE recipients SET capacity = 'counsel for Ada', party_id = 1 WHERE id = 2")
        self.assertEqual(self._snapshot(con, 1), sent)
        self.assertEqual(con.execute(self.SENT, (2,)).fetchall(), self.printed_before)
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (4, 1, 'letter_to_opposing_counsel', 'new', 0)")
        con.execute("INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (4, 1, 'to', 1)")
        self.assertEqual(con.execute(self.LIVE, (4,)).fetchall(), [(4, 1, "to", 1, "the new registry", None, "Eve Registrar", None, "1 New St")])

    def test_retiring_without_sending_snapshots_nothing(self):
        con = self._hop_from_v43()
        con.execute("UPDATE filings SET retired_on = '2026-09-28', retirement_reason = 'other' WHERE id = 1")
        self.assertEqual(self._snapshot(con, 1), [])
        self.assertEqual(self._snapshot(con, 3), [])

    def test_a_filed_on_cleared_and_set_again_keeps_the_first_snapshot_and_adds_a_recipient_added_meanwhile(self):
        con = self._hop_from_v43()
        first = self._snapshot(con, 2)
        con.execute("UPDATE filings SET filed_on = NULL WHERE id = 2")
        con.execute("UPDATE recipients SET name = 'Eve Registrar' WHERE id = 1")
        con.execute("DELETE FROM filing_recipients WHERE id = 5")
        con.execute("INSERT INTO recipients (id, proceeding_id, name, capacity, party_id, ordinal) VALUES (4, 1, 'Xena Expert', 'an expert', NULL, 4)")
        con.execute("INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (2, 4, 'cc', 2)")
        con.execute("UPDATE filings SET filed_on = '2026-09-28' WHERE id = 2")
        self.assertEqual(self._snapshot(con, 2), first + [(4, "an expert", None, "Xena Expert", None, None)])

    def test_fresh_v44_database_has_the_snapshot_table_trigger_and_guards(self):
        engine.migrate(str(self.db_path))
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(
            sorted(con.execute("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%recipients%'").fetchall()),
            [
                ("guard_filing_recipients_frozen_del", "filing_recipients"),
                ("guard_filing_recipients_frozen_ins", "filing_recipients"),
                ("guard_filing_recipients_frozen_upd", "filing_recipients"),
                ("rev_filing_recipients_del", "filing_recipients"),
                ("rev_filing_recipients_ins", "filing_recipients"),
                ("rev_filing_recipients_upd", "filing_recipients"),
                ("rev_recipients_del", "recipients"),
                ("rev_recipients_ins", "recipients"),
                ("rev_recipients_snapshot_del", "recipients_snapshot"),
                ("rev_recipients_snapshot_ins", "recipients_snapshot"),
                ("rev_recipients_snapshot_upd", "recipients_snapshot"),
                ("rev_recipients_upd", "recipients"),
                ("snapshot_recipients_on_send", "filings"),
            ],
        )


class TestV45GuardMessageRenamed(unittest.TestCase):
    """v45: guard_filings_parties_snapshot is recreated so its refusal names the record tools
    without a tool prefix, as /drafting-data's record-sent and record-filed tools. No row
    changes and no revision moves."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL);
        INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES
            (1, 1, 'Ada Client', 'Claimant', 1, 1, 11);
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0);
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v44(self):
        engine.migrate(str(self.db_path), target_version=44)
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.revision = con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=45), [(44, 45)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def test_hop_renames_the_tools_in_the_guard_message_and_moves_no_revision(self):
        con = self._hop_from_v44()
        self.assertEqual(schema_version(self.db_path), 45)
        self.assertEqual(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone(), self.revision, "the hop moves no revision")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "/drafting-data's record-sent tool.*record-filed tool"):
            con.execute("UPDATE filings SET filed_on = '2026-10-01' WHERE id = 1")
        self.assertEqual(con.execute("SELECT filed_on FROM filings WHERE id = 1").fetchone(), (None,))
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))


class TestV46FailedScrutiny(unittest.TestCase):
    """v46 (Engineering/2. Plan/2026-10-02_failed-scrutiny-outcome-plan.md): statements_of_law.verification
    admits 'failed', the research lawyer's negative return, and a failed statement must carry its finding
    in doubt. The rebuild drops and recreates the two filing_law proceeding guards, which name the table.
    Two triggers set a failed statement back to 'lead' when its excerpt or pinpoint changes, or when its
    proposition's wording changes, keeping doubt."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0001', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
            VALUES (1, 1, 'Lead Authority v. X', '2021 BCSC 1', 'case'), (2, 2, 'Other v. Y', '2022 BCSC 2', 'case');
        INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'p1'), (2, 1, 'p2');
        INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
            VALUES (1, 1, 1, 1, 'para 1', 'e1', 'primary', NULL, 'verified'),
                   (2, 1, 1, 1, 'para 2', 'e2', NULL, 'd2', 'lead'),
                   (3, 1, 1, 1, 'para 3', 'e3', NULL, NULL, 'lead'),
                   (4, 1, 2, 1, 'para 4', 'e4', NULL, NULL, 'lead'),
                   (5, 2, NULL, 2, 'para 5', 'e5', NULL, NULL, 'lead');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts)
            VALUES (1, 1, 'letter_to_opposing_counsel', 'drafting', 0);
        INSERT INTO filing_law (id, filing_id, statement_id) VALUES (1, 1, 1);
    """
    STATEMENTS = "SELECT * FROM statements_of_law ORDER BY id"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop_from_v45(self):
        engine.migrate(str(self.db_path), target_version=45)
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.before = con.execute(self.STATEMENTS).fetchall()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.migrate(str(self.db_path), target_version=46), [(45, 46)])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _state(con, statement_id):
        return con.execute("SELECT verification, doubt FROM statements_of_law WHERE id = ?", (statement_id,)).fetchone()

    @staticmethod
    def _fail(con, statement_id, finding):
        con.execute(
            "UPDATE statements_of_law SET verification = 'failed', "
            "doubt = COALESCE(doubt || ' ', '') || ? WHERE id = ?",
            (finding, statement_id),
        )

    def test_hop_keeps_every_row_and_link_and_moves_no_revision(self):
        con = self._hop_from_v45()
        self.assertEqual(schema_version(self.db_path), 46)
        self.assertEqual(con.execute(self.STATEMENTS).fetchall(), self.before)
        self.assertEqual(con.execute("SELECT * FROM filing_law").fetchall(), [(1, 1, 1)])
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(
            sorted(con.execute("SELECT type, name FROM sqlite_master WHERE tbl_name = 'statements_of_law' AND type IN ('index', 'trigger')").fetchall()),
            [
                ("index", "idx_statements_of_law_assertion"),
                ("index", "idx_statements_of_law_authority"),
                ("index", "idx_statements_of_law_proceeding"),
                ("trigger", "reopen_scrutiny_on_statement_change"),
                ("trigger", "rev_statements_of_law_del"),
                ("trigger", "rev_statements_of_law_ins"),
                ("trigger", "rev_statements_of_law_upd"),
            ],
        )
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'reopen_scrutiny_on_proposition_change'").fetchone(),
            ("law_assertions",),
        )

    def test_failed_is_admitted_and_an_unknown_state_is_refused(self):
        con = self._hop_from_v45()
        self._fail(con, 3, "Scrutiny failed 2026-10-02: ratio held; fit failed.")
        self.assertEqual(self._state(con, 3), ("failed", "Scrutiny failed 2026-10-02: ratio held; fit failed."))
        con.execute(
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification) VALUES (9, 1, 1, 'f', 'failed')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (10, 1, 1, 'unsure')")

    def test_a_failed_statement_without_a_finding_is_refused(self):
        con = self._hop_from_v45()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE statements_of_law SET verification = 'failed' WHERE id = 3")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (9, 1, 1, 'failed')")
        self._fail(con, 3, "finding")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE statements_of_law SET doubt = NULL WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("failed", "finding"))

    def test_an_excerpt_or_pinpoint_change_reopens_a_failed_statement_keeping_its_finding(self):
        con = self._hop_from_v45()
        self._fail(con, 2, "Scrutiny failed 2026-10-02: fit failed.")
        self._fail(con, 3, "Scrutiny failed 2026-10-02: ratio failed.")
        revision = self._revision(con)
        con.execute("UPDATE statements_of_law SET excerpt = 'e2 reworded' WHERE id = 2")
        self.assertEqual(self._state(con, 2), ("lead", "d2 Scrutiny failed 2026-10-02: fit failed."))
        self.assertEqual(self._revision(con), revision + 2, "the write and the reset each move the revision")
        con.execute("UPDATE statements_of_law SET pinpoint = 'para 3.1' WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("lead", "Scrutiny failed 2026-10-02: ratio failed."))

    def test_a_same_value_write_or_another_column_leaves_a_failed_statement_failed(self):
        con = self._hop_from_v45()
        self._fail(con, 3, "finding")
        con.execute("UPDATE statements_of_law SET excerpt = 'e3', pinpoint = 'para 3' WHERE id = 3")
        con.execute("UPDATE statements_of_law SET source = 'secondary' WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("failed", "finding"))

    def test_an_excerpt_change_leaves_a_verified_or_lead_statement_alone(self):
        con = self._hop_from_v45()
        con.execute("UPDATE statements_of_law SET excerpt = 'e1 edited' WHERE id = 1")
        con.execute("UPDATE statements_of_law SET excerpt = 'e4 edited' WHERE id = 4")
        self.assertEqual(self._state(con, 1), ("verified", None))
        self.assertEqual(self._state(con, 4), ("lead", None))

    def test_a_proposition_reword_reopens_only_that_propositions_failed_statements(self):
        con = self._hop_from_v45()
        self._fail(con, 3, "fit failed")
        self._fail(con, 4, "fit failed")
        con.execute("UPDATE law_assertions SET proposition = 'p2' WHERE id = 2")
        self.assertEqual(self._state(con, 4), ("failed", "fit failed"), "a same-value write reopens nothing")
        revision = self._revision(con)
        con.execute("UPDATE law_assertions SET proposition = 'p1 reworded' WHERE id = 1")
        self.assertEqual(
            con.execute("SELECT id, verification, doubt FROM statements_of_law WHERE id IN (1, 2, 3, 4) ORDER BY id").fetchall(),
            [(1, "verified", None), (2, "lead", "d2"), (3, "lead", "fit failed"), (4, "failed", "fit failed")],
        )
        self.assertEqual(self._revision(con), revision + 2, "the reword and the one reset each move the revision")

    def test_the_filing_law_proceeding_guards_still_refuse_a_cross_proceeding_link(self):
        con = self._hop_from_v45()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "its own proceeding"):
            con.execute("INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 5)")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "its own proceeding"):
            con.execute("UPDATE filing_law SET statement_id = 5 WHERE id = 1")
        con.execute("INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 2)")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM filing_law").fetchone(), (2,))


class TestV47ScrutinySettlesOnce(unittest.TestCase):
    """v47 (Engineering/2. Plan/2026-10-02_scrutiny-settles-once-plan.md): a scrutiny return settles the
    pair it judged. verification admits 'settled', counsel's confirmed close over a finding, with its
    date, note and a snapshot of the confirmed pair; a verified row takes its pair as its snapshot.
    One trigger reopens a verified or settled row whose pair moves off its snapshot; a proposition's
    wording reopens nothing, and a failed row is never reset by an edit. A 'lead' row carrying a v46
    finding becomes 'failed', and every failed statement linked to a live Writing gets one review job."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0001', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
            VALUES (1, 1, 'Lead Authority v. X', '2021 BCSC 1', 'case'), (2, 1, 'Second Authority v. Y', '2022 BCSC 2', 'case'),
                   (3, 2, 'Other v. Z', '2023 BCSC 3', 'case');
        INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'p deployed'), (2, 1, 'p unlinked'), (3, 1, 'p reserved');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'deployed', 1), (2, 1, 'reserved', 2);
        INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1), (2, 3);
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'drafting', 0);
        INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
        INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
            VALUES (1, 1, 1, 1, 'para 1', 'e1', 'primary', NULL, 'verified'),
                   (2, 1, 1, 1, 'para 2', 'e2', NULL, NULL, 'lead'),
                   (3, 1, 1, 1, 'para 3', 'e3', NULL, 'Scrutiny failed 2026-10-02: fit failed.', 'failed'),
                   (4, 1, 1, 2, 'para 4', 'e4', NULL, 'Scrutiny failed 2026-10-01: ratio failed. Disputed 2026-10-02: it is ratio.', 'lead'),
                   (5, 1, 2, 1, 'para 5', 'e5', NULL, 'Scrutiny failed 2026-10-02: fit failed.', 'failed'),
                   (6, 1, 3, 1, 'para 6', 'e6', NULL, 'Scrutiny failed 2026-10-02: fit failed.', 'failed'),
                   (7, 1, NULL, 2, 'para 7', 'e7', NULL, 'Scrutiny failed 2026-10-02: no power to grant.', 'failed'),
                   (8, 2, NULL, 3, 'para 8', 'e8', NULL, NULL, 'lead');
        INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'an order');
        INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 7, 'filled');
        INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);
        INSERT INTO filing_law (id, filing_id, statement_id) VALUES (1, 1, 1);
    """
    TICKETS = """
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
            VALUES (1, 1, NULL, 'Scrutinize: Lead Authority v. X, 2021 BCSC 1', 'Scrutinize: Lead Authority v. X, 2021 BCSC 1',
                    'completed', 0, 'work', 'L0000|scrutiny anchor', '2026-10-01T09:00', '2026-10-01T10:00'),
                   (2, 1, 1, 'later work', 'Later work.', 'queued', 4, 'work', 'L0000|later anchor', '2026-10-02T09:00', NULL);
        INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
            VALUES (1, 'scrutinize:statements_of_law:3', 'Lead Authority v. X, 2021 BCSC 1');
    """
    INTENT = "Counsel reviews the scrutinizer's finding on this statement of law against the source and confirms, revises or drops the statement."
    STEP = "Review the finding against the source and confirm, revise or drop the statement"
    REVIEW_JOBS = (
        "SELECT t.title, t.intent, t.status, t.kind, t.filing_id, t.priority, t.billing_anchor FROM tickets t "
        "WHERE t.title LIKE 'Review scrutiny finding: %' ORDER BY t.id"
    )

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _v46(self, extra=TICKETS):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=46)[-1], (45, 46))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED + extra)
        con.commit()
        self.revision = self._revision(con)
        con.close()

    def _hop(self, extra=TICKETS):
        self._v46(extra)
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 47})["applied"], [{"from": 46, "to": 47}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _state(con, statement_id):
        return con.execute(
            "SELECT verification, doubt, scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt FROM statements_of_law WHERE id = ?",
            (statement_id,),
        ).fetchone()

    @staticmethod
    def _settle(con, statement_id, authority_id, pinpoint, excerpt, note="Keep it: the finding misreads para 3."):
        con.execute(
            "UPDATE statements_of_law SET verification = 'settled', settled_on = '2026-10-02', settled_note = ?, "
            "authority_id = ?, pinpoint = ?, excerpt = ?, scrutinized_authority_id = ?, scrutinized_pinpoint = ?, scrutinized_excerpt = ? "
            "WHERE id = ?",
            (note, authority_id, pinpoint, excerpt, authority_id, pinpoint, excerpt, statement_id),
        )

    def test_hop_keeps_every_row_moves_no_revision_and_leaves_one_reopen_trigger(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 47)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM statements_of_law").fetchone(), (8,))
        self.assertEqual(con.execute("SELECT * FROM filing_law").fetchall(), [(1, 1, 1)])
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(
            sorted(con.execute(
                "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' "
                "AND (tbl_name = 'statements_of_law' OR name LIKE 'guard_filing_law_proceeding_%' OR name LIKE 'reopen_scrutiny_%')"
            ).fetchall()),
            [
                ("guard_filing_law_proceeding_ins", "filing_law"),
                ("guard_filing_law_proceeding_upd", "filing_law"),
                ("reopen_scrutiny_on_statement_change", "statements_of_law"),
                ("rev_statements_of_law_del", "statements_of_law"),
                ("rev_statements_of_law_ins", "statements_of_law"),
                ("rev_statements_of_law_upd", "statements_of_law"),
            ],
        )
        self.assertIsNone(con.execute("SELECT 1 FROM sqlite_master WHERE name = 'reopen_scrutiny_on_proposition_change'").fetchone())

    def test_backfill_snapshots_verified_rows_and_fails_leads_carrying_a_finding(self):
        con = self._hop()
        self.assertEqual(self._state(con, 1), ("verified", None, 1, "para 1", "e1"))
        self.assertEqual(self._state(con, 2), ("lead", None, None, None, None))
        self.assertEqual(
            self._state(con, 4),
            ("failed", "Scrutiny failed 2026-10-01: ratio failed. Disputed 2026-10-02: it is ratio.", None, None, None),
        )
        self.assertEqual(self._state(con, 3)[0], "failed")
        self.assertEqual(self._state(con, 8), ("lead", None, None, None, None))

    def test_each_failed_linked_statement_gets_one_review_job_and_an_unlinked_one_none(self):
        con = self._hop()
        self.assertEqual(
            con.execute(self.REVIEW_JOBS).fetchall(),
            [
                ("Review scrutiny finding: Lead Authority v. X (statement 3)", self.INTENT, "queued", "work", None, 5, "L0000|scrutiny anchor"),
                ("Review scrutiny finding: Second Authority v. Y (statement 4)", self.INTENT, "queued", "work", None, 5, "L0000|later anchor"),
                ("Review scrutiny finding: Second Authority v. Y (statement 7)", self.INTENT, "queued", "work", None, 5, "L0000|later anchor"),
            ],
        )
        jobs = dict(con.execute("SELECT title, id FROM tickets WHERE title LIKE 'Review scrutiny finding: %'").fetchall())
        for statement_id, scope in (
            (3, [("authorities", None), ("law_assertions", 1), ("statements_of_law", 3)]),
            (4, [("authorities", None), ("law_assertions", 1), ("statements_of_law", 4)]),
            (7, [("authorities", None), ("statements_of_law", 7)]),
        ):
            job_id = next(i for t, i in jobs.items() if t.endswith(f"(statement {statement_id})"))
            with self.subTest(statement=statement_id):
                self.assertEqual(con.execute("SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ?", (job_id,)).fetchall(), [(1, self.STEP, None)])
                self.assertEqual(
                    sorted(con.execute("SELECT entity, entity_id FROM ticket_scope WHERE ticket_id = ?", (job_id,)).fetchall(), key=lambda r: (r[0], r[1] or 0)),
                    scope,
                )
        named = [r[0] for r in con.execute("SELECT entity_id FROM ticket_scope WHERE entity = 'statements_of_law' ORDER BY entity_id")]
        self.assertEqual(named, [3, 4, 7], "no job for the statement linked to nothing (5) or only to a reserved submission (6)")

    def test_a_live_review_job_is_not_duplicated(self):
        live = self.TICKETS + """
            INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
                VALUES (3, 1, NULL, 'Review scrutiny finding: Lead Authority v. X (statement 3)', 'i', 'queued', 1, 'work', 'L0000|own', '2026-10-02T10:00');
            INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (3, 1, 's');
            INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (3, 'statements_of_law', 3);
        """
        con = self._hop(live)
        self.assertEqual(
            con.execute("SELECT entity_id, COUNT(*) FROM ticket_scope WHERE entity = 'statements_of_law' GROUP BY entity_id ORDER BY entity_id").fetchall(),
            [(3, 1), (4, 1), (7, 1)],
        )
        self.assertEqual(con.execute("SELECT COUNT(*) FROM tickets WHERE title LIKE 'Review scrutiny finding: %'").fetchone(), (3,))

    def test_a_review_job_with_no_anchor_is_refused_naming_the_statements_and_the_database_stays_at_v46(self):
        self._v46(extra="")
        with self.assertRaises(engine.MigrateError) as caught:
            engine.migrate(str(self.db_path))
        self.assertEqual(caught.exception.code, "review_job_anchor_missing")
        self.assertEqual(caught.exception.details, {"table": "statements_of_law", "ids": [3, 4, 7]})
        self.assertEqual(schema_version(self.db_path), 46)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(con.execute("SELECT verification FROM statements_of_law WHERE id = 4").fetchone(), ("lead",))

    def test_settled_is_admitted_with_its_finding_date_note_and_snapshot_and_refused_without_any(self):
        con = self._hop()
        con.execute(
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification, settled_on, settled_note, scrutinized_authority_id) "
            "VALUES (9, 1, 1, 'f', 'settled', '2026-10-02', 'n', 1)"
        )
        for sql in (
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (10, 1, 1, 'unsure')",
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification, settled_on, settled_note, scrutinized_authority_id) VALUES (10, 1, 1, NULL, 'settled', '2026-10-02', 'n', 1)",
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification, settled_on, settled_note, scrutinized_authority_id) VALUES (10, 1, 1, 'f', 'settled', NULL, 'n', 1)",
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification, settled_on, settled_note, scrutinized_authority_id) VALUES (10, 1, 1, 'f', 'settled', '2026-10-02', NULL, 1)",
            "INSERT INTO statements_of_law (id, proceeding_id, authority_id, doubt, verification, settled_on, settled_note, scrutinized_authority_id) VALUES (10, 1, 1, 'f', 'settled', '2026-10-02', 'n', NULL)",
            "UPDATE statements_of_law SET doubt = NULL WHERE id = 9",
            "UPDATE statements_of_law SET doubt = NULL WHERE id = 3",
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)

    def test_the_confirmation_write_settles_a_failed_row_in_one_update(self):
        con = self._hop()
        self._settle(con, 3, 2, "para 30", "e3 re-pointed")
        self.assertEqual(self._state(con, 3), ("settled", "Scrutiny failed 2026-10-02: fit failed.", 2, "para 30", "e3 re-pointed"))
        self.assertEqual(
            con.execute("SELECT authority_id, pinpoint, excerpt, settled_on, settled_note FROM statements_of_law WHERE id = 3").fetchone(),
            (2, "para 30", "e3 re-pointed", "2026-10-02", "Keep it: the finding misreads para 3."),
        )
        self._settle(con, 7, 2, "para 7", "e7")  # keep as is: the pair repeated unchanged
        self.assertEqual(self._state(con, 7)[0], "settled")

    def test_a_pair_moving_off_its_snapshot_reopens_a_settled_or_verified_row_and_a_same_value_write_does_not(self):
        con = self._hop()
        self._settle(con, 3, 1, "para 3", "e3")
        revision = self._revision(con)
        con.execute("UPDATE statements_of_law SET excerpt = 'e3, edited' WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("lead", "Scrutiny failed 2026-10-02: fit failed.", 1, "para 3", "e3"))
        self.assertEqual(self._revision(con), revision + 2, "the write and the reset each move the revision")

        con.execute("UPDATE statements_of_law SET pinpoint = 'para 1.1' WHERE id = 1")
        self.assertEqual(self._state(con, 1)[0], "lead")
        con.execute(
            "UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, "
            "scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt WHERE id = 2"
        )
        self.assertEqual(self._state(con, 2), ("verified", None, 1, "para 2", "e2"))
        con.execute("UPDATE statements_of_law SET authority_id = 2 WHERE id = 2")
        self.assertEqual(self._state(con, 2)[0], "lead")

        self._settle(con, 7, 2, "para 7", "e7")
        con.execute(
            "UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, "
            "scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt WHERE id = 1"
        )
        con.execute("UPDATE statements_of_law SET authority_id = authority_id, pinpoint = pinpoint, excerpt = excerpt WHERE id IN (1, 7)")
        self.assertEqual(self._state(con, 1)[0], "verified")
        self.assertEqual(self._state(con, 7)[0], "settled")

    def test_a_proposition_reword_resets_no_statement(self):
        con = self._hop()
        self._settle(con, 4, 2, "para 4", "e4")
        revision = self._revision(con)
        con.execute("UPDATE law_assertions SET proposition = 'p deployed, reworded' WHERE id = 1")
        self.assertEqual(
            con.execute("SELECT id, verification FROM statements_of_law WHERE law_assertion_id = 1 ORDER BY id").fetchall(),
            [(1, "verified"), (2, "lead"), (3, "failed"), (4, "settled")],
        )
        self.assertEqual(self._revision(con), revision + 1, "the reword alone moves the revision")

    def test_an_edit_leaves_a_failed_row_failed(self):
        con = self._hop()
        con.execute("UPDATE statements_of_law SET excerpt = 'e3 re-captured', pinpoint = 'para 3.1', authority_id = 2 WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("failed", "Scrutiny failed 2026-10-02: fit failed.", None, None, None))

    def test_the_filing_law_proceeding_guards_still_refuse_a_cross_proceeding_link(self):
        con = self._hop()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "its own proceeding"):
            con.execute("INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 8)")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "its own proceeding"):
            con.execute("UPDATE filing_law SET statement_id = 8 WHERE id = 1")
        con.execute("INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 2)")
        self.assertEqual(con.execute("SELECT COUNT(*) FROM filing_law").fetchone(), (2,))


class TestV48NoFactsNeeded(unittest.TestCase):
    """v48: counsel records that a contention needs no stated fact. submissions gains
    no_facts_needed_on, no_facts_needed_note and no_facts_needed_contention, all three set or all
    three NULL by CHECK. A trigger clears all three when the contention's wording moves off the
    wording decided on; a same-value write keeps the decision, and changing the wording back does
    not restore it."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal)
            VALUES (1, 1, 'The court has jurisdiction.', 1), (2, 1, 'The claim is out of time.', 2);
    """
    DECIDE = (
        "UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = ?, "
        "no_facts_needed_contention = contention WHERE id = ?"
    )
    NOTE = "Jurisdiction is a question of law on the statute's face."

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=47)[-1], (46, 47))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 48})["applied"], [{"from": 47, "to": 48}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _decision(con, submission_id):
        return con.execute(
            "SELECT no_facts_needed_on, no_facts_needed_note, no_facts_needed_contention FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

    def test_hop_adds_three_null_columns_and_the_reset_trigger_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 48)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(submissions)")][-3:],
            ["no_facts_needed_on", "no_facts_needed_note", "no_facts_needed_contention"],
        )
        self.assertEqual(
            con.execute("SELECT id, contention, killed_on, no_facts_needed_on, no_facts_needed_note, no_facts_needed_contention FROM submissions ORDER BY id").fetchall(),
            [(1, "The court has jurisdiction.", None, None, None, None), (2, "The claim is out of time.", None, None, None, None)],
        )
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'reset_no_facts_needed_on_contention_change'").fetchone(),
            ("submissions",),
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_partial_decision_is_refused_and_a_whole_one_admitted(self):
        con = self._hop()
        for sql in (
            "UPDATE submissions SET no_facts_needed_on = '2026-10-04' WHERE id = 1",
            "UPDATE submissions SET no_facts_needed_note = 'n' WHERE id = 1",
            "UPDATE submissions SET no_facts_needed_contention = contention WHERE id = 1",
            "UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = 'n' WHERE id = 1",
            "UPDATE submissions SET no_facts_needed_note = 'n', no_facts_needed_contention = contention WHERE id = 1",
            "INSERT INTO submissions (id, proceeding_id, contention, ordinal, no_facts_needed_on, no_facts_needed_note) VALUES (3, 1, 'c', 3, '2026-10-04', 'n')",
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)
        self.assertEqual(self._decision(con, 1), (None, None, None))
        con.execute(self.DECIDE, (self.NOTE, 1))
        self.assertEqual(self._decision(con, 1), ("2026-10-04", self.NOTE, "The court has jurisdiction."))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE submissions SET no_facts_needed_note = NULL WHERE id = 1")
        con.execute("UPDATE submissions SET no_facts_needed_on = NULL, no_facts_needed_note = NULL, no_facts_needed_contention = NULL WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))

    def test_a_decision_dated_other_than_yyyy_mm_dd_is_refused(self):
        con = self._hop()
        for bad in ("2026-10-04T09:00", "today"):
            with self.subTest(date=bad), self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "UPDATE submissions SET no_facts_needed_on = ?, no_facts_needed_note = ?, no_facts_needed_contention = contention WHERE id = 1",
                    (bad, self.NOTE),
                )
        self.assertEqual(self._decision(con, 1), (None, None, None))

    def test_a_contention_reword_clears_the_decision_and_moves_the_revision_twice(self):
        con = self._hop()
        con.execute(self.DECIDE, (self.NOTE, 1))
        con.execute(self.DECIDE, ("Limitation runs on the pleaded dates alone.", 2))
        revision = self._revision(con)
        con.execute("UPDATE submissions SET contention = 'The court has jurisdiction to make the order.' WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))
        self.assertEqual(self._revision(con), revision + 2, "the write and the reset each move the revision")
        self.assertEqual(self._decision(con, 2), ("2026-10-04", "Limitation runs on the pleaded dates alone.", "The claim is out of time."), "only the reworded row clears")

    def test_the_decision_write_and_a_same_value_write_keep_the_decision(self):
        con = self._hop()
        revision = self._revision(con)
        con.execute(self.DECIDE, (self.NOTE, 1))
        self.assertEqual(self._revision(con), revision + 1, "the decision write fires no reset")
        con.execute("UPDATE submissions SET contention = contention WHERE id = 1")
        con.execute("UPDATE submissions SET contention = 'The court has jurisdiction.', ordinal = 5 WHERE id = 1")
        self.assertEqual(self._decision(con, 1), ("2026-10-04", self.NOTE, "The court has jurisdiction."))

    def test_changing_the_wording_back_does_not_restore_the_decision(self):
        con = self._hop()
        con.execute(self.DECIDE, (self.NOTE, 1))
        con.execute("UPDATE submissions SET contention = 'A reworded contention.' WHERE id = 1")
        con.execute("UPDATE submissions SET contention = 'The court has jurisdiction.' WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))


class TestV49PureLaw(unittest.TestCase):
    """v49: counsel records that a Notice of Application or Application Response is to be filed
    with an empty factual-basis Part. filings gains pure_law_on and pure_law_note, both set or both
    NULL by CHECK. Seven triggers clear both when the filing gains something the decision did not
    see: a form fact, order or contention deployed, a deployed order's wording or override changed,
    or a position taken or changed. Deletes and same-value writes keep the decision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of application');
        INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'An order setting aside the default judgment.');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The claim was served on 1 March 2026.');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The Rules permit the order.', 1);
        INSERT INTO documents (id, proceeding_id, label) VALUES (1, 1, 'Notice of application of the plaintiff');
        INSERT INTO opposing_orders (id, proceeding_id, document_id, paragraph_number, wording) VALUES (1, 1, 1, 1, 'An order for costs.');
    """
    DECIDE = "UPDATE filings SET pure_law_on = '2026-10-04', pure_law_note = ? WHERE id = 1"
    NOTE = "The application turns on the Rules alone."
    TRIGGERS = [
        "reset_pure_law_on_fact_ins",
        "reset_pure_law_on_order_ins",
        "reset_pure_law_on_order_override",
        "reset_pure_law_on_order_wording",
        "reset_pure_law_on_submission_ins",
        "reset_pure_law_on_position_ins",
        "reset_pure_law_on_position_upd",
    ]

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=48)[-1], (47, 48))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 49})["applied"], [{"from": 48, "to": 49}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _decision(con):
        return con.execute("SELECT pure_law_on, pure_law_note FROM filings WHERE id = 1").fetchone()

    def test_hop_adds_two_null_columns_and_seven_triggers_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 49)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(filings)")][-2:], ["pure_law_on", "pure_law_note"])
        self.assertEqual(self._decision(con), (None, None))
        self.assertEqual(
            [row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'reset_pure_law_on_%' ORDER BY name")],
            sorted(self.TRIGGERS),
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_partial_or_misdated_decision_is_refused_and_a_whole_one_admitted(self):
        con = self._hop()
        for sql, params in (
            ("UPDATE filings SET pure_law_on = '2026-10-04' WHERE id = 1", ()),
            ("UPDATE filings SET pure_law_note = ? WHERE id = 1", (self.NOTE,)),
            ("UPDATE filings SET pure_law_on = '2026-10-04T09:00', pure_law_note = ? WHERE id = 1", (self.NOTE,)),
            ("UPDATE filings SET pure_law_on = 'today', pure_law_note = ? WHERE id = 1", (self.NOTE,)),
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql, params)
        self.assertEqual(self._decision(con), (None, None))
        con.execute(self.DECIDE, (self.NOTE,))
        self.assertEqual(self._decision(con), ("2026-10-04", self.NOTE))
        con.execute("UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = 1")
        self.assertEqual(self._decision(con), (None, None))

    def test_each_trigger_clears_the_decision(self):
        con = self._hop()
        for trigger, sql in (
            ("reset_pure_law_on_fact_ins", "INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1)"),
            ("reset_pure_law_on_order_ins", "INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1)"),
            ("reset_pure_law_on_order_override", "UPDATE filing_orders SET wording_override = 'An order setting aside the judgment.' WHERE filing_id = 1 AND document = 'form'"),
            ("reset_pure_law_on_order_wording", "UPDATE order_sought SET wording = 'An order setting aside the default judgment, with costs.' WHERE id = 1"),
            ("reset_pure_law_on_submission_ins", "INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1)"),
            ("reset_pure_law_on_position_ins", "INSERT INTO filing_positions (filing_id, opposing_order_id, position) VALUES (1, 1, 'opposed')"),
            ("reset_pure_law_on_position_upd", "UPDATE filing_positions SET position = 'no_position' WHERE filing_id = 1"),
        ):
            with self.subTest(trigger=trigger):
                con.execute(self.DECIDE, (self.NOTE,))
                self.assertEqual(self._decision(con), ("2026-10-04", self.NOTE))
                con.execute(sql)
                self.assertEqual(self._decision(con), (None, None))

    def test_a_reset_moves_the_revision_twice(self):
        con = self._hop()
        con.execute(self.DECIDE, (self.NOTE,))
        revision = self._revision(con)
        con.execute("INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1)")
        self.assertEqual(self._decision(con), (None, None))
        self.assertEqual(self._revision(con), revision + 2, "the write and the reset each move the revision")

    def test_deletes_same_value_writes_and_the_decision_write_keep_the_decision(self):
        con = self._hop()
        con.executescript(
            """
            INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 1, 'form', 'part2', 1);
            INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal, wording_override) VALUES (1, 1, 'form', 1, 'An order.');
            INSERT INTO filing_positions (filing_id, opposing_order_id, position) VALUES (1, 1, 'opposed');
            """
        )
        revision = self._revision(con)
        con.execute(self.DECIDE, (self.NOTE,))
        self.assertEqual(self._revision(con), revision + 1, "the decision write fires no reset")
        for sql in (
            "INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'written_argument', 'part2', 1)",
            "DELETE FROM filing_facts WHERE id = 1",
            "UPDATE order_sought SET wording = wording WHERE id = 1",
            "UPDATE filing_orders SET wording_override = wording_override WHERE filing_id = 1",
            "UPDATE filing_positions SET position = position WHERE filing_id = 1",
        ):
            with self.subTest(sql=sql):
                con.execute(sql)
                self.assertEqual(self._decision(con), ("2026-10-04", self.NOTE))


class TestV50SessionProposed(unittest.TestCase):
    """v50: tickets gains session_proposed, 0 or 1 by CHECK, DEFAULT 0, set to 1 on a job whose
    title and intent were a session proposal the practitioner approved word for word. Additive:
    every existing row reads 0, and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO tickets (id, proceeding_id, title, intent, kind, billing_anchor, created)
          VALUES (1, 1, 'reply to their attornment argument', 'I want to reply to their attornment argument.', 'work', 'L0000|attornment', '2026-10-04T09:00');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=49)[-1], (48, 49))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 50})["applied"], [{"from": 49, "to": 50}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_adds_the_column_last_and_every_existing_row_reads_0(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 50)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(tickets)")][-1], "session_proposed")
        self.assertEqual(con.execute("SELECT session_proposed FROM tickets WHERE id = 1").fetchone(), (0,))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_session_proposed_admits_only_0_and_1(self):
        con = self._hop()
        insert = ("INSERT INTO tickets (proceeding_id, title, intent, kind, billing_anchor, created, session_proposed) "
                  "VALUES (1, 'Confirm the date', 'When was it signed?', 'work', 'L0000|attornment', '2026-10-04T09:00', ?)")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(insert, (2,))
        con.execute(insert, (1,))
        self.assertEqual(con.execute("SELECT session_proposed FROM tickets WHERE title = 'Confirm the date'").fetchone(), (1,))


class TestV51TreatmentNote(unittest.TestCase):
    """v51: authorities gains treatment_note, nullable text holding a note-up return's coverage line
    and qualifications verbatim. The treatment enum is unchanged. Additive: every existing row reads
    NULL, and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
          VALUES (1, 1, 'R v Bernard', '1992 CanLII 613', 'case');
    """
    COVERAGE = "CanLII: noted up (1992 CanLII 613: 43 citing decisions; 4 read, plus 1 seen through a later decision quoting it)"
    QUALIFICATION = "If the record classifies each proposition separately, step 3 alone would rate 'negative (partial)'."

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=50)[-1], (49, 50))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 51})["applied"], [{"from": 50, "to": 51}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_adds_the_column_last_and_every_existing_row_reads_null(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 51)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(authorities)")][-1], "treatment_note")
        self.assertEqual(con.execute("SELECT treatment, treatment_note FROM authorities WHERE id = 1").fetchone(), (None, None))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_qualified_return_reads_back_unchanged(self):
        con = self._hop()
        note = f"{self.COVERAGE}; {self.QUALIFICATION}"
        con.execute("UPDATE authorities SET treatment = 'good_law', treatment_note = ? WHERE id = 1", (note,))
        self.assertEqual(con.execute("SELECT treatment, treatment_note FROM authorities WHERE id = 1").fetchone(), ("good_law", note))


class TestV52TicketAnswers(unittest.TestCase):
    """v52: ticket_answers, one row per research answer saved for a job (ticket_id, file_path,
    saved_at), indexed on ticket_id. A revision-exempt job table: no triggers, so neither the hop nor
    a saved answer moves the revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at)
          VALUES (1, 1, 'Research the limitation point', 'When did time start to run?', 'wip', 'work', 'L0000|limitation', '2026-10-04T09:00', 'sess-a1', '2026-10-04T09:05');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=51)[-1], (50, 51))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 52})["applied"], [{"from": 51, "to": 52}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_creates_the_table_and_its_index_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 52)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(ticket_answers)")], ["id", "ticket_id", "file_path", "saved_at"])
        self.assertEqual([row[1] for row in con.execute("PRAGMA index_list(ticket_answers)")], ["idx_ticket_answers_ticket"])
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ticket_answers'").fetchone(), (0,))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_saved_answer_moves_no_revision_and_needs_a_real_job(self):
        con = self._hop()
        con.execute("INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Limitation\\2026-10-04 research-lawyer answer.md', '2026-10-04T10:12')")
        self.assertEqual(self._revision(con), self.revision, "a saved answer moves no revision")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (99, 'x.md', '2026-10-04T10:12')")


class TestV53ProvisionCurrency(unittest.TestCase):
    """v53: provision_currency records statute currency per cited provision, keyed by authority and
    the pinpoint as the statement of law records it, with checked_on, the consolidation's current_to
    date, and the newest amendment effective after it. 'current' is refused without current_to, and
    while that amendment is recorded and not checked. A rename of the authority deletes its rows.
    Additive: no existing row changes and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, currency_status, currency_checked_on)
          VALUES (1, 1, 'Supreme Court Civil Rules', 'BC Reg 168/2009', 'rule', 'current', '2026-10-01');
    """
    INSERT = ("INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, current_to, amended_on, amendment_checked_on) "
              "VALUES (1, ?, ?, '2026-10-04', ?, ?, ?)")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=52)[-1], (51, 52))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 53})["applied"], [{"from": 52, "to": 53}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _rows(self, con):
        return con.execute("SELECT provision, currency_status FROM provision_currency ORDER BY provision").fetchall()

    def test_hop_adds_the_table_and_changes_no_row(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 53)
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(provision_currency)")],
            ["id", "authority_id", "provision", "currency_status", "checked_on", "current_to", "amended_on", "amendment_checked_on"],
        )
        self.assertEqual(self._rows(con), [])
        self.assertEqual(con.execute("SELECT currency_status, currency_checked_on FROM authorities WHERE id = 1").fetchone(), ("current", "2026-10-01"))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_each_provision_of_one_instrument_holds_its_own_result(self):
        con = self._hop()
        con.execute(self.INSERT, ("Rule 8-1", "amendment-unchecked", "2026-09-01", "2026-09-15", None))
        for provision in ("Rule 9-6", "Rule 3-4", "Rule 14-1"):
            con.execute(self.INSERT, (provision, "current", "2026-09-01", None, None))
        self.assertEqual(
            self._rows(con),
            [("Rule 14-1", "current"), ("Rule 3-4", "current"), ("Rule 8-1", "amendment-unchecked"), ("Rule 9-6", "current")],
        )
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(self.INSERT, ("Rule 9-6", "current", "2026-09-01", None, None))

    def test_current_is_refused_while_the_newest_amendment_after_current_to_is_unchecked(self):
        con = self._hop()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(self.INSERT, ("Rule 8-1", "current", "2026-09-01", "2026-09-15", None))
        con.execute(self.INSERT, ("Rule 8-1", "amendment-unchecked", "2026-09-01", "2026-09-15", None))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE provision_currency SET currency_status = 'current' WHERE provision = 'Rule 8-1'")
        con.execute("UPDATE provision_currency SET currency_status = 'current', amendment_checked_on = '2026-10-04' WHERE provision = 'Rule 8-1'")
        self.assertEqual(self._rows(con), [("Rule 8-1", "current")])

    def test_current_is_refused_without_the_current_to_date(self):
        con = self._hop()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(self.INSERT, ("Rule 9-6", "current", None, None, None))

    def test_status_takes_only_the_closed_set(self):
        con = self._hop()
        for value in ("amendment-unchecked", "repealed", "not-found", "validation_unavailable"):
            with self.subTest(value=value):
                con.execute(self.INSERT, (f"Rule {value}", value, None, None, None))
        for value in ("archived", "in force", None):
            with self.subTest(value=value), self.assertRaises(sqlite3.IntegrityError):
                con.execute(self.INSERT, ("Rule 1-1", value, "2026-09-01", None, None))

    def test_every_write_moves_the_revision(self):
        con = self._hop()
        con.execute(self.INSERT, ("Rule 9-6", "current", "2026-09-01", None, None))
        after_insert = self._revision(con)
        self.assertEqual(after_insert, self.revision + 1)
        con.execute("UPDATE provision_currency SET checked_on = '2026-10-05'")
        self.assertEqual(self._revision(con), after_insert + 1)
        con.execute("DELETE FROM provision_currency")
        self.assertEqual(self._revision(con), after_insert + 2)

    def test_a_rename_deletes_the_authoritys_provision_results_and_a_same_value_write_keeps_them(self):
        con = self._hop()
        con.execute(self.INSERT, ("Rule 9-6", "current", "2026-09-01", None, None))
        con.execute("UPDATE authorities SET citation = 'BC Reg 168/2009' WHERE id = 1")
        self.assertEqual(self._rows(con), [("Rule 9-6", "current")])
        con.execute("UPDATE authorities SET style_of_cause_or_title = 'Supreme Court Family Rules' WHERE id = 1")
        self.assertEqual(self._rows(con), [])


class TestV54DeletedAt(unittest.TestCase):
    """v54: tickets gains deleted_at, nullable text, set when a job is deleted and cleared when it is
    restored. Additive: every existing row reads NULL, and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO tickets (id, proceeding_id, title, intent, kind, billing_anchor, created)
          VALUES (1, 1, 'Confirm the date of the contract', 'When was it signed?', 'work', 'L0000|contract', '2026-10-05T09:00');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=53)[-1], (52, 53))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 54})["applied"], [{"from": 53, "to": 54}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_adds_the_column_and_every_existing_row_reads_null(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 54)
        self.assertIn("deleted_at", [row[1] for row in con.execute("PRAGMA table_info(tickets)")])
        self.assertEqual(con.execute("SELECT deleted_at FROM tickets WHERE id = 1").fetchone(), (None,))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_queued_job_takes_a_deleted_stamp(self):
        con = self._hop()
        cur = con.execute("UPDATE tickets SET deleted_at = '2026-10-05T10:00' WHERE id = 1 AND status = 'queued'")
        self.assertEqual(cur.rowcount, 1)
        self.assertEqual(con.execute("SELECT deleted_at FROM tickets WHERE id = 1").fetchone(), ("2026-10-05T10:00",))


class TestV55PlanIsItsSteps(unittest.TestCase):
    """v55: a job's plan is its steps. tickets drops plan and the CHECK tying it to plan_approved_at,
    rebuilt create-copy-drop-rename, so every other column, both indexes and every row pointing at a
    job are kept, and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (7, 1, 'notice_of_application', 'N');
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created,
                             locked_by, locked_at, plan, plan_approved_at, session_proposed)
          VALUES (1, 1, 7, 'Rebuild the evidence index', 'Reconcile the exhibit list.', 'wip', 3, 'work', 'L0000|exhibits',
                  '2026-10-05T09:00', 'sess-a1', '2026-10-05T09:05', 'Audit the list; reconcile it.', '2026-10-05T09:06', 1);
        INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created, deleted_at)
          VALUES (2, 1, 7, 'Cite-check the index', 'Check every citation.', 'work', 'L0000|exhibits', '2026-10-05T09:10', '2026-10-05T09:30');
        INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Audit the list', '2026-10-05T09:20'), (1, 2, 'Reconcile it', NULL);
        INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (1, 'documents', 4);
        INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (1, 2);
        INSERT INTO ticket_conflicts (a_id, b_id) VALUES (1, 2);
        INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea, charted_into)
          VALUES (1, 1, 7, 1, '2026-10-05T09:25', 'noticed', 'Number the exhibits once.', 2);
        INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (1, 'not-recorded:documents:4', 'Exhibit 4');
        INSERT INTO review_points (id, filing_id, ticket_id, entity, entity_id, created, comment)
          VALUES (1, 7, 1, 'facts', 3, '2026-10-05T09:45', 'Which exhibit?');
        INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Exhibits\\answer.md', '2026-10-05T09:50');
    """
    KEPT = ("id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, "
            "plan_approved_at, created, completed_at, superseded_by, rejected_at, superseded_marker_gone_at, "
            "session_proposed, deleted_at")
    CHILDREN = (
        "SELECT ticket_id, ordinal, text, done_at FROM ticket_steps ORDER BY ticket_id, ordinal",
        "SELECT ticket_id, entity, entity_id FROM ticket_scope",
        "SELECT blocker_id, blocked_id FROM ticket_blocks",
        "SELECT a_id, b_id FROM ticket_conflicts",
        "SELECT origin_ticket_id, charted_into FROM seeds",
        "SELECT ticket_id, proposal_key, item FROM ticket_proposals",
        "SELECT ticket_id, comment FROM review_points",
        "SELECT ticket_id, file_path FROM ticket_answers",
    )

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=54)[-1], (53, 54))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        self.tickets = con.execute(f"SELECT {self.KEPT} FROM tickets ORDER BY id").fetchall()
        self.children = [con.execute(sql).fetchall() for sql in self.CHILDREN]
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 55})["applied"], [{"from": 54, "to": 55}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_drops_plan_and_keeps_every_other_column_and_every_row_pointing_at_a_job(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 55)
        columns = [row[1] for row in con.execute("PRAGMA table_info(tickets)")]
        self.assertNotIn("plan", columns)
        self.assertEqual(columns, self.KEPT.split(", "))
        self.assertEqual(con.execute(f"SELECT {self.KEPT} FROM tickets ORDER BY id").fetchall(), self.tickets)
        self.assertEqual(con.execute("SELECT plan_approved_at FROM tickets WHERE id = 1").fetchone(), ("2026-10-05T09:06",))
        self.assertEqual([con.execute(sql).fetchall() for sql in self.CHILDREN], self.children)
        self.assertEqual(sorted(row[1] for row in con.execute("PRAGMA index_list(tickets)")), ["idx_tickets_filing", "idx_tickets_proceeding"])
        self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")

    def test_an_approval_stamp_needs_no_plan_and_every_other_check_still_holds(self):
        con = self._hop()
        con.execute("UPDATE tickets SET plan_approved_at = '2026-10-05T10:00' WHERE id = 2")
        self.assertEqual(con.execute("SELECT plan_approved_at FROM tickets WHERE id = 2").fetchone(), ("2026-10-05T10:00",))
        for sql in ("UPDATE tickets SET session_proposed = 2 WHERE id = 2",
                    "UPDATE tickets SET locked_by = NULL WHERE id = 1",
                    "UPDATE tickets SET superseded_by = 2 WHERE id = 2",
                    "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (99, 1, 'No such job')"):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)


class TestV56ExhibitLetters(unittest.TestCase):
    """v56: documents gains exhibit_letters, nullable text, the sworn version's exhibit letters.
    Additive: every existing row reads NULL, and the hop moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO documents (id, proceeding_id, label, instrument, execution, affidavit_number)
          VALUES (1, 1, 'Affidavit #2 of A. Deponent', 'affidavit', '2026-08-12', '2');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=55)[-1], (54, 55))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 56})["applied"], [{"from": 55, "to": 56}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_adds_the_column_and_every_existing_row_reads_null(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 56)
        self.assertIn("exhibit_letters", [row[1] for row in con.execute("PRAGMA table_info(documents)")])
        self.assertEqual(con.execute("SELECT execution, exhibit_letters FROM documents WHERE id = 1").fetchone(), ("2026-08-12", None))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_sworn_affidavit_records_its_exhibit_letters(self):
        con = self._hop()
        con.execute("UPDATE documents SET exhibit_letters = 'A-J, L' WHERE id = 1")
        self.assertEqual(con.execute("SELECT exhibit_letters FROM documents WHERE id = 1").fetchone(), ("A-J, L",))


class TestV57ParagraphRevisions(unittest.TestCase):
    """v57: paragraph_revisions, one append-only audit row per on-the-fly revision decision on one of
    the six reviewed paragraph types, or on a filing_orders row's wording_override where the Writing
    prints its own wording for an order. Revision-exempt: no triggers, so neither the hop nor an
    audit row moves the revision. The choice fixes the origin, and 'current' writes no new text."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (12, 1, 'The invoice was delivered on April 2nd 2025.');
    """
    COLUMNS = ["id", "entity", "entity_id", "field", "old_text", "new_text", "proposed_text", "alternative_text",
               "review_flags", "choice", "origin", "session_token", "created"]
    INSERT = ("INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, "
              "review_flags, choice, origin, session_token, created) "
              "VALUES (?, 12, 'postulate', 'Old.', ?, 'Proposed.', 'Alternative.', NULL, ?, ?, 'sess-a1', '2026-10-05T10:00')")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=56)[-1], (55, 56))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 57})["applied"], [{"from": 56, "to": 57}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def test_hop_creates_the_table_with_no_trigger_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 57)
        self.assertEqual([row[1] for row in con.execute("PRAGMA table_info(paragraph_revisions)")], self.COLUMNS)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM paragraph_revisions").fetchone(), (0,))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'paragraph_revisions'").fetchone(), (0,))
        self.assertEqual(con.execute("SELECT postulate FROM facts WHERE id = 12").fetchone(), ("The invoice was delivered on April 2nd 2025.",))
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_an_audit_row_moves_no_revision_and_the_substance_update_beside_it_does(self):
        con = self._hop()
        con.execute(self.INSERT, ("facts", "Proposed.", "proposed", "practitioner"))
        self.assertEqual(self._revision(con), self.revision, "an audit row moves no revision")
        con.execute("UPDATE facts SET postulate = 'Proposed.' WHERE id = 12")
        self.assertEqual(self._revision(con), self.revision + 1)

    def test_every_valid_choice_and_origin_pairing_is_accepted(self):
        con = self._hop()
        for new_text, choice, origin in (("Old.", "current", "practitioner"), ("Proposed.", "proposed", "practitioner"),
                                         ("Alternative.", "alternative", "model"), ("Typed.", "other", "practitioner")):
            with self.subTest(choice=choice):
                con.execute(self.INSERT, ("facts", new_text, choice, origin))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM paragraph_revisions").fetchone(), (4,))

    def test_every_revisable_entity_is_accepted(self):
        con = self._hop()
        entities = ("facts", "statements_of_fact", "law_assertions", "statements_of_law", "submissions", "order_sought", "filing_orders")
        for entity in entities:
            with self.subTest(entity=entity):
                con.execute(self.INSERT, (entity, "Proposed.", "proposed", "practitioner"))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM paragraph_revisions").fetchone(), (len(entities),))

    def test_the_checks_refuse_bad_rows(self):
        con = self._hop()
        for label, row in (
            ("entity outside the six tables", ("clauses", "Proposed.", "proposed", "practitioner")),
            ("choice outside the closed set", ("facts", "Proposed.", "skip", "practitioner")),
            ("origin outside the closed set", ("facts", "Proposed.", "proposed", "session")),
            ("the alternative is not the practitioner's", ("facts", "Alternative.", "alternative", "practitioner")),
            ("only the alternative is the model's", ("facts", "Proposed.", "proposed", "model")),
            ("only the alternative is the model's (other)", ("facts", "Typed.", "other", "model")),
            ("current writes no new text", ("facts", "Changed.", "current", "practitioner")),
        ):
            with self.subTest(label), self.assertRaises(sqlite3.IntegrityError):
                con.execute(self.INSERT, row)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM paragraph_revisions").fetchone(), (0,))

    # A move: entity 'filing_facts', field 'ordinal', the ordinals as text, choice 'move', no wording.
    FULL_INSERT = ("INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, "
                   "review_flags, choice, origin, session_token, created) "
                   "VALUES (?, 31, ?, ?, ?, ?, ?, NULL, ?, 'practitioner', 'sess-a1', '2026-10-05T10:00')")
    MOVE = ("filing_facts", "ordinal", "3", "4", None, None, "move")

    def test_a_move_row_is_accepted(self):
        con = self._hop()
        con.execute(self.FULL_INSERT, self.MOVE)
        self.assertEqual(
            con.execute("SELECT entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice "
                        "FROM paragraph_revisions").fetchall(),
            [("filing_facts", 31, "ordinal", "3", "4", None, None, None, "move")],
        )
        self.assertEqual(self._revision(con), self.revision, "an audit row moves no revision")

    def test_the_move_checks_refuse_bad_rows(self):
        con = self._hop()
        for label, row in (
            ("filing_facts with a choice other than move", ("filing_facts", "ordinal", "3", "4", None, None, "other")),
            ("move on facts", ("facts", "postulate", "Old.", "New.", "Proposed.", "Alternative.", "move")),
            ("filing_facts with proposed_text set", ("filing_facts", "ordinal", "3", "4", "4", None, "move")),
            ("filing_facts with new_text equal to old_text", ("filing_facts", "ordinal", "3", "3", None, None, "move")),
            ("facts with NULL proposed_text", ("facts", "postulate", "Old.", "New.", None, "Alternative.", "other")),
        ):
            with self.subTest(label), self.assertRaises(sqlite3.IntegrityError):
                con.execute(self.FULL_INSERT, row)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM paragraph_revisions").fetchone(), (0,))


class TestV58PointerListFreeze(unittest.TestCase):
    """v58: v37's content freeze extended to filing_facts, filing_submissions and filing_orders.
    Once a Writing's filed_on or retired_on is set, its rows in the three tables refuse every
    insert, update and delete, an update checked against both the old and the new owning Writing.
    A drafting Writing's rows stay writable. Additive: no row changes and no revision moved."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'f1'), (2, 1, 'f2');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 's1', 1), (2, 1, 's2', 2);
        INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'o1'), (2, 1, 'o2');
        INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, filed_on, retired_on, retirement_reason) VALUES
            (1, 1, 'letter_to_opposing_counsel', 'drafting', 0, NULL, NULL, NULL),
            (2, 1, 'letter_to_opposing_counsel', 'sent', 0, '2026-09-27', NULL, NULL),
            (3, 1, 'letter_to_opposing_counsel', 'retired', 0, NULL, '2026-09-27', 'other');
        INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES
            (1, 1, 1, 'form', 'part2', 1), (2, 2, 1, 'form', 'part2', 1), (3, 3, 1, 'form', 'part2', 1);
        INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES
            (1, 1, 1, 'form', 1), (2, 2, 1, 'form', 1), (3, 3, 1, 'form', 1);
        INSERT INTO filing_orders (id, filing_id, order_sought_id, document, ordinal) VALUES
            (1, 1, 1, 'form', 1), (2, 2, 1, 'form', 1), (3, 3, 1, 'form', 1);
    """
    TABLES = ("filing_facts", "filing_submissions", "filing_orders")
    FREEZE = "sent or retired Writing"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=57)[-1], (56, 57))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.before = {t: con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall() for t in self.TABLES}
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 58})["applied"], [{"from": 57, "to": 58}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _writes(filing_id, row_id):
        """One insert, update and delete per table, all against the given Writing's rows."""
        return {
            "filing_facts": (
                f"INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES ({filing_id}, 2, 'form', 'part2', 2)",
                f"UPDATE filing_facts SET ordinal = 5 WHERE id = {row_id}",
                f"DELETE FROM filing_facts WHERE id = {row_id}",
            ),
            "filing_submissions": (
                f"INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES ({filing_id}, 2, 'form', 2)",
                f"UPDATE filing_submissions SET ordinal = 5 WHERE id = {row_id}",
                f"DELETE FROM filing_submissions WHERE id = {row_id}",
            ),
            "filing_orders": (
                f"INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES ({filing_id}, 2, 'form', 2)",
                f"UPDATE filing_orders SET wording_override = 'changed' WHERE id = {row_id}",
                f"DELETE FROM filing_orders WHERE id = {row_id}",
            ),
        }

    def test_hop_adds_the_nine_guards_and_changes_no_row(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 58)
        self.assertEqual(
            con.execute("SELECT tbl_name, name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'guard_%_frozen_%' "
                        "AND tbl_name IN ('filing_facts', 'filing_submissions', 'filing_orders') ORDER BY name").fetchall(),
            [(t, f"guard_{t}_frozen_{op}") for t in sorted(self.TABLES) for op in ("del", "ins", "upd")],
        )
        for t in self.TABLES:
            self.assertEqual(con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall(), self.before[t], t)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_sent_and_retired_writings_refuse_insert_update_and_delete(self):
        con = self._hop()
        for filing_id in (2, 3):
            for sqls in self._writes(filing_id, filing_id).values():
                for sql in sqls:
                    with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FREEZE):
                        con.execute(sql)
        for t in self.TABLES:
            self.assertEqual(con.execute(f"SELECT * FROM {t} ORDER BY id").fetchall(), self.before[t], t)

    def test_drafting_writing_accepts_insert_update_and_delete(self):
        con = self._hop()
        for sqls in self._writes(1, 1).values():
            for sql in sqls:
                with self.subTest(sql=sql):
                    self.assertEqual(con.execute(sql).rowcount, 1)

    def test_a_row_cannot_leave_or_join_a_frozen_writing(self):
        con = self._hop()
        for t in self.TABLES:
            for sql in (f"UPDATE {t} SET filing_id = 1 WHERE id = 2",  # off the sent Writing
                        f"UPDATE {t} SET filing_id = 3 WHERE id = 1"):  # onto the retired Writing
                with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, self.FREEZE):
                    con.execute(sql)

    def test_killing_a_submission_removes_it_from_drafting_writings_only(self):
        con = self._hop()
        con.executescript("""
            UPDATE submissions SET killed_on = '2026-10-05' WHERE id = 1;
            DELETE FROM filing_submissions WHERE submission_id = 1
               AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NULL AND retired_on IS NULL);
        """)
        self.assertEqual(con.execute("SELECT filing_id FROM filing_submissions WHERE submission_id = 1 ORDER BY filing_id").fetchall(), [(2,), (3,)])


class TestV59SubmissionFactsPlaced(unittest.TestCase):
    """v59: every fact a submission on a drafting Notice of Application or Application Response
    rests on is placed in the form's facts Part (part2 or part4), last, with a Written Arguments
    pointer row when the Writing has none for the fact. Two triggers place on attach and on deploy;
    the hop backfills; four guards keep a placed, attached fact in place and close the UPDATE routes
    around the triggers. BCCA kinds and sent or retired Writings are untouched."""

    # Writing 1 drafting NoA, 2 drafting Application Response, 3 sent NoA, 4 drafting BCCA factum.
    # Fact 3 is already placed on Writing 1 at ordinal 5. Submission 1 rests on facts 2 and 3,
    # submission 2 on facts 1 and 2, submission 3 on fact 4.
    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'f1'), (2, 1, 'f2'), (3, 1, 'f3'), (4, 1, 'f4'), (5, 1, 'f5');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 's1', 1), (2, 1, 's2', 2), (3, 1, 's3', 3);
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES
            (1, 1, 'notice_of_application', 'drafting NoA'),
            (2, 1, 'application_response', 'drafting response'),
            (3, 1, 'notice_of_application', 'sent NoA'),
            (4, 1, 'bcca_factum', 'factum');
        INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 3, 'form', 'part2', 5);
        INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 2), (1, 3), (2, 1), (2, 2), (3, 4);
        INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES
            (1, 1, 1, 'form', 1), (2, 1, 2, 'form', 2), (3, 2, 3, 'form', 1), (4, 3, 3, 'form', 1), (5, 4, 3, 'form', 1);
        UPDATE filings SET filed_on = '2026-10-01' WHERE id = 3;
    """
    TRIGGERS = ["guard_filing_facts_attached_del", "guard_filing_facts_attached_upd", "guard_filing_submissions_fixed_upd",
                "guard_submission_facts_upd", "place_facts_on_attach", "place_facts_on_deploy"]

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _seed_at_58(self, seed):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=58)[-1], (57, 58))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(seed)
        con.commit()
        self.revision = self._revision(con)
        con.close()

    def _connect(self):
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def _hop(self, seed=SEED):
        self._seed_at_58(seed)
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 59})["applied"], [{"from": 58, "to": 59}])
        return self._connect()

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _rows(con, filing_id):
        return con.execute("SELECT fact_id, document, part, ordinal FROM filing_facts WHERE filing_id = ? ORDER BY document, ordinal",
                           (filing_id,)).fetchall()

    def test_hop_adds_the_triggers_and_backfills_drafting_forms_only_moving_the_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 59)
        self.assertEqual(
            [r[0] for r in con.execute(f"SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ({','.join('?' * len(self.TRIGGERS))}) ORDER BY name",
                                       self.TRIGGERS)],
            sorted(self.TRIGGERS),
        )
        # Writing 1: facts 2 then 1 join the form after fact 3's ordinal 5, ordered by the first form
        # position of a submission resting on each (fact 2 under submission 1, fact 1 under 2). The
        # Written Arguments had none, so it gains 2, 3, 1 in that same order.
        self.assertEqual(self._rows(con, 1), [
            (3, "form", "part2", 5), (2, "form", "part2", 6), (1, "form", "part2", 7),
            (2, "written_argument", "part2", 1), (3, "written_argument", "part2", 2), (1, "written_argument", "part2", 3),
        ])
        self.assertEqual(self._rows(con, 2), [(4, "form", "part4", 1), (4, "written_argument", "part4", 1)])
        self.assertEqual(self._rows(con, 3), [], "a sent Writing is untouched")
        self.assertEqual(self._rows(con, 4), [], "a BCCA factum is untouched")
        self.assertEqual(self._revision(con), self.revision + 7, "each placed row moves the revision")
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_attaching_a_fact_places_it_last_on_every_drafting_form_carrying_the_submission(self):
        con = self._hop()
        con.execute("INSERT INTO submission_facts (submission_id, fact_id) VALUES (3, 5)")
        self.assertEqual(self._rows(con, 2), [(4, "form", "part4", 1), (5, "form", "part4", 2),
                                              (4, "written_argument", "part4", 1), (5, "written_argument", "part4", 2)])
        self.assertEqual(self._rows(con, 3), [], "the sent Writing gains nothing")
        self.assertEqual(self._rows(con, 4), [], "the BCCA factum gains nothing")

    def test_deploying_a_submission_places_its_facts(self):
        con = self._hop()
        con.execute("INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (2, 1, 'form', 2)")
        self.assertEqual(self._rows(con, 2), [(4, "form", "part4", 1), (2, "form", "part4", 2), (3, "form", "part4", 3),
                                              (4, "written_argument", "part4", 1), (2, "written_argument", "part4", 2), (3, "written_argument", "part4", 3)])
        # A Written Arguments deployment, or a BCCA factum's form, places nothing.
        con.execute("INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 3, 'written_argument', 1)")
        con.execute("INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (4, 1, 'form', 2)")
        self.assertNotIn(4, [r[0] for r in self._rows(con, 1)])
        self.assertEqual(self._rows(con, 4), [])

    def test_the_written_arguments_pointer_is_added_once(self):
        con = self._hop()
        before = self._rows(con, 1)
        # Fact 1 is already placed and pointed at; attaching it to a second deployed submission adds nothing.
        con.execute("INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1)")
        self.assertEqual(self._rows(con, 1), before)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM filing_facts WHERE filing_id = 1 AND fact_id = 1 AND document = 'written_argument'").fetchone(), (1,))

    def test_removing_an_attached_placed_fact_is_refused_naming_the_submission(self):
        con = self._hop()
        row = con.execute("SELECT id FROM filing_facts WHERE filing_id = 1 AND fact_id = 2 AND document = 'form'").fetchone()[0]
        for sql in (f"DELETE FROM filing_facts WHERE id = {row}",
                    f"UPDATE filing_facts SET fact_id = 5 WHERE id = {row}",
                    f"UPDATE filing_facts SET document = 'written_argument' WHERE id = {row}",
                    f"UPDATE filing_facts SET part = 'part4' WHERE id = {row}",
                    f"UPDATE filing_facts SET filing_id = 2 WHERE id = {row}"):
            with self.subTest(sql=sql), self.assertRaisesRegex(
                    sqlite3.IntegrityError, r"^fact 2 is attached to submission 1, 2 on Writing 1's form, .*drops it from the submission's argument in the Written Arguments"):
                con.execute(sql)
        self.assertIn((2, "form", "part2", 6), self._rows(con, 1))

    def test_ordinal_moves_and_unattached_or_written_argument_rows_stay_writable(self):
        con = self._hop()
        self.assertEqual(con.execute("UPDATE filing_facts SET ordinal = 9 WHERE filing_id = 1 AND fact_id = 2 AND document = 'form'").rowcount, 1)
        self.assertEqual(con.execute("DELETE FROM filing_facts WHERE filing_id = 1 AND fact_id = 2 AND document = 'written_argument'").rowcount, 1)
        # Detaching removes nothing from the facts Part, and the detached fact may then be removed.
        con.execute("DELETE FROM submission_facts WHERE fact_id = 2")
        self.assertIn((2, "form", "part2", 9), self._rows(con, 1))
        self.assertEqual(con.execute("DELETE FROM filing_facts WHERE filing_id = 1 AND fact_id = 2 AND document = 'form'").rowcount, 1)

    def test_the_update_routes_around_the_triggers_are_refused(self):
        con = self._hop()
        for sql, message in (
            ("UPDATE submission_facts SET fact_id = 5 WHERE submission_id = 3", r"^submission_facts row \(submission 3, fact 4\): an attachment does not change"),
            ("UPDATE filing_submissions SET document = 'written_argument' WHERE id = 1", r"^filing_submissions row 1: a submission's Writing and document do not change"),
            ("UPDATE filing_submissions SET filing_id = 2 WHERE id = 1", r"^filing_submissions row 1: "),
        ):
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.IntegrityError, message):
                con.execute(sql)
        self.assertEqual(con.execute("UPDATE filing_submissions SET ordinal = 7 WHERE id = 1").rowcount, 1)

    def test_a_later_placement_clears_a_recorded_pure_law_decision(self):
        con = self._hop()
        con.execute("UPDATE filings SET pure_law_on = '2026-10-06', pure_law_note = 'The Rules alone.' WHERE id = 2")
        con.execute("INSERT INTO submission_facts (submission_id, fact_id) VALUES (3, 5)")
        self.assertEqual(con.execute("SELECT pure_law_on, pure_law_note FROM filings WHERE id = 2").fetchone(), (None, None))

    def test_the_hop_refuses_when_the_backfill_would_clear_a_pure_law_decision(self):
        self._seed_at_58(self.SEED + "UPDATE filings SET pure_law_on = '2026-10-06', pure_law_note = 'The Rules alone.' WHERE id IN (1, 4);")
        with self.assertRaises(engine.MigrateError) as caught:
            engine.run({"db_path": str(self.db_path), "target_version": 59})
        self.assertEqual(caught.exception.code, "pure_law_would_clear")
        self.assertEqual(caught.exception.details["ids"], [1], "the BCCA factum's decision is no concern of the hop")
        self.assertIn("filings rows 1 (facts 1, 2)", caught.exception.message)
        self.assertEqual(schema_version(self.db_path), 58)
        con = self._connect()
        self.assertEqual(self._rows(con, 1), [(3, "form", "part2", 5)])
        self.assertEqual(self._revision(con), self.revision)


class TestV60NoLawNeeded(unittest.TestCase):
    """v60: counsel records that a contention needs no stated law, the law-side mirror of v48.
    submissions gains no_law_needed_on, no_law_needed_note and no_law_needed_contention, all three
    set or all three NULL by CHECK, and a second CHECK refuses a row carrying both this record and
    no_facts_needed_on. A trigger clears all three when the contention's wording moves off the
    wording decided on; a same-value write keeps the decision, and changing the wording back does
    not restore it."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO submissions (id, proceeding_id, contention, ordinal)
            VALUES (1, 1, 'The respondent signed the agreement.', 1), (2, 1, 'The notice was delivered on time.', 2);
    """
    DECIDE = (
        "UPDATE submissions SET no_law_needed_on = '2026-10-06', no_law_needed_note = ?, "
        "no_law_needed_contention = contention WHERE id = ?"
    )
    NOTE = "The point is one of fact; no test is in issue."

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=59)[-1], (58, 59))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 60})["applied"], [{"from": 59, "to": 60}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _decision(con, submission_id):
        return con.execute(
            "SELECT no_law_needed_on, no_law_needed_note, no_law_needed_contention FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

    def test_hop_adds_three_null_columns_and_the_reset_trigger_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 60)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            [row[1] for row in con.execute("PRAGMA table_info(submissions)")][-3:],
            ["no_law_needed_on", "no_law_needed_note", "no_law_needed_contention"],
        )
        self.assertEqual(
            con.execute("SELECT id, no_facts_needed_on, no_law_needed_on, no_law_needed_note, no_law_needed_contention FROM submissions ORDER BY id").fetchall(),
            [(1, None, None, None, None), (2, None, None, None, None)],
        )
        self.assertEqual(
            con.execute("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = 'reset_no_law_needed_on_contention_change'").fetchone(),
            ("submissions",),
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_partial_decision_is_refused_and_a_whole_one_admitted(self):
        con = self._hop()
        for sql in (
            "UPDATE submissions SET no_law_needed_on = '2026-10-06' WHERE id = 1",
            "UPDATE submissions SET no_law_needed_note = 'n' WHERE id = 1",
            "UPDATE submissions SET no_law_needed_contention = contention WHERE id = 1",
            "UPDATE submissions SET no_law_needed_on = '2026-10-06', no_law_needed_note = 'n' WHERE id = 1",
            "UPDATE submissions SET no_law_needed_note = 'n', no_law_needed_contention = contention WHERE id = 1",
            "INSERT INTO submissions (id, proceeding_id, contention, ordinal, no_law_needed_on, no_law_needed_note) VALUES (3, 1, 'c', 3, '2026-10-06', 'n')",
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                con.execute(sql)
        self.assertEqual(self._decision(con, 1), (None, None, None))
        con.execute(self.DECIDE, (self.NOTE, 1))
        self.assertEqual(self._decision(con, 1), ("2026-10-06", self.NOTE, "The respondent signed the agreement."))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE submissions SET no_law_needed_note = NULL WHERE id = 1")
        con.execute("UPDATE submissions SET no_law_needed_on = NULL, no_law_needed_note = NULL, no_law_needed_contention = NULL WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))

    def test_a_decision_dated_other_than_yyyy_mm_dd_is_refused(self):
        con = self._hop()
        for bad in ("2026-10-06T09:00", "today"):
            with self.subTest(date=bad), self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "UPDATE submissions SET no_law_needed_on = ?, no_law_needed_note = ?, no_law_needed_contention = contention WHERE id = 1",
                    (bad, self.NOTE),
                )
        self.assertEqual(self._decision(con, 1), (None, None, None))

    def test_both_records_on_one_row_are_refused_either_way_round(self):
        con = self._hop()
        decide_facts = ("UPDATE submissions SET no_facts_needed_on = '2026-10-06', no_facts_needed_note = 'Law alone.', "
                        "no_facts_needed_contention = contention WHERE id = ?")
        con.execute(self.DECIDE, (self.NOTE, 1))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(decide_facts, (1,))
        con.execute(decide_facts, (2,))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(self.DECIDE, (self.NOTE, 2))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(
                "INSERT INTO submissions (id, proceeding_id, contention, ordinal, no_facts_needed_on, no_facts_needed_note, no_facts_needed_contention, "
                "no_law_needed_on, no_law_needed_note, no_law_needed_contention) VALUES (3, 1, 'c', 3, '2026-10-06', 'n', 'c', '2026-10-06', 'n', 'c')"
            )
        self.assertEqual(self._decision(con, 1), ("2026-10-06", self.NOTE, "The respondent signed the agreement."))
        self.assertEqual(con.execute("SELECT no_facts_needed_on FROM submissions WHERE id = 1").fetchone(), (None,))
        self.assertEqual(self._decision(con, 2), (None, None, None))
        self.assertEqual(con.execute("SELECT no_facts_needed_on FROM submissions WHERE id = 2").fetchone(), ("2026-10-06",))

    def test_a_contention_reword_clears_the_decision_and_moves_the_revision_twice(self):
        con = self._hop()
        con.execute(self.DECIDE, (self.NOTE, 1))
        con.execute(self.DECIDE, ("Delivery is shown by the courier's record.", 2))
        revision = self._revision(con)
        con.execute("UPDATE submissions SET contention = 'The respondent signed the agreement on 1 May.' WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))
        self.assertEqual(self._revision(con), revision + 2, "the write and the reset each move the revision")
        self.assertEqual(self._decision(con, 2), ("2026-10-06", "Delivery is shown by the courier's record.", "The notice was delivered on time."), "only the reworded row clears")

    def test_the_decision_write_and_a_same_value_write_keep_the_decision(self):
        con = self._hop()
        revision = self._revision(con)
        con.execute(self.DECIDE, (self.NOTE, 1))
        self.assertEqual(self._revision(con), revision + 1, "the decision write fires no reset")
        con.execute("UPDATE submissions SET contention = contention WHERE id = 1")
        con.execute("UPDATE submissions SET contention = 'The respondent signed the agreement.', ordinal = 5 WHERE id = 1")
        self.assertEqual(self._decision(con, 1), ("2026-10-06", self.NOTE, "The respondent signed the agreement."))

    def test_changing_the_wording_back_does_not_restore_the_decision(self):
        con = self._hop()
        con.execute(self.DECIDE, (self.NOTE, 1))
        con.execute("UPDATE submissions SET contention = 'A reworded contention.' WHERE id = 1")
        con.execute("UPDATE submissions SET contention = 'The respondent signed the agreement.' WHERE id = 1")
        self.assertEqual(self._decision(con, 1), (None, None, None))


class TestV61AuthorityFit(unittest.TestCase):
    """v61: cheap checks of an authority's fit. statements_of_law gains excerpt_speaker and
    verified_on, provision_currency gains in_force_on, and two triggers refuse a new move into
    'verified' with no pinpoint. A row verified with no pinpoint before the hop stays valid and
    takes every other edit; clearing a verified row's pinpoint still reopens it to 'lead'."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
            VALUES (1, 1, 'Older Case v. Example', '2011 BCCA 1', 'case'),
                   (2, 1, 'Example Act', 'SBC 2020, c 1', 'statute');
        INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'p1');
        INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification,
                                       scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt)
            VALUES (1, 1, 1, 1, NULL, 'e1', 'verified', 1, NULL, 'e1'),
                   (2, 1, 1, 1, 'para 2', 'e2', 'verified', 1, 'para 2', 'e2'),
                   (3, 1, 1, 2, NULL, NULL, 'lead', NULL, NULL, NULL);
        INSERT INTO provision_currency (id, authority_id, provision, currency_status, checked_on)
            VALUES (1, 2, 's 3', 'not-found', '2026-10-01');
    """
    REFUSAL = "a verified statement of law needs a pinpoint"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=60)[-1], (59, 60))
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 61})["applied"], [{"from": 60, "to": 61}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        con.execute("PRAGMA foreign_keys = ON")
        return con

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    @staticmethod
    def _state(con, statement_id):
        return con.execute("SELECT verification, pinpoint FROM statements_of_law WHERE id = ?", (statement_id,)).fetchone()

    def test_hop_adds_three_null_columns_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 61)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual([r[1] for r in con.execute("PRAGMA table_info(statements_of_law)")][-2:], ["excerpt_speaker", "verified_on"])
        self.assertEqual([r[1] for r in con.execute("PRAGMA table_info(provision_currency)")][-1], "in_force_on")
        self.assertEqual(con.execute("SELECT excerpt_speaker, verified_on FROM statements_of_law WHERE id = 1").fetchone(), (None, None))
        self.assertEqual(con.execute("SELECT in_force_on FROM provision_currency WHERE id = 1").fetchone(), (None,))

    def test_inserting_a_verified_statement_with_no_pinpoint_is_refused(self):
        con = self._hop()
        for pinpoint in (None, "", "  "):
            with self.assertRaisesRegex(sqlite3.IntegrityError, self.REFUSAL):
                con.execute(
                    "INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, pinpoint, verification) "
                    "VALUES (1, 1, 1, ?, 'verified')", (pinpoint,))
        con.execute(
            "INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, pinpoint, verification) "
            "VALUES (1, 1, 1, 'para 9', 'verified')")
        con.execute("INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, verification) VALUES (1, 1, 1, 'lead')")

    def test_moving_a_lead_with_no_pinpoint_into_verified_is_refused(self):
        con = self._hop()
        with self.assertRaisesRegex(sqlite3.IntegrityError, self.REFUSAL):
            con.execute("UPDATE statements_of_law SET verification = 'verified', verified_on = '2026-10-06' WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("lead", None))
        con.execute("UPDATE statements_of_law SET pinpoint = 's 3' WHERE id = 3")
        con.execute(
            "UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, "
            "scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt, verified_on = '2026-10-06' WHERE id = 3")
        self.assertEqual(self._state(con, 3), ("verified", "s 3"))

    def test_a_row_verified_with_no_pinpoint_before_the_hop_stays_and_takes_other_edits(self):
        con = self._hop()
        self.assertEqual(self._state(con, 1), ("verified", None))
        con.execute("UPDATE statements_of_law SET doubt = 'a note' WHERE id = 1")
        con.execute("UPDATE statements_of_law SET verification = 'verified', excerpt_speaker = 'Another court' WHERE id = 1")
        self.assertEqual(self._state(con, 1), ("verified", None))

    def test_clearing_a_verified_rows_pinpoint_still_reopens_it(self):
        con = self._hop()
        con.execute("UPDATE statements_of_law SET pinpoint = NULL WHERE id = 2")
        self.assertEqual(self._state(con, 2), ("lead", None))

    def test_the_date_columns_take_only_a_date(self):
        con = self._hop()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE provision_currency SET in_force_on = '2020' WHERE id = 1")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE statements_of_law SET verified_on = 'today' WHERE id = 2")
        con.execute("UPDATE provision_currency SET in_force_on = '2020-07-01' WHERE id = 1")
        con.execute("UPDATE statements_of_law SET verified_on = '2026-10-06' WHERE id = 2")


class TestV68SeedDeferral(unittest.TestCase):
    """v68: the Loose Threads page's Defer button. seeds gains deferred_at, NULL on every existing
    row; seeds is job process state, so the hop adds no revision trigger and moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea)
            VALUES (1, 1, '2026-10-08T09:00', 'noticed', 'An idea.');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=67)[-1], (66, 67))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 68})["applied"], [{"from": 67, "to": 68}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_hop_adds_a_null_column_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 68)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual([r[1] for r in con.execute("PRAGMA table_info(seeds)")][-1], "deferred_at")
        self.assertEqual(con.execute("SELECT deferred_at FROM seeds WHERE id = 1").fetchone(), (None,))

    def test_seeds_still_carry_no_revision_trigger(self):
        con = self._hop()
        triggers = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'seeds' AND name LIKE 'rev\\_%' ESCAPE '\\'")]
        self.assertEqual(triggers, [])
        con.execute("UPDATE seeds SET deferred_at = '2026-10-08T10:00' WHERE id = 1")
        con.commit()
        self.assertEqual(self._revision(con), self.revision, "deferring moves no revision")


class TestV75SeedDiscardAndSuggest(unittest.TestCase):
    """v75: a loose thread leaves the board without being deleted. seeds gains discarded_at and
    suggested_at, NULL on every existing row; the hop adds no revision trigger and moves no revision."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, rank, rank_group, rank_job, rank_reason, deferred_at)
            VALUES (1, 1, '2026-10-08T09:00', 'noticed', 'An idea.', NULL, NULL, NULL, NULL, NULL),
                   (2, 1, '2026-10-08T09:01', 'noticed', 'A ranked, deferred idea.', 1, 'tooling', 'Fix it.', 'Blocks the rest.', '2026-10-09T10:00');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=74)[-1], (73, 74))
        con = sqlite3.connect(str(self.db_path))
        self.assertNotIn("discarded_at", [r[1] for r in con.execute("PRAGMA table_info(seeds)")])
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 75})["applied"], [{"from": 74, "to": 75}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_hop_adds_two_null_columns_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 75)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual([r[1] for r in con.execute("PRAGMA table_info(seeds)")][-2:], ["discarded_at", "suggested_at"])
        self.assertEqual(
            con.execute("SELECT id, discarded_at, suggested_at FROM seeds ORDER BY id").fetchall(),
            [(1, None, None), (2, None, None)],
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_hop_keeps_each_thread_as_it_was(self):
        con = self._hop()
        self.assertEqual(
            con.execute("SELECT id, idea, rank, rank_group, rank_job, rank_reason, deferred_at FROM seeds ORDER BY id").fetchall(),
            [
                (1, "An idea.", None, None, None, None, None),
                (2, "A ranked, deferred idea.", 1, "tooling", "Fix it.", "Blocks the rest.", "2026-10-09T10:00"),
            ],
        )

    def test_discarding_and_suggesting_move_no_revision(self):
        con = self._hop()
        triggers = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'seeds' AND name LIKE 'rev\\_%' ESCAPE '\\'")]
        self.assertEqual(triggers, [])
        con.execute("UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 1")
        con.execute("UPDATE seeds SET suggested_at = '2026-10-13T10:01' WHERE id = 2")
        con.commit()
        self.assertEqual(self._revision(con), self.revision, "neither write moves a revision")

    def test_a_fresh_database_holds_both_columns(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        columns = [r[1] for r in con.execute("PRAGMA table_info(seeds)")]
        self.assertIn("discarded_at", columns)
        self.assertIn("suggested_at", columns)


class TestV77FactProceduralOn(unittest.TestCase):
    """v77: the Provable Facts page splits into Procedural History and Material Facts (ADR 0011).
    facts gains procedural_on, a date that makes a fact procedural; every existing fact reads NULL,
    so it lands on Material Facts, and the pre-migration copy-aside is written."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The contract was signed.'), (2, 1, 'The claim was served.');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=76)[-1], (75, 76))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 77})["applied"], [{"from": 76, "to": 77}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_every_existing_fact_lands_on_material_facts_and_no_revision_moves(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 77)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            con.execute("SELECT id, postulate, procedural_on FROM facts ORDER BY id").fetchall(),
            [(1, "The contract was signed.", None), (2, "The claim was served.", None)],
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_the_copy_aside_holds_the_pre_migration_facts(self):
        self._hop()
        backups = backups_of(self.db_path)
        self.assertEqual(len(backups), 1)
        self.assertEqual(schema_version(backups[0]), 76)
        con = sqlite3.connect(str(backups[0]))
        self.addCleanup(con.close)
        self.assertNotIn("procedural_on", [r[1] for r in con.execute("PRAGMA table_info(facts)")])
        self.assertEqual(con.execute("SELECT id FROM facts ORDER BY id").fetchall(), [(1,), (2,)])

    def test_a_procedural_fact_takes_a_date_and_moving_it_moves_the_revision(self):
        con = self._hop()
        con.execute("UPDATE facts SET procedural_on = '2026-03-04' WHERE id = 2")
        con.commit()
        self.assertGreater(self._revision(con), self.revision, "moving a fact between the pages re-renders them")
        self.assertEqual(con.execute("SELECT procedural_on FROM facts WHERE id = 2").fetchone(), ("2026-03-04",))
        for bad in ("March 4, 2026", "2026-3-4", ""):
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE facts SET procedural_on = ? WHERE id = 1", (bad,))

    def test_a_fresh_database_holds_the_column(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertIn("procedural_on", [r[1] for r in con.execute("PRAGMA table_info(facts)")])


class TestV78StepStatus(unittest.TestCase):
    """v78: a job step can be to be retried, cancelled, deferred or waiting (Brahm, 2026-10-21).
    ticket_steps gains status, wait_until and status_note, all NULL on every existing step, so every
    stamp keeps its meaning and no revision moves."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at)
            VALUES (1, 1, 'Research it', 'Find the test.', 'wip', 'work', 'L0000|x', '2026-10-21T09:00', 'sess-a1', '2026-10-21T09:01');
        INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Search the pool', '2026-10-21T09:10'), (1, 2, 'Run the Westlaw query', NULL);
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=77)[-1], (76, 77))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 78})["applied"], [{"from": 77, "to": 78}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_every_existing_step_keeps_its_stamp_and_reads_null_in_the_new_columns(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 78)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            con.execute("SELECT ordinal, text, done_at, status, wait_until, status_note FROM ticket_steps ORDER BY ordinal").fetchall(),
            [(1, "Search the pool", "2026-10-21T09:10", None, None, None), (2, "Run the Westlaw query", None, None, None, None)],
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_the_checks_hold_the_status_and_the_wake_minute(self):
        con = self._hop()
        con.execute("UPDATE ticket_steps SET status = 'waiting', wait_until = '2026-10-21T09:15' WHERE ticket_id = 1 AND ordinal = 2")
        con.commit()
        self.assertEqual(self._revision(con), self.revision, "a step status is job process state")
        for status in ("retry", "cancelled", "deferred"):
            con.execute("UPDATE ticket_steps SET status = ? WHERE ticket_id = 1 AND ordinal = 2", (status,))
        for bad in ("done", "open", ""):
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE ticket_steps SET status = ? WHERE ticket_id = 1 AND ordinal = 2", (bad,))
        for bad in ("2026-10-21 09:15", "09:15", "2026-10-21"):
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE ticket_steps SET wait_until = ? WHERE ticket_id = 1 AND ordinal = 2", (bad,))

    def test_the_copy_aside_holds_the_pre_migration_steps(self):
        self._hop()
        backups = backups_of(self.db_path)
        self.assertEqual(len(backups), 1)
        self.assertEqual(schema_version(backups[0]), 77)
        con = sqlite3.connect(str(backups[0]))
        self.addCleanup(con.close)
        self.assertNotIn("status", [r[1] for r in con.execute("PRAGMA table_info(ticket_steps)")])

    def test_a_fresh_database_holds_the_columns(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        columns = [r[1] for r in con.execute("PRAGMA table_info(ticket_steps)")]
        for column in ("status", "wait_until", "status_note"):
            self.assertIn(column, columns)


class TestV79HearingDatePosition(unittest.TestCase):
    """v79: Form 33 as substituted by B.C. Reg. 105/2026 states whether the respondent agrees with the
    applicant's proposed hearing date (Rule 8-1(10)(b)(iv)). hearing_details gains
    hearing_date_position, NULL on every existing row, and no revision moves."""

    SEED = """
        INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
        INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'application_response', 'Application Response');
        INSERT INTO hearing_details (filing_id, time_estimate_minutes, proposed_hearing) VALUES (1, 90, 'March 3, 2027');
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=78)[-1], (77, 78))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(self.SEED)
        con.commit()
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 79})["applied"], [{"from": 78, "to": 79}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_an_existing_row_reads_null_and_no_revision_moves(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 79)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            con.execute("SELECT time_estimate_minutes, proposed_hearing, hearing_date_position FROM hearing_details").fetchall(),
            [(90, "March 3, 2027", None)],
        )
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_the_check_holds_the_three_positions(self):
        con = self._hop()
        for position in ("agree", "propose_other", "none_proposed", None):
            con.execute("UPDATE hearing_details SET hearing_date_position = ? WHERE filing_id = 1", (position,))
        for bad in ("agreed", "disagree", ""):
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE hearing_details SET hearing_date_position = ? WHERE filing_id = 1", (bad,))

    def test_a_fresh_database_holds_the_column(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertIn("hearing_date_position", [r[1] for r in con.execute("PRAGMA table_info(hearing_details)")])


class TestV80KvStore(unittest.TestCase):
    """v80: one generic kv_store table (Brahm's ruling of 2026-10-29). The hop adds the table with no
    revision trigger, writes no row and moves no revision."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    @staticmethod
    def _revision(con):
        return int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=79)[-1], (78, 79))
        con = sqlite3.connect(str(self.db_path))
        self.revision = self._revision(con)
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 80})["applied"], [{"from": 79, "to": 80}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def test_hop_adds_the_empty_table_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 80)
        self.assertEqual(self._revision(con), self.revision, "the hop moves no revision")
        self.assertEqual(
            [(r[1], r[2], r[3], r[5]) for r in con.execute("PRAGMA table_info(kv_store)")],
            [("namespace", "TEXT", 1, 1), ("key", "TEXT", 1, 2), ("value", "TEXT", 1, 0), ("updated_at", "TEXT", 1, 0)],
        )
        self.assertEqual(con.execute("SELECT COUNT(*) FROM kv_store").fetchone(), (0,))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'kv_store'").fetchone(), (0,))
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_a_value_write_moves_no_revision_and_the_key_is_unique(self):
        con = self._hop()
        con.execute("INSERT INTO kv_store VALUES ('job_state', 'tickets:1', '{\"a\": 1}', '2026-10-29T10:00')")
        con.commit()
        self.assertEqual(self._revision(con), self.revision, "a kv_store value is job or process state")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO kv_store VALUES ('job_state', 'tickets:1', '{}', '2026-10-29T10:01')")

    def test_a_fresh_database_holds_the_table(self):
        engine.run({"db_path": str(self.db_path)})
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'kv_store'").fetchone(), (1,))


class TestV81OpposingFiling(unittest.TestCase):
    """v81: board_attachments.kind gains 'opposing_filing' (Brahm, 2026-10-29), a rebuild. Rows keep
    their ids, the guards survive the rebuild, and the table stays revision-exempt."""

    OLD_ROWS = [
        (1, 1, 1, "0. DRAFT\\2026-10-08 ET Client re costs.md", "client_letter", "2026-10-08"),
        (2, 1, 1, "0. DRAFT\\2026-10-08 ET Smith re hearing.md", "reply", "2026-10-08"),
        (3, 2, None, "0. DRAFT\\2026-10-09 ET Client re plan.md", "client_letter", "2026-10-09"),
    ]
    OPPOSING = [
        "COURT FILE\\2026-10-20 RESP1 Application Response FILED.pdf",
        "COURT FILE\\2026-10-21 RESP2 Application Response FILED.pdf",
        "COURT FILE\\2026-10-20 AFF1 SmithJ AFFIRMED FILED.pdf",
        "COURT FILE\\2026-10-20 AFF2 JonesK AFFIRMED FILED.pdf",
        "COURT FILE\\2026-10-21 AFF3 LeeM AFFIRMED FILED.pdf",
    ]

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"

    def _hop(self):
        self.assertEqual(engine.migrate(str(self.db_path), target_version=80)[-1], (79, 80))
        con = sqlite3.connect(str(self.db_path))
        con.executescript(
            """
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0001', NULL);
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
            """
        )
        con.executemany("INSERT INTO board_attachments VALUES (?, ?, ?, ?, ?, ?)", self.OLD_ROWS)
        con.commit()
        self.revision = int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])
        con.close()
        self.assertEqual(engine.run({"db_path": str(self.db_path), "target_version": 81})["applied"], [{"from": 80, "to": 81}])
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        return con

    def _opposing_rows(self, con):
        for n, path in enumerate(self.OPPOSING, start=10):
            con.execute("INSERT INTO board_attachments VALUES (?, 1, 1, ?, 'opposing_filing', '2026-10-29')", (n, path))
        con.commit()

    def test_hop_keeps_every_row_and_moves_no_revision(self):
        con = self._hop()
        self.assertEqual(schema_version(self.db_path), 81)
        self.assertEqual(con.execute("SELECT * FROM board_attachments ORDER BY id").fetchall(), self.OLD_ROWS)
        self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), self.revision)
        self.assertEqual(con.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_one_row_for_each_of_five_opposing_documents_moves_no_revision(self):
        con = self._hop()
        self._opposing_rows(con)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM board_attachments WHERE kind = 'opposing_filing'").fetchone(), (5,))
        self.assertEqual(int(con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]), self.revision)

    def test_other_kinds_are_still_refused_and_a_path_stays_unique(self):
        con = self._hop()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO board_attachments VALUES (20, 1, 1, 'x.md', 'memo', '2026-10-29')")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO board_attachments VALUES (21, 1, 1, ?, 'opposing_filing', '2026-10-29')", (self.OLD_ROWS[0][3],))

    def test_the_guards_survive_for_the_new_kind(self):
        con = self._hop()
        con.execute("INSERT INTO filings (id, proceeding_id, kind, title, retired_on) VALUES (2, 1, 'notice_of_application', 'Old', '2026-10-01')")
        with self.assertRaises(sqlite3.IntegrityError):  # a retired Writing has no board
            con.execute("INSERT INTO board_attachments VALUES (20, 1, 2, 'a.pdf', 'opposing_filing', '2026-10-29')")
        with self.assertRaises(sqlite3.IntegrityError):  # a Writing of another proceeding
            con.execute("INSERT INTO board_attachments VALUES (21, 2, 1, 'b.pdf', 'opposing_filing', '2026-10-29')")
        with self.assertRaises(sqlite3.IntegrityError):  # a proceeding with a Writing has no board of its own
            con.execute("INSERT INTO board_attachments VALUES (22, 1, NULL, 'c.pdf', 'opposing_filing', '2026-10-29')")
        with self.assertRaises(sqlite3.IntegrityError):  # a Writing holding an attachment is not retired
            con.execute("UPDATE filings SET retired_on = '2026-10-29' WHERE id = 1")

    def test_a_fresh_database_holds_the_kind(self):
        engine.run({"db_path": str(self.db_path)})
        self.assertEqual(schema_version(self.db_path), 81)
        con = sqlite3.connect(str(self.db_path))
        self.addCleanup(con.close)
        self.assertIn("'opposing_filing'", con.execute("SELECT sql FROM sqlite_master WHERE name = 'board_attachments'").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
