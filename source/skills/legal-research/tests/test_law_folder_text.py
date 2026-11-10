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
SCHEMA = REPO_ROOT / "source" / "lawyer" / "mcp" / "src" / "schema" / "file.ts"
TOOL = "research_filing__law_folder_text"
READER = "research_filing__research_folder"


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

    def test_duty_two_stages_and_converts_nothing(self):
        duty = duty_two()
        for gone in ("soffice", "pdftotext", "device_stage_files", "stage", "pdf_pages__images", "page manifests"):
            self.assertNotIn(gone, duty)

    def test_the_agent_reads_the_rows_through_the_narrow_tool(self):
        duty = duty_two()
        self.assertIn("A PDF's `status: ok` row is its page manifest", duty)
        self.assertIn(f"each `text_path`, and the PDF of each `ocr_unavailable` row, through `{READER}`", duty)
        self.assertIn("The agent reads a scanned page only from its images", duty)

    def test_the_agents_hold_the_narrow_tool_and_not_the_whole_matter_one(self):
        for agent in ("research-agent", "memo-reviewer", "brief-reviewer"):
            text = (REPO_ROOT / "source" / "researcher" / "agents" / f"{agent}.md").read_text(encoding="utf-8")
            front = text.split("---")[1]
            for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
                self.assertIn(f"  - {prefix}{READER}\n", front, agent)
            self.assertNotIn("matter_folder", text, agent)

    def test_no_audit_file_tells_anyone_to_stage_or_render(self):
        for name in ("legal-audit-protocol.md", "legal-audit-scoped.md"):
            text = " ".join((SKILLS_ROOT / "shared" / name).read_text(encoding="utf-8").split())
            self.assertIn(f"`{READER}`", text, name)
            for gone in ("device_stage_files", "`6. LAW page manifests:`", "render it and re-invoke"):
                self.assertNotIn(gone, text, name)
        self.assertNotIn("extracted or staged", GATE.read_text(encoding="utf-8"))
        self.assertNotIn("6. LAW page manifests", GATE.read_text(encoding="utf-8"))

    def test_the_tools_duty_two_names_are_registered(self):
        schema = SCHEMA.read_text(encoding="utf-8")
        self.assertIn(f'name: "{TOOL}"', schema)
        self.assertIn(f'name: "{READER}"', schema)


if __name__ == "__main__":
    unittest.main()
