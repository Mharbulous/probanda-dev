"""/bill runs on the pipeline (build plan slice 11): Step 6 calls the parallel mode, the page and the block
export, /issue-invoice locks the blocks its lines rest on, and the stale triage key is gone."""
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[3]
SKILLS = SOURCE / "skills"
BILL = (SKILLS / "bill" / "SKILL.md").read_text(encoding="utf-8")
ISSUE = (SKILLS / "issue-invoice" / "SKILL.md").read_text(encoding="utf-8")
VET = (SKILLS / "vet-billable-time" / "SKILL.md").read_text(encoding="utf-8")
TIMECAMPING = (SKILLS / "timecamping" / "SKILL.md").read_text(encoding="utf-8")
EVIDENCE = (SKILLS / "timecamping-data" / "SKILL.md").read_text(encoding="utf-8")
DATA = (SKILLS / "time-pipeline-data" / "SKILL.md").read_text(encoding="utf-8")
REVIEW_SCHEMA = (SOURCE / "lawyer" / "mcp" / "src" / "schema" / "time-review.ts").read_text(encoding="utf-8")
DATE_SCHEMA = (SOURCE / "lawyer" / "mcp" / "src" / "schema" / "review-date.ts").read_text(encoding="utf-8")
DIAGRAMS = SOURCE.parent / "docs" / "diagrams" / "Built"


def step_six(text):
    return text[text.index("## Step 6"):text.index("## Step 7")]


class BillStepSix(unittest.TestCase):
    def test_it_calls_the_parallel_mode_the_page_and_the_export(self):
        step = step_six(BILL)
        for text in ("Parallel mode", "The review page", "time_review__export_blocks", "blocks.json",
                     "Only flagged blocks need action", "`/vet-billable-time`"):
            self.assertIn(text, step)

    def test_the_in_chat_day_review_and_line_vetting_are_gone_from_it(self):
        step = step_six(BILL)
        self.assertNotIn("invoke `/timecamping` with the candidate list", step)
        self.assertNotIn("Uncovered time.", step)
        self.assertNotIn("Vet the lines.", step)

    def test_cowork_stops_before_the_review_and_says_why(self):
        line = next(l for l in step_six(BILL).splitlines() if "Judge the days" in l)
        self.assertIn("In Cowork, stop here", line)
        self.assertRegex(line, r"review page .* served on the PC only")

    def test_a_date_judged_in_chat_is_judged_once_more(self):
        self.assertIn("judged in chat before the page existed", step_six(BILL))
        self.assertIn("review_date__rejudge", TIMECAMPING)
        self.assertIn('name: "review_date__rejudge"', DATE_SCHEMA)
        self.assertIn("review_date__rejudge", DATA)

    def test_the_bill_record_rows_describe_the_new_steps(self):
        self.assertRegex(BILL, r"\| 6\.3 \| The page has no flagged block left \|")
        self.assertIn("`vetted.json` path and hash", BILL)

    def test_the_chat_review_stays_for_work_outside_a_bill(self):
        self.assertIn("outside a bill", TIMECAMPING)
        self.assertIn("Step 6: Confidence-gated ceremony", TIMECAMPING)

    def test_the_new_tools_are_defined_and_documented(self):
        self.assertIn('name: "time_review__export_blocks"', REVIEW_SCHEMA)
        self.assertIn("time_review__export_blocks", DATA)

    def test_the_vet_skill_reads_the_blocks_file(self):
        self.assertIn("From reviewed blocks", VET)
        self.assertIn("scripts/blocks_export.py export", VET)
        self.assertTrue((SKILLS / "vet-billable-time" / "scripts" / "blocks_export.py").is_file())


class IssueInvoice(unittest.TestCase):
    def test_it_marks_the_blocks_its_lines_rest_on_as_issued(self):
        self.assertIn("time_review__mark_issued", ISSUE)
        self.assertIn("`block_ids` of every line in `line_map.json`", ISSUE)
        self.assertIn("the invoice number from step 1", ISSUE)

    def test_the_lock_comes_after_the_invoice_is_recorded_and_never_undoes_it(self):
        text = ISSUE[ISSUE.index("3. **Issue it.**"):ISSUE.index("4. **Draft the trust instruction.**")]
        self.assertLess(text.index("practice_data__issue_invoice"), text.index("time_review__mark_issued"))
        self.assertRegex(text, r"never undoes the issue")

    def test_a_chat_vetted_invoice_calls_nothing(self):
        self.assertIn("has no `block_ids`", ISSUE)

    def test_the_tool_it_calls_is_defined(self):
        self.assertIn('name: "time_review__mark_issued"', REVIEW_SCHEMA)


class StaleTriageKey(unittest.TestCase):
    def test_the_evidence_skill_no_longer_lists_a_triage_family(self):
        self.assertNotIn("`triage:<matter>:<date>`", EVIDENCE)
        self.assertIn("`candidate_date` records", EVIDENCE)

    def test_nothing_in_the_skills_writes_a_triage_key(self):
        pattern = re.compile(r"[`\"']triage:[<\w]")
        for path in SKILLS.rglob("*"):
            if path.suffix not in (".md", ".py", ".json") or "tests" in path.parts or "__pycache__" in path.parts:
                continue
            self.assertIsNone(pattern.search(path.read_text(encoding="utf-8", errors="ignore")), str(path))


class Diagram(unittest.TestCase):
    def test_the_diagram_and_its_prose_show_the_page_and_carry_a_fresh_tag(self):
        html = (DIAGRAMS / "Client billing.html").read_text(encoding="utf-8")
        prose = (DIAGRAMS / "Client billing process.md").read_text(encoding="utf-8")
        self.assertIn("review page", html)
        self.assertNotIn("Time-review database<br/>all evidence and decisions", html)
        self.assertRegex(html, r'data-based-on-commit="[0-9a-f]{40}"')
        self.assertIn("data-updated=\"2026-11-11", html)
        self.assertIn("### Step 6.3: The review page", prose)
        self.assertIn("blocks_export.py", prose)


if __name__ == "__main__":
    unittest.main()
