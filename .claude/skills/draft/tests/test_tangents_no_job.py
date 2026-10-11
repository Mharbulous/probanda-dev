import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"
TANGENTS = Path(__file__).resolve().parents[1] / "references" / "tangents.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class TangentsWithNoJobTest(unittest.TestCase):
    """A session holding no job counts read-only requests as tangents (#1370)."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.tangents = paragraph(TANGENTS.read_text(encoding="utf-8"), "**Tangents.**")

    def test_job_held_budget_is_unchanged(self):
        self.assertIn(
            "Up to three consecutive read-only out-of-scope turns the practitioner started",
            self.tangents,
        )

    def test_no_job_read_only_turn_counts_except_a_mockup_or_outlining(self):
        self.assertIn(
            "turns the practitioner started "
            "(holding no job and not outlining, any except showing a mockup)",
            self.tangents,
        )

    def test_expand_scope_is_offered_only_with_a_job_held(self):
        self.assertIn(
            "On the third, offer a separate outlining session, "
            "or to expand scope (job held) or outline here (none).",
            self.tangents,
        )
        self.assertNotIn("offer to expand scope or take it", self.tangents)

    def test_capture_rule_is_unchanged(self):
        captured = paragraph(self.text, "**Captured ideas.**")
        self.assertIn("Whoever names it, capture comes first", captured)


if __name__ == "__main__":
    unittest.main()
