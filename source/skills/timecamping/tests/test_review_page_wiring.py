"""The review page's skill text (build plan slice 7): the two tools, the PC-only stop, and no mock-up of actions."""
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[3]
TIMECAMPING = (SOURCE / "skills" / "timecamping" / "SKILL.md").read_text(encoding="utf-8")
BILL = (SOURCE / "skills" / "bill" / "SKILL.md").read_text(encoding="utf-8")
DATA = (SOURCE / "skills" / "time-pipeline-data" / "SKILL.md").read_text(encoding="utf-8")
SCHEMA = (SOURCE / "lawyer" / "mcp" / "src" / "schema" / "time-review.ts").read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(f"### {heading}")
    end = text.find("\n## ", start)
    nxt = text.find("\n### ", start + 1)
    stops = [i for i in (end, nxt) if i != -1]
    return text[start:min(stops)] if stops else text[start:]


class ReviewPage(unittest.TestCase):
    def test_timecamping_names_both_tools(self):
        page = section(TIMECAMPING, "The review page")
        self.assertIn("time_review__serve_page", page)
        self.assertIn("time_review__wait_click", page)

    def test_timecamping_says_pc_only_and_to_stop_in_cowork(self):
        page = section(TIMECAMPING, "The review page")
        self.assertRegex(page, r"PC only")
        self.assertRegex(page, r"In Cowork, stop")

    def test_the_page_is_never_read_by_the_session(self):
        page = section(TIMECAMPING, "The review page")
        self.assertRegex(page, r"Never open, read or describe the page")

    def test_bill_stops_in_cowork_and_says_the_page_is_pc_only(self):
        step = next(line for line in BILL.splitlines() if "Judge the days" in line)
        self.assertIn("In Cowork, stop here", step)
        self.assertRegex(step, r"review page .* served on the PC only")

    def test_the_data_skill_lists_both_tools(self):
        for tool in ("time_review__serve_page", "time_review__wait_click"):
            self.assertIn(tool, DATA)
            self.assertIn(f'name: "{tool}"', SCHEMA)

    def test_no_action_buttons_are_promised(self):
        page = section(TIMECAMPING, "The review page")
        self.assertRegex(page, r"no action buttons yet")


if __name__ == "__main__":
    unittest.main()
