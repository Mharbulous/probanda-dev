"""Tests for cast_of_characters.py, the read-only list of everyone in a matter's
case data behind the Cast of Characters board (spec 4.2). Fictional test matter
T512; every name is invented.

Run: python -m pytest .claude/skills/matter-data/tests/test_cast_of_characters.py -q
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

import cast_of_characters  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number) VALUES (1, 'BCSC', 'S-000512');
INSERT INTO parties (party_id, name, party_type, lawyer_name, lawyer_firm, lawyer_email,
                     lawyer_phone, address, service_address_filed_date, replaced_representative)
VALUES (1, 'Alan Wei Park', 'individual', 'Pat Counsel', 'Example Law LLP', 'pat@examplelaw.example',
        '604-555-0100', '900-555 Sample St', '2026-03-01', NULL),
       (2, 'Grace Liu', 'individual', 'Old Counsel', 'Old Firm LLP', 'old@example.com', NULL, NULL, NULL,
        'Old Counsel replaced 2026-09-15');
INSERT INTO proceeding_parties (proceeding_id, party_id, role, lawyer_name, lawyer_firm, lawyer_email)
VALUES (1, 1, 'plaintiff', NULL, NULL, NULL),
       (1, 2, 'defendant', 'Sample Counsel B', 'Sample Law Corp.', 'counsel.b@example.com');
INSERT INTO witnesses (witness_id, name, witness_type, field_of_expertise, retained_by_party_id)
VALUES (1, 'Jordan Kim', 'fact', NULL, NULL), (2, 'Dr. Sample Air', 'expert', 'Air quality', 1);
INSERT INTO proceeding_witnesses (proceeding_id, witness_id, called_by_party_id) VALUES (1, 1, 1);
INSERT INTO tribunal_members (tribunal_member_id, name, capacity, tribunal_body, proceeding_id, notes)
VALUES (1, 'Justice Sample', 'judge', 'Supreme Court of BC', 1, 'Consent injunction order');
INSERT INTO participant_aliases (party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind, approved_on)
VALUES (1, 0, NULL, NULL, 'ParkA', 'file_code', '2026-11-01'),
       (1, 0, NULL, NULL, 'Wei Park', 'spelling', '2026-11-01'),
       (NULL, 0, 1, NULL, 'KimJ', 'file_code', '2026-11-01');
INSERT INTO sources (source_id, proceeding_id, category, title, filed_by_party_id, file_path)
VALUES (1, 1, 'court', 'Notice of Civil Claim', 1, 'C:\\T512\\2026-03-01 ParkA NOCC.pdf'),
       (2, 1, 'correspondence', 'Letter', NULL, 'C:\\T512\\2026-10-01 KimJ re smoke.pdf'),
       (3, 1, 'correspondence', 'Note about Justice Sample', NULL, NULL);
INSERT INTO facts (fact_id, description, source_id)
VALUES (1, 'Wei Park smelled smoke in Unit 210.', 1),
       (2, 'Jordan Kim identified the tenant.', 2),
       (3, 'The landlord replied.', 2);
INSERT INTO positions (fact_id, party_id, position, source_id) VALUES (3, 2, 'deny', 1);
"""


class CastOfCharactersTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.case_data_dir = Path(self._tmp.name) / "matter-data"
        self.case_data_dir.mkdir()

    def build(self, version=resolve_paths.EXPECTED_USER_VERSION):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        con = sqlite3.connect(self.case_data_dir / "main.sqlite")
        try:
            con.executescript(sections["main"])
            con.executescript(SEED)
            con.execute(f"PRAGMA user_version = {version}")
            con.commit()
        finally:
            con.close()

    def read(self):
        return cast_of_characters.run({"case_data_dir": str(self.case_data_dir)})

    def test_everyone_with_counsel_overrides_aliases_and_counts(self):
        self.build()
        result = self.read()
        self.assertEqual(result["status"], "ok")
        park, liu = result["parties"]
        self.assertEqual(park["proceedings"], [{"proceeding_id": 1, "role": "plaintiff"}])
        self.assertEqual(park["counsel_by_proceeding"][0]["lawyer_name"], "Pat Counsel")
        self.assertEqual(liu["counsel_by_proceeding"][0]["lawyer_name"], "Sample Counsel B",
                         "a proceeding's counsel overrides the party's own")
        self.assertEqual(liu["replaced_representative"], "Old Counsel replaced 2026-09-15")
        self.assertEqual([a["text"] for a in park["aliases"]], ["ParkA", "Wei Park"])
        self.assertEqual(park["counts"], {"facts": 1, "documents": 1})
        self.assertEqual(liu["counts"], {"facts": 1, "documents": 0}, "a position ties a fact to its party")

        kim, expert = result["witnesses"]
        self.assertEqual(kim["proceedings"], [{"proceeding_id": 1, "called_by_party_id": 1}])
        self.assertEqual(kim["counts"], {"facts": 1, "documents": 1}, "a file code in a file name names its owner")
        self.assertEqual(expert["retained_by_party_id"], 1)

        [judge] = result["tribunal_members"]
        self.assertEqual([judge["capacity"], judge["notes"]], ["judge", "Consent injunction order"])
        self.assertEqual(judge["counts"], {"facts": 0, "documents": 1})

    def test_cited_sources(self):
        self.build()
        result = cast_of_characters.run({"case_data_dir": str(self.case_data_dir), "source_ids": [2, 99]})
        self.assertEqual(result["sources"], [
            {"source_id": 2, "title": "Letter", "date": None, "file_path": "C:\\T512\\2026-10-01 KimJ re smoke.pdf"}])

    def test_behind_and_missing(self):
        self.assertEqual(self.read()["status"], "not_applicable")
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        self.assertEqual(self.read()["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
