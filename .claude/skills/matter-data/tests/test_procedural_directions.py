"""operations/procedural-directions.md: the forum's directions on record for one
proceeding, newest first, unlinked sources included. Synthetic rows only."""

import importlib.util
import sqlite3
import sys
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "procedural-directions.md"

sys.path.insert(0, str(SCRIPTS_DIR))
spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


def directions_query():
    text = OPERATION_PATH.read_text(encoding="utf-8")
    body = text.index("```sql\n") + len("```sql\n")
    return text[body : text.index(";", body) + 1]


class ProceduralDirectionsTests(unittest.TestCase):
    def setUp(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.con = sqlite3.connect(":memory:")
        self.con.executescript(sections["main"])
        self.con.execute("PRAGMA foreign_keys = OFF")
        rows = [
            # source_id, proceeding_id, title, date
            (1, 1, "Order of 2099-01-10", "2099-01-10"),
            (2, None, "Case manager email", "2099-03-02"),
            (3, 2, "Other proceeding order", "2099-04-01"),
            (4, 1, "Undated direction", None),
            (5, 1, "Order with effects applied", "2099-05-01"),
        ]
        for sid, pid, title, date in rows:
            self.con.execute(
                "INSERT INTO sources (source_id, proceeding_id, category, title, date) "
                "VALUES (?, ?, ?, ?, ?)",
                (sid, pid, self.category(), title, date),
            )
        refs = [
            (1, 1, "procedural", 'DIRECTION: Justice A: "First sentence."'),
            (2, 1, "procedural", 'DIRECTION: Justice A: "Second sentence."'),
            (3, 2, "procedural", 'DIRECTION: Case manager: "Later sentence."'),
            (4, 3, "procedural", 'DIRECTION: Justice B: "Elsewhere."'),
            (5, 4, "procedural", 'DIRECTION: Registrar: "Undated."'),
            (6, 5, "procedural", "ORDER-EFFECT: trial date updated"),
            (7, 1, "other", 'DIRECTION: Justice A: "Wrong type."'),
        ]
        self.con.executemany(
            "INSERT INTO source_references (source_reference_id, source_id, reference_type, description) "
            "VALUES (?, ?, ?, ?)",
            refs,
        )
        self.sql = directions_query()

    def category(self):
        ddl = self.con.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'sources'"
        ).fetchone()[0]
        start = ddl.index("category")
        return ddl[start:].split("'")[1]

    def tearDown(self):
        self.con.close()

    def run_query(self, proceeding_id):
        cur = self.con.execute(self.sql, (proceeding_id,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def test_newest_first_unlinked_included_undated_last_document_order_kept(self):
        rows = self.run_query(1)
        self.assertEqual(
            [r["description"] for r in rows],
            [
                'DIRECTION: Case manager: "Later sentence."',
                'DIRECTION: Justice A: "First sentence."',
                'DIRECTION: Justice A: "Second sentence."',
                'DIRECTION: Registrar: "Undated."',
            ],
        )
        self.assertIsNone(rows[0]["proceeding_id"])
        self.assertEqual(rows[1]["direction_date"], "2099-01-10")

    def test_other_proceedings_order_effects_and_other_types_never_match(self):
        descriptions = [r["description"] for r in self.run_query(1)]
        self.assertNotIn('DIRECTION: Justice B: "Elsewhere."', descriptions)
        self.assertNotIn("ORDER-EFFECT: trial date updated", descriptions)
        self.assertNotIn('DIRECTION: Justice A: "Wrong type."', descriptions)


if __name__ == "__main__":
    unittest.main()
