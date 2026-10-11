"""Tests for the host-side migrate engine behind `case_data__migrate`.

The end-to-end fixtures are deliberately SYNTHETIC HYBRIDS: a set of databases
built from the canonical v9.0 schema, selectively un-upgraded, then stamped at
an older user_version. That is not a historically faithful v7.4 database, and it
does not need to be — the engine walks the chain by version stamp and every hop
is shape-idempotent by construction. What these tests exercise is the engine
(chain building, the token, staging, backup, all-or-nothing replacement,
restore), not the schema deltas, which test_schema_v89.py already owns.
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import migrate_engine as engine  # noqa: E402
import rebuild  # noqa: E402

DBS = ("main", "law", "privileged")
V62_SCHEMA_PATH = CASE_DATA_ROOT / "tests" / "fixtures" / "schema_v62.sql"


def build_matter(tmp, user_version, deprecated_role=False, drop_housekeeping=False,
                 schema_path=SCHEMA_PATH):
    """Create a matter tree with three databases stamped at `user_version`.

    `schema_path` defaults to the current schema (then selectively un-upgraded
    below); pass a historic schema (e.g. V62_SCHEMA_PATH) to build a faithful
    old-generation database that needs no un-upgrading."""
    matter_root = Path(tmp) / "4165.L999 Fixture Matter"
    case_data_dir = matter_root / "case-data"
    evidence_path = case_data_dir / "evidence.sql"
    case_data_dir.mkdir(parents=True)

    (matter_root / "coclerk.json").write_text(
        json.dumps({
            "schema_version": 5,
            "matter_root": str(matter_root),
            "case_data_dir": str(case_data_dir),
            "evidence_sql_path": str(evidence_path.relative_to(matter_root)),
        }),
        encoding="utf-8",
    )

    sections = rebuild.parse_sections(schema_path.read_text(encoding="utf-8"))
    historic = schema_path != SCHEMA_PATH
    if deprecated_role:
        # Re-admit the retired value so rebuild.upgrade_74_to_75 has work to do.
        sections["main"] = sections["main"].replace(
            "'defendant_by_counterclaim'))",
            "'plaintiff_by_counterclaim','defendant_by_counterclaim'))",
            1,
        )

    for db in DBS:
        con = sqlite3.connect(case_data_dir / f"{db}.sqlite")
        try:
            con.executescript(sections[db])
            if historic:
                con.execute(f"PRAGMA user_version = {user_version}")
                con.commit()
                con.close()
                continue
            if db == "main" and drop_housekeeping:
                # So the 76 -> 77 marker (CREATE TABLE housekeeping_reviews)
                # genuinely fires rather than colliding.
                con.executescript(
                    "DROP INDEX IF EXISTS idx_housekeeping_reviews_hash;"
                    "DROP TABLE IF EXISTS housekeeping_reviews;"
                )
            if user_version < 78 and db == "main":
                con.executescript(
                    "DROP TABLE IF EXISTS proceeding_witnesses;"
                    "DROP TABLE IF EXISTS witnesses;"
                )
            if user_version < 78 and db == "privileged":
                con.execute("DROP TABLE IF EXISTS client_instructions")
            if user_version < 79 and db == "main":
                # Pre-v7.9 fixtures lack execution_status, so the 78 -> 79
                # ALTER genuinely fires instead of colliding.
                con.execute(
                    "ALTER TABLE sources DROP COLUMN execution_status"
                )
            if user_version < 80 and db == "main":
                # Pre-v8.0 fixtures lack the quarantine marker, so the 79 -> 80
                # ALTER statements genuinely fire instead of colliding.
                con.execute(
                    "ALTER TABLE facts DROP COLUMN pending_reverification"
                )
                con.execute(
                    "ALTER TABLE positions DROP COLUMN pending_reverification"
                )
            if user_version < 81 and db == "main":
                # Pre-v8.1 fixtures lack admissions, so the 80 -> 81 CREATE
                # genuinely fires instead of short-circuiting on IF NOT EXISTS.
                con.execute("DROP TABLE IF EXISTS admissions")
            if user_version < 82 and db == "main":
                # Pre-v8.2 fixtures lack the address-for-service provenance
                # columns, so the 81 -> 82 ALTERs genuinely fire instead of
                # colliding on a duplicate column.
                con.execute(
                    "ALTER TABLE parties DROP COLUMN service_address_filed_date"
                )
                con.execute(
                    "ALTER TABLE parties DROP COLUMN replaced_representative"
                )
            # No un-upgrade step is needed for the 82 -> 83 hop: it widens
            # proceeding_parties.role via a table rebuild (CREATE new / INSERT
            # SELECT / DROP / RENAME), which copies existing rows across
            # regardless of whether the source table's CHECK already allows
            # 'appellant' -- unlike an ADD COLUMN hop, it never collides.
            if user_version < 84 and db == "main":
                # Pre-v8.4 fixtures lack sought_orders, so the 83 -> 84 CREATE
                # genuinely fires instead of short-circuiting on IF NOT EXISTS.
                con.execute("DROP TABLE IF EXISTS sought_orders")
            if user_version < 85 and db == "law":
                # Pre-v8.5 fixtures lack the capture columns, so the
                # 84 -> 85 rebuild genuinely adds them instead of copying
                # them across. The three CHECK widenings in the same hop
                # need no un-upgrade -- a table rebuild copies rows across
                # regardless of what the source CHECK already allowed.
                con.execute(
                    "ALTER TABLE concept_authorities DROP COLUMN pinpoint"
                )
                con.execute(
                    "ALTER TABLE concept_authorities DROP COLUMN excerpt"
                )
            # No un-upgrade step is needed for the 85 -> 86 hop: it relaxes
            # client_instructions.proceeding_id via a table rebuild, which
            # copies rows across whether or not the source column was NOT NULL.
            if user_version < 87 and db == "main":
                # Pre-v8.7 fixtures lack privilege_status, so the 86 -> 87
                # ALTER genuinely fires instead of colliding on a duplicate
                # column.
                con.execute(
                    "ALTER TABLE sources DROP COLUMN privilege_status"
                )
            # No un-upgrade step is needed for the 87 -> 88 hop: it rebuilds
            # housekeeping_reviews and copies only the pre-v8.8 columns across,
            # so a source table already in the v8.8 shape never collides.
            if user_version < 89 and db == "main":
                # Pre-v8.9 fixtures lack the counsel contact columns and the
                # per-proceeding overrides, so the 88 -> 89 ALTERs genuinely
                # fire instead of colliding on a duplicate column.
                for column in ("lawyer_email", "lawyer_phone"):
                    con.execute(f"ALTER TABLE parties DROP COLUMN {column}")
                for column in ("lawyer_name", "lawyer_firm", "lawyer_email",
                               "lawyer_phone", "address",
                               "service_address_filed_date"):
                    con.execute(
                        f"ALTER TABLE proceeding_parties DROP COLUMN {column}")
            if user_version < 90 and db == "main":
                # Pre-v9.0 fixtures lack the participant tables, so the
                # 89 -> 90 hop genuinely creates them rather than finding
                # them already there.
                con.execute("DROP TABLE participant_aliases")
                con.execute("DROP TABLE tribunal_members")
            con.execute(f"PRAGMA user_version = {user_version}")
            con.commit()
        finally:
            con.close()

    evidence_path.write_text("-- Case Data evidence dump -- schema v7.4\n", encoding="utf-8")
    return matter_root, case_data_dir, evidence_path


def hashes(case_data_dir):
    return {db: engine.sha256_file(case_data_dir / f"{db}.sqlite") for db in DBS}


def versions(case_data_dir):
    return {db: engine.read_user_version(case_data_dir / f"{db}.sqlite") for db in DBS}


class ChainTests(unittest.TestCase):
    def setUp(self):
        self.hops = engine.parse_migrations(rebuild.read_ref("migrations.sql"))

    def test_markers_are_grouped_by_hop(self):
        for key, steps in self.hops.items():
            self.assertTrue(steps, f"empty hop {key}")
            for db, sql in steps:
                self.assertIn(db, DBS)
                self.assertTrue(sql.strip(), f"empty body for {key} {db}")

    def test_v73_routes_through_both_carveouts(self):
        chain = engine.build_chain(73, self.hops)
        self.assertEqual(
            [(s["from"], s["to"], s["kind"]) for s in chain],
            [(73, 74, "marker"), (74, 75, "carveout"),
             (75, 76, "carveout"), (76, 77, "marker"),
             (77, 78, "marker"), (78, 79, "marker"),
             (79, 80, "marker"), (80, 81, "marker"),
             (81, 82, "marker"), (82, 83, "marker"),
             (83, 84, "marker"), (84, 85, "marker"), (85, 86, "marker"),
             (86, 87, "marker"), (87, 88, "marker"),
             (88, 89, "marker"), (89, 90, "marker")],
        )
        self.assertEqual([s["name"] for s in chain if s["kind"] == "carveout"],
                         ["upgrade_74_to_75", "upgrade_75_to_76"])

    def test_carveout_functions_exist_on_rebuild(self):
        for name, _ in engine.CARVEOUTS.values():
            self.assertTrue(callable(getattr(rebuild, name, None)),
                            f"rebuild.{name} is missing")

    def test_gapped_chain_fails_closed(self):
        # A hop served by neither a marker nor a carve-out must make migrate
        # refuse rather than silently skip a schema generation.
        hops = dict(self.hops)
        del hops[(76, 77)]
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.build_chain(69, hops)
        self.assertEqual(ctx.exception.code, "no_migration_path")
        self.assertEqual(ctx.exception.details["missing_hop"], [76, 77])

    def test_v69_routes_through_the_v70_carveout(self):
        chain = engine.build_chain(69, self.hops)
        self.assertEqual((chain[0]["from"], chain[0]["to"], chain[0]["kind"],
                          chain[0]["name"]), (69, 70, "carveout", "upgrade_69_to_70"))
        self.assertEqual([(s["from"], s["to"]) for s in chain],
                         [(v, v + 1) for v in range(69, 90)])

    def test_public_steps_carry_no_sql_bodies(self):
        for step in engine.public_steps(engine.build_chain(73, self.hops)):
            self.assertNotIn("sql", step)


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.hops = engine.parse_migrations(rebuild.read_ref("migrations.sql"))
        self.chain = engine.build_chain(76, self.hops)
        self.base = engine.token_components(
            matter_root=r"C:\m", case_data_dir=r"C:\m\cd",
            native_hashes={"main": "a", "law": "b", "privileged": "c"},
            start_versions={"main": 76, "law": 76, "privileged": 76},
            chain=self.chain, ref_hashes={"migrations.sql": "x", "rebuild.py": "y"},
        )

    def test_token_is_stable_for_identical_inputs(self):
        self.assertEqual(engine.compute_plan_token(self.base),
                         engine.compute_plan_token(dict(self.base)))

    def test_token_changes_when_a_database_changes(self):
        moved = json.loads(json.dumps(self.base))
        moved["native_sha256"]["main"] = "CHANGED"
        self.assertNotEqual(engine.compute_plan_token(self.base),
                            engine.compute_plan_token(moved))
        self.assertEqual(engine.diff_components(self.base, moved), "native_sha256.main")

    def test_token_changes_when_reference_sql_changes(self):
        moved = json.loads(json.dumps(self.base))
        moved["refs_sha256"]["migrations.sql"] = "CHANGED"
        self.assertNotEqual(engine.compute_plan_token(self.base),
                            engine.compute_plan_token(moved))
        self.assertEqual(engine.diff_components(self.base, moved),
                         "refs_sha256.migrations.sql")

    def test_token_changes_when_rebuild_py_changes(self):
        # rebuild.py's upgrade_* functions ARE part of a plan's semantics.
        moved = json.loads(json.dumps(self.base))
        moved["refs_sha256"]["rebuild.py"] = "CHANGED"
        self.assertNotEqual(engine.compute_plan_token(self.base),
                            engine.compute_plan_token(moved))


class EngineFixtureTest(unittest.TestCase):
    """Base class: isolated matter + isolated backup root per test."""

    user_version = 76
    deprecated_role = False
    drop_housekeeping = True

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="coclerk_migrate_test_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.backups = os.path.join(self.tmp, "backups")
        os.makedirs(self.backups)
        self._prev = os.environ.get(engine.ENV_BACKUP_ROOT)
        os.environ[engine.ENV_BACKUP_ROOT] = self.backups
        self.addCleanup(self._restore_env)
        self.matter_root, self.case_data_dir, self.evidence_path = build_matter(
            os.path.join(self.tmp, "matter"), self.user_version,
            deprecated_role=self.deprecated_role,
            drop_housekeeping=self.drop_housekeeping)

    def _restore_env(self):
        if self._prev is None:
            os.environ.pop(engine.ENV_BACKUP_ROOT, None)
        else:
            os.environ[engine.ENV_BACKUP_ROOT] = self._prev


class PlanApplyTests(EngineFixtureTest):
    def test_plan_then_apply_reaches_the_target(self):
        before = hashes(self.case_data_dir)
        plan = engine.plan(str(self.matter_root))

        self.assertTrue(plan["ok"])
        self.assertFalse(plan["already_current"])
        self.assertEqual(plan["from_version"], "7.6")
        self.assertEqual(plan["target_version"], "9.0")
        self.assertTrue(plan["plan_token"].startswith("cdm1."))
        self.assertEqual(plan["dry_run"]["dump_header"], engine.DUMP_HEADER)
        self.assertGreater(plan["dry_run"]["triggers_loaded"], 0)
        for db in DBS:
            self.assertGreaterEqual(plan["dry_run"]["table_counts"][db],
                                    rebuild.MIN_TABLES[db])
            self.assertEqual(plan["dry_run"]["integrity_check"][db], "ok")

        # A dry run must leave the natives byte-identical.
        self.assertEqual(hashes(self.case_data_dir), before)
        self.assertEqual(versions(self.case_data_dir),
                         {db: 76 for db in DBS})

        result = engine.apply(str(self.matter_root), plan["plan_token"],
                              plan["user_confirmation_required"])
        self.assertTrue(result["applied"])
        self.assertEqual(versions(self.case_data_dir), {db: 90 for db in DBS})
        self.assertTrue(result["evidence_sql_written"])
        self.assertIn("schema v9.0",
                      self.evidence_path.read_text(encoding="utf-8").splitlines()[0])

        # The 76 -> 77 marker's table is really there.
        con = sqlite3.connect(self.case_data_dir / "main.sqlite")
        try:
            self.assertIsNotNone(con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name='housekeeping_reviews'").fetchone())
        finally:
            con.close()

        # No sidecar or in-flight marker survives a clean apply.
        self.assertEqual([p for p in os.listdir(self.case_data_dir)
                          if p.startswith(".coclerk_migrate_")], [])
        self.assertEqual([p for p in os.listdir(
            os.path.join(self.backups, os.listdir(self.backups)[0]))
            if p.startswith(".inflight")], [])

    def test_row_counts_are_preserved(self):
        plan = engine.plan(str(self.matter_root))
        before = plan["dry_run"]["row_counts_before"]
        after = plan["dry_run"]["row_counts_after"]
        for db in DBS:
            for table, count in before[db].items():
                self.assertEqual(after[db].get(table), count,
                                 f"{db}.{table} row count changed")

    def test_apply_refuses_a_stale_token(self):
        plan = engine.plan(str(self.matter_root))
        # Another session writes to the matter between plan and apply.
        con = sqlite3.connect(self.case_data_dir / "law.sqlite")
        try:
            con.execute("PRAGMA application_id = 4242")
            con.commit()
        finally:
            con.close()
        before = hashes(self.case_data_dir)

        with self.assertRaises(engine.MigrateError) as ctx:
            engine.apply(str(self.matter_root), plan["plan_token"],
                         plan["user_confirmation_required"])
        self.assertEqual(ctx.exception.code, "plan_token_mismatch")
        self.assertEqual(hashes(self.case_data_dir), before)
        self.assertEqual(versions(self.case_data_dir), {db: 76 for db in DBS})

    def test_apply_refuses_without_a_token(self):
        before = hashes(self.case_data_dir)
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.apply(str(self.matter_root), None, "MIGRATE anything")
        self.assertEqual(ctx.exception.code, "plan_token_mismatch")
        self.assertEqual(hashes(self.case_data_dir), before)

    def test_apply_refuses_a_wrong_confirmation(self):
        plan = engine.plan(str(self.matter_root))
        before = hashes(self.case_data_dir)
        for bad in ("", "yes", "MIGRATE wrong v7.6 -> v9.0"):
            with self.assertRaises(engine.MigrateError) as ctx:
                engine.apply(str(self.matter_root), plan["plan_token"], bad)
            self.assertIn(ctx.exception.code,
                          ("confirmation_mismatch", "plan_token_mismatch"))
        self.assertEqual(hashes(self.case_data_dir), before)

    def test_disagreeing_version_stamps_are_refused(self):
        con = sqlite3.connect(self.case_data_dir / "law.sqlite")
        try:
            con.execute("PRAGMA user_version = 74")
        finally:
            con.close()
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(str(self.matter_root))
        self.assertEqual(ctx.exception.code, "version_stamps_disagree")

    def test_a_newer_database_is_never_downgraded(self):
        for db in DBS:
            con = sqlite3.connect(self.case_data_dir / f"{db}.sqlite")
            try:
                con.execute("PRAGMA user_version = 99")
            finally:
                con.close()
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(str(self.matter_root))
        self.assertEqual(ctx.exception.code, "migrate_refused")
        self.assertIn("never downgrades", ctx.exception.message)


class CarveoutFiringTests(EngineFixtureTest):
    """A hybrid stamped v7.4 whose role CHECK still admits the retired value, so
    upgrade_74_to_75 genuinely fires while upgrade_75_to_76 correctly no-ops."""

    user_version = 74
    deprecated_role = True

    def test_carveout_fires_and_the_retired_role_is_gone(self):
        plan = engine.plan(str(self.matter_root))
        fired = {s.get("name"): s["fired"] for s in plan["steps"]
                 if s["kind"] == "carveout"}
        self.assertTrue(fired["upgrade_74_to_75"])
        self.assertFalse(fired["upgrade_75_to_76"])

        engine.apply(str(self.matter_root), plan["plan_token"],
                     plan["user_confirmation_required"])
        self.assertEqual(versions(self.case_data_dir), {db: 90 for db in DBS})

        con = sqlite3.connect(self.case_data_dir / "main.sqlite")
        try:
            ddl = con.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' "
                "AND name='proceeding_parties'").fetchone()[0]
        finally:
            con.close()
        self.assertNotIn("plaintiff_by_counterclaim", ddl)


def fresh_v89_shape(tmp):
    """Table -> column-name set per database, from a clean build of schema.sql."""
    sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
    shape = {}
    for db in DBS:
        path = os.path.join(tmp, f"fresh_{db}.sqlite")
        con = sqlite3.connect(path)
        try:
            con.executescript(sections[db])
            shape[db] = table_shape(con)
        finally:
            con.close()
    return shape


def table_shape(con):
    return {name: {r[1] for r in con.execute(f'PRAGMA table_info("{name}")')}
            for (name,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%'")}


class FromV62Tests(EngineFixtureTest):
    """A faithful v6.2 database (historic schema.sql, no un-upgrading) walks the
    whole chain, including the 69 -> 70 carve-out, and lands on the v9.0 shape."""

    user_version = 62

    def setUp(self):
        super().setUp()
        shutil.rmtree(os.path.join(self.tmp, "matter"))
        self.matter_root, self.case_data_dir, self.evidence_path = build_matter(
            os.path.join(self.tmp, "matter"), self.user_version,
            schema_path=V62_SCHEMA_PATH)

    def test_plan_and_apply_from_v62_land_on_the_v89_shape(self):
        plan = engine.plan(str(self.matter_root))
        self.assertTrue(plan["ok"])
        self.assertEqual(plan["from_user_version"], 62)
        self.assertTrue(plan["dry_run"]["ok"])
        self.assertEqual(plan["dry_run"]["foreign_key_violations"],
                         {db: 0 for db in DBS})
        for db in DBS:
            self.assertEqual(plan["dry_run"]["integrity_check"][db], "ok")
        fired = {s["name"]: s["fired"] for s in plan["steps"]
                 if s["kind"] == "carveout"}
        self.assertEqual(fired, {"upgrade_69_to_70": True,
                                 "upgrade_74_to_75": True,
                                 "upgrade_75_to_76": True})

        engine.apply(str(self.matter_root), plan["plan_token"],
                     plan["user_confirmation_required"])
        self.assertEqual(versions(self.case_data_dir), {db: 90 for db in DBS})

        expected = fresh_v89_shape(self.tmp)
        for db in DBS:
            con = sqlite3.connect(self.case_data_dir / f"{db}.sqlite")
            try:
                actual = table_shape(con)
            finally:
                con.close()
            self.assertEqual(set(actual), set(expected[db]), f"{db} table set")
            for table in expected[db]:
                self.assertEqual(actual[table], expected[db][table],
                                 f"{db}.{table} columns")
        self.assertIn("housekeeping_reviews", expected["main"])


class From85Tests(EngineFixtureTest):
    """A v8.5 privileged database whose client_instructions still carries the
    NOT NULL proceeding_id, with rows, takes the 85 -> 86 hop through the
    engine and keeps every row."""

    user_version = 85
    drop_housekeeping = False

    def setUp(self):
        super().setUp()
        snippet = dict(engine.parse_migrations(
            rebuild.read_ref("migrations.sql"))[(77, 78)])["privileged"]
        con = sqlite3.connect(self.case_data_dir / "privileged.sqlite")
        try:
            # The 77 -> 78 snippet creates exactly the pre-v8.6 NOT NULL shape.
            con.execute("DROP TABLE client_instructions")
            con.executescript(snippet)
            con.executescript(
                """
                INSERT INTO privileged_sources (source_id, category, title)
                VALUES (3, 'solicitor_client', 'Instruction memo');
                INSERT INTO client_instructions
                    (instruction_id, proceeding_id, party_id, instructed_by, date,
                     description, source_id, status, valid_from, valid_to)
                VALUES (4, 1, 2, 'Client', '2026-08-01', 'Settle at 50k.', 3,
                        'superseded', '2026-08-01', '2026-08-09');
                INSERT INTO client_instructions
                    (instruction_id, proceeding_id, party_id, instructed_by, date,
                     description, source_id, status, valid_from, prior_id)
                VALUES (5, 1, 2, 'Client', '2026-08-09', 'Settle at 40k.', 3,
                        'open', '2026-08-09', 4);
                """
            )
            con.commit()
        finally:
            con.close()

    def instructions(self):
        con = sqlite3.connect(self.case_data_dir / "privileged.sqlite")
        try:
            rows = con.execute(
                "SELECT * FROM client_instructions ORDER BY instruction_id").fetchall()
            notnull = {r[1]: r[3] for r in
                       con.execute("PRAGMA table_info(client_instructions)")}
            violations = con.execute("PRAGMA foreign_key_check").fetchall()
        finally:
            con.close()
        return rows, notnull, violations

    def test_apply_relaxes_proceeding_id_and_preserves_rows(self):
        rows_before, notnull_before, _ = self.instructions()
        self.assertEqual(len(rows_before), 2)
        self.assertEqual(notnull_before["proceeding_id"], 1)

        plan = engine.plan(str(self.matter_root))
        self.assertEqual([(s["from"], s["to"], s["kind"]) for s in plan["steps"]],
                         [(85, 86, "marker"), (86, 87, "marker"), (87, 88, "marker"),
                          (88, 89, "marker"), (89, 90, "marker")])
        self.assertEqual(plan["dry_run"]["foreign_key_violations"],
                         {db: 0 for db in DBS})

        engine.apply(str(self.matter_root), plan["plan_token"],
                     plan["user_confirmation_required"])
        self.assertEqual(versions(self.case_data_dir), {db: 90 for db in DBS})

        rows_after, notnull_after, violations = self.instructions()
        self.assertEqual(rows_after, rows_before)
        self.assertEqual((notnull_after["proceeding_id"], notnull_after["party_id"]),
                         (0, 1))
        self.assertEqual(violations, [])


class StagingTagTests(EngineFixtureTest):
    """#1060: the data runtime removes a killed call's temp folders by its COCLERK_STAGING_TAG.
    The user-version guard folder is not here: migrate bypasses the guard (test_resolve_paths)."""

    def top_level_prefixes(self, tag):
        """Every prefix plan + apply pass to mkdtemp for a folder directly in the OS temp dir."""
        prefixes = []
        real = tempfile.mkdtemp

        def recording(*args, **kwargs):
            if kwargs.get("dir") is None:
                prefixes.append(kwargs.get("prefix"))
            return real(*args, **kwargs)

        env = {k: v for k, v in os.environ.items() if k != "COCLERK_STAGING_TAG"}
        if tag:
            env["COCLERK_STAGING_TAG"] = tag
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("tempfile.mkdtemp", recording):
            plan = engine.plan(str(self.matter_root))
            engine.apply(str(self.matter_root), plan["plan_token"],
                         plan["user_confirmation_required"])
        return prefixes

    def test_tagged_under_the_runtime(self):
        prefixes = self.top_level_prefixes("0123456789abcdef")
        self.assertTrue({"coclerk_migrate_plan_0123456789abcdef_",
                         "coclerk_migrate_apply_0123456789abcdef_",
                         "coclerk_probe_0123456789abcdef_"} <= set(prefixes), prefixes)
        for prefix in prefixes:
            self.assertRegex(prefix, r"^coclerk_[a-z_]+_0123456789abcdef_$")

    def test_untagged_when_run_by_hand(self):
        prefixes = self.top_level_prefixes(None)
        self.assertTrue({"coclerk_migrate_plan_", "coclerk_migrate_apply_",
                         "coclerk_probe_"} <= set(prefixes), prefixes)


class AlreadyCurrentTests(EngineFixtureTest):
    user_version = 90
    drop_housekeeping = False

    def test_plan_reports_already_current_and_issues_no_token(self):
        plan = engine.plan(str(self.matter_root))
        self.assertTrue(plan["already_current"])
        self.assertIsNone(plan["plan_token"])
        self.assertEqual(plan["steps"], [])

    def test_apply_refuses_when_already_current(self):
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.apply(str(self.matter_root), "cdm1.whatever", "MIGRATE x")
        self.assertEqual(ctx.exception.code, "migrate_refused")


class BackupRestoreTests(EngineFixtureTest):
    def test_restore_recovers_the_pre_migration_set_byte_for_byte(self):
        original = hashes(self.case_data_dir)
        plan = engine.plan(str(self.matter_root))
        result = engine.apply(str(self.matter_root), plan["plan_token"],
                              plan["user_confirmation_required"])
        self.assertNotEqual(hashes(self.case_data_dir), original)

        backup_id = result["backup_id"]
        listing = engine.list_backups(str(self.matter_root))
        self.assertIn(backup_id, [b["backup_id"] for b in listing["backups"]])
        self.assertFalse(listing["inflight"])

        restored = engine.restore(str(self.matter_root), backup_id,
                                  f"RESTORE {backup_id}")
        self.assertEqual(restored["restored_from"], backup_id)
        self.assertEqual(hashes(self.case_data_dir), original)
        self.assertEqual(versions(self.case_data_dir), {db: 76 for db in DBS})
        # A restore is itself reversible.
        self.assertTrue(restored["safety_backup_id"])

    def test_restore_refuses_a_wrong_confirmation(self):
        plan = engine.plan(str(self.matter_root))
        result = engine.apply(str(self.matter_root), plan["plan_token"],
                              plan["user_confirmation_required"])
        after = hashes(self.case_data_dir)
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.restore(str(self.matter_root), result["backup_id"], "yes")
        self.assertEqual(ctx.exception.code, "confirmation_mismatch")
        self.assertEqual(hashes(self.case_data_dir), after)

    def test_restore_refuses_a_corrupted_backup(self):
        plan = engine.plan(str(self.matter_root))
        result = engine.apply(str(self.matter_root), plan["plan_token"],
                              plan["user_confirmation_required"])
        after = hashes(self.case_data_dir)
        backup_id = result["backup_id"]
        with open(os.path.join(result["backup_dir"], "law.sqlite"), "ab") as fh:
            fh.write(b"\x00corrupt")

        with self.assertRaises(engine.MigrateError) as ctx:
            engine.restore(str(self.matter_root), backup_id, f"RESTORE {backup_id}")
        self.assertEqual(ctx.exception.code, "backup_corrupt")
        self.assertEqual(hashes(self.case_data_dir), after)

    def test_an_interrupted_apply_blocks_the_next_plan(self):
        engine.plan(str(self.matter_root))  # creates the matter backup dir
        resolved = engine.resolve(str(self.matter_root))[0]
        slug = engine.matter_identity(str(self.matter_root), resolved)[1]
        marker = engine.inflight_path(
            slug, engine.canonical_matter_root(resolved, str(self.matter_root)))
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write("20260101T000000Z-abcdef")

        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(str(self.matter_root))
        self.assertEqual(ctx.exception.code, "apply_interrupted")
        self.assertEqual(ctx.exception.details["backup_id"], "20260101T000000Z-abcdef")


class SharedBackupFolderTests(EngineFixtureTest):
    """Two roots whose databases carry the same matter id and short name (a
    scratch copy of a live matter) share one backup folder. In-flight state is
    scoped to the root, so neither can block or clear the other (#1345)."""

    def setUp(self):
        super().setUp()
        self.other_root, _, _ = build_matter(
            os.path.join(self.tmp, "copy"), self.user_version,
            deprecated_role=self.deprecated_role,
            drop_housekeeping=self.drop_housekeeping)
        self.a, self.b = str(self.matter_root), str(self.other_root)

    def _interrupt_apply(self, root):
        plan = engine.plan(root)
        failure = engine.MigrateError("apply_interrupted", "simulated crash")
        with mock.patch.object(engine, "atomic_replace_set", side_effect=failure):
            with self.assertRaises(engine.MigrateError):
                engine.apply(root, plan["plan_token"],
                             plan["user_confirmation_required"])
        return engine.list_backups(root)["backups"][0]["backup_id"]

    def _legacy_marker(self, root, backup_id):
        listing = engine.list_backups(root)
        path = os.path.join(listing["backups_root"], ".inflight")
        os.makedirs(listing["backups_root"], exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(backup_id)
        return path

    def test_the_roots_really_share_a_backup_folder(self):
        self.assertEqual(engine.list_backups(self.a)["backups_root"],
                         engine.list_backups(self.b)["backups_root"])

    def test_an_interrupted_apply_on_one_root_leaves_plan_on_the_other_working(self):
        self._interrupt_apply(self.a)
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(self.a)
        self.assertEqual(ctx.exception.code, "apply_interrupted")
        self.assertTrue(engine.plan(self.b)["ok"])

    def test_inflight_is_reported_only_for_the_interrupted_root(self):
        self._interrupt_apply(self.a)
        self.assertTrue(engine.list_backups(self.a)["inflight"])
        self.assertFalse(engine.list_backups(self.b)["inflight"])

    def test_restore_on_one_root_leaves_the_other_roots_marker(self):
        plan = engine.plan(self.b)
        done = engine.apply(self.b, plan["plan_token"],
                            plan["user_confirmation_required"])
        self._interrupt_apply(self.a)

        engine.restore(self.b, done["backup_id"], "RESTORE %s" % done["backup_id"])
        self.assertTrue(engine.list_backups(self.a)["inflight"])
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(self.a)
        self.assertEqual(ctx.exception.code, "apply_interrupted")

    def test_restore_clears_the_restored_roots_own_marker(self):
        backup_id = self._interrupt_apply(self.a)
        engine.restore(self.a, backup_id, "RESTORE %s" % backup_id)
        self.assertFalse(engine.list_backups(self.a)["inflight"])
        self.assertTrue(engine.plan(self.a)["ok"])

    def test_a_legacy_marker_blocks_only_the_root_its_backup_names(self):
        backup_id = self._interrupt_apply(self.a)
        engine.restore(self.a, backup_id, "RESTORE %s" % backup_id)
        self._legacy_marker(self.a, backup_id)

        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(self.a)
        self.assertEqual(ctx.exception.code, "apply_interrupted")
        self.assertEqual(ctx.exception.details["backup_id"], backup_id)
        self.assertTrue(engine.list_backups(self.a)["inflight"])
        self.assertTrue(engine.plan(self.b)["ok"])
        self.assertFalse(engine.list_backups(self.b)["inflight"])

    def test_restore_clears_a_legacy_marker_only_for_its_own_root(self):
        backup_id = self._interrupt_apply(self.a)
        engine.restore(self.a, backup_id, "RESTORE %s" % backup_id)
        marker = self._legacy_marker(self.a, backup_id)

        plan = engine.plan(self.b)
        done = engine.apply(self.b, plan["plan_token"],
                            plan["user_confirmation_required"])
        engine.restore(self.b, done["backup_id"], "RESTORE %s" % done["backup_id"])
        self.assertTrue(os.path.exists(marker))

        engine.restore(self.a, backup_id, "RESTORE %s" % backup_id)
        self.assertFalse(os.path.exists(marker))

    def test_an_unattributable_legacy_marker_blocks_every_root(self):
        self._legacy_marker(self.a, "20260101T000000Z-abcdef")
        for root in (self.a, self.b):
            with self.assertRaises(engine.MigrateError) as ctx:
                engine.plan(root)
            self.assertEqual(ctx.exception.code, "apply_interrupted")
            self.assertFalse(ctx.exception.details["attributed"])


class FailureIsolationTests(EngineFixtureTest):
    def test_a_broken_chain_step_leaves_the_natives_untouched(self):
        before = hashes(self.case_data_dir)
        hops = engine.parse_migrations(rebuild.read_ref("migrations.sql"))
        hops[(76, 77)] = [("main", "THIS IS NOT SQL;")]
        original_parse = engine.parse_migrations
        engine.parse_migrations = lambda _text: hops
        try:
            with self.assertRaises(Exception):
                engine.plan(str(self.matter_root))
        finally:
            engine.parse_migrations = original_parse
        self.assertEqual(hashes(self.case_data_dir), before)
        self.assertEqual(versions(self.case_data_dir), {db: 76 for db in DBS})

    def test_a_missing_database_is_refused_before_anything_is_staged(self):
        os.remove(self.case_data_dir / "privileged.sqlite")
        with self.assertRaises(engine.MigrateError) as ctx:
            engine.plan(str(self.matter_root))
        self.assertEqual(ctx.exception.code, "migrate_refused")
        self.assertIn("privileged.sqlite", ctx.exception.message)


if __name__ == "__main__":
    unittest.main()
