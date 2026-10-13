"""The fact-swap script of references/paragraph-revision.md §6, run on the real engine against a
fresh database at the current schema the way drafting_data__execute runs it: one executescript wrapped in BEGIN and
COMMIT. Proves the cross-guarded UPDATEs land together or not at all, and that each audit INSERT,
guarded on changes() = 1, lands only when the statement before it changed one row (trigger writes
excluded)."""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

# paragraph-revision.md §6 step 3, the general shape. swap_script(31, 3, 32, 4, 'sess-a1') is the
# section's example text exactly.
SWAP = """UPDATE filing_facts SET ordinal = {b}
 WHERE id = {a_id} AND ordinal = {a}
   AND (SELECT ordinal FROM filing_facts WHERE id = {b_id}) = {b}
   AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NULL AND retired_on IS NULL);
UPDATE filing_facts SET ordinal = {a}
 WHERE id = {b_id} AND ordinal = {b}
   AND (SELECT ordinal FROM filing_facts WHERE id = {a_id}) = {b};
INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT 'filing_facts', {a_id}, 'ordinal', '{a}', '{b}', NULL, NULL, NULL, 'move', 'practitioner', '{session}', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE changes() = 1;
INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT 'filing_facts', {b_id}, 'ordinal', '{b}', '{a}', NULL, NULL, NULL, 'move', 'practitioner', '{session}', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE changes() = 1;"""


def swap_script(a_id, a, b_id, b, session="sess-a1"):
    return SWAP.format(a_id=a_id, a=a, b_id=b_id, b=b, session=session)


# Filing 8, form, part 2: rows 31, 32, 33 hold facts 5, 9, 11 at ordinals 3, 4, 5. The same facts
# also sit in the filing's Written Arguments (rows 41, 42, 43, ordinals 1, 2, 3).
SEED = """
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
    INSERT INTO filings (id, proceeding_id, kind, title) VALUES (8, 1, 'notice_of_application', 'Notice of Application');
    INSERT INTO facts (id, proceeding_id, postulate) VALUES (5, 1, 'Fact five.'), (9, 1, 'Fact nine.'), (11, 1, 'Fact eleven.');
    INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES
        (31, 8, 5, 'form', 'part2', 3), (32, 8, 9, 'form', 'part2', 4), (33, 8, 11, 'form', 'part2', 5),
        (41, 8, 5, 'written_argument', 'part2', 1), (42, 8, 9, 'written_argument', 'part2', 2), (43, 8, 11, 'written_argument', 'part2', 3);
"""


class TestFactReorderScript(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "submission.sqlite"
        self.assertEqual(engine.run({"db_path": str(self.db_path)})["schema_version"], engine.TARGET_SCHEMA_VERSION)
        self.con = sqlite3.connect(str(self.db_path))
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(SEED)

    def execute(self, script):
        # drafting_data__execute's own wrapper (submission/backend.ts).
        self.con.executescript("BEGIN;\n" + script + "\n;\nCOMMIT;")

    def ordinals(self):
        return dict(self.con.execute("SELECT id, ordinal FROM filing_facts ORDER BY id").fetchall())

    def audit(self):
        return self.con.execute(
            "SELECT entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token "
            "FROM paragraph_revisions ORDER BY id"
        ).fetchall()

    def revision(self):
        return int(self.con.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def assert_nothing_written(self, ordinals, revision):
        self.assertEqual(self.ordinals(), ordinals)
        self.assertEqual(self.audit(), [])
        self.assertEqual(self.revision(), revision)

    def test_a_the_swap_lands(self):
        before = self.ordinals()
        revision = self.revision()
        self.execute(swap_script(31, 3, 32, 4))
        self.assertEqual(self.ordinals(), {**before, 31: 4, 32: 3})
        self.assertEqual(self.audit(), [
            ("filing_facts", 31, "ordinal", "3", "4", None, None, None, "move", "practitioner", "sess-a1"),
            ("filing_facts", 32, "ordinal", "4", "3", None, None, None, "move", "practitioner", "sess-a1"),
        ])
        # Two filing_facts updates, one revision bump each. Both audit rows landed, so changes() after
        # each UPDATE read 1, not 2: the trigger's db_meta write is not counted.
        self.assertEqual(self.revision(), revision + 2)

    def test_b_a_peer_already_moved_b_elsewhere(self):
        self.con.execute("UPDATE filing_facts SET ordinal = 7 WHERE id = 32")
        self.con.commit()
        before, revision = self.ordinals(), self.revision()
        self.execute(swap_script(31, 3, 32, 4))
        self.assert_nothing_written(before, revision)

    def test_c_a_peer_already_made_the_identical_swap(self):
        self.con.executescript("UPDATE filing_facts SET ordinal = 4 WHERE id = 31; UPDATE filing_facts SET ordinal = 3 WHERE id = 32;")
        before, revision = self.ordinals(), self.revision()
        # The rows already hold the new ordinals, so an INSERT guarded on the row's new ordinal would
        # have recorded a false audit row here. Only the changes() guard stops it.
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM filing_facts WHERE id = 31 AND ordinal = 4").fetchone(), (1,))
        self.assertEqual(self.con.execute("SELECT COUNT(*) FROM filing_facts WHERE id = 32 AND ordinal = 3").fetchone(), (1,))
        self.execute(swap_script(31, 3, 32, 4))
        self.assert_nothing_written(before, revision)

    def test_d_a_sent_or_retired_writing_is_not_written(self):
        for column, value in (("filed_on", "2026-10-01"), ("retired_on", "2026-10-02")):
            with self.subTest(column):
                self.con.execute(f"UPDATE filings SET {column} = ? WHERE id = 8", (value,))
                self.con.commit()
                before, revision = self.ordinals(), self.revision()
                self.execute(swap_script(31, 3, 32, 4))
                self.assert_nothing_written(before, revision)
                self.con.execute(f"UPDATE filings SET {column} = NULL WHERE id = 8")
                self.con.commit()

    def test_e_a_conflicting_pair_composed_from_the_pre_swap_state_writes_nothing(self):
        second = swap_script(32, 4, 33, 5)  # composed before the first swap ran
        self.execute(swap_script(31, 3, 32, 4))
        after_first, revision = self.ordinals(), self.revision()
        self.assertEqual(len(self.audit()), 2)
        self.execute(second)
        self.assertEqual(self.ordinals(), after_first)
        self.assertEqual(len(self.audit()), 2)
        self.assertEqual(self.revision(), revision)

    def test_f_a_form_swap_leaves_the_written_argument_rows_untouched(self):
        self.execute(swap_script(31, 3, 32, 4))
        self.assertEqual(
            self.con.execute("SELECT id, fact_id, ordinal FROM filing_facts WHERE document = 'written_argument' ORDER BY id").fetchall(),
            [(41, 5, 1), (42, 9, 2), (43, 11, 3)],
        )


if __name__ == "__main__":
    unittest.main()
