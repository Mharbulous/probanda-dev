"""Regression lock for /verify-law's plain-draft sweep (sweep-draft).

Spec `2026-10-06_research-results-to-board-spec.md` §4.4: on request only, lists unsupported
statements of law in a plain draft file by line number, states no law, writes nothing, and
stays inside this skill tree's hard constraint (no drafting database tool or skill).

Run: python -m pytest .claude/skills/verify-law/tests/test_sweep_draft_routing.py -q
"""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONT = (ROOT / "SKILL.md").read_text(encoding="utf-8")
SWEEP = (ROOT / "subskills" / "sweep-draft" / "SUBSKILL.md").read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


class SweepDraftTests(unittest.TestCase):
    def test_front_door_routes_it(self):
        self.assertIn("read `subskills/sweep-draft/SUBSKILL.md` and follow it as the active workflow", flat(FRONT))
        self.assertIn("(sweep-draft)", flat(FRONT.split("---")[1]))

    def test_on_request_only(self):
        self.assertIn("Never on your own initiative", SWEEP)

    def test_states_no_law_and_writes_nothing(self):
        sweep = flat(SWEEP)
        self.assertIn("States no law.", sweep)
        self.assertIn("Writes nothing: no edit to the draft, no file, no row, no captured item.", sweep)
        self.assertIn('`Line <n>: "<the sentence, word for word>"`', sweep)

    def test_offers_research_with_origin(self):
        self.assertIn('`Origin: <the draft\'s path>: "<the sentence>"`', flat(SWEEP))

    def test_writing_points_to_its_marker(self):
        self.assertIn("📚", SWEEP)

    def test_hard_constraint(self):
        for literal in ("drafting_data", "drafting_forms", "drafting-data", "legal_commons", "legal-commons"):
            self.assertNotIn(literal, SWEEP)


if __name__ == "__main__":
    unittest.main()
