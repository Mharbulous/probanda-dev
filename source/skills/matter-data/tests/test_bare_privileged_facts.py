"""Decision #67: a Fact known only from a privileged source is a bare row.

Builds a real v9.0 matter from schema.sql and runs the SQL blocks lifted from the
operation files, so the documents and the behaviour are tested together.
"""
import importlib.util
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
QUERIES_PATH = CASE_DATA_ROOT / "references" / "queries.sql"
OPERATIONS = CASE_DATA_ROOT / "operations"

sys.path.insert(0, str(SCRIPTS_DIR))
_spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rebuild)
_spec = importlib.util.spec_from_file_location(
    "case_data_facts_for_drafting", SCRIPTS_DIR / "get_facts_for_drafting.py")
facts_for_drafting = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(facts_for_drafting)

BARE_COLUMNS = (
    "description, category, date_of_fact, source_id, source_locator, verified, "
    "created_date, notes, basis_of_knowledge, informant, human_reviewed, "
    "pending_reverification"
)
BARE_ROW = ("", None, None, None, None, 0, None, None, None, None, 0, 0)


def named_query(marker):
    """From the marker's first SELECT to the first code line ending in a semicolon.
    A comment inside the statement may itself contain a semicolon."""
    text = QUERIES_PATH.read_text(encoding="utf-8")
    start = text.index(f"-- @{marker}")
    lines = text[text.index("SELECT", start):].split("\n")
    out = []
    for line in lines:
        out.append(line)
        if not line.lstrip().startswith("--") and line.rstrip().endswith(";"):
            break
    return "\n".join(out)


def doc_sql(filename, marker):
    """The one fenced sql block in an operation file that contains `marker`."""
    text = (OPERATIONS / filename).read_text(encoding="utf-8")
    for block in re.findall(r"```sql\n(.*?)```", text, re.S):
        if marker in block:
            return block
    raise AssertionError(f"no sql block with {marker!r} in {filename}")


class BareRowTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        paths = {db: str(Path(self._tmp.name) / f"{db}.sqlite")
                 for db in ("main", "law", "privileged")}
        for db, path in paths.items():
            c = sqlite3.connect(path)
            c.executescript(sections[db])
            c.close()
        self.con = sqlite3.connect(paths["main"])
        self.addCleanup(self.con.close)
        self.con.execute(f"ATTACH DATABASE '{paths['law']}' AS law")
        self.con.execute(f"ATTACH DATABASE '{paths['privileged']}' AS privileged")
        self.views = rebuild.views_from_queries(QUERIES_PATH.read_text(encoding="utf-8"))
        self.con.executescript(self.views)

    def one(self, sql, params=()):
        return self.con.execute(sql, params).fetchone()

    def bare_state(self, fact_id):
        return self.one(f"SELECT {BARE_COLUMNS} FROM main.facts WHERE fact_id = ?", (fact_id,))

    def add_privileged_source(self, source_id, category="solicitor_client",
                              title="Client email"):
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title) "
            "VALUES (?, ?, ?)", (source_id, category, title))

    def add_provenance(self, fact_id, source_id, note=None, disposition="active",
                       verified=0, locator=None):
        self.con.execute(
            "INSERT INTO privileged.fact_provenance "
            "(fact_id, source_id, source_locator, source_note, disposition, verified) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (fact_id, source_id, locator, note, disposition, verified))


class ReadersSkipBareRows(BareRowTestCase):
    def setUp(self):
        super().setUp()
        self.con.executescript("""
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (1, 'An ordinary fact', '2026-10-12');
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (2, '', NULL);
        """)

    def test_v_fact_status_skips_the_bare_row(self):
        ids = [r[0] for r in self.con.execute("SELECT fact_id FROM v_fact_status")]
        self.assertEqual(ids, [1])

    def test_get_facts_for_drafting_never_sees_the_bare_row(self):
        facts = facts_for_drafting.read_facts(self.con)
        self.assertEqual([f["fact_id"] for f in facts], [1])

    def test_unverified_backlog_skips_the_bare_row(self):
        rows = self.con.execute(named_query("query_05a_verification_backlog_unverified"))
        self.assertEqual([r[1] for r in rows if r[0] == "facts"], [1])

    def test_human_review_backlog_skips_a_bare_row_even_at_verified_2(self):
        self.con.execute("UPDATE facts SET verified = 2 WHERE fact_id IN (1, 2)")
        rows = self.con.execute(named_query("query_05b_verification_needs_human"))
        self.assertEqual([r[1] for r in rows if r[0] == "facts"], [1])

    def test_a_view_that_predates_the_exclusion_is_replaced(self):
        self.con.executescript("""
            DROP VIEW v_fact_status;
            CREATE VIEW v_fact_status AS SELECT fact_id, description FROM facts;
        """)
        self.assertEqual(
            sorted(r[0] for r in self.con.execute("SELECT fact_id FROM v_fact_status")),
            [1, 2])
        self.con.executescript(self.views)
        self.assertEqual(
            [r[0] for r in self.con.execute("SELECT fact_id FROM v_fact_status")], [1])


class PrivilegedSideReads(BareRowTestCase):
    def setUp(self):
        super().setUp()
        self.add_privileged_source(1, "privileged_work_product", "Theory of the case — A1")
        self.add_privileged_source(2)
        self.con.executescript("""
            INSERT INTO facts (fact_id, description, created_date) VALUES (5, '', NULL);
            INSERT INTO facts (fact_id, description, created_date) VALUES (6, '', NULL);
            INSERT INTO facts (fact_id, description, created_date) VALUES (7, '', NULL);
            INSERT INTO facts (fact_id, description, category, created_date)
                VALUES (8, 'Own wording', 'payment', '2026-10-12');
        """)
        self.add_provenance(5, 1, "STATEMENT: Theorized wording\nCATEGORY: breach\na note")
        self.add_provenance(6, 2, "STATEMENT: Told to us\nCATEGORY: damages")
        self.add_provenance(
            7, 1, "DISMISSED (2026-10-12): no | prior: STATEMENT: Dismissed wording\n"
                  "CATEGORY: credibility", disposition="dismissed")
        self.add_provenance(8, 2)

    def test_query_22_reads_wording_and_category_from_the_record(self):
        rows = {r[0]: r for r in self.con.execute(named_query("query_22_theorized_facts"))}
        self.assertEqual(sorted(rows), [5, 7])
        self.assertEqual(rows[5][1:3], ("Theorized wording", "breach"))
        self.assertEqual(rows[7][1:3], ("Dismissed wording", "credibility"))
        self.assertEqual(rows[7][3], "dismissed")

    def test_query_10_reads_the_record_and_keeps_an_ordinary_row_as_it_is(self):
        rows = {r[0]: r for r in self.con.execute(
            named_query("query_10_facts_only_privileged_sources"))}
        self.assertEqual(sorted(rows), [5, 6, 7, 8])
        self.assertEqual(rows[5][1:3], ("Theorized wording", "breach"))
        self.assertEqual(rows[6][1:3], ("Told to us", "damages"))
        self.assertEqual(rows[7][1:3], ("Dismissed wording", "credibility"))
        self.assertEqual(rows[8][1:3], ("Own wording", "payment"))


class MintWritesABareRow(BareRowTestCase):
    def test_mint_script_leaves_only_an_id_in_main(self):
        script = (doc_sql("theorize-fact.md", "Ensure the application's theory placeholder")
                  .replace("<proceeding_id>", "1")
                  .replace("<app_id>", "2026-10-12-test")
                  .replace("<description>", "The deal''s terms were agreed")
                  .replace("<category>", "contract"))
        self.con.executescript(script)
        fact_id = self.one("SELECT fact_id FROM main.facts")[0]
        self.assertEqual(self.bare_state(fact_id), BARE_ROW)
        note = self.one("SELECT source_note FROM privileged.fact_provenance")[0]
        self.assertEqual(note, "STATEMENT: The deal's terms were agreed\nCATEGORY: contract")
        self.assertEqual(self.one("SELECT COUNT(*) FROM v_fact_status")[0], 0)
        row = self.one(named_query("query_22_theorized_facts"))
        self.assertEqual(row[:3], (fact_id, "The deal's terms were agreed", "contract"))


class EmptyRemediation(BareRowTestCase):
    def setUp(self):
        super().setUp()
        self.add_privileged_source(1)
        self.add_privileged_source(2, "privileged_work_product", "Theory of the case — A1")
        self.con.executescript("""
            INSERT INTO parties (party_id, name, party_type) VALUES (1, 'Client', 'individual');
            INSERT INTO sources (source_id, category, title) VALUES (9, 'court', 'Pleading');
            INSERT INTO facts (fact_id, description, category, date_of_fact, source_locator,
                               verified, created_date, notes, basis_of_knowledge, informant,
                               human_reviewed)
                VALUES (1, 'Privileged wording', 'breach', '2026-01-02', 'p. 2', 1, '2026-01-03',
                        'a note', 'personal', 'An Informant', 1);
            INSERT INTO facts (fact_id, description, category, created_date)
                VALUES (2, 'Theorized line one' || char(10) || 'line two', 'damages', '2026-01-04');
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (3, 'Linked privileged wording', '2026-01-05');
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (4, 'Wording with no provenance', '2026-01-06');
            INSERT INTO facts (fact_id, description, source_id, created_date)
                VALUES (5, 'Ordinary, own source', 9, '2026-01-07');
            INSERT INTO facts (fact_id, description, verified, created_date)
                VALUES (6, 'Rejected wording', -1, '2026-01-08');
            INSERT INTO facts (fact_id, description, verified, created_date)
                VALUES (7, 'Flagged wording', 2, '2026-01-09');
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (8, 'Multi source wording', '2026-01-10');
            INSERT INTO facts (fact_id, description, created_date)
                VALUES (9, 'Nine wording', '2026-01-11');
            INSERT INTO positions (fact_id, party_id, position) VALUES (3, 1, 'claim');
        """)
        self.add_provenance(1, 1, "old note")
        self.add_provenance(2, 2)
        self.add_provenance(3, 1)
        self.add_provenance(5, 1)
        self.add_provenance(6, 1)
        self.add_provenance(7, 1)
        self.add_provenance(8, 1)
        self.add_provenance(8, 2, "STATEMENT: Different wording")
        self.add_provenance(9, 1, "STATEMENT: Other wording")
        self.dry_run = doc_sql("bare-privileged-facts.md", "SELECT f.fact_id,")
        self.empty = doc_sql("bare-privileged-facts.md", "The privileged side first")

    def note(self, fact_id, source_id=None):
        sql = "SELECT source_note FROM privileged.fact_provenance WHERE fact_id = ?"
        params = [fact_id]
        if source_id is not None:
            sql += " AND source_id = ?"
            params.append(source_id)
        return self.one(sql + " ORDER BY source_id", params)[0]

    def test_dry_run_lists_every_row_by_action_and_shape(self):
        rows = self.con.execute(self.dry_run).fetchall()
        by_action = {}
        for fact_id, action, shape, verified, line_break in rows:
            by_action.setdefault(action, []).append((fact_id, shape, verified, line_break))
        self.assertEqual(sorted(by_action), ["blocked", "empty", "unexplained"])
        self.assertEqual([r[0] for r in by_action["blocked"]], [3])
        self.assertEqual([r[0] for r in by_action["unexplained"]], [4])
        self.assertEqual(
            by_action["empty"],
            [(1, "privileged_source", 1, 0), (2, "theorized", 0, 1),
             (6, "privileged_source", -1, 0), (7, "privileged_source", 2, 0),
             (8, "privileged_source", 0, 0), (9, "privileged_source", 0, 0)])
        self.assertNotIn(5, [r[0] for r in rows])

    def test_empty_moves_the_record_then_empties_the_row(self):
        self.con.executescript(self.empty)
        for fact_id in (1, 2, 6, 7, 8, 9):
            self.assertEqual(self.bare_state(fact_id), BARE_ROW, fact_id)
        self.assertEqual(
            self.one("SELECT source_note, verified FROM privileged.fact_provenance "
                     "WHERE fact_id = 1"),
            ("STATEMENT: Privileged wording\nCATEGORY: breach\nDATE OF FACT: 2026-01-02\n"
             "BASIS OF KNOWLEDGE: personal\nINFORMANT: An Informant\nNOTES: a note\n"
             "LOCATOR: p. 2\nCREATED: 2026-01-03\nHUMAN REVIEWED: 1\nold note", 1))
        self.assertEqual(
            self.note(2),
            "STATEMENT: Theorized line one line two\nCATEGORY: damages\nCREATED: 2026-01-04")

    def test_a_rejected_and_a_flagged_value_survive_on_the_provenance_row(self):
        self.con.executescript(self.empty)
        self.assertEqual(
            [r[0] for r in self.con.execute(
                "SELECT verified FROM privileged.fact_provenance "
                "WHERE fact_id IN (6, 7) ORDER BY fact_id")], [-1, 2])

    def test_the_record_goes_on_the_lowest_source_id_only(self):
        self.con.executescript(self.empty)
        self.assertTrue(self.note(8, 1).startswith("STATEMENT: Multi source wording\n"))
        self.assertEqual(self.note(8, 2), "STATEMENT: Different wording")

    def test_a_different_statement_line_does_not_stand_in_for_the_wording(self):
        self.con.executescript(self.empty)
        self.assertEqual(
            self.note(9),
            "STATEMENT: Nine wording\nCREATED: 2026-01-11\nSTATEMENT: Other wording")

    def test_empty_leaves_linked_unexplained_and_ordinary_rows_alone(self):
        before = {i: self.bare_state(i) for i in (3, 4, 5)}
        self.con.executescript(self.empty)
        self.assertEqual({i: self.bare_state(i) for i in (3, 4, 5)}, before)
        self.assertIsNone(self.note(3))

    def test_empty_is_idempotent_and_deletes_nothing(self):
        self.con.executescript(self.empty)
        notes = self.con.execute(
            "SELECT fact_id, source_id, source_note FROM privileged.fact_provenance "
            "ORDER BY 1, 2").fetchall()
        self.con.executescript(self.empty)
        self.assertEqual(
            self.con.execute("SELECT fact_id, source_id, source_note "
                             "FROM privileged.fact_provenance ORDER BY 1, 2").fetchall(), notes)
        self.assertEqual(self.one("SELECT COUNT(*) FROM main.facts")[0], 9)

    def test_the_wording_survives_on_the_privileged_side(self):
        self.con.executescript(self.empty)
        rows = {r[0]: r for r in self.con.execute(
            named_query("query_10_facts_only_privileged_sources"))}
        self.assertEqual(rows[1][1:3], ("Privileged wording", "breach"))
        self.assertEqual(rows[8][1], "Multi source wording")
        self.assertEqual(self.one("SELECT COUNT(*) FROM v_fact_status")[0], 3)

    def test_fill_makes_an_ordinary_row_and_refuses_a_row_that_is_not_bare(self):
        self.con.executescript(self.empty)
        fill = (doc_sql("bare-privileged-facts.md", "UPDATE main.facts\nSET description    =")
                .replace("<that source''s own Statement of Fact>", "Own wording")
                .replace("<the non-privileged main source_id>", "9")
                .replace("<its locator, or NULL>", "'para 4'"))
        self.con.executescript(fill.replace("<bare fact_id>", "3"))
        self.assertEqual(self.one("SELECT description FROM main.facts WHERE fact_id = 3")[0],
                         "Linked privileged wording")
        before = self.note(1)
        self.con.executescript(fill.replace("<bare fact_id>", "1"))
        self.assertEqual(
            self.one("SELECT description, source_id, source_locator FROM main.facts "
                     "WHERE fact_id = 1"), ("Own wording", 9, "para 4"))
        self.assertIsNotNone(
            self.one("SELECT created_date FROM main.facts WHERE fact_id = 1")[0])
        self.assertEqual(self.note(1), before)
        self.assertIn(
            1, [r[0] for r in self.con.execute("SELECT fact_id FROM v_fact_status")])


class ResolvePrivilegeLeavesBareRows(BareRowTestCase):
    def test_step_4b_script_moves_the_wording_before_emptying(self):
        self.con.executescript("""
            INSERT INTO sources (source_id, category, title, privilege_status, listed)
                VALUES (1, 'work_product', 'Internal memo', 'pending', 0);
            INSERT INTO facts (fact_id, description, category, source_id, source_locator,
                               verified, created_date)
                VALUES (1, 'First wording', 'breach', 1, 'para 1', 1, '2026-10-01');
            INSERT INTO facts (fact_id, description, source_id, created_date, notes)
                VALUES (2, 'Second wording', 1, '2026-10-01', 'UNCONFIRMED: check');
        """)
        script = (doc_sql("resolve-privilege.md", "Register the document on the privileged side")
                  .replace("<source_id>", "1")
                  .replace("<privileged_category>", "solicitor_client"))
        self.con.executescript(script)
        self.assertIsNone(self.one("SELECT 1 FROM main.sources WHERE source_id = 1"))
        self.assertEqual(self.bare_state(1), BARE_ROW)
        self.assertEqual(self.bare_state(2), BARE_ROW)
        notes = dict(self.con.execute(
            "SELECT fact_id, source_note FROM privileged.fact_provenance"))
        self.assertEqual(
            notes[1],
            "STATEMENT: First wording\nCATEGORY: breach\nLOCATOR: para 1\nCREATED: 2026-10-01")
        self.assertEqual(
            notes[2],
            "STATEMENT: Second wording\nNOTES: UNCONFIRMED: check\nCREATED: 2026-10-01")
        self.assertEqual(
            self.one("SELECT verified FROM privileged.fact_provenance WHERE fact_id = 1")[0], 1)


if __name__ == "__main__":
    unittest.main()
