"""The bill-of-costs chain's Cowork route (#1273), checked in its text.

gather-disbursements, itemize-boc and calculate-boc are Code-tab (PC) jobs, as publish-boc is
(ADR 0026): each refuses in Cowork before its first step, any tool call and any file write. No
Cowork instruction in the members or their shared workspace reference runs boc_context.py in the
sandbox shell, requests folder access, or writes a host path with the Write tool.

Run: python -m unittest discover -s .claude/skills/calculate/tests
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

CALCULATE_ROOT = Path(__file__).resolve().parents[1]
MEMBERS = ("gather-disbursements", "itemize-boc", "calculate-boc")
WORKSPACE = CALCULATE_ROOT / "references" / "bill-of-costs-workspace.md"

# A numbered step: a bold-numbered list item, or a numbered heading ("## 1.", "### Step 1").
FIRST_STEP = re.compile(r"^(\d+\. \*\*|#{2,3} (Step )?\d+\b)", re.MULTILINE)


def read(name: str) -> str:
    return (CALCULATE_ROOT / "subskills" / name / "SUBSKILL.md").read_text(encoding="utf-8")


class CodeTabRefusalTest(unittest.TestCase):
    def test_refusal_comes_before_the_first_step_and_the_first_read(self):
        for name in MEMBERS:
            with self.subTest(member=name):
                text = read(name)
                refusal = text.index("**In Cowork, stop here.**")
                step = FIRST_STEP.search(text)
                self.assertIsNotNone(step, name)
                self.assertLess(refusal, step.start())
                self.assertLess(refusal, text.index("\n## "))
                self.assertLess(refusal, text.index("Read `references/bill-of-costs-workspace.md`"))
                paragraph = " ".join(text[refusal:].split("\n\n", 1)[0].split())
                for phrase in (
                    "mcp__remote-devices__plugin_practice_data__",
                    "stop before any tool call or file write",
                    "Claude Code session in the desktop app's Code tab",
                    "where the Probanda plugin is installed",
                    "open a Code-tab session in their Coclerk checkout",
                ):
                    self.assertIn(phrase, paragraph)


class NoSandboxStepTest(unittest.TestCase):
    def test_no_text_tells_cowork_to_run_a_script_or_request_folder_access(self):
        texts = {name: read(name) for name in MEMBERS}
        texts["bill-of-costs-workspace.md"] = WORKSPACE.read_text(encoding="utf-8")
        for name, text in texts.items():
            with self.subTest(file=name):
                flat = " ".join(text.split())
                self.assertNotRegex(
                    flat, r"(?i)Cowork[^.]*\b(run (it|them|this) from the folder|request(s|ing)? (folder )?access)")
                self.assertNotIn("the path the session sees", flat)
                for sentence in re.split(r"(?<=[.:])\s+", flat):
                    if "Cowork" in sentence:
                        self.assertNotRegex(sentence, r"\bpython\b|\.py\b|Write tool", sentence)


if __name__ == "__main__":
    unittest.main()
