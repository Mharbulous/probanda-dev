"""The bill record is wired into the skill text: namespace `bill` owned by bill-client, written and listed by /bill-client, ended by /issue-invoice."""
import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def text(skill):
    return (SKILLS / skill / "SKILL.md").read_text(encoding="utf-8")


class BillRecordWiring(unittest.TestCase):
    def test_namespace_row(self):
        self.assertTrue(re.search(r"^\| `bill` \| bill-client \|", text("time-pipeline-data"), re.M), "no `bill` row owned by bill-client")

    def test_namespace_count_agrees(self):
        self.assertFalse("three above" in text("time-pipeline-data"), "namespace count still contradicts the table")

    def test_bill_client_writes_and_finds_record(self):
        body = text("bill-client")
        self.assertTrue("time_pipeline__set" in body, "bill-client writes no bill record")
        self.assertTrue("time_pipeline__list" in body, "bill-client has no re-entry lookup")

    def test_issue_invoice_ends_record(self):
        self.assertTrue("time_pipeline__" in text("issue-invoice"), "issue-invoice does not end the bill record")


if __name__ == "__main__":
    unittest.main()
