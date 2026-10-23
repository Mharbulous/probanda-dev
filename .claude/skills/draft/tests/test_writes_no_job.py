import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"
PROCEDURE = Path(__file__).resolve().parents[1] / "references" / "procedure.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class WritesWithNoJobTest(unittest.TestCase):
    """A session holding no job hands job-only work on a structured filing to /work (#1433), and drafts
    a letter, email, memo or Unstructured Writing with no job."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")

    def test_publish_hand_off_is_job_only(self):
        self.assertIn(
            "Sections 4, 9, 10, 12, 13 and 8's `/publish` hand-off "
            "run inside an assigned job's approved plan for a structured filing. "
            "For a Writing drafted under `references/letters.md` or `references/unstructured.md` they run with no job",
            self.procedure,
        )

    def test_requested_job_only_work_is_outlined_with_no_job(self):
        scope = paragraph(self.text, "**Scope.**")
        self.assertIn(
            "No job: job-only work on a structured filing invokes `/work` for that Writing.",
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
