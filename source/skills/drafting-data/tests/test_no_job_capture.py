"""Tests for references/jobs-run.md §8a's text: a loose thread captured with no job held.

What the capture writes is tested against the store in source/lawyer/mcp/test/loose-threads-store.db.test.mjs.

Run: python -m pytest source/skills/drafting-data/tests/test_no_job_capture.py -q
"""

import unittest
from pathlib import Path

JOBS_RUN = Path(__file__).resolve().parents[1] / "references" / "jobs-run.md"


def section_8a():
    text = JOBS_RUN.read_text(encoding="utf-8")
    begin = text.index("### 8a. With no job held")
    return text[begin:text.index("## 9. Complete", begin)]


class NoJobCaptureTests(unittest.TestCase):
    def test_section_rules(self):
        text = " ".join(section_8a().split())
        self.assertIn("with `origin_job` left out", text)
        self.assertIn("by one `loose_threads__capture` call", text)
        self.assertNotIn("INTO seeds", text)
        self.assertIn("ask the practitioner once which proceeding the draft serves", text)
        self.assertIn("None: there is no board.", text)
        self.assertIn(
            '("With a board, the return\'s open items are sorted against it")', text
        )
        self.assertIn(
            "Never create a proceeding here, never create a job other than §3i's research offer job, "
            "and never assign anything: a loose thread is consumed only by a later outlining session "
            "(§3) or by §3i's add path.",
            text,
        )


if __name__ == "__main__":
    unittest.main()
