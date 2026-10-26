"""Tests for list_record_names.py, the read-only list of the names a matter's case data
records, which the suggestion cross-check spawns (design decision #74).

Each fixture is a matter-data folder holding a main.sqlite built from the canonical
schema.sql and stamped at the current version.

Run: python -m unittest discover -s .claude/skills/matter-data/tests -p "test_list_record_names.py"
"""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import list_record_names  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause)
VALUES (1, 'BCSC', 'S-290001', 'Ada Client v Bert Other Ltd.'), (2, 'BCCA', 'CA59991', NULL);
INSERT INTO parties (party_id, name, lawyer_name, lawyer_firm)
VALUES (1, 'Ada Client', 'L. Lawyer', 'Logica Law'), (2, 'Bert Other Ltd.', NULL, NULL);
INSERT INTO sources (source_id, category, title, file_path)
VALUES (1, 'court', 'Notice of Civil Claim', 'Pleadings/2025-01-02 NOCC.pdf'),
       (2, 'correspondence', 'Letter to Bert', 'Correspondence\\\\2025-02-03 Letter to Bert.pdf'),
       (3, 'production', 'Receipt', NULL);
INSERT INTO housekeeping_reviews (file_hash, file_name, folder_type, outcome, reviewed_at)
VALUES ('abc', 'Reviewed Only.pdf', 'Correspondence', 'renamed', '2025-01-01');
"""


class ListRecordNamesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def build(self, name, version=resolve_paths.EXPECTED_USER_VERSION):
        folder = self.root / name
        folder.mkdir()
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(folder / "main.sqlite")
        try:
            con.executescript(sections["main"])
            con.executescript(SEED)
            con.execute(f"PRAGMA user_version = {version}")
            con.commit()
        finally:
            con.close()
        return str(folder)

    def test_titles_file_names_proceedings_and_parties(self):
        result = list_record_names.run({"case_data_dirs": [self.build("a")]})["results"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], {
            "status": "ok",
            "titles": ["Notice of Civil Claim", "Letter to Bert", "Receipt"],
            "file_names": ["2025-01-02 NOCC.pdf", "2025-02-03 Letter to Bert.pdf"],
            "matter": ["S-290001", "CA59991", "Ada Client v Bert Other Ltd."],
            "parties": ["Ada Client", "L. Lawyer", "Logica Law", "Bert Other Ltd."],
        })

    def test_the_review_log_is_never_read(self):
        result = list_record_names.run({"case_data_dirs": [self.build("a")]})["results"][0]
        self.assertNotIn("Reviewed Only.pdf", str(result))

    def test_one_result_per_folder_in_order_whatever_its_state(self):
        missing = self.root / "empty"
        missing.mkdir()
        behind = self.build("old", version=resolve_paths.EXPECTED_USER_VERSION - 1)
        result = list_record_names.run({"case_data_dirs": [self.build("a"), str(missing), behind]})["results"]
        self.assertEqual([r["status"] for r in result], ["ok", "not_applicable", "unavailable"])

    def test_nothing_is_written_and_no_staging_folder_is_left(self):
        folder = self.build("a")
        before = sorted(p.name for p in Path(folder).iterdir())
        staged = set(Path(tempfile.gettempdir()).glob("coclerk_names_*"))
        list_record_names.run({"case_data_dirs": [folder]})
        self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), before)
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("coclerk_names_*")), staged)


if __name__ == "__main__":
    unittest.main()
