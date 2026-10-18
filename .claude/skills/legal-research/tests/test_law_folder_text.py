"""Regression lock for duty 2 of the gate: tier-3 text comes from the runtime.

Hand staging and conversion of every `6. LAW` file failed transiently, and a
scanned decision converted to 69 bytes the agent could read as the decision.
Duty 2 now calls `research_filing__law_folder_text`, which flags such a file
unread (Engineering/1. Design/2026-10-05_law-folder-text-for-audit-verification.md).
"""
import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SKILLS_ROOT.parents[1]
GATE = SKILLS_ROOT / "shared" / "legal-research.md"
SCHEMA = REPO_ROOT / "source" / "lawyer" / "mcp" / "src" / "schema-gen.ts"
TOOL = "research_filing__law_folder_text"


def duty_two():
    text = GATE.read_text(encoding="utf-8")
    start = re.search(r"(?m)^2\. \*\*Tier 3", text).start()
    end = re.search(r"(?m)^3\. \*\*Tier 4", text).start()
    return " ".join(text[start:end].split())


class DutyTwoTests(unittest.TestCase):
    def test_duty_two_calls_the_runtime_tool_and_names_unread_rows(self):
        duty = duty_two()
        self.assertIn(f"call `{TOOL}`", duty)
        self.assertIn("`6. LAW listing and extracted text:`", duty)
        self.assertIn("`status: unread` row there as UNREAD", duty)
        self.assertIn("UNREAD, never absent", duty)

    def test_duty_two_stages_only_text_files_and_converts_nothing(self):
        duty = duty_two()
        self.assertIn(
            "stage only the rows' `text_path` files, at most 50 paths per `device_stage_files` call", duty
        )
        for gone in ("soffice", "pdftotext", "stage every file"):
            self.assertNotIn(gone, duty)

    def test_the_tool_duty_two_names_is_registered(self):
        self.assertIn(f'name: "{TOOL}"', SCHEMA.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
