import re
import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]
CLOSEOUT = SKILLS / "drafting-data" / "references" / "jobs-closeout.md"
HOUSEKEEPING = SKILLS / "draft" / "rules" / "nodes" / "housekeeping.md"


def section(text, opening, closing):
    start = text.index(opening)
    return text[start:text.index(closing, start)]


def rule(text, rule_id):
    start = text.index(f"<!-- rule id={rule_id} ")
    body_start = text.index("\n", start) + 1
    end = text.find("\n<!--", body_start)
    return text[body_start:end if end != -1 else None]


class BoardMergeWordingTest(unittest.TestCase):
    """docs/ADRs/0010: a board merge combines only pages and goals, and the ask says so."""

    @classmethod
    def setUpClass(cls):
        cls.closeout = CLOSEOUT.read_text(encoding="utf-8")
        cls.housekeeping = HOUSEKEEPING.read_text(encoding="utf-8")

    def test_ask_says_writings_stay_separate(self):
        ask = section(self.closeout, "**Ask first.**", "**The write.**").lower()
        self.assertRegex(ask, r"each writing stays a separate filing")
        for kept in ("documents", "numbering"):
            self.assertIn(kept, ask)
        for combined in ("Milestone page", "view pages", "goal"):
            self.assertIn(combined, ask)

    def test_move_section_does_not_claim_merges(self):
        when = section(self.closeout, "## 10c.", "**The target.**")
        self.assertNotIn("or to merge two boards", when)
        self.assertIn("§10d", when)

    def test_draft_move_rule_does_not_route_merge(self):
        move = rule(self.housekeeping, "draft.shelve.move")
        self.assertNotRegex(move.lower(), r"merge")

    def test_draft_merge_rule_points_to_10d(self):
        merge = rule(self.housekeeping, "draft.shelve.merge")
        self.assertIn("§10d", merge)
        self.assertTrue(re.search(r"separate", merge))


if __name__ == "__main__":
    unittest.main()
