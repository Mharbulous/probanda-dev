"""Tests for list_parties.py, the read-only list of every party that
practice_data__contact_checks spawns (ADR 0009, firm-wide contacts spec 4.4).

Each fixture is a matter-data folder holding a main.sqlite built from the
canonical schema.sql and stamped at the current version.

Run: python -m unittest discover -s source/skills/matter-data/tests -p "test_list_parties.py"
"""

import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import list_parties  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number)
VALUES (1, 'BCSC', 'S-290001'), (2, 'BCCA', 'CA59991');
INSERT INTO parties (party_id, name, party_type, lawyer_name, lawyer_firm,
                     lawyer_email, lawyer_phone, address, contact_info)
VALUES (1, 'Ada Client', 'individual', 'L. Lawyer', 'Logica Law',
        'l@logica.example', '604-555-0101', '1 Firm St', 'blob'),
       (2, 'Bert Other Ltd.', 'corporation', 'Y. Counsel', 'Y LLP',
        'y@y.example', '604-555-0102', '2 Y St', NULL),
       (3, 'Cleo Unnamed', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO proceeding_parties (proceeding_id, party_id, role)
VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant'), (2, 2, 'appellant');
"""

KEYS = {"party_id", "name", "party_type", "lawyer_name", "lawyer_firm", "lawyer_email",
        "lawyer_phone", "address", "contact_info", "proceedings"}


class ListPartiesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.case_data_dir = Path(self._tmp.name) / "matter-data"
        self.case_data_dir.mkdir()
        self.main = self.case_data_dir / "main.sqlite"

    def build(self, version=resolve_paths.EXPECTED_USER_VERSION):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(self.main)
        try:
            con.executescript(sections["main"])
            con.executescript(SEED)
            con.execute(f"PRAGMA user_version = {version}")
            con.commit()
        finally:
            con.close()

    def read(self):
        return list_parties.run({"case_data_dir": str(self.case_data_dir)})

    def test_every_party_with_its_proceedings_and_roles(self):
        self.build()
        result = self.read()
        self.assertEqual(result["status"], "ok")
        self.assertEqual([p["party_id"] for p in result["parties"]], [1, 2, 3])
        for party in result["parties"]:
            self.assertEqual(set(party), KEYS)
        self.assertEqual(result["parties"][1], {
            "party_id": 2, "name": "Bert Other Ltd.", "party_type": "corporation",
            "lawyer_name": "Y. Counsel", "lawyer_firm": "Y LLP", "lawyer_email": "y@y.example",
            "lawyer_phone": "604-555-0102", "address": "2 Y St", "contact_info": None,
            "proceedings": [{"proceeding_id": 1, "role": "defendant"},
                            {"proceeding_id": 2, "role": "appellant"}],
        })
        self.assertEqual(result["parties"][0]["contact_info"], "blob")

    def test_a_party_in_no_proceeding_is_listed_with_none(self):
        self.build()
        cleo = self.read()["parties"][2]
        self.assertEqual((cleo["party_type"], cleo["proceedings"]), (None, []))

    def test_a_database_behind_the_current_version_is_unavailable(self):
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        result = self.read()
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("matter_data__migrate", result["reason"])

    def test_no_case_data_database_is_not_applicable(self):
        result = self.read()
        self.assertEqual(result["status"], "not_applicable")
        self.assertIn(str(self.case_data_dir), result["reason"])

    def test_the_read_never_writes(self):
        self.build()
        before = hashlib.sha256(self.main.read_bytes()).hexdigest()
        self.assertEqual(self.read()["status"], "ok")
        self.assertEqual(hashlib.sha256(self.main.read_bytes()).hexdigest(), before)


if __name__ == "__main__":
    unittest.main()
