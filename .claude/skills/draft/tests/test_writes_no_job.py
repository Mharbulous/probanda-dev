import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"
PROCEDURE = Path(__file__).resolve().parents[1] / "references" / "procedure.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class WritesWithNoJobTest(unittest.TestCase):
    """A session holding no job outlines a requested write, never runs it (#1433)."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")

    def test_publish_hand_off_is_job_only(self):
        self.assertIn(
            "Sections 4, 9, 10, 12, 13 and 8's `/publish` hand-off "
            "run only inside an assigned job's approved plan",
            self.procedure,
        )

    def test_requested_job_only_work_is_outlined_with_no_job(self):
        scope = paragraph(self.text, "**Scope.**")
        self.assertIn(
            "No job: requested job-only work (section 7) is outlined, not run here.",
            scope,
        )

    def test_an_on_the_fly_revision_runs_with_or_without_a_job(self):
        scope = paragraph(self.text, "**Scope.**")
        self.assertIn(
            "An on-the-fly revision or reorder (rewording one reviewed paragraph, or swapping or moving "
            "facts on a Writing: `references/revise-on-the-fly.md`) "
            "runs in any session, holding a job or not, after its own foreign-scope read.",
            scope,
        )

    def test_scope_gate_for_a_held_job_is_unchanged(self):
        scope = paragraph(self.text, "**Scope.**")
        self.assertIn(
            "Out of scope means refuse and offer an expansion, itself in scope.",
            scope,
        )


if __name__ == "__main__":
    unittest.main()
