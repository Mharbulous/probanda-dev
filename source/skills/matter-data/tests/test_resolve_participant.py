"""Tests for resolve_participant.py, the read-only participant resolver behind
matter_data__resolve_participant (design-decisions.md #65, #66).

Each fixture is a matter-data folder holding a main.sqlite built from the
canonical schema.sql and stamped at the current version. Every name is invented.

Run: python -m unittest discover -s source/skills/matter-data/tests -p "test_resolve_participant.py"
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

import rebuild  # noqa: E402
import resolve_participant  # noqa: E402
import resolve_paths  # noqa: E402

SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number)
VALUES (1, 'BCSC', 'S-000001');
INSERT INTO parties (party_id, name, party_type, lawyer_name)
VALUES (1, 'Ada Plumtree', 'individual', 'Lior Vantongeren'),
       (2, 'Northwind Fabrication Ltd.', 'corporation', NULL),
       (3, 'Bo Ng', 'individual', NULL);
INSERT INTO proceeding_parties (proceeding_id, party_id, role)
VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant'), (1, 3, 'defendant');
INSERT INTO witnesses (witness_id, name, witness_type, field_of_expertise)
VALUES (1, 'Tamsin Oakhurst', 'fact', NULL),
       (2, 'Dr. Ravi Ellwood', 'expert', 'structural engineering');
INSERT INTO tribunal_members (tribunal_member_id, name, capacity, tribunal_body, proceeding_id)
VALUES (1, 'Moira Quillfeather', 'arbitrator', 'Example Arbitration Board', NULL);
INSERT INTO participant_aliases
    (party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind, approved_on)
VALUES (NULL, 0, NULL, 1, 'QuillfeatherM', 'file_code', '2026-10-06'),
       (NULL, 0, NULL, 1, 'Guillfeather', 'spelling', '2026-10-06'),
       (NULL, 0, NULL, 1, 'GuillfeatherM', 'file_code', '2026-10-06'),
       (NULL, 0, NULL, 1, 'M. Quilfeather', 'spelling', '2026-10-06'),
       (1, 1, NULL, NULL, 'VantongerenL', 'file_code', '2026-10-06');
"""


class ResolveParticipantTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.case_data_dir = Path(self._tmp.name) / "matter-data"
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

    def resolve(self, name):
        return resolve_participant.run({"case_data_dir": str(self.case_data_dir), "name": name})

    def only(self, name):
        result = self.resolve(name)
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(len(result["matches"]), 1, result)
        return result["matches"][0]

    def test_exact_alias_spelling_returns_every_search_term(self):
        self.build()
        m = self.only("Guillfeather")
        self.assertEqual((m["role"], m["id"], m["match"], m["matched"]),
                         ("tribunal", 1, "exact", "Guillfeather"))
        self.assertEqual((m["capacity"], m["body"]), ("arbitrator", "Example Arbitration Board"))
        for term in ("Moira Quillfeather", "QuillfeatherM", "Guillfeather",
                     "GuillfeatherM", "M. Quilfeather", "Quillfeather", "Quilfeather"):
            self.assertIn(term, m["search_terms"])
        self.assertNotIn("distance", m)

    def test_file_code_matches_exactly_and_as_a_surname_with_initial(self):
        self.build()
        self.assertEqual(self.only("quillfeatherm")["matched"], "QuillfeatherM")
        m = self.only("VantongerenL")
        self.assertEqual((m["role"], m["party_ids"], m["match"]), ("counsel", [1], "exact"))
        self.assertEqual(m["capacity"], "counsel for Ada Plumtree")
        self.assertIn("VantongerenL", m["search_terms"])

    def test_surname_and_initial_forms_match_exactly(self):
        self.build()
        for name in ("Quillfeather", "M. Quillfeather", "Quillfeather, Moira", "QUILLFEATHER"):
            self.assertEqual(self.only(name)["match"], "exact", name)

    def test_a_disagreeing_given_name_does_not_match(self):
        self.build()
        self.assertEqual(self.resolve("Zed Quillfeather")["status"], "not_found")

    def test_misspelt_surname_within_two_is_near_and_says_so(self):
        self.build()
        m = self.only("Quilfether")   # two edits from Quillfeather, one from Quilfeather
        self.assertEqual((m["role"], m["match"], m["distance"]), ("tribunal", "near", 1))
        self.assertEqual(m["matched"], "M. Quilfeather")
        m = self.only("Plumtry")
        self.assertEqual((m["role"], m["match"], m["distance"]), ("party", "near", 2))

    def test_three_edits_is_not_near(self):
        self.build()
        self.assertEqual(self.resolve("Plimtrio")["status"], "not_found")

    def test_short_surnames_never_fuzz(self):
        self.build()
        self.assertEqual(self.only("Ng")["match"], "exact")
        self.assertEqual(self.resolve("Ny")["status"], "not_found")
        self.assertEqual(self.resolve("Ngo")["status"], "not_found")

    def test_given_names_are_never_fuzzed(self):
        self.build()
        self.assertEqual(self.resolve("Tamzin Oakhurst")["status"], "not_found")
        self.assertEqual(self.only("T. Oakhurst")["role"], "witness")

    def test_expert_role_and_organisation_word_match(self):
        self.build()
        m = self.only("Ellwood")
        self.assertEqual((m["role"], m["capacity"]), ("expert", "structural engineering"))
        m = self.only("Northwind")
        self.assertEqual((m["role"], m["match"]), ("party", "exact"))
        self.assertEqual(self.resolve("Northwynd")["status"], "not_found")

    def test_unknown_name_is_not_found_with_a_reason(self):
        self.build()
        result = self.resolve("Hargreaves")
        self.assertEqual(result["status"], "not_found")
        self.assertIn("Hargreaves", result["reason"])

    def test_exact_matches_sort_before_near_ones(self):
        self.build(SEED + """
            INSERT INTO witnesses (witness_id, name, witness_type)
            VALUES (3, 'Ada Plumtre', 'fact');
        """)
        result = self.resolve("Plumtre")
        self.assertEqual([(m["role"], m["match"]) for m in result["matches"]],
                         [("witness", "exact"), ("party", "near")])

    def test_unavailable_without_a_name_a_database_or_the_current_schema(self):
        self.assertEqual(self.resolve("Quillfeather")["status"], "unavailable")
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        result = self.resolve("Quillfeather")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("matter_data__migrate", result["reason"])
        self.assertEqual(self.resolve("  ")["status"], "unavailable")

    def test_reads_a_copy_and_writes_nothing(self):
        self.build()
        before = self.main.read_bytes()
        self.resolve("Quillfeather")
        self.assertEqual(self.main.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
