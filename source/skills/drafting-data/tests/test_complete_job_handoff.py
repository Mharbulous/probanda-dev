import unittest
from pathlib import Path


class TestCompleteJobHandsOffToGateCheck(unittest.TestCase):
    """jobs-run.md section 9 names section 14's open-jobs read as the next step, owed even with other jobs open (#1608)."""

    RUN = Path(__file__).resolve().parents[1] / "references" / "jobs-run.md"

    def test_confirm_read_hands_off_to_the_open_jobs_read(self):
        run = self.RUN.read_text(encoding="utf-8").replace("\r\n", "\n")
        section = run[run.index("## 9."):run.index("## 10.")]
        self.assertIn("the session runs §14's open-jobs read next, before presenting", section)
        self.assertIn("even with other jobs open (then no write)", section)


if __name__ == "__main__":
    unittest.main()
