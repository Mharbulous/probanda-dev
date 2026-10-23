import unittest
from pathlib import Path


SKILLS = Path(__file__).resolve().parents[2]
JOB_SESSION = SKILLS / "work" / "references" / "job-session.md"
JOBS_CREATE = SKILLS / "drafting-data" / "references" / "jobs-create.md"


def atom(text, atom_id):
    start = text.index(f"<!-- atom id={atom_id} ")
    end = text.find("<!-- atom id=", start + 1)
    return text[start:end]


class FormIsOneJobTest(unittest.TestCase):
    """Filling one form is one job with a step per part, never one job per part."""

    @classmethod
    def setUpClass(cls):
        cls.rule = atom(JOB_SESSION.read_text(encoding="utf-8"), "work.outline.form-job")
        cls.create = JOBS_CREATE.read_text(encoding="utf-8")

    def test_a_form_is_one_job_with_a_step_per_part(self):
        self.assertIn("ops=new_work,change", self.rule)
        self.assertIn("is one job, whose steps are the form's parts, one step per part", self.rule)

    def test_a_further_part_extends_the_live_job(self):
        self.assertIn("the part is added to it as a further step, never written as another job", self.rule)
        self.assertIn("the part is a Change to it", self.rule)

    def test_adding_a_part_clears_the_plan_approval(self):
        self.assertIn("which clears its plan approval", self.rule)

    def test_after_a_completed_job_one_new_job_takes_every_remaining_part(self):
        self.assertIn("write one new job whose steps are every remaining part the practitioner asks for, never one job per part", self.rule)
        self.assertIn("A completed job is never reopened, deleted or merged for this", self.rule)

    def test_jobs_create_points_to_the_rule(self):
        self.assertIn("filling one form is one job with a step per part", self.create)
        self.assertIn('(`/work`\'s `job-session.md`, "A form is one job")', self.create)


if __name__ == "__main__":
    unittest.main()
