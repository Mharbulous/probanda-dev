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

    def test_practitioner_write_outside_scope_expands_it(self):
        scope = paragraph(self.text, "**Scope.**")
        self.assertIn(
            "A write the practitioner asked for outside it expands the scope "
            "(`/drafting-data` `jobs-run.md` §7) and proceeds. "
            "A write the session itself originated outside it is refused, "
            "and the expansion offered, itself in scope.",
            scope,
        )
        self.assertNotIn("Out of scope means refuse", scope)

    def test_rules_bind_the_model_not_the_practitioner(self):
        self.assertIn(
            "Rules in this skill constrain the model's route, never refuse the practitioner.",
            self.text,
        )
        ban = paragraph(self.text, "11. Never")
        self.assertIn("Never silently supersede another session's job.", ban)
        self.assertNotIn("Retirement refuses", ban)
        ideas = paragraph(self.text, "**Captured ideas.**")
        self.assertNotIn("never ripe", ideas)
        self.assertIn(
            "When the practitioner asks for one to be worked, outline it into a job and proceed.",
            ideas,
        )
        retire = (SKILL.parent / "references" / "retire-filing.md").read_text(encoding="utf-8")
        self.assertNotIn("stops the retirement outright", retire)
        self.assertIn("is never superseded silently", retire)


if __name__ == "__main__":
    unittest.main()
