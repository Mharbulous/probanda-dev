"""The triage skill keeps the list in the store and names each save, resume and check where it is used."""
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def text(skill):
    return (SKILLS / skill / "SKILL.md").read_text(encoding="utf-8")


class StoreWiring(unittest.TestCase):
    def test_triage_names_the_save_tool_key_and_shape_itself(self):
        body = text("triage-billing-dates")
        for needle in ("time_pipeline__set", "candidate_date:<matter>:<first date>", "candidate_coverage:<matter>",
                       "expect_absent", "expect_sha256", "stale_write", "namespace `item`"):
            self.assertIn(needle, body)

    def test_triage_resumes_and_checks(self):
        body = text("triage-billing-dates")
        for needle in ("resume_plan.py plan", "resume_plan.py check", "candidate_list.py render", "candidate_list.py export", "new_days", "open_leads"):
            self.assertIn(needle, body)
        self.assertLess(body.index("resume_plan.py plan"), body.index("Fastest first"))

    def test_the_other_skills_name_the_kinds(self):
        self.assertIn("`candidate_date`", text("time-pipeline-data"))
        self.assertIn("`candidate_coverage`", text("time-pipeline-data"))
        self.assertIn("candidate_date", text("bill"))
        self.assertIn("candidates.json", text("bill"))


if __name__ == "__main__":
    unittest.main()
