"""Each non-BCSC publish subskill's Cowork route (#1268, ADR 0026), checked in its text.

publish-general, publish-bcca-factum and publish-vaniac-package call a host tool in Cowork, so
their Cowork branch never runs a fill in the sandbox shell or writes a host path with the Write
tool. publish-bcca-book, publish-boc, publish-notice-to-admit and publish-small-claims-form are
Code-tab (PC) jobs: each refuses in Cowork before its first step.

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import re
import unittest

import support

SUBSKILLS = support.PUBLISH_ROOT / "subskills"

HOST_TOOL = {
    "publish-general": "drafting_forms__publish_general",
    "publish-bcca-factum": "drafting_forms__publish_bcca_factum",
    "publish-vaniac-package": "drafting_forms__publish_vaniac_package",
}
REFUSING = ("publish-bcca-book", "publish-boc", "publish-notice-to-admit", "publish-small-claims-form", "renumber-affidavit")

# A numbered step: a bold-numbered list item, or a numbered heading ("## 1.", "### Step 1").
FIRST_STEP = re.compile(r"^(\d+\. \*\*|#{2,3} (Step )?\d+\b)", re.MULTILINE)


def read(name: str) -> str:
    return (SUBSKILLS / name / "SUBSKILL.md").read_text(encoding="utf-8")


def cowork_branch(text: str) -> str:
    match = re.search(r"^## In Cowork\n(.*?)(?=^## )", text, re.MULTILINE | re.DOTALL)
    assert match, "no '## In Cowork' section"
    return match.group(1)


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.:])\s+", " ".join(text.split())) if s]


class HostToolBranchTest(unittest.TestCase):
    def test_branch_calls_its_host_tool_before_the_steps(self):
        for name, tool in HOST_TOOL.items():
            with self.subTest(subskill=name):
                text = read(name)
                self.assertIn(tool, cowork_branch(text))
                self.assertLess(text.index("## In Cowork"), text.index("## Steps"))

    def test_branch_runs_no_fill_in_the_sandbox_and_writes_nothing_with_the_write_tool(self):
        for name in HOST_TOOL:
            with self.subTest(subskill=name):
                branch = cowork_branch(read(name))
                self.assertNotIn("```", branch)
                self.assertNotRegex(branch, r"\bpython\b|\.py\b|\bbash\b|BASH\(")
                for sentence in sentences(branch):
                    if "Write tool" in sentence or "sandbox shell" in sentence:
                        self.assertRegex(sentence, r"\b([Nn]ever|not the host)\b", sentence)


class NoSandboxStepTest(unittest.TestCase):
    def test_no_step_tells_cowork_to_run_a_script_or_request_folder_access(self):
        for name in (*HOST_TOOL, *REFUSING):
            with self.subTest(subskill=name):
                text = " ".join(read(name).split())
                self.assertNotRegex(text, r"(?i)\bin Cowork,? run (it|them) from the folder")
                self.assertNotRegex(text, r"(?i)\bin Cowork,? request access")
                self.assertNotIn("the path the session sees", text)


class CodeTabRefusalTest(unittest.TestCase):
    def test_refusal_comes_before_the_first_step(self):
        for name in REFUSING:
            with self.subTest(subskill=name):
                text = read(name)
                refusal = text.index("**In Cowork, stop here.**")
                self.assertLess(refusal, FIRST_STEP.search(text).start())
                self.assertLess(refusal, text.index("\n## "))
                paragraph = " ".join(text[refusal:].split("\n\n", 1)[0].split())
                for phrase in (
                    "mcp__remote-devices__plugin_probanda_data__",
                    "stop before any tool call or file write",
                    "Claude Code session in the desktop app's Code tab",
                    "where the Probanda plugin is installed",
                    "open a Code-tab session in their Coclerk checkout",
                ):
                    self.assertIn(phrase, paragraph)


if __name__ == "__main__":
    unittest.main()
