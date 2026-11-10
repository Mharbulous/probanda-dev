"""@query_30_instrument_text_source: the held copy of a statute's or regulation's
full text, which /legal-research uses when law-getter filed nothing.
Synthetic rows only."""

import importlib.util
import sqlite3
import sys
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
QUERIES_PATH = CASE_DATA_ROOT / "references" / "queries.sql"

sys.path.insert(0, str(SCRIPTS_DIR))
spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

MARKER = "-- @query_30_instrument_text_source"


def query_30():
    text = QUERIES_PATH.read_text(encoding="utf-8")
    start = text.index(MARKER)
    body = text.index("WITH held", start)
    return text[body : text.index(";", body) + 1]


class InstrumentTextSourceTests(unittest.TestCase):
    def setUp(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.con = sqlite3.connect(":memory:")
        self.con.execute("ATTACH DATABASE ':memory:' AS law")
        self.con.executescript(
            sections["law"].replace("CREATE TABLE ", "CREATE TABLE law.")
                           .replace("CREATE INDEX ", "CREATE INDEX law.")
        )
        self.con.executescript(
            "INSERT INTO law.authorities (authority_id, title, citation, authority_type, "
            "file_path, file_hash, notes) VALUES "
            "(1, 'Fixture Act', 'S.B.C. 2099, c. 1', 'statute', "
            " '4. APPEAL\\Book of Authorities.pdf', 'aa', 'Bundled authority, pp. 412–480'),"
            "(2, 'Fixture Act', 'SBC 2099, c 1', 'statute', "
            " '6. LAW\\Issue\\Fixture Act, SBC 2099, c 1.md', 'bb', NULL),"
            "(3, 'Fixture Act', 'SBC 2099, c 1', 'statute', 'old.md', 'cc', "
            " '[MERGED-INTO:#2 2026-10-06 test]'),"
            "(4, 'Fixture v Fixture', '2099 BCSC 1', 'case_law', 'case.pdf', 'dd', NULL),"
            "(5, 'Fixture Regulation', 'B.C. Reg. 1/2099', 'regulation', "
            " '4. APPEAL\\Book of Authorities.pdf', 'aa', 'Bundled authority, pp. 9–12; checked');"
        )
        self.sql = query_30()

    def tearDown(self):
        self.con.close()

    def run_query(self, citation, title):
        cur = self.con.execute(self.sql, (citation, title))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def test_citation_match_ignores_periods_spaces_and_case_standalone_first(self):
        rows = self.run_query("sbc 2099, c 1", "")
        self.assertEqual([r["authority_id"] for r in rows], [2, 1])
        self.assertIsNone(rows[0]["bundled_pages"])
        self.assertEqual(rows[1]["bundled_pages"], "412–480")
        self.assertEqual(rows[1]["file_path"], "4. APPEAL\\Book of Authorities.pdf")

    def test_title_fragment_finds_a_bundled_regulation_and_trims_its_range(self):
        rows = self.run_query("", "Regulation")
        self.assertEqual([(r["authority_id"], r["bundled_pages"]) for r in rows], [(5, "9–12")])

    def test_no_argument_matches_nothing_and_cases_and_tombstones_never_match(self):
        self.assertEqual(self.run_query("", ""), [])
        self.assertEqual(self.run_query("2099 BCSC 1", "Fixture v"), [])
        self.assertNotIn(3, [r["authority_id"] for r in self.run_query("SBC 2099, c 1", "Fixture")])


if __name__ == "__main__":
    unittest.main()
