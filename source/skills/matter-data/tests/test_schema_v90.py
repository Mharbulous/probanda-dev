import importlib.util
import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))
spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

dump_spec = importlib.util.spec_from_file_location(
    "case_data_dump", SCRIPTS_DIR / "dump.py"
)
dump = importlib.util.module_from_spec(dump_spec)
dump_spec.loader.exec_module(dump)


MIGRATIONS_PATH = CASE_DATA_ROOT / "references" / "migrations.sql"
QUERIES_PATH = CASE_DATA_ROOT / "references" / "queries.sql"


def migration_snippet(frm, to, db):
    """Return the body of one `-- MIGRATE <frm> -> <to> -- DB: <db>` snippet."""
    import re

    text = MIGRATIONS_PATH.read_text(encoding="utf-8")
    pat = re.compile(
        r"^-- MIGRATE\s+(\d+)\s*->\s*(\d+)\s*-- DB:\s*(main|law|privileged)\s*$",
        re.M,
    )
    marks = list(pat.finditer(text))
    for i, m in enumerate(marks):
        if (int(m.group(1)), int(m.group(2)), m.group(3)) == (frm, to, db):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            return text[m.end() : end]
    raise AssertionError(f"no MIGRATE {frm} -> {to} -- DB: {db} snippet")


V89_PARTY_COLUMNS = ("lawyer_email", "lawyer_phone")
V89_OVERRIDE_COLUMNS = (
    "lawyer_name", "lawyer_firm", "lawyer_email", "lawyer_phone",
    "address", "service_address_filed_date",
)


def drop_v89_columns(con):
    """Un-upgrade a canonical main to its pre-v8.9 parties shape, so the
    88 -> 89 ALTERs genuinely fire instead of colliding on a duplicate column."""
    for column in V89_PARTY_COLUMNS:
        con.execute(f"ALTER TABLE parties DROP COLUMN {column}")
    for column in V89_OVERRIDE_COLUMNS:
        con.execute(f"ALTER TABLE proceeding_parties DROP COLUMN {column}")


def named_query(marker):
    text = QUERIES_PATH.read_text(encoding="utf-8")
    start = text.index(f"-- @{marker}")
    select = text.index("SELECT", start)
    return text[select : text.index(";", select) + 1]


class SchemaV90Tests(unittest.TestCase):
    def test_reverification_columns_default_and_enforce_cross_column_state(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(sections["main"])
            connection.executescript(
                """
                INSERT INTO parties (party_id, name, party_type)
                VALUES (1, 'Client', 'individual');
                INSERT INTO facts (fact_id, description)
                VALUES (2, 'Corrected fact');
                INSERT INTO positions
                    (position_id, fact_id, party_id, position)
                VALUES (3, 2, 1, 'claim');
                """
            )
            self.assertEqual(
                connection.execute(
                    "SELECT pending_reverification FROM facts WHERE fact_id = 2"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT pending_reverification FROM positions WHERE position_id = 3"
                ).fetchone()[0],
                0,
            )

            for table, id_column, row_id in (
                ("facts", "fact_id", 2),
                ("positions", "position_id", 3),
            ):
                connection.execute(
                    f"UPDATE {table} SET pending_reverification = 1 "
                    f"WHERE {id_column} = ?",
                    (row_id,),
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        f"UPDATE {table} SET verified = 1 WHERE {id_column} = ?",
                        (row_id,),
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        f"UPDATE {table} SET human_reviewed = 1 WHERE {id_column} = ?",
                        (row_id,),
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        f"UPDATE {table} SET verified = NULL WHERE {id_column} = ?",
                        (row_id,),
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        f"UPDATE {table} SET human_reviewed = NULL "
                        f"WHERE {id_column} = ?",
                        (row_id,),
                    )
                connection.execute(
                    f"UPDATE {table} SET verified = 1, human_reviewed = 1, "
                    f"pending_reverification = 0 WHERE {id_column} = ?",
                    (row_id,),
                )

            self.assertEqual(
                connection.execute(
                    "SELECT verified, human_reviewed, pending_reverification "
                    "FROM facts WHERE fact_id = 2"
                ).fetchone(),
                (1, 1, 0),
            )
        finally:
            connection.close()

    def test_79_to_80_migration_preserves_rows_and_backfills_zero(self):
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(
                """
                CREATE TABLE facts (
                    fact_id INTEGER PRIMARY KEY,
                    description TEXT NOT NULL,
                    verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
                    human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
                );
                CREATE TABLE positions (
                    position_id INTEGER PRIMARY KEY,
                    verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
                    human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
                );
                CREATE TABLE parties (
                    party_id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    lawyer_name TEXT,
                    lawyer_firm TEXT,
                    address TEXT,
                    contact_info TEXT
                );
                INSERT INTO facts VALUES (1, 'grandfathered verified fact', 1, 0);
                INSERT INTO positions VALUES (2, 0, 0);
                PRAGMA user_version = 79;
                """
            )
            connection.executescript(migration_snippet(79, 80, "main"))
            connection.executescript(migration_snippet(80, 81, "main"))
            connection.executescript(migration_snippet(81, 82, "main"))
            connection.execute("PRAGMA user_version = 82")

            self.assertEqual(
                connection.execute(
                    "SELECT fact_id, verified, human_reviewed, pending_reverification "
                    "FROM facts"
                ).fetchall(),
                [(1, 1, 0, 0)],
            )
            self.assertEqual(
                connection.execute(
                    "SELECT position_id, verified, human_reviewed, pending_reverification "
                    "FROM positions"
                ).fetchall(),
                [(2, 0, 0, 0)],
            )
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 82)
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "UPDATE facts SET pending_reverification = 1 WHERE verified = 1"
                )
        finally:
            connection.close()

    def test_80_to_81_migration_adds_admissions_matching_canonical_schema(self):
        """The hop is purely additive and lands the canonical admissions shape.

        A drift between the migration snippet and schema.sql is the silent kind
        (`references/schema-bump.md`): a migrated matter and a freshly
        initialized one would disagree on a table nothing re-derives.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))

        fresh = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            fresh.executescript(sections["main"])

            # Reconstruct a v8.0 main by stripping the additive table.
            v80 = re.sub(
                r"-- -+\n-- Admissions.*?\n\);\n", "", sections["main"], flags=re.S
            )
            v80 = re.sub(r"CREATE INDEX idx_admissions_\w+.*?;\n", "", v80)
            migrated.executescript(v80)
            self.assertNotIn(
                "admissions",
                {
                    row[0]
                    for row in migrated.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                },
            )

            snippet = migration_snippet(80, 81, "main")
            migrated.executescript(snippet)
            migrated.executescript(snippet)  # re-runnable, per schema-bump.md

            def shape(connection):
                columns = [
                    (row[1], row[2], row[3], row[5])
                    for row in connection.execute("PRAGMA table_info(admissions)")
                ]
                indexes = sorted(
                    row[1] for row in connection.execute("PRAGMA index_list(admissions)")
                )
                return columns, indexes

            self.assertEqual(shape(migrated), shape(fresh))

            # Row counts are unchanged by an additive hop.
            self.assertEqual(
                migrated.execute("SELECT count(*) FROM admissions").fetchone()[0], 0
            )
        finally:
            fresh.close()
            migrated.close()

    def test_migration_81_to_82_adds_parties_service_provenance_columns(self):
        """The hop is purely additive and lands the canonical parties shape.

        Drift between the snippet and schema.sql is the silent kind
        (`references/schema-bump.md`): a migrated matter and a freshly
        initialized one would disagree on columns nothing re-derives.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            # A v8.1 main is the canonical main minus the two new columns,
            # and minus the v8.9 counsel contact columns, which the 88 -> 89
            # hop then re-adds after them in canonical order.
            migrated.executescript(sections["main"])
            migrated.execute("ALTER TABLE parties DROP COLUMN service_address_filed_date")
            migrated.execute("ALTER TABLE parties DROP COLUMN replaced_representative")
            drop_v89_columns(migrated)

            migrated.executescript(migration_snippet(81, 82, "main"))
            migrated.executescript(migration_snippet(88, 89, "main"))

            def columns(connection):
                return [
                    (row[1], row[2], row[3])  # name, declared type, NOT NULL
                    for row in connection.execute("PRAGMA table_info(parties)").fetchall()
                ]

            self.assertIn(("service_address_filed_date", "TEXT", 0), columns(migrated))
            self.assertIn(("replaced_representative", "TEXT", 0), columns(migrated))
            self.assertEqual(columns(canonical), columns(migrated))

            # Both stay nullable: NULL is the honest backfill for an existing row.
            migrated.execute(
                "INSERT INTO parties (party_id, name, party_type) "
                "VALUES (1, 'Legacy party', 'individual')"
            )
            self.assertEqual(
                migrated.execute(
                    "SELECT service_address_filed_date, replaced_representative "
                    "FROM parties WHERE party_id = 1"
                ).fetchone(),
                (None, None),
            )
        finally:
            canonical.close()
            migrated.close()

    def test_deemed_admissions_require_an_instrument_and_effective_date(self):
        """A deemed admission with no traceable instrument fails closed.

        Mirrors the sworn route's document binding: a deemed kind arises from a
        served instrument plus a non-event, so both the instrument and the date
        its response period expired are mandatory.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(sections["main"])
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("INSERT INTO parties(party_id, name) VALUES (1, 'X')")
            connection.execute("INSERT INTO facts(fact_id, description) VALUES (1, 'f')")

            def insert(kind, effective_date, source_id):
                connection.execute(
                    "INSERT INTO admissions(fact_id, admitting_party_id, "
                    "admission_kind, deemed_effective_date, source_id) "
                    "VALUES (1, 1, ?, ?, ?)",
                    (kind, effective_date, source_id),
                )

            # Express kinds need neither field.
            insert("express_pleading", None, None)

            for kind in ("deemed_default", "deemed_rule_7_7"):
                with self.assertRaises(sqlite3.IntegrityError):
                    insert(kind, None, None)
                with self.assertRaises(sqlite3.IntegrityError):
                    insert(kind, None, 1)
                with self.assertRaises(sqlite3.IntegrityError):
                    insert(kind, "2026-05-12", None)
                insert(kind, "2026-05-12", 1)

            with self.assertRaises(sqlite3.IntegrityError):
                insert("deemed_something_else", "2026-05-12", 1)
        finally:
            connection.close()

    def test_witness_query_returns_fact_and_expert_assignments(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(sections["main"])
            connection.executescript(
                """
                INSERT INTO proceedings
                    (proceeding_id, court, file_number)
                VALUES (1, 'BCSC', 'S-1');
                INSERT INTO parties
                    (party_id, name, party_type)
                VALUES (2, 'Client', 'individual');
                INSERT INTO sources
                    (source_id, category, title)
                VALUES (3, 'court', 'Expert report');
                INSERT INTO witnesses
                    (witness_id, name, witness_type)
                VALUES (4, 'Fact Witness', 'fact');
                INSERT INTO witnesses
                    (witness_id, name, witness_type, field_of_expertise,
                     retained_by_party_id, report_source_id, qualified)
                VALUES (5, 'Expert Witness', 'expert', 'Engineering', 2, 3, 1);
                INSERT INTO proceeding_witnesses VALUES (1, 4, NULL);
                INSERT INTO proceeding_witnesses VALUES (1, 5, 2);
                """
            )
            rows = connection.execute(
                named_query("query_23_witnesses_by_proceeding"),
                (1,),
            ).fetchall()
            self.assertEqual(
                rows,
                [
                    (
                        4, "Fact Witness", "fact", None, None,
                        None, None, None, None, None,
                    ),
                    (
                        5, "Expert Witness", "expert", "Engineering", 1,
                        2, "Client", 2, "Client", 3,
                    ),
                ],
            )
        finally:
            connection.close()

    def test_client_instruction_query_returns_only_current_requested_status(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            paths = {
                database: Path(tmp) / f"{database}.sqlite"
                for database in ("main", "privileged")
            }
            for database, path in paths.items():
                connection = sqlite3.connect(path)
                try:
                    connection.executescript(sections[database])
                finally:
                    connection.close()

            connection = sqlite3.connect(paths["main"])
            try:
                connection.execute(
                    "ATTACH DATABASE ? AS privileged",
                    (str(paths["privileged"]),),
                )
                connection.executescript(
                    """
                    INSERT INTO proceedings
                        (proceeding_id, court, file_number)
                    VALUES (1, 'BCSC', 'S-1');
                    INSERT INTO parties
                        (party_id, name, party_type)
                    VALUES (2, 'Client', 'individual');
                    INSERT INTO privileged.privileged_sources
                        (source_id, category, title)
                    VALUES (3, 'solicitor_client', 'Instruction memo');
                    INSERT INTO privileged.client_instructions
                        (instruction_id, proceeding_id, party_id, instructed_by,
                         date, description, source_id, source_locator, status,
                         valid_from)
                    VALUES (4, 1, 2, 'Client', '2026-08-08',
                            'Proceed with the application.', 3, 'p1', 'open',
                            '2026-08-08');
                    UPDATE privileged.client_instructions
                    SET valid_to = '2026-08-09', status = 'superseded'
                    WHERE instruction_id = 4;
                    INSERT INTO privileged.client_instructions
                        (instruction_id, proceeding_id, party_id, instructed_by,
                         date, description, source_id, source_locator, status,
                         valid_from, prior_id, verified)
                    VALUES (5, 1, 2, 'Client', '2026-08-09',
                            'Proceed with the application.', 3, 'p2', 'actioned',
                            '2026-08-09', 4, 1);
                    INSERT INTO privileged.client_instructions
                        (instruction_id, proceeding_id, party_id, instructed_by,
                         date, description, source_id, source_locator, status,
                         valid_from)
                    VALUES (6, NULL, 2, 'Client', '2026-09-13',
                            'Advise on limitation.', 3, 'p3', 'open',
                            '2026-09-13');
                    """
                )

                self.assertEqual(
                    connection.execute(
                        named_query("query_24_client_instructions_status"),
                        (1, "actioned"),
                    ).fetchall(),
                    [
                        (
                            5, 1, 2, "Client", "Client", "2026-08-09",
                            "Proceed with the application.", 3,
                            "Instruction memo", "p2", "actioned",
                            "2026-08-09", 4, 1, None,
                        )
                    ],
                )
                self.assertEqual(
                    connection.execute(
                        named_query("query_24_client_instructions_status"),
                        (1, "open"),
                    ).fetchall(),
                    [],
                )
                # A NULL proceeding_id selects the no-proceeding (advice)
                # instructions, and only those (v8.6).
                self.assertEqual(
                    [
                        row[0]
                        for row in connection.execute(
                            named_query("query_24_client_instructions_status"),
                            (None, "open"),
                        ).fetchall()
                    ],
                    [6],
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT status, valid_to FROM "
                        "privileged.client_instructions "
                        "WHERE instruction_id = 4"
                    ).fetchone(),
                    ("superseded", "2026-08-09"),
                )
            finally:
                connection.close()
    def test_canonical_schema_models_witnesses_and_privileged_client_instructions(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        main = sqlite3.connect(":memory:")
        privileged = sqlite3.connect(":memory:")
        try:
            main.executescript(sections["main"])
            privileged.executescript(sections["privileged"])

            main.executescript(
                """
                INSERT INTO proceedings
                    (proceeding_id, court, file_number)
                VALUES (1, 'BCSC', 'S-1');
                INSERT INTO parties
                    (party_id, name, party_type)
                VALUES (2, 'Client', 'individual');
                INSERT INTO sources
                    (source_id, category, title)
                VALUES (3, 'court', 'Expert report');
                INSERT INTO witnesses
                    (witness_id, name, witness_type, field_of_expertise,
                     retained_by_party_id, report_source_id, qualified)
                VALUES (4, 'Dr. Example', 'expert', 'Engineering', 2, 3, 1);
                INSERT INTO proceeding_witnesses
                    (proceeding_id, witness_id, called_by_party_id)
                VALUES (1, 4, 2);
                """
            )
            self.assertEqual(
                main.execute(
                    "SELECT w.name, w.witness_type, w.field_of_expertise, "
                    "pw.called_by_party_id FROM witnesses w "
                    "JOIN proceeding_witnesses pw USING (witness_id)"
                ).fetchone(),
                ("Dr. Example", "expert", "Engineering", 2),
            )
            with self.assertRaises(sqlite3.IntegrityError):
                main.execute(
                    "INSERT INTO witnesses "
                    "(witness_id, name, witness_type, field_of_expertise) "
                    "VALUES (5, 'Fact witness', 'fact', 'Engineering')"
                )

            privileged.execute(
                "INSERT INTO privileged_sources "
                "(source_id, category, title) "
                "VALUES (7, 'solicitor_client', 'Instruction memo')"
            )
            privileged.execute(
                "INSERT INTO client_instructions "
                "(instruction_id, proceeding_id, party_id, instructed_by, date, "
                " description, source_id, source_locator, status, verified) "
                "VALUES (8, 1, 2, 'Client', '2026-08-08', "
                "'Do not consent to adjournment.', 7, 'p1', 'open', 0)"
            )
            self.assertEqual(
                privileged.execute(
                    "SELECT description, status, valid_to, prior_id "
                    "FROM client_instructions"
                ).fetchone(),
                ("Do not consent to adjournment.", "open", None, None),
            )
        finally:
            main.close()
            privileged.close()

    def test_migration_77_to_78_is_idempotent_and_matches_canonical_tables(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for database, new_tables in {
            "main": ("proceeding_witnesses", "witnesses"),
            "privileged": ("client_instructions",),
        }.items():
            with self.subTest(database=database):
                canonical = sqlite3.connect(":memory:")
                migrated = sqlite3.connect(":memory:")
                try:
                    canonical.executescript(sections[database])
                    migrated.executescript(sections[database])
                    for table in new_tables:
                        migrated.execute(f"DROP TABLE {table}")

                    snippet = migration_snippet(77, 78, database)
                    migrated.executescript(snippet)
                    migrated.executescript(snippet)
                    if database == "privileged":
                        # v8.6 relaxed proceeding_id; the canonical shape is
                        # reached only through that later hop.
                        migrated.executescript(migration_snippet(85, 86, database))

                    for table in new_tables:
                        canonical_columns = canonical.execute(
                            f"PRAGMA table_info({table})"
                        ).fetchall()
                        migrated_columns = migrated.execute(
                            f"PRAGMA table_info({table})"
                        ).fetchall()
                        self.assertEqual(canonical_columns, migrated_columns)
                finally:
                    canonical.close()
                    migrated.close()

    def test_client_instruction_cross_database_references_fail_closed(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        triggers = (CASE_DATA_ROOT / "references" / "triggers.sql").read_text(
            encoding="utf-8"
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = {
                database: Path(tmp) / f"{database}.sqlite"
                for database in ("main", "law", "privileged")
            }
            for database, path in paths.items():
                connection = sqlite3.connect(path)
                try:
                    connection.executescript(sections[database])
                finally:
                    connection.close()

            connection = sqlite3.connect(paths["main"])
            try:
                connection.execute("ATTACH DATABASE ? AS law", (str(paths["law"]),))
                connection.execute(
                    "ATTACH DATABASE ? AS privileged", (str(paths["privileged"]),)
                )
                connection.executescript(triggers)
                connection.executescript(
                    """
                    INSERT INTO proceedings
                        (proceeding_id, court, file_number)
                    VALUES (1, 'BCSC', 'S-1');
                    INSERT INTO parties
                        (party_id, name, party_type)
                    VALUES (2, 'Client', 'individual');
                    INSERT INTO privileged.privileged_sources
                        (source_id, category, title)
                    VALUES (3, 'solicitor_client', 'Instruction memo');
                    INSERT INTO privileged.client_instructions
                        (instruction_id, proceeding_id, party_id, instructed_by,
                         date, description, source_id)
                    VALUES (4, 1, 2, 'Client', '2026-08-08',
                            'Proceed with the application.', 3);
                    """
                )

                for instruction_id, (column, bad_value) in enumerate(
                    (("proceeding_id", 999), ("party_id", 999)),
                    start=5,
                ):
                    with self.subTest(column=column), self.assertRaisesRegex(
                        sqlite3.IntegrityError, "FK violation"
                    ):
                        values = {
                            "proceeding_id": 1,
                            "party_id": 2,
                        }
                        values[column] = bad_value
                        connection.execute(
                            "INSERT INTO privileged.client_instructions "
                            "(instruction_id, proceeding_id, party_id, instructed_by, "
                            " date, description) VALUES (?, ?, ?, 'Client', "
                            " '2026-08-08', 'Invalid reference')",
                            (instruction_id, values["proceeding_id"], values["party_id"]),
                        )

                with self.assertRaisesRegex(sqlite3.IntegrityError, "client_instructions"):
                    connection.execute("DELETE FROM proceedings WHERE proceeding_id = 1")
                with self.assertRaisesRegex(sqlite3.IntegrityError, "client_instructions"):
                    connection.execute("DELETE FROM parties WHERE party_id = 2")
            finally:
                connection.close()

    def test_client_instruction_needs_a_party_but_not_a_proceeding(self):
        """Advice work has no proceeding, and privilege attaches without one.

        The proceeding FK trigger's `WHEN NEW.proceeding_id IS NOT NULL` guard
        is live (v8.6), so a NULL passes the trigger layer; the party is still
        required at the column and still trigger-checked.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        triggers = (CASE_DATA_ROOT / "references" / "triggers.sql").read_text(
            encoding="utf-8"
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = {
                database: Path(tmp) / f"{database}.sqlite"
                for database in ("main", "law", "privileged")
            }
            for database, path in paths.items():
                connection = sqlite3.connect(path)
                try:
                    connection.executescript(sections[database])
                finally:
                    connection.close()

            connection = sqlite3.connect(paths["main"])
            try:
                connection.execute("ATTACH DATABASE ? AS law", (str(paths["law"]),))
                connection.execute(
                    "ATTACH DATABASE ? AS privileged", (str(paths["privileged"]),)
                )
                connection.executescript(triggers)
                connection.execute(
                    "INSERT INTO parties (party_id, name, party_type) "
                    "VALUES (2, 'Client', 'individual')"
                )
                connection.execute(
                    "INSERT INTO privileged.client_instructions "
                    "(instruction_id, proceeding_id, party_id, instructed_by, "
                    " date, description) VALUES (1, NULL, 2, 'Client', "
                    " '2026-09-13', 'Advise on limitation before any claim.')"
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT proceeding_id, party_id "
                        "FROM privileged.client_instructions"
                    ).fetchall(),
                    [(None, 2)],
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO privileged.client_instructions "
                        "(instruction_id, proceeding_id, party_id, instructed_by, "
                        " date, description) VALUES (2, NULL, NULL, 'Client', "
                        " '2026-09-13', 'No instructing party.')"
                    )
            finally:
                connection.close()

    def test_migration_85_to_86_relaxes_proceeding_id_and_preserves_rows(self):
        """A pre-v8.6 privileged database keeps every row and lands on the
        canonical shape: proceeding_id nullable, party_id still NOT NULL."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["privileged"])
            migrated.executescript(sections["privileged"])
            # A v8.5 client_instructions is exactly the NOT NULL shape the
            # 77 -> 78 hop created, indexes included.
            migrated.execute("DROP TABLE client_instructions")
            migrated.executescript(migration_snippet(77, 78, "privileged"))
            self.assertEqual(
                [
                    row[3]
                    for row in migrated.execute(
                        "PRAGMA table_info(client_instructions)"
                    )
                    if row[1] == "proceeding_id"
                ],
                [1],
            )
            migrated.executescript(
                """
                INSERT INTO privileged_sources (source_id, category, title)
                VALUES (3, 'solicitor_client', 'Instruction memo');
                INSERT INTO client_instructions
                    (instruction_id, proceeding_id, party_id, instructed_by, date,
                     description, source_id, source_locator, status, valid_from,
                     valid_to, notes, verified)
                VALUES (4, 1, 2, 'Client', '2026-08-01', 'Settle at 50k.', 3,
                        'p1', 'superseded', '2026-08-01', '2026-08-09', 'old', 1);
                INSERT INTO client_instructions
                    (instruction_id, proceeding_id, party_id, instructed_by, date,
                     description, source_id, source_locator, status, valid_from,
                     prior_id, verified)
                VALUES (5, 1, 2, 'Client', '2026-08-09', 'Settle at 40k.', 3,
                        'p2', 'open', '2026-08-09', 4, 0);
                """
            )
            migrated.commit()
            before = migrated.execute(
                "SELECT * FROM client_instructions ORDER BY instruction_id"
            ).fetchall()

            # Engine conditions: _apply_marker turns foreign_keys ON first.
            migrated.execute("PRAGMA foreign_keys = ON")
            migrated.executescript(migration_snippet(85, 86, "privileged"))

            self.assertEqual(
                migrated.execute(
                    "SELECT * FROM client_instructions ORDER BY instruction_id"
                ).fetchall(),
                before,
            )

            def shape(connection):
                columns = connection.execute(
                    "PRAGMA table_info(client_instructions)"
                ).fetchall()
                foreign_keys = connection.execute(
                    "PRAGMA foreign_key_list(client_instructions)"
                ).fetchall()
                indexes = {
                    row[1]: [
                        info[2]
                        for info in connection.execute(f"PRAGMA index_info({row[1]})")
                    ]
                    for row in connection.execute(
                        "PRAGMA index_list(client_instructions)"
                    )
                }
                return columns, sorted(foreign_keys), indexes

            self.assertEqual(shape(migrated), shape(canonical))
            self.assertEqual(
                migrated.execute("PRAGMA foreign_key_check").fetchall(), []
            )

            migrated.execute(
                "INSERT INTO client_instructions "
                "(instruction_id, proceeding_id, party_id, instructed_by, date, "
                " description) VALUES (6, NULL, 2, 'Client', '2026-09-13', 'Advice.')"
            )
            with self.assertRaises(sqlite3.IntegrityError):
                migrated.execute(
                    "INSERT INTO client_instructions "
                    "(instruction_id, proceeding_id, party_id, instructed_by, date, "
                    " description) VALUES (7, 1, NULL, 'Client', '2026-09-13', 'x')"
                )
        finally:
            canonical.close()
            migrated.close()
    def test_rebuild_modes_fail_closed_on_wrong_dump_generation(self):
        self.assertEqual(
            rebuild.require_source_version(
                "-- Case Data evidence dump — schema v7.4\n", migrate=True
            ),
            74,
        )
        self.assertEqual(
            rebuild.require_source_version(
                "-- Case Data evidence dump — schema v7.5\n", migrate=True
            ),
            75,
        )
        self.assertEqual(
            rebuild.require_source_version(
                "-- Case Data evidence dump — schema v9.0\n", migrate=False
            ),
            90,
        )
        with self.assertRaisesRegex(SystemExit, "requires v7.4 or v7.5"):
            rebuild.require_source_version(
                "-- Case Data evidence dump — schema v7.3\n", migrate=True
            )
        with self.assertRaisesRegex(SystemExit, "requires v9.0"):
            rebuild.require_source_version(
                "-- Case Data evidence dump — schema v8.9\n", migrate=False
            )

    def test_canonical_schema_accepts_only_current_counterclaim_role(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.execute(
                "INSERT INTO proceedings "
                "(proceeding_id, court, file_number) VALUES (1, 'BCSC', 'S-1')"
            )
            con.execute(
                "INSERT INTO parties (party_id, name, party_type) "
                "VALUES (1, 'Counterclaim-only party', 'individual')"
            )
            con.execute(
                "INSERT INTO proceeding_parties "
                "(proceeding_id, party_id, role) "
                "VALUES (1, 1, 'defendant_by_counterclaim')"
            )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK constraint failed"):
                con.execute(
                    "INSERT INTO proceeding_parties "
                    "(proceeding_id, party_id, role) "
                    "VALUES (1, 1, 'plaintiff_by_counterclaim')"
                )
        finally:
            con.close()

    def test_canonical_schema_accepts_appellant_role(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.execute(
                "INSERT INTO proceedings "
                "(proceeding_id, court, file_number) VALUES (1, 'BCCA', 'CA52140')"
            )
            con.execute(
                "INSERT INTO parties (party_id, name, party_type) "
                "VALUES (1, 'Tidewater Outfitters Inc.', 'corporation')"
            )
            con.execute(
                "INSERT INTO proceeding_parties "
                "(proceeding_id, party_id, role) "
                "VALUES (1, 1, 'appellant')"
            )
            self.assertEqual(
                con.execute(
                    "SELECT role FROM proceeding_parties WHERE party_id = 1"
                ).fetchone(),
                ("appellant",),
            )
        finally:
            con.close()

    def test_migration_82_to_83_adds_appellant_and_preserves_rows(self):
        """The hop is a table rebuild, not an ALTER, so row preservation is

        the thing worth pinning: unlike the ADD-COLUMN hops, a rebuild that
        drops a role value by accident would fail silently at INSERT time on
        some later matter, not at migration time.
        """
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
            canonical.executescript(sections["main"])

            # A v8.2 main is the canonical main minus 'appellant'.
            v82_main = sections["main"].replace(
                "'petitioner','appellant',\n                        "
                "'defendant_by_counterclaim'))",
                "'petitioner',\n                        "
                "'defendant_by_counterclaim'))",
                1,
            )
            migrated.executescript(v82_main)
            drop_v89_columns(migrated)
            migrated.executescript(
                """
                INSERT INTO proceedings
                    (proceeding_id, court, file_number)
                VALUES (1, 'BCSC', 'S-1');
                INSERT INTO parties (party_id, name, party_type) VALUES
                    (1, 'Plaintiff Co.', 'corporation'),
                    (2, 'Defendant Co.', 'corporation'),
                    (3, 'Appellant Co.', 'corporation');
                INSERT INTO proceeding_parties (proceeding_id, party_id, role)
                VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant');
                """
            )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                migrated.execute(
                    "INSERT INTO proceeding_parties "
                    "(proceeding_id, party_id, role) VALUES (1, 3, 'appellant')"
                )

            migrated.executescript(migration_snippet(82, 83, "main"))
            # The rebuild copies the three v8.3 columns; the v8.9 override
            # columns arrive with their own hop.
            migrated.executescript(migration_snippet(88, 89, "main"))

            self.assertEqual(
                migrated.execute(
                    "SELECT proceeding_id, party_id, role "
                    "FROM proceeding_parties ORDER BY party_id"
                ).fetchall(),
                [(1, 1, "plaintiff"), (1, 2, "defendant")],
            )
            migrated.execute(
                "INSERT INTO proceeding_parties "
                "(proceeding_id, party_id, role) VALUES (1, 3, 'appellant')"
            )
            self.assertEqual(
                migrated.execute(
                    "SELECT role FROM proceeding_parties WHERE party_id = 3"
                ).fetchone(),
                ("appellant",),
            )

            def columns(connection):
                return [
                    (row[1], row[2], row[3])  # name, declared type, NOT NULL
                    for row in connection.execute(
                        "PRAGMA table_info(proceeding_parties)"
                    ).fetchall()
                ]

            self.assertEqual(columns(canonical), columns(migrated))
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                migrated.execute(
                    "INSERT INTO proceeding_parties "
                    "(proceeding_id, party_id, role) VALUES (1, 3, 'not_a_role')"
                )
        finally:
            canonical.close()
            migrated.close()

    def test_83_to_84_migration_adds_sought_orders_matching_canonical_schema(self):
        """The hop is purely additive and lands the canonical sought_orders shape.

        A drift between the migration snippet and schema.sql is the silent kind
        (`references/schema-bump.md`): a migrated matter and a freshly
        initialized one would disagree on a table nothing re-derives.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))

        fresh = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            fresh.executescript(sections["main"])

            # Reconstruct a v8.3 main by stripping the additive table.
            v83 = re.sub(
                r"-- -+\n-- Sought orders.*?\n\);\n", "", sections["main"], flags=re.S
            )
            migrated.executescript(v83)
            self.assertNotIn(
                "sought_orders",
                {
                    row[0]
                    for row in migrated.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                },
            )

            snippet = migration_snippet(83, 84, "main")
            migrated.executescript(snippet)
            migrated.executescript(snippet)  # re-runnable, per schema-bump.md

            def shape(connection):
                columns = [
                    (row[1], row[2], row[3], row[5])
                    for row in connection.execute("PRAGMA table_info(sought_orders)")
                ]
                indexes = sorted(
                    row[1] for row in connection.execute("PRAGMA index_list(sought_orders)")
                )
                return columns, indexes

            self.assertEqual(shape(migrated), shape(fresh))

            # Row counts are unchanged by an additive hop.
            self.assertEqual(
                migrated.execute("SELECT count(*) FROM sought_orders").fetchone()[0], 0
            )

            # UNIQUE(source_id, order_number) survives the migration, not just
            # the columns.
            migrated.executescript(
                """
                INSERT INTO sources (source_id, category, title)
                VALUES (1, 'court', 'Notice of Application');
                INSERT INTO sought_orders (source_id, order_number, order_text)
                VALUES (1, '1', 'An order that the respondent produce documents.');
                """
            )
            with self.assertRaises(sqlite3.IntegrityError):
                migrated.execute(
                    "INSERT INTO sought_orders (source_id, order_number, order_text) "
                    "VALUES (1, '1', 'A duplicate paragraph number.')"
                )
        finally:
            fresh.close()
            migrated.close()

    def test_fact_status_distinguishes_all_v76_postures(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        queries = (CASE_DATA_ROOT / "references" / "queries.sql").read_text(
            encoding="utf-8"
        )
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(rebuild.views_from_queries(queries))
            con.executescript(
                """
                INSERT INTO parties (party_id, name, party_type) VALUES
                    (1, 'Claimant', 'individual'),
                    (2, 'Respondent', 'corporation');
                INSERT INTO facts (fact_id, description) VALUES
                    (1, 'Disputed'), (2, 'Admitted'),
                    (3, 'Not admitted'), (4, 'No position'),
                    (5, 'Claimed'), (6, 'Unaddressed');
                INSERT INTO positions (fact_id, party_id, position) VALUES
                    (1, 1, 'claim'), (1, 2, 'deny'),
                    (2, 1, 'claim'), (2, 2, 'admit'),
                    (3, 1, 'claim'), (3, 2, 'not_admit'),
                    (4, 1, 'claim'), (4, 2, 'no_position'),
                    (5, 1, 'claim');
                """
            )
            self.assertEqual(
                con.execute(
                    "SELECT fact_id, posture FROM v_fact_status ORDER BY fact_id"
                ).fetchall(),
                [
                    (1, "disputed"),
                    (2, "admitted"),
                    (3, "not_admitted"),
                    (4, "no_position"),
                    (5, "claimed"),
                    (6, "unaddressed"),
                ],
            )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                con.execute(
                    "INSERT INTO positions (fact_id, party_id, position) "
                    "VALUES (6, 2, 'silent')"
                )
        finally:
            con.close()

    def test_rebuild_upgrade_rejects_deprecated_role_with_exact_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            main_path = Path(tmp) / "main.sqlite"
            con = sqlite3.connect(main_path)
            try:
                con.executescript(
                    """
                    CREATE TABLE proceeding_parties (
                        proceeding_id INTEGER NOT NULL,
                        party_id INTEGER NOT NULL,
                        role TEXT NOT NULL CHECK(role IN (
                            'plaintiff','defendant','third_party','intervenor',
                            'applicant','respondent','petitioner',
                            'plaintiff_by_counterclaim','defendant_by_counterclaim')),
                        PRIMARY KEY (proceeding_id, party_id, role)
                    );
                    INSERT INTO proceeding_parties
                        (proceeding_id, party_id, role)
                    VALUES (7, 11, 'plaintiff_by_counterclaim');
                    """
                )
            finally:
                con.close()

            with self.assertRaisesRegex(
                SystemExit,
                r"proceeding_id=7, party_id=11, role=plaintiff_by_counterclaim",
            ):
                rebuild.upgrade_74_to_75({"main": str(main_path)})

    def test_rebuild_upgrade_preserves_clean_rows_and_removes_deprecated_check_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            main_path = Path(tmp) / "main.sqlite"
            con = sqlite3.connect(main_path)
            try:
                con.executescript(
                    """
                    CREATE TABLE proceeding_parties (
                        proceeding_id INTEGER NOT NULL,
                        party_id INTEGER NOT NULL,
                        role TEXT NOT NULL CHECK(role IN (
                            'plaintiff','defendant','third_party','intervenor',
                            'applicant','respondent','petitioner',
                            'plaintiff_by_counterclaim','defendant_by_counterclaim')),
                        PRIMARY KEY (proceeding_id, party_id, role)
                    );
                    CREATE INDEX idx_proceeding_parties_party
                        ON proceeding_parties(party_id);
                    INSERT INTO proceeding_parties
                        (proceeding_id, party_id, role)
                    VALUES
                        (7, 11, 'plaintiff'),
                        (7, 12, 'defendant'),
                        (7, 13, 'defendant_by_counterclaim');
                    """
                )
            finally:
                con.close()

            self.assertTrue(rebuild.upgrade_74_to_75({"main": str(main_path)}))

            con = sqlite3.connect(main_path)
            try:
                rows = con.execute(
                    "SELECT proceeding_id, party_id, role "
                    "FROM proceeding_parties ORDER BY party_id"
                ).fetchall()
                self.assertEqual(
                    rows,
                    [
                        (7, 11, "plaintiff"),
                        (7, 12, "defendant"),
                        (7, 13, "defendant_by_counterclaim"),
                    ],
                )
                ddl = con.execute(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type='table' AND name='proceeding_parties'"
                ).fetchone()[0]
                self.assertNotIn("plaintiff_by_counterclaim", ddl)
                with self.assertRaisesRegex(
                    sqlite3.IntegrityError, "CHECK constraint failed"
                ):
                    con.execute(
                        "INSERT INTO proceeding_parties "
                        "(proceeding_id, party_id, role) "
                        "VALUES (7, 14, 'plaintiff_by_counterclaim')"
                    )
            finally:
                con.close()

    def test_upgrade_75_to_76_reclassifies_silent_and_adds_relief_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            main_path = Path(tmp) / "main.sqlite"
            con = sqlite3.connect(main_path)
            try:
                con.executescript(
                    """
                    CREATE TABLE positions (
                        position_id INTEGER PRIMARY KEY,
                        fact_id INTEGER NOT NULL,
                        party_id INTEGER NOT NULL,
                        position TEXT NOT NULL CHECK(position IN (
                            'claim','admit','deny','silent')),
                        qualification TEXT,
                        source_id INTEGER,
                        source_locator TEXT,
                        valid_from TEXT NOT NULL DEFAULT (date('now')),
                        valid_to TEXT,
                        prior_id INTEGER,
                        verified INTEGER DEFAULT 0,
                        notes TEXT,
                        human_reviewed INTEGER DEFAULT 0
                    );
                    INSERT INTO positions (
                        position_id, fact_id, party_id, position, qualification,
                        source_id, source_locator
                    ) VALUES
                        (1, 10, 20, 'silent', 'outside its knowledge', 30, 'Part 1 para 1'),
                        (2, 11, 20, 'silent', 'takes no position', 30, 'Part 1 para 2'),
                        (3, 12, 20, 'deny', NULL, 30, 'Part 1 para 3');
                    """
                )
            finally:
                con.close()

            self.assertTrue(rebuild.upgrade_75_to_76({"main": str(main_path)}))
            con = sqlite3.connect(main_path)
            try:
                self.assertEqual(
                    con.execute(
                        "SELECT position, position_basis FROM positions "
                        "ORDER BY position_id"
                    ).fetchall(),
                    [
                        ("not_admit", "outside_knowledge"),
                        ("no_position", None),
                        ("deny", None),
                    ],
                )
                tables = {
                    row[0]
                    for row in con.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertTrue(
                    {"relief_items", "relief_positions", "source_references"}
                    <= tables
                )
                with self.assertRaisesRegex(
                    sqlite3.IntegrityError, "UNIQUE constraint failed"
                ):
                    con.execute(
                        "INSERT INTO positions "
                        "(fact_id, party_id, position, source_id, source_locator) "
                        "VALUES (10, 20, 'deny', 30, 'Part 1 para 1')"
                    )
            finally:
                con.close()

    def test_upgrade_75_to_76_rejects_duplicate_current_positions_exactly(self):
        with tempfile.TemporaryDirectory() as tmp:
            main_path = Path(tmp) / "main.sqlite"
            con = sqlite3.connect(main_path)
            try:
                con.executescript(
                    """
                    CREATE TABLE positions (
                        position_id INTEGER PRIMARY KEY,
                        fact_id INTEGER NOT NULL,
                        party_id INTEGER NOT NULL,
                        position TEXT NOT NULL,
                        qualification TEXT,
                        source_id INTEGER,
                        source_locator TEXT,
                        valid_from TEXT NOT NULL,
                        valid_to TEXT,
                        prior_id INTEGER,
                        verified INTEGER,
                        notes TEXT,
                        human_reviewed INTEGER
                    );
                    INSERT INTO positions VALUES
                        (1, 10, 20, 'deny', NULL, 30, 'p1', '2026-01-01', NULL, NULL, 0, NULL, 0),
                        (2, 10, 20, 'deny', NULL, 30, 'p1', '2026-01-02', NULL, 1, 0, NULL, 0);
                    """
                )
            finally:
                con.close()

            with self.assertRaisesRegex(
                SystemExit,
                r"fact_id=10, party_id=20, source_id=30, "
                r"source_locator='p1', rows=2",
            ):
                rebuild.upgrade_75_to_76({"main": str(main_path)})

    def test_canonical_schema_creates_the_housekeeping_review_log(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.execute(
                "INSERT INTO housekeeping_reviews "
                "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                "VALUES ('abc', 'old name.pdf', 'Correspondence', 'declined', "
                "'2026-07-26')"
            )
            # Same bytes under a different name is a distinct review row: the
            # hash lookup is what survives a manual rename.
            con.execute(
                "INSERT INTO housekeeping_reviews "
                "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                "VALUES ('abc', 'new name.pdf', 'Law', 'renamed', '2026-07-26')"
            )
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO housekeeping_reviews "
                    "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                    "VALUES ('abc', 'old name.pdf', 'Law', 'renamed', '2026-07-26')"
                )
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO housekeeping_reviews "
                    "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                    "VALUES ('def', 'x.pdf', 'Law', 'skipped', '2026-07-26')"
                )
        finally:
            con.close()

    def test_migration_76_to_77_is_idempotent_and_matches_canonical_schema(self):
        snippet = migration_snippet(76, 77, "main")
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))

        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            # A v7.6 main is the canonical main minus the new table/index.
            migrated.executescript(sections["main"])
            migrated.executescript(
                "DROP INDEX idx_housekeeping_reviews_name;"
                "DROP TABLE housekeeping_reviews;"
            )
            migrated.executescript(snippet)
            migrated.executescript(snippet)  # IF NOT EXISTS -> re-runnable
            migrated.executescript(migration_snippet(87, 88, "main"))

            def objects(con):
                return sorted(
                    con.execute(
                        "SELECT type, name FROM sqlite_master "
                        "WHERE name LIKE '%housekeeping_reviews%' "
                        "   OR name LIKE 'idx_housekeeping%'"
                    ).fetchall()
                )

            def columns(con):
                return [
                    (row[1], row[2], row[3])  # name, declared type, NOT NULL
                    for row in con.execute(
                        "PRAGMA table_info(housekeeping_reviews)"
                    ).fetchall()
                ]

            self.assertTrue(objects(canonical))
            self.assertEqual(objects(canonical), objects(migrated))
            self.assertEqual(columns(canonical), columns(migrated))
            # The CHECK constraint must survive the migration, not just the columns.
            with self.assertRaises(sqlite3.IntegrityError):
                migrated.execute(
                    "INSERT INTO housekeeping_reviews "
                    "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                    "VALUES ('a', 'b.pdf', 'Law', 'skipped', '2026-07-26')"
                )
        finally:
            canonical.close()
            migrated.close()

    def test_migration_78_to_79_adds_execution_status_with_its_check(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            # A v7.8 main is the canonical main minus the new column (and minus
            # the later v8.7 column, so the canonical column order is reached
            # only through that later hop).
            migrated.executescript(sections["main"])
            migrated.execute("ALTER TABLE sources DROP COLUMN privilege_status")
            migrated.execute("ALTER TABLE sources DROP COLUMN execution_status")

            migrated.executescript(migration_snippet(78, 79, "main"))
            migrated.executescript(migration_snippet(86, 87, "main"))

            def columns(con):
                return [
                    (row[1], row[2], row[3])  # name, declared type, NOT NULL
                    for row in con.execute("PRAGMA table_info(sources)").fetchall()
                ]

            self.assertIn(
                ("execution_status", "TEXT", 0), columns(migrated)
            )
            self.assertEqual(columns(canonical), columns(migrated))

            migrated.execute(
                "INSERT INTO sources (source_id, category, title, execution_status) "
                "VALUES (1, 'court', 'Affidavit #1', 'affirmed')"
            )
            # NULL stays legal: not an affidavit / never assessed.
            migrated.execute(
                "INSERT INTO sources (source_id, category, title) "
                "VALUES (2, 'court', 'Pleading')"
            )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                migrated.execute(
                    "INSERT INTO sources "
                    "(source_id, category, title, execution_status) "
                    "VALUES (3, 'court', 'Bad status', 'sworn')"
                )
        finally:
            canonical.close()
            migrated.close()

    def test_rebuild_stamps_all_databases_and_emits_v89_dump(self):
        with tempfile.TemporaryDirectory() as tmp:
            matter_root = Path(tmp) / "Litigation - Documents" / "L9000 Rebuild"
            case_data_dir = matter_root.parent / "0. CASE DATA" / matter_root.name
            evidence_path = case_data_dir / "evidence.sql"
            matter_root.mkdir(parents=True)
            case_data_dir.mkdir(parents=True)
            (matter_root / "coclerk.json").write_text(
                json.dumps(
                    {
                        "schema_version": 5,
                        "matter_root": str(matter_root),
                        "case_data_dir": str(case_data_dir),
                        "evidence_sql_path": str(
                            Path("..", "0. CASE DATA", matter_root.name, "evidence.sql")
                        ),
                    }
                ),
                encoding="utf-8",
            )

            sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
            sections["main"] = sections["main"].replace(
                "'defendant_by_counterclaim'))",
                "'plaintiff_by_counterclaim','defendant_by_counterclaim'))",
                1,
            )
            # A v7.4 dump predates execution_status; un-upgrade the fixture so
            # the 78 -> 79 ALTER genuinely fires instead of colliding.
            sections["main"] = sections["main"].replace(
                ",\n    execution_status    TEXT "
                "CHECK(execution_status IN ('draft','affirmed','filed'))",
                "",
                1,
            )
            evidence = ["-- Case Data evidence dump — schema v7.4"]
            for database in ("main", "law", "privileged"):
                evidence.extend(
                    [
                        f"-- ===== v6 BEGIN {database} =====",
                        sections[database],
                        f"-- ===== v6 END {database} =====",
                    ]
                )
            evidence_path.write_text("\n".join(evidence), encoding="utf-8")

            # --migrate owns the rebuild-only carve-out and stops at the 76
            # way-station; it must NOT stamp the current version.
            self.assertEqual(rebuild.main([str(matter_root), "--migrate"]), 0)
            for database in ("main", "law", "privileged"):
                con = sqlite3.connect(case_data_dir / f"{database}.sqlite")
                try:
                    self.assertEqual(
                        con.execute("PRAGMA user_version").fetchone()[0], 76
                    )
                finally:
                    con.close()

            # A 76 database is not activatable: the version guard refuses it, so
            # it cannot be dumped under a v9.0 header while still at 76.
            with self.assertRaises(SystemExit):
                dump.main([str(matter_root)])

            # Apply the post-rebuild 76 -> 77, 77 -> 78, 78 -> 79, 79 -> 80,
            # 80 -> 81, 81 -> 82, 82 -> 83, 83 -> 84, 85 -> 86, 86 -> 87,
            # 87 -> 88, 88 -> 89 and 89 -> 90 segments before stamping every
            # database at 90 (the 84 -> 85 hop
            # is on `law` and rebuilds three tables the synthetic dump already
            # carries in their v8.5 shape, so it is stamped, not replayed). The
            # synthetic v7.4 dump started
            # from current DDL, so remove the v8.0/v8.2/v8.7/v8.9 columns before
            # exercising their migrations. The carve-out's proceeding_parties
            # rebuild already dropped the v8.9 override columns.
            con = sqlite3.connect(case_data_dir / "main.sqlite")
            try:
                con.executescript(
                    "DROP VIEW IF EXISTS review_queue;"
                    "DROP VIEW IF EXISTS v_fact_status;"
                    "DROP VIEW IF EXISTS v_current_positions;"
                )
                con.execute(
                    "ALTER TABLE facts DROP COLUMN pending_reverification"
                )
                con.execute(
                    "ALTER TABLE positions DROP COLUMN pending_reverification"
                )
                con.execute(
                    "ALTER TABLE parties DROP COLUMN service_address_filed_date"
                )
                con.execute(
                    "ALTER TABLE parties DROP COLUMN replaced_representative"
                )
                con.execute(
                    "ALTER TABLE sources DROP COLUMN privilege_status"
                )
                for column in V89_PARTY_COLUMNS:
                    con.execute(f"ALTER TABLE parties DROP COLUMN {column}")
                con.executescript(migration_snippet(76, 77, "main"))
                con.executescript(migration_snippet(77, 78, "main"))
                con.executescript(migration_snippet(78, 79, "main"))
                con.executescript(migration_snippet(79, 80, "main"))
                con.executescript(migration_snippet(80, 81, "main"))
                con.executescript(migration_snippet(81, 82, "main"))
                con.executescript(migration_snippet(82, 83, "main"))
                con.executescript(migration_snippet(83, 84, "main"))
                con.executescript(migration_snippet(86, 87, "main"))
                con.executescript(migration_snippet(87, 88, "main"))
                con.executescript(migration_snippet(88, 89, "main"))
                con.executescript(migration_snippet(89, 90, "main"))
                con.execute("PRAGMA user_version = 90")
            finally:
                con.close()
            con = sqlite3.connect(case_data_dir / "privileged.sqlite")
            try:
                con.executescript(migration_snippet(77, 78, "privileged"))
                con.executescript(migration_snippet(85, 86, "privileged"))
                con.execute("PRAGMA user_version = 90")
            finally:
                con.close()
            for database in ("law",):
                con = sqlite3.connect(case_data_dir / f"{database}.sqlite")
                try:
                    con.execute("PRAGMA user_version = 90")
                finally:
                    con.close()

            self.assertEqual(dump.main([str(matter_root)]), 0)
            self.assertIn(
                "schema v9.0",
                evidence_path.read_text(encoding="utf-8").splitlines()[0],
            )

    # ------------------------------------------------------------------
    # v8.4 -> v8.5 (law): three CHECK widenings + two capture columns
    # ------------------------------------------------------------------
    @staticmethod
    def _law_v84(section):
        """Un-upgrade the canonical law section back to its v8.4 shape."""
        section = section.replace(
            "'case_law','statute','regulation','treatise','other',\n"
            "                        'oral_reasons')),"
            "  -- v8.5: bench decision, no transcript",
            "'case_law','statute','regulation','treatise','other')),")
        section = section.replace(
            "'affirms','reverses','varies','distinguishes','overrules',\n"
            "        'follows','declines_to_follow','not_considered')),"
            "  -- v8.5: oral-decision vocabulary",
            "'affirms','reverses','varies','distinguishes','overrules')),")
        section = section.replace(
            "'establishes','refines','applies','distinguishes','affirms',\n"
            "                        'answered')),"
            "  -- v8.5: opposing authority the filing answered",
            "'establishes','refines','applies','distinguishes','affirms')),")
        section = section.replace(
            "    pinpoint        TEXT,  -- v8.5: local-only capture;"
            " never crosses, hash-excluded\n", "")
        section = section.replace(
            "    excerpt         TEXT,  -- v8.5: local-only capture;"
            " never crosses, hash-excluded\n", "")
        return section

    def test_84_to_85_law_rebuild_preserves_rows_widens_checks(self):
        """The hop rebuilds three law tables under an FK OFF/ON bracket.

        It runs here exactly as `migrate_engine._apply_marker` runs it -- on a
        connection with `PRAGMA foreign_keys = ON` -- because the bracket inside
        the snippet is the only thing that lets a PARENT table (`authorities`)
        be dropped and recreated at all. Row counts and every stored value must
        survive, the three widened CHECKs must accept their new values, and the
        retired values must still be refused.
        """
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical_law = sections["law"]
        v84_law = self._law_v84(canonical_law)
        self.assertNotEqual(v84_law, canonical_law, "un-upgrade did not fire")
        self.assertNotIn("oral_reasons", v84_law)
        self.assertNotIn("pinpoint", v84_law)

        fresh = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            fresh.executescript(canonical_law)
            migrated.executescript(v84_law)
            migrated.executescript(
                "INSERT INTO authorities (authority_id, title, citation, "
                "authority_type, jurisdiction, notes) VALUES "
                "(1, 'Alpha', '2020 BCSC 1', 'case_law', 'BC', 'n1'),"
                "(2, 'Beta', '2021 BCCA 2', 'case_law', 'BC', NULL);"
                "INSERT INTO authority_treatments (treating_authority_id, "
                "treated_authority_id, treatment, scope, notes) VALUES "
                "(2, 1, 'affirms', 'full', 'tnote');"
                "INSERT INTO legal_concepts (concept_id, name, concept_type, "
                "description, jurisdiction) VALUES (1, 'C', 'doctrine', 'D', 'BC');"
                "INSERT INTO concept_authorities (concept_id, authority_id, "
                "relationship, proposition, order_terms, treatment, "
                "treated_by_authority_id, verified, notes) VALUES "
                "(1, 1, 'establishes', 'P', 'OT', 'affirmed', 2, 1, 'enote');"
                "INSERT INTO legal_criteria (criterion_id, concept_id, "
                "criterion_order, criterion_description, authority_id) VALUES "
                "(1, 1, 1, 'Crit', 1);"
            )
            migrated.commit()
            tables = ("authorities", "authority_treatments", "legal_concepts",
                      "concept_authorities", "legal_criteria")
            before = {t: migrated.execute("SELECT count(*) FROM " + t).fetchone()[0]
                      for t in tables}

            # Exactly as the engine applies a marker: FK ON, then the snippet.
            migrated.execute("PRAGMA foreign_keys = ON")
            migrated.executescript(migration_snippet(84, 85, "law"))
            migrated.commit()

            after = {t: migrated.execute("SELECT count(*) FROM " + t).fetchone()[0]
                     for t in tables}
            self.assertEqual(before, after)
            self.assertEqual(
                migrated.execute(
                    "SELECT title, citation, authority_type, jurisdiction, notes "
                    "FROM authorities ORDER BY authority_id").fetchall(),
                [("Alpha", "2020 BCSC 1", "case_law", "BC", "n1"),
                 ("Beta", "2021 BCCA 2", "case_law", "BC", None)])
            self.assertEqual(
                migrated.execute(
                    "SELECT treating_authority_id, treated_authority_id, treatment, "
                    "scope, notes FROM authority_treatments").fetchall(),
                [(2, 1, "affirms", "full", "tnote")])
            self.assertEqual(
                migrated.execute(
                    "SELECT relationship, proposition, order_terms, pinpoint, "
                    "excerpt, treatment, treated_by_authority_id, verified, notes "
                    "FROM concept_authorities").fetchall(),
                [("establishes", "P", "OT", None, None, "affirmed", 2, 1, "enote")])

            # foreign_keys is back ON and nothing dangles.
            self.assertEqual(
                migrated.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertEqual(
                migrated.execute("PRAGMA foreign_key_check").fetchall(), [])

            # The widened CHECKs accept their new values...
            migrated.executescript(
                "INSERT INTO authorities (authority_id, title, citation, "
                "authority_type) VALUES (3, 'Oral reasons, BCSC S-1, J, 2026-08-14',"
                " 'Oral reasons, BCSC S-1, J, 2026-08-14', 'oral_reasons');"
                "INSERT INTO authority_treatments (treating_authority_id, "
                "treated_authority_id, treatment) VALUES "
                "(3, 1, 'follows'), (3, 2, 'not_considered');"
                "INSERT INTO concept_authorities (concept_id, authority_id, "
                "relationship, pinpoint, excerpt) VALUES "
                "(1, 3, 'answered', 'para 31', 'quoted passage');"
            )
            # ...and still refuse an unknown one.
            for statement in (
                "INSERT INTO authorities (authority_id, title, authority_type) "
                "VALUES (9, 'x', 'podcast')",
                "INSERT INTO authority_treatments (treating_authority_id, "
                "treated_authority_id, treatment) VALUES (1, 2, 'ignores')",
                "INSERT INTO concept_authorities (concept_id, authority_id, "
                "relationship) VALUES (1, 2, 'rebuts')",
            ):
                with self.assertRaises(sqlite3.IntegrityError):
                    migrated.execute(statement)
                migrated.rollback()

            def shape(connection, table):
                columns = [(r[1], r[2], r[3], r[5])
                           for r in connection.execute(
                               "PRAGMA table_info(%s)" % table)]
                indexes = sorted(r[1] for r in connection.execute(
                    "PRAGMA index_list(%s)" % table))
                return columns, indexes

            for table in ("authorities", "authority_treatments",
                          "concept_authorities"):
                with self.subTest(table=table):
                    self.assertEqual(shape(migrated, table), shape(fresh, table))
        finally:
            fresh.close()
            migrated.close()

    def test_query_27_reads_only_oral_reasons_treatments(self):
        """@query_27 is the consolidation stage's read of oral-decision
        treatments. It must never return an ordinary appellate treatment."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("ATTACH DATABASE ':memory:' AS law")
            connection.executescript(
                sections["law"].replace("CREATE TABLE ", "CREATE TABLE law.")
                               .replace("CREATE INDEX ", "CREATE INDEX law."))
            connection.executescript(
                "INSERT INTO law.authorities (authority_id, title, citation, "
                "authority_type) VALUES "
                "(1, 'Alpha', '2020 BCSC 1', 'case_law'),"
                "(2, 'Beta', '2021 BCCA 2', 'case_law'),"
                "(3, 'Oral reasons, BCSC S-1, Master Harper, 2026-08-14',"
                " 'Oral reasons, BCSC S-1, Master Harper, 2026-08-14', 'oral_reasons');"
                "INSERT INTO law.authority_treatments (treating_authority_id, "
                "treated_authority_id, treatment) VALUES "
                "(3, 1, 'follows'), (3, 2, 'declines_to_follow'), (2, 1, 'affirms');"
            )
            sql = named_query("query_27_oral_treatments_for_authorities")
            rows = connection.execute(sql, ("1,2",)).fetchall()
            self.assertEqual([(r[0], r[5], r[9]) for r in rows],
                             [(3, 1, "follows"), (3, 2, "declines_to_follow")])
            self.assertEqual(connection.execute(sql, ("",)).fetchall(), [])
            self.assertEqual([r[5] for r in connection.execute(sql, ("1",))], [1])
        finally:
            connection.close()

    # ------------------------------------------------------------------
    # v8.6 -> v8.7 (main): pending privilege review (decision #49)
    # ------------------------------------------------------------------
    def test_migration_86_to_87_backfills_pending_only_from_the_legacy_note(self):
        """Only a note that STARTS with the legacy marker becomes 'pending';
        every other row stays NULL and no note is rewritten. A listed legacy
        row fails the CHECK, so the hop fails closed."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            # A v8.6 main is the canonical main minus the new column.
            migrated.executescript(sections["main"])
            migrated.execute("ALTER TABLE sources DROP COLUMN privilege_status")
            migrated.executescript(
                """
                INSERT INTO sources (source_id, category, title, listed, notes) VALUES
                    (1, 'work_product', 'Client email', 0,
                     'PRIVILEGE REVIEW PENDING - call not yet made.'),
                    (2, 'work_product', 'Memo', 0,
                     'Reviewed. PRIVILEGE REVIEW PENDING appears mid-note.'),
                    (3, 'correspondence', 'Letter', 1, NULL),
                    (4, 'court', 'Pleading', 0, 'OCR: p3 smudged');
                """
            )
            migrated.execute("PRAGMA foreign_keys = ON")  # as _apply_marker does
            migrated.executescript(migration_snippet(86, 87, "main"))

            self.assertEqual(
                migrated.execute(
                    "SELECT source_id, privilege_status, notes FROM sources "
                    "ORDER BY source_id"
                ).fetchall(),
                [
                    (1, "pending", "PRIVILEGE REVIEW PENDING - call not yet made."),
                    (2, None, "Reviewed. PRIVILEGE REVIEW PENDING appears mid-note."),
                    (3, None, None),
                    (4, None, "OCR: p3 smudged"),
                ],
            )

            def columns(connection):
                return [
                    (row[1], row[2], row[3])  # name, declared type, NOT NULL
                    for row in connection.execute("PRAGMA table_info(sources)")
                ]

            self.assertIn(("privilege_status", "TEXT", 0), columns(migrated))
            self.assertEqual(columns(canonical), columns(migrated))
        finally:
            canonical.close()
            migrated.close()

        listed = sqlite3.connect(":memory:")
        try:
            listed.executescript(sections["main"])
            listed.execute("ALTER TABLE sources DROP COLUMN privilege_status")
            listed.execute(
                "INSERT INTO sources (source_id, category, title, listed, notes) "
                "VALUES (1, 'work_product', 'Listed memo', 1, "
                "'PRIVILEGE REVIEW PENDING')"
            )
            listed.commit()
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                listed.executescript(migration_snippet(86, 87, "main"))
        finally:
            listed.close()

    def test_privilege_status_check_refuses_listing_a_pending_source(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.execute(
                "INSERT INTO sources (source_id, category, title, privilege_status) "
                "VALUES (1, 'work_product', 'Pending memo', 'pending')"
            )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                con.execute("UPDATE sources SET listed = 1 WHERE source_id = 1")
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                con.execute(
                    "INSERT INTO sources "
                    "(source_id, category, title, listed, privilege_status) "
                    "VALUES (2, 'work_product', 'Listed pending', 1, 'pending')"
                )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "CHECK constraint failed"
            ):
                con.execute(
                    "INSERT INTO sources (source_id, category, title, privilege_status) "
                    "VALUES (3, 'work_product', 'Unknown value', 'privileged')"
                )
            # A cleared or never-assessed source may be listed.
            con.execute(
                "INSERT INTO sources "
                "(source_id, category, title, listed, privilege_status) "
                "VALUES (4, 'work_product', 'Cleared', 1, 'cleared')"
            )
            con.execute(
                "INSERT INTO sources (source_id, category, title, listed) "
                "VALUES (5, 'court', 'Never assessed', 1)"
            )
            self.assertEqual(
                con.execute(
                    "SELECT source_id, listed, privilege_status FROM sources "
                    "ORDER BY source_id"
                ).fetchall(),
                [(1, 0, "pending"), (4, 1, "cleared"), (5, 1, None)],
            )
        finally:
            con.close()

    def test_triggers_refuse_evidence_and_positions_citing_a_pending_source(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        triggers = (CASE_DATA_ROOT / "references" / "triggers.sql").read_text(
            encoding="utf-8"
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = {
                database: Path(tmp) / f"{database}.sqlite"
                for database in ("main", "law", "privileged")
            }
            for database, path in paths.items():
                connection = sqlite3.connect(path)
                try:
                    connection.executescript(sections[database])
                finally:
                    connection.close()

            connection = sqlite3.connect(paths["main"])
            try:
                connection.execute("ATTACH DATABASE ? AS law", (str(paths["law"]),))
                connection.execute(
                    "ATTACH DATABASE ? AS privileged", (str(paths["privileged"]),)
                )
                connection.executescript(triggers)
                connection.executescript(
                    """
                    INSERT INTO parties (party_id, name, party_type)
                    VALUES (1, 'Client', 'individual');
                    INSERT INTO sources (source_id, category, title, privilege_status)
                    VALUES (1, 'work_product', 'Pending memo', 'pending'),
                           (2, 'work_product', 'Cleared memo', 'cleared'),
                           (3, 'court', 'Pleading', NULL);
                    INSERT INTO facts (fact_id, description, source_id)
                    VALUES (1, 'A fact', 3);
                    """
                )

                pending = "source is pending privilege review"
                with self.assertRaisesRegex(sqlite3.IntegrityError, pending):
                    connection.execute(
                        "INSERT INTO evidence_links (source_id, fact_id, strength) "
                        "VALUES (1, 1, 2)"
                    )
                with self.assertRaisesRegex(sqlite3.IntegrityError, pending):
                    connection.execute(
                        "INSERT INTO positions (fact_id, party_id, position, source_id) "
                        "VALUES (1, 1, 'claim', 1)"
                    )

                for source_id in (2, 3):
                    connection.execute(
                        "INSERT INTO evidence_links "
                        "(evidence_link_id, source_id, fact_id, strength) "
                        "VALUES (?, ?, 1, 2)",
                        (source_id, source_id),
                    )
                    connection.execute(
                        "INSERT INTO positions "
                        "(position_id, fact_id, party_id, position, source_id) "
                        "VALUES (?, 1, 1, 'claim', ?)",
                        (source_id, source_id),
                    )

                # Re-pointing an existing row at a pending source is refused too.
                with self.assertRaisesRegex(sqlite3.IntegrityError, pending):
                    connection.execute(
                        "UPDATE evidence_links SET source_id = 1 "
                        "WHERE evidence_link_id = 2"
                    )
                with self.assertRaisesRegex(sqlite3.IntegrityError, pending):
                    connection.execute(
                        "UPDATE positions SET source_id = 1 WHERE position_id = 3"
                    )
                self.assertEqual(
                    connection.execute(
                        "SELECT count(*) FROM evidence_links WHERE source_id = 1"
                    ).fetchone()[0]
                    + connection.execute(
                        "SELECT count(*) FROM positions WHERE source_id = 1"
                    ).fetchone()[0],
                    0,
                )
            finally:
                connection.close()

    def test_fact_status_holds_back_a_pending_sources_facts_until_cleared(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(rebuild.views_from_queries(QUERIES_PATH.read_text(
                encoding="utf-8")))
            con.executescript(
                """
                INSERT INTO parties (party_id, name, party_type)
                VALUES (1, 'Client', 'individual');
                INSERT INTO sources (source_id, category, title, privilege_status)
                VALUES (1, 'work_product', 'Pending memo', 'pending'),
                       (2, 'court', 'Pleading', NULL);
                INSERT INTO facts (fact_id, description, source_id) VALUES
                    (1, 'From the pending memo', 1),
                    (2, 'From the pleading', 2),
                    (3, 'Theorized, no source', NULL);
                -- A legacy position citing the pending source (the triggers
                -- are not loaded here, as they are not for a pre-v8.7 row).
                INSERT INTO positions (position_id, fact_id, party_id, position, source_id)
                VALUES (1, 2, 1, 'claim', 1), (2, 2, 1, 'admit', 2);
                """
            )

            def fact_ids():
                return [r[0] for r in con.execute(
                    "SELECT fact_id FROM v_fact_status ORDER BY fact_id")]

            self.assertEqual(fact_ids(), [2, 3])
            self.assertEqual(
                [r[0] for r in con.execute(
                    "SELECT position_id FROM v_current_positions ORDER BY position_id")],
                [2],
            )

            con.execute(
                "UPDATE sources SET privilege_status = 'cleared' WHERE source_id = 1"
            )
            self.assertEqual(fact_ids(), [1, 2, 3])
            self.assertEqual(
                [r[0] for r in con.execute(
                    "SELECT position_id FROM v_current_positions ORDER BY position_id")],
                [1, 2],
            )
        finally:
            con.close()

    def test_query_28_lists_pending_sources_with_fact_counts(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(
                """
                INSERT INTO sources (source_id, category, title, file_path,
                                     last_ingested_at, notes, privilege_status) VALUES
                    (1, 'work_product', 'Client email', 'a.eml', '2026-09-01',
                     'PRIVILEGE REVIEW PENDING', 'pending'),
                    (2, 'work_product', 'Cleared memo', 'b.pdf', '2026-07-01',
                     NULL, 'cleared'),
                    (3, 'work_product', 'Lawyer note', 'c.docx', '2026-08-01',
                     NULL, 'pending');
                INSERT INTO facts (fact_id, description, source_id) VALUES
                    (1, 'one', 1), (2, 'two', 1), (3, 'three', 2);
                """
            )
            self.assertEqual(
                con.execute(
                    named_query("query_28_pending_privilege_review")
                ).fetchall(),
                [
                    (3, "Lawyer note", "c.docx", "work_product", "2026-08-01",
                     None, 0),
                    (1, "Client email", "a.eml", "work_product", "2026-09-01",
                     "PRIVILEGE REVIEW PENDING", 2),
                ],
            )
        finally:
            con.close()

    def test_review_queue_still_shows_a_pending_sources_flagged_fact(self):
        """The verifier's and lawyer's backlogs deliberately keep seeing a
        pending document's facts: extraction quality is independent of the
        privilege call."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(rebuild.views_from_queries(QUERIES_PATH.read_text(
                encoding="utf-8")))
            con.executescript(
                """
                INSERT INTO sources (source_id, category, title, privilege_status)
                VALUES (1, 'work_product', 'Pending memo', 'pending');
                INSERT INTO facts (fact_id, description, source_id, verified, notes)
                VALUES (1, 'Flagged fact', 1, 2, 'OCR: amount unclear');
                """
            )
            self.assertEqual(
                con.execute(
                    "SELECT record_type, record_id, flag_type FROM review_queue"
                ).fetchall(),
                [("fact", 1, "ocr")],
            )
            self.assertEqual(
                con.execute("SELECT count(*) FROM v_fact_status").fetchone()[0], 0
            )
            # Re-homed (source_id NULL) by a Privileged outcome: still queued.
            con.execute("UPDATE facts SET source_id = NULL WHERE fact_id = 1")
            self.assertEqual(
                con.execute(
                    "SELECT record_type, record_id, flag_type FROM review_queue"
                ).fetchall(),
                [("fact", 1, "ocr")],
            )
        finally:
            con.close()

    def test_drafting_queries_hold_back_pending_facts_and_evidence(self):
        """01, 02, 04, 20, 25 and get_facts_for_drafting.read_evidence exclude
        facts and evidence from a pending source; clearing it restores them."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(rebuild.views_from_queries(QUERIES_PATH.read_text(
                encoding="utf-8")))
            con.executescript(
                """
                INSERT INTO proceedings (proceeding_id, court, file_number)
                VALUES (1, 'BCSC', 'S-1');
                INSERT INTO parties (party_id, name, party_type)
                VALUES (1, 'Client', 'individual'), (2, 'Other', 'individual');
                INSERT INTO sources (source_id, proceeding_id, category, title,
                                     privilege_status) VALUES
                    (1, 1, 'work_product', 'Pending memo', 'pending'),
                    (2, 1, 'court', 'Pleading', NULL),
                    (3, 1, 'production', 'Invoice', NULL);
                INSERT INTO facts (fact_id, description, source_id) VALUES
                    (1, 'Pending-memo fact, admitted', 1),
                    (2, 'Pleaded fact, denied', 2),
                    (3, 'Pending-memo fact, denied', 1);
                -- Positions cite the pleading, not the pending memo.
                INSERT INTO positions (position_id, fact_id, party_id, position,
                                       source_id) VALUES
                    (1, 1, 2, 'admit', 2), (2, 2, 2, 'deny', 2),
                    (3, 3, 2, 'deny', 2);
                -- Legacy link citing the pending source (no triggers loaded).
                INSERT INTO evidence_links (evidence_link_id, source_id, fact_id,
                                            strength) VALUES
                    (1, 1, 2, 2),   -- pending memo proves the pleaded fact
                    (2, 3, 2, 1);   -- invoice also proves it
                INSERT INTO criteria_facts (criterion_id, fact_id, relevance)
                VALUES (1, 1, 'supports'), (1, 2, 'supports');
                """
            )
            spec = importlib.util.spec_from_file_location(
                "case_data_drafting", SCRIPTS_DIR / "get_facts_for_drafting.py")
            drafting = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(drafting)

            def run(name, params=()):
                return con.execute(named_query(name), params).fetchall()

            def pending_state():
                return {
                    "q01": sorted(r[0] for r in run("query_01_denied_facts_no_evidence")),
                    "q02": sorted(r[0] for r in run("query_02_uncontested_admitted_facts")),
                    "q04": sorted(r[0] for r in run("query_04_witness_dependencies")),
                    "q20": sorted(r[1] for r in run("query_20_criterion_facts", (1,))),
                    "q25": sorted({r[0] for r in run("query_25_admitted_facts", (1, 2))}),
                    "evidence": sorted(e["evidence_link_id"]
                                       for e in drafting.read_evidence(con, 2)),
                }

            # Pending: facts 1 and 3 are held back everywhere; link 1 neither
            # proves fact 2 (so 04 sees the invoice as its sole proof) nor is
            # returned by the drafting evidence read.
            self.assertEqual(pending_state(), {
                "q01": [], "q02": [], "q04": [3], "q20": [2], "q25": [],
                "evidence": [2],
            })

            con.execute("UPDATE sources SET privilege_status = 'cleared' "
                        "WHERE source_id = 1")
            self.assertEqual(pending_state(), {
                "q01": [3], "q02": [1], "q04": [], "q20": [1, 2], "q25": [1],
                "evidence": [1, 2],
            })
        finally:
            con.close()



    # ------------------------------------------------------------------
    # v8.7 -> v8.8 (main): housekeeping ingest outcomes (decision #26)
    # ------------------------------------------------------------------
    @staticmethod
    def _main_v87(con):
        """A v8.7 main: the canonical main with housekeeping_reviews in its
        pre-v8.8 shape, which the 76 -> 77 snippet creates exactly."""
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con.executescript(sections["main"])
        con.executescript(
            "DROP INDEX idx_housekeeping_reviews_name;"
            "DROP TABLE housekeeping_reviews;"
        )
        con.executescript(migration_snippet(76, 77, "main"))

    def test_migration_87_to_88_keeps_every_row_and_matches_canonical(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            self._main_v87(migrated)
            migrated.executescript(
                """
                INSERT INTO housekeeping_reviews
                    (review_id, file_hash, file_name, folder_type, outcome, reviewed_at)
                VALUES (1, 'h1', 'a.pdf', 'Correspondence', 'renamed', '2026-07-26'),
                       (2, 'h2', 'b.pdf', 'Law', 'manual_review', '2026-07-27'),
                       (3, 'h3', 'c.pdf', 'Court File', 'declined', '2026-07-28');
                """
            )
            # The v8.7 table refuses the new values; that is why the hop exists.
            with self.assertRaises(sqlite3.IntegrityError):
                migrated.execute(
                    "INSERT INTO housekeeping_reviews "
                    "(file_hash, file_name, folder_type, outcome, reviewed_at) "
                    "VALUES ('h4', 'd.pdf', 'Law', 'not_ingested', '2026-09-24')")
            before = migrated.execute(
                "SELECT * FROM housekeeping_reviews ORDER BY review_id").fetchall()

            migrated.executescript(migration_snippet(87, 88, "main"))

            after = migrated.execute(
                "SELECT review_id, file_hash, file_name, folder_type, outcome, "
                "reviewed_at, reason, failure_class, retry_next_run "
                "FROM housekeeping_reviews ORDER BY review_id").fetchall()
            self.assertEqual([row[:6] for row in after], before)
            self.assertEqual({row[6:] for row in after}, {(None, None, None)})

            def columns(con):
                return [(r[1], r[2], r[3], r[4]) for r in
                        con.execute("PRAGMA table_info(housekeeping_reviews)")]

            def objects(con):
                return sorted(con.execute(
                    "SELECT type, name FROM sqlite_master "
                    "WHERE tbl_name = 'housekeeping_reviews' AND name NOT LIKE 'sqlite_%'"))

            self.assertEqual(columns(migrated), columns(canonical))
            self.assertEqual(objects(migrated), objects(canonical))
            self.assertEqual(migrated.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        finally:
            canonical.close()
            migrated.close()

    def test_v88_review_log_accepts_the_new_outcomes_and_checks_their_values(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.execute(
                "INSERT INTO housekeeping_reviews (file_hash, file_name, folder_type, "
                "outcome, reviewed_at) VALUES ('h1', 'a.pdf', 'Law', 'not_ingested', '2026-09-24')")
            # A root file's failure has no folder type.
            con.execute(
                "INSERT INTO housekeeping_reviews (file_hash, file_name, folder_type, "
                "outcome, reviewed_at, reason, failure_class, retry_next_run) "
                "VALUES ('h2', 'b.pdf', NULL, 'ingest_failed', '2026-09-24', "
                "'extractor returned malformed JSON', 'extractor', 1)")
            for column, value in (("outcome", "skipped"), ("failure_class", "other"),
                                  ("retry_next_run", 2)):
                with self.subTest(column=column), self.assertRaises(sqlite3.IntegrityError):
                    row = {"outcome": "ingest_failed", "failure_class": "extractor",
                           "retry_next_run": 0, column: value}
                    con.execute(
                        "INSERT INTO housekeeping_reviews (file_hash, file_name, "
                        "outcome, reviewed_at, failure_class, retry_next_run) "
                        "VALUES ('h3', 'c.pdf', :outcome, '2026-09-24', "
                        ":failure_class, :retry_next_run)", row)
        finally:
            con.close()

    # ------------------------------------------------------------------
    # v8.8 -> v8.9 (main): counsel contact split and per-proceeding
    # overrides (party/counsel SSOT, decision #55)
    # ------------------------------------------------------------------
    def test_migration_88_to_89_adds_counsel_columns_keeps_rows_and_matches_canonical(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            migrated.executescript(sections["main"])
            drop_v89_columns(migrated)
            migrated.executescript(
                """
                INSERT INTO proceedings (proceeding_id, court, file_number)
                VALUES (1, 'BCSC', 'S-1');
                INSERT INTO parties (party_id, name, party_type, lawyer_name,
                                     lawyer_firm, address, contact_info)
                VALUES (1, 'Plaintiff Co.', 'corporation', 'A. Lawyer',
                        'Firm LLP', '1 Main St', 'a@firm.example 604-555-0100');
                INSERT INTO proceeding_parties (proceeding_id, party_id, role)
                VALUES (1, 1, 'plaintiff');
                """
            )
            parties_before = migrated.execute("SELECT * FROM parties").fetchall()
            roles_before = migrated.execute("SELECT * FROM proceeding_parties").fetchall()

            migrated.executescript(migration_snippet(88, 89, "main"))

            def columns(con, table):
                return [(r[1], r[2], r[3], r[4]) for r in
                        con.execute(f"PRAGMA table_info({table})")]

            for table in ("parties", "proceeding_parties"):
                self.assertEqual(columns(migrated, table), columns(canonical, table), table)
            # Every new column is nullable with no default: NULL is the honest
            # backfill, and an override is written only on the practitioner's word.
            self.assertEqual(
                migrated.execute("SELECT * FROM parties").fetchall(),
                [row + (None, None) for row in parties_before],
            )
            self.assertEqual(
                migrated.execute("SELECT * FROM proceeding_parties").fetchall(),
                [row + (None,) * len(V89_OVERRIDE_COLUMNS) for row in roles_before],
            )
            self.assertEqual(migrated.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        finally:
            canonical.close()
            migrated.close()

    # ------------------------------------------------------------------
    # v8.9 -> v9.0 (main): tribunal members and participant aliases
    # (decision #65)
    # ------------------------------------------------------------------
    def test_migration_89_to_90_adds_participant_tables_and_matches_canonical(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        canonical = sqlite3.connect(":memory:")
        migrated = sqlite3.connect(":memory:")
        try:
            canonical.executescript(sections["main"])
            migrated.executescript(sections["main"])
            migrated.execute("DROP TABLE participant_aliases")
            migrated.execute("DROP TABLE tribunal_members")
            migrated.executescript(
                """
                INSERT INTO parties (party_id, name, party_type)
                VALUES (1, 'Example Co.', 'corporation');
                """
            )
            parties_before = migrated.execute("SELECT * FROM parties").fetchall()

            migrated.executescript(migration_snippet(89, 90, "main"))
            # Re-runnable: CREATE ... IF NOT EXISTS throughout.
            migrated.executescript(migration_snippet(89, 90, "main"))

            def shape(con):
                return sorted(
                    (r[0], r[1]) for r in con.execute(
                        "SELECT name, sql FROM sqlite_master "
                        "WHERE name IN ('tribunal_members', 'participant_aliases', "
                        "'idx_tribunal_members_proceeding', "
                        "'idx_participant_aliases_unique')"))

            def columns(con, table):
                return [(r[1], r[2], r[3], r[4]) for r in
                        con.execute(f"PRAGMA table_info({table})")]

            self.assertEqual(len(shape(migrated)), 4)
            for table in ("tribunal_members", "participant_aliases"):
                self.assertEqual(columns(migrated, table), columns(canonical, table), table)
            self.assertEqual(migrated.execute("SELECT * FROM parties").fetchall(),
                             parties_before)
            self.assertEqual(migrated.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        finally:
            canonical.close()
            migrated.close()

    def test_participant_aliases_enforce_one_owner_approval_and_uniqueness(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(sections["main"])
            con.executescript(
                """
                INSERT INTO parties (party_id, name, party_type)
                VALUES (1, 'Pat Example', 'individual');
                INSERT INTO witnesses (witness_id, name, witness_type)
                VALUES (1, 'Wren Sample', 'fact');
                INSERT INTO tribunal_members (tribunal_member_id, name, capacity)
                VALUES (1, 'Alex Specimen', 'arbitrator');
                """
            )
            ok = ("INSERT INTO participant_aliases "
                  "(party_id, of_counsel, witness_id, tribunal_member_id, alias_text, "
                  " alias_kind, approved_on) VALUES (?, ?, ?, ?, ?, ?, ?)")
            con.execute(ok, (1, 0, None, None, "Exampel", "spelling", "2026-10-06"))
            con.execute(ok, (1, 1, None, None, "CounselC", "file_code", "2026-10-06"))
            con.execute(ok, (None, 0, 1, None, "SampleW", "file_code", "2026-10-06"))
            con.execute(ok, (None, 0, None, 1, "SpecimenA", "file_code", "2026-10-06"))
            bad_rows = [
                # no owner
                (None, 0, None, None, "X", "spelling", "2026-10-06"),
                # two owners
                (1, 0, 1, None, "X", "spelling", "2026-10-06"),
                # counsel alias without a party
                (None, 1, 1, None, "X", "spelling", "2026-10-06"),
                # no approval date
                (1, 0, None, None, "X", "spelling", None),
                (1, 0, None, None, "X", "spelling", ""),
                # unknown kind, blank alias
                (1, 0, None, None, "X", "nickname", "2026-10-06"),
                (1, 0, None, None, "  ", "spelling", "2026-10-06"),
                # duplicate of an existing alias, case-insensitively
                (1, 0, None, None, "EXAMPEL", "spelling", "2026-10-06"),
            ]
            for row in bad_rows:
                with self.assertRaises(sqlite3.IntegrityError, msg=row):
                    con.execute(ok, row)
        finally:
            con.close()


if __name__ == "__main__":
    unittest.main()
