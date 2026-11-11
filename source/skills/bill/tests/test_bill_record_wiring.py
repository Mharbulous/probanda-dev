"""The bill record is wired into the skill text: namespace `bill` owned by bill, written and listed by /bill, ended by /issue-invoice."""
import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def text(skill):
    return (SKILLS / skill / "SKILL.md").read_text(encoding="utf-8")


class BillRecordWiring(unittest.TestCase):
    def test_namespace_row(self):
        self.assertTrue(re.search(r"^\| `bill` \| bill \|", text("time-pipeline-data"), re.M), "no `bill` row owned by bill")

    def test_namespace_count_agrees(self):
        self.assertFalse("three above" in text("time-pipeline-data"), "namespace count still contradicts the table")

    def test_bill_client_writes_and_finds_record(self):
        body = text("bill")
        self.assertTrue("time_pipeline__set" in body, "bill writes no bill record")
        self.assertTrue("time_pipeline__list" in body, "bill has no re-entry lookup")

    def test_issue_invoice_ends_record(self):
        self.assertTrue("time_pipeline__" in text("issue-invoice"), "issue-invoice does not end the bill record")

    def test_saves_name_what_they_read(self):
        """Issue 284: a save names the hash it read, or that the key was absent, so two bills cannot overwrite each other."""
        body = text("bill")
        for name in ("expect_sha256", "expect_absent", "stale_write", "time_pipeline__get"):
            self.assertTrue(name in body, f"bill's save does not use {name}")
        self.assertTrue("expect_sha256" in text("issue-invoice"), "issue-invoice saves the bill record blind")

    def test_dates_are_claimed_not_appended(self):
        timecamping = text("timecamping")
        for name in ("review_date__claim", "review_date__renew", "review_date__judge", "review_date__release"):
            self.assertTrue(name in timecamping, f"/timecamping's candidate-list run does not call {name}")
        self.assertTrue("never appends to `judged-dates.jsonl`" in timecamping, "/timecamping may still append judged marks")
        body = text("bill")
        self.assertTrue("review_date__export" in body and "review_date__import_file" in body, "bill neither exports nor imports judged dates")


if __name__ == "__main__":
    unittest.main()
