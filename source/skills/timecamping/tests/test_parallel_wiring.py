"""The day-reviewer agent, the parallel mode in /timecamping, and what the guards on delete and bulk_apply promise."""
import json
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[3]
AGENT = SOURCE / "billing" / "agents" / "day-reviewer.md"
SKILL = SOURCE / "skills" / "timecamping" / "SKILL.md"


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    head = text.split("---", 2)[1]
    fields, key = {}, None
    for line in head.splitlines():
        if re.match(r"^\s+- ", line) and key:
            fields[key].append(line.split("- ", 1)[1].strip())
        elif ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = [] if not value.strip() else value.strip()
    return fields, text


class Agent(unittest.TestCase):
    def test_pinned_to_opus_at_high_effort(self):
        fields, _ = frontmatter(AGENT)
        self.assertEqual(fields["model"], "claude-opus-5-5")
        self.assertEqual(fields["effort"], "high")

    def test_holds_the_day_read_the_stage_tool_and_read_only(self):
        fields, _ = frontmatter(AGENT)
        self.assertEqual(sorted(fields["tools"]), sorted([
            "mcp__plugin_billing_timekeeping__time_review__read_day",
            "mcp__plugin_billing_timekeeping__time_review__stage_day",
            "mcp__remote-devices__plugin_billing_timekeeping__time_review__read_day",
            "mcp__remote-devices__plugin_billing_timekeeping__time_review__stage_day",
            "Read",
        ]))

    def test_no_timecamp_tool_and_no_way_to_ask(self):
        fields, text = frontmatter(AGENT)
        for tool in fields["tools"]:
            self.assertNotIn("timecamp", tool.lower())
            self.assertNotIn("AskUserQuestion", tool)
        self.assertNotIn("AskUserQuestion", text)

    def test_preloads_the_inference_and_bill_style_skills(self):
        fields, _ = frontmatter(AGENT)
        self.assertEqual(sorted(fields["skills"]), ["billing:time-pipeline-data", "billing:timecamping", "billing:vet-billable-time"])

    def test_returns_a_status_line_and_an_end_line(self):
        _, text = frontmatter(AGENT)
        ret = text[text.index("## Return"):]
        self.assertRegex(ret, r"(?m)^status: ")
        self.assertRegex(ret, r"(?m)^end: ")

    def test_is_shipped_by_billing(self):
        assignment = json.loads((SOURCE / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("day-reviewer", assignment["plugins"]["billing"]["agents"])


class ParallelMode(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text(encoding="utf-8")
        self.section = self.text[self.text.index("### Parallel mode"):self.text.index("## Queries")]

    def test_claims_dispatches_ten_renews_and_judges(self):
        for needle in ("review_date__claim", "at most 10", "review_date__renew", "review_date__judge",
                       "time_review__save_evidence", "scripts/day_plan.py", "strongest candidate first"):
            self.assertIn(needle, self.section)

    def test_a_date_another_bill_holds_is_skipped_and_picked_up_when_judged(self):
        self.assertRegex(self.section, r"held.*skipped now")
        self.assertIn("judge each date once", self.section)

    def test_no_question_reaches_the_practitioner(self):
        self.assertIn("puts no question to the practitioner", self.section)

    def test_bill_calls_the_mode(self):
        bill = (SOURCE / "skills" / "bill" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Parallel mode", bill)
        self.assertIn("`/bill` calls this mode", self.section)
        self.assertNotIn("Not called by `/bill` yet", self.section)

    def test_screenshot_rule_reader_first_then_day_reviewer_on_doubt(self):
        step5 = self.text[self.text.index("### Step 5"):self.text.index("### Step 6")]
        self.assertIn("The reader looks first", step5)
        self.assertRegex(step5, r"(?s)day-reviewer.*only after\s+the\s+reader's answers leave a doubt")
        self.assertNotIn("only by `billing:screenshot-reader`", step5)
        self.assertIn("scripts/screenshot_pick.py", step5)


class Roster(unittest.TestCase):
    def test_timecamping_ships_its_scripts(self):
        roster = json.loads((SOURCE / "billing" / "roster.json").read_text(encoding="utf-8"))
        self.assertEqual(roster["timecamping"], ["scripts"])


if __name__ == "__main__":
    unittest.main()
