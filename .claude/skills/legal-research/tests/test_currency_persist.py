"""Regression lock for where a gate-run statute-currency result is saved (#1635).

Sessions appended the currency result to the saved audit answer, breaking its
verbatim rule. The answer stays verbatim with nothing added, and the currency
result goes to its own file, in the answer's research folder, or `6. LAW\\` when
no audit agent ran.
"""
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"
CURRENCY_FILE = "`YYYY-MM-DD statute-currency check.md`"


def doctrine():
    return " ".join((SHARED / "legal-research.md").read_text(encoding="utf-8").split())


def step_one(text):
    start = text.index("1. Save it verbatim")
    return text[start:text.index("2. For every court decision", start)]


def currency_paragraph(text):
    start = text.index("**Statute currency.**")
    return text[start:]


class CurrencyPersistTests(unittest.TestCase):
    def test_answer_file_takes_nothing_added(self):
        self.assertIn("nothing added", step_one(doctrine()))

    def test_currency_result_has_its_own_file(self):
        self.assertIn(CURRENCY_FILE, currency_paragraph(doctrine()))

    def test_currency_file_has_a_folder_when_no_audit_agent_ran(self):
        self.assertIn("step 1's tool and folder (`6. LAW\\` if no audit agent ran)", currency_paragraph(doctrine()))


if __name__ == "__main__":
    unittest.main()
