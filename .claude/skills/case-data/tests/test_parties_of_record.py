"""Tests for parties_of_record.py, the read-only parties-of-record read the
drafting runtime spawns (design-decisions.md #55, #56).

Each fixture is a case-data folder holding a main.sqlite built from the
canonical schema.sql and stamped at the current version.

Run: python -m unittest discover -s .claude/skills/case-data/tests -p "test_parties_of_record.py"
"""

import hashlib
import os
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

import parties_of_record  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number)
VALUES (1, 'BCSC', 'S-290001'), (2, 'BCCA', 'CA59991');
INSERT INTO parties (party_id, name, party_type, lawyer_name, lawyer_firm,
                     lawyer_email, lawyer_phone, address,
                     service_address_filed_date, contact_info)
VALUES (1, 'Ada Client', 'individual', 'L. Lawyer', 'Logica Law',
        'l@logica.example', '604-555-0101', '1 Firm St', '2026-01-05', 'blob'),
       (2, 'Bert Other', 'individual', 'Y. Counsel', 'Y LLP',
        'y@y.example', '604-555-0102', '2 Y St', '2026-08-01', NULL),
       (3, 'Cleo Unrep', 'individual', NULL, NULL,
        NULL, NULL, '3 Home Rd', '2026-09-01', NULL);
INSERT INTO proceeding_parties (proceeding_id, party_id, role)
VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant'), (1, 3, 'defendant'),
       (2, 2, 'appellant');
"""

CONTRACT_KEYS = {
    "case_party_id", "name", "roles", "counsel_name", "counsel_firm",
    "counsel_email", "counsel_phone", "address_for_service",
    "address_for_service_filed_on",
}


class PartiesOfRecordTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.case_data_dir = Path(self._tmp.name) / "case-data"
        self.case_data_dir.mkdir()
        self.main = self.case_data_dir / "main.sqlite"

    def build(self, seed=SEED, version=resolve_paths.EXPECTED_USER_VERSION):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(self.main)
        try:
            con.executescript(sections["main"])
            con.executescript(seed)
            con.execute(f"PRAGMA user_version = {version}")
            con.commit()
        finally:
            con.close()

    def write(self, sql):
        con = sqlite3.connect(self.main)
        try:
            con.executescript(sql)
            con.commit()
        finally:
            con.close()

    def read(self, file_number):
        return parties_of_record.run(
            {"case_data_dir": str(self.case_data_dir), "file_number": file_number})

    def test_returns_each_party_of_record_with_its_own_counsel(self):
        self.build()
        result = self.read("S-290001")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["file_number"], "S-290001")
        self.assertEqual([p["case_party_id"] for p in result["parties"]], [1, 2, 3])
        for party in result["parties"]:
            self.assertEqual(set(party), CONTRACT_KEYS)
        self.assertEqual(result["parties"][1], {
            "case_party_id": 2, "name": "Bert Other", "roles": ["defendant"],
            "counsel_name": "Y. Counsel", "counsel_firm": "Y LLP",
            "counsel_email": "y@y.example", "counsel_phone": "604-555-0102",
            "address_for_service": "2 Y St",
            "address_for_service_filed_on": "2026-08-01",
        })
        # A self-represented party reads NULL counsel, never an empty string.
        unrep = result["parties"][2]
        self.assertEqual(
            (unrep["counsel_name"], unrep["counsel_firm"], unrep["counsel_email"],
             unrep["counsel_phone"], unrep["address_for_service"]),
            (None, None, None, None, "3 Home Rd"))

    def test_only_the_named_proceedings_parties_are_returned(self):
        self.build()
        result = self.read("CA59991")
        self.assertEqual([(p["case_party_id"], p["roles"]) for p in result["parties"]],
                         [(2, ["appellant"])])

    def test_an_override_wins_in_its_own_proceeding_only_and_field_by_field(self):
        self.build()
        self.write(
            "UPDATE proceeding_parties SET lawyer_name = 'Z. Appeal Counsel', "
            "lawyer_email = 'z@z.example' WHERE proceeding_id = 2 AND party_id = 2;")
        appeal = self.read("CA59991")["parties"][0]
        self.assertEqual(appeal["counsel_name"], "Z. Appeal Counsel")
        self.assertEqual(appeal["counsel_email"], "z@z.example")
        # A field the override leaves NULL falls back to the party's own value.
        self.assertEqual(appeal["counsel_firm"], "Y LLP")
        self.assertEqual(appeal["address_for_service"], "2 Y St")
        trial = self.read("S-290001")["parties"][1]
        self.assertEqual(trial["counsel_name"], "Y. Counsel")
        self.assertEqual(trial["counsel_email"], "y@y.example")

    def test_a_party_in_two_roles_is_one_entry_naming_both(self):
        self.build(SEED + "INSERT INTO proceeding_parties (proceeding_id, party_id, role) "
                          "VALUES (1, 2, 'third_party');")
        parties = self.read("S-290001")["parties"]
        self.assertEqual([p["case_party_id"] for p in parties], [1, 2, 3])
        self.assertEqual(parties[1]["roles"], ["defendant", "third_party"])

    def test_role_rows_carrying_different_overrides_are_unavailable(self):
        self.build(SEED + "INSERT INTO proceeding_parties (proceeding_id, party_id, role, "
                          "lawyer_name) VALUES (1, 2, 'third_party', 'Other Counsel');")
        result = self.read("S-290001")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("Bert Other", result["reason"])
        self.assertNotIn("parties", result)

    def test_the_file_number_is_matched_after_trimming(self):
        self.build()
        self.assertEqual(self.read("  S-290001 ")["status"], "ok")

    def test_no_matching_proceeding_is_unavailable_naming_the_file_number(self):
        self.build()
        result = self.read("S-999999")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("S-999999", result["reason"])

    def test_two_matching_proceedings_are_unavailable(self):
        # file_number is UNIQUE, so only a stored value differing by surrounding
        # whitespace can make the trimmed match ambiguous.
        self.build(SEED + "INSERT INTO proceedings (proceeding_id, court, file_number) "
                          "VALUES (3, 'BCSC', 'S-290001 ');")
        result = self.read("S-290001")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("2", result["reason"])

    def test_a_database_behind_the_current_version_is_unavailable_and_names_migrate(self):
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        result = self.read("S-290001")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("case_data__migrate", result["reason"])

    def test_no_case_data_database_is_not_applicable(self):
        result = self.read("S-290001")
        self.assertEqual(result["status"], "not_applicable")
        self.assertIn(str(self.case_data_dir), result["reason"])

    def test_a_blank_file_number_is_not_applicable(self):
        self.build()
        for blank in (None, "", "   "):
            with self.subTest(file_number=blank):
                self.assertEqual(self.read(blank)["status"], "not_applicable")

    def read_ids(self, case_party_ids):
        return parties_of_record.run(
            {"case_data_dir": str(self.case_data_dir), "file_number": None,
             "case_party_ids": case_party_ids})

    def test_case_party_ids_with_no_file_number_return_each_partys_own_counsel(self):
        self.build()
        # An override for another proceeding never applies: a pre-filing
        # proceeding has no court record of its own.
        self.write(
            "UPDATE proceeding_parties SET lawyer_name = 'Z. Appeal Counsel' "
            "WHERE proceeding_id = 2 AND party_id = 2;")
        result = self.read_ids([3, 2])
        self.assertEqual(result["status"], "ok")
        self.assertEqual([p["case_party_id"] for p in result["parties"]], [2, 3])
        for party in result["parties"]:
            self.assertEqual(set(party), CONTRACT_KEYS)
        self.assertEqual(result["parties"][0], {
            "case_party_id": 2, "name": "Bert Other", "roles": [],
            "counsel_name": "Y. Counsel", "counsel_firm": "Y LLP",
            "counsel_email": "y@y.example", "counsel_phone": "604-555-0102",
            "address_for_service": "2 Y St",
            "address_for_service_filed_on": "2026-08-01",
        })
        self.assertIsNone(result["parties"][1]["counsel_name"])

    def test_a_case_party_id_case_data_does_not_hold_is_absent(self):
        self.build()
        result = self.read_ids([1, 99])
        self.assertEqual(result["status"], "ok")
        self.assertEqual([p["case_party_id"] for p in result["parties"]], [1])

    def test_case_party_ids_on_a_database_behind_the_current_version_are_unavailable(self):
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        result = self.read_ids([1])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("case_data__migrate", result["reason"])

    def test_case_party_ids_with_no_case_data_database_are_not_applicable(self):
        result = self.read_ids([1])
        self.assertEqual(result["status"], "not_applicable")
        self.assertIn(str(self.case_data_dir), result["reason"])

    def test_the_read_never_writes_and_cleans_its_tagged_staging_folder(self):
        self.build()
        before = hashlib.sha256(self.main.read_bytes()).hexdigest()
        staging_root = Path(self._tmp.name) / "staging"
        staging_root.mkdir()
        with mock.patch.dict(os.environ, {"COCLERK_STAGING_TAG": "0123456789abcdef"}), \
                mock.patch("tempfile.tempdir", str(staging_root)):
            self.assertEqual(self.read("S-290001")["status"], "ok")
        self.assertEqual(hashlib.sha256(self.main.read_bytes()).hexdigest(), before)
        self.assertEqual(list(staging_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
