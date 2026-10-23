import unittest
from pathlib import Path


WORK_JOB_SESSION = Path(__file__).resolve().parents[2] / "work" / "references" / "job-session.md"
JOB_SESSION = Path(__file__).resolve().parents[1] / "references" / "job-session.md"
TAKE_OVER = Path(__file__).resolve().parents[1] / "references" / "take-over.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class VacuousStepReadBackTest(unittest.TestCase):
    """A step that only restates the job's request is named as naming no work, never announced or dispatched."""

    @classmethod
    def setUpClass(cls):
        cls.text = JOB_SESSION.read_text(encoding="utf-8")
        cls.work = WORK_JOB_SESSION.read_text(encoding="utf-8")
        cls.rule = paragraph(cls.work, "**A step that only restates the request.**")

    def test_rule_is_served_before_the_assigning_write(self):
        self.assertIn("<!-- atom id=work.steps.restated ops=dispatch,pre_claim,plan_readback,take_over -->", self.work)
        self.assertIn("Before the assigning write of every ready job, one-step or many-step", self.rule)

    def test_step_is_compared_with_title_and_intent_after_normalising(self):
        self.assertIn(
            "compare each step not yet done with the job's title and with its intent, ignoring case, "
            "surrounding and repeated whitespace, trailing punctuation",
            self.rule,
        )
        self.assertIn("A step that equals or contains the title or the intent names no work", self.rule)

    def test_read_back_names_it_and_rewrites_it_with_no_adoption(self):
        self.assertIn("only restates the request and so names no work", self.rule)
        self.assertIn("with no adoption ceremony (`shared/paralegal-posture.md` section 3)", self.rule)
        self.assertIn("Assign nothing and write nothing until it is rewritten.", self.rule)

    def test_never_announced_and_the_job_does_not_proceed(self):
        self.assertIn("never dispatch on it, and never ask whether it is still right.", self.rule)
        self.assertIn("While any such step stands, the job is neither assigned nor proceeds", self.rule)

    def test_taken_over_read_back_defers_to_the_rule(self):
        taken_over = paragraph(TAKE_OVER.read_text(encoding="utf-8"), "**A taken-over job:**")
        self.assertIn(
            "Where an unfinished step only restates the request (`work/references/job-session.md`, "
            '"A step that only restates the request"), name it as naming no work',
            taken_over,
        )
        self.assertIn("Never ask whether the next unfinished step is still right.", taken_over)

    def test_announce_and_proceed_stops_for_it(self):
        announce = paragraph(self.text, "**Announce and proceed.**")
        self.assertIn("Once the premise check and the restating check (`work/references/job-session.md`) have passed", announce)
        stops = paragraph(self.text, "The only stops before the first step are")
        self.assertIn("and a step that only restates the request (`work/references/job-session.md`).", stops)

    def test_one_step_job_is_not_exempt(self):
        self.assertNotIn("dispatched on its recorded intent as below, unchanged", self.text)
        one_step = paragraph(self.text, "**A newly assigned one-step job**")
        self.assertIn("runs on its creation approval once its step names work. No pause", one_step)


if __name__ == "__main__":
    unittest.main()
