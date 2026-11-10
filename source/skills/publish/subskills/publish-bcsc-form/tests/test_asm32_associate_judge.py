"""asm32's associate_judge frontmatter key (#451).

drafting_forms__emit_form32 always states the value, so fill_plain.py's
missing-key default of "yes" never decides a court filing's jurisdiction
sentence on the assembly path.

Run: python -m unittest discover -s .claude/skills/publish/subskills/publish-bcsc-form/tests -p "test_asm32*.py"
"""

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.asm32.common import parse_form32, required_scalars_present, transform  # noqa: E402

BODY = "## Part 2\n\n1. A fact.\n\n## Part 3\n\n2. A proposition.\n\n## Part 4\n\n- A document\n"


def form32(associate_judge_line):
    lines = [
        "---",
        "proposed_hearing: September 1, 2026",
        "hearing_place: 800 Smithe Street",
        "registry: Vancouver",
        "time_estimate: 45 minutes",
        'orders: [{"order": 1, "text": "costs"}]',
    ]
    if associate_judge_line:
        lines.append(associate_judge_line)
    return "\n".join(lines + ["---", "", BODY])


class TestAsm32AssociateJudge(unittest.TestCase):
    def parse(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "form-32.md"
            path.write_text(text, encoding="utf-8")
            return parse_form32(path)

    def test_key_is_required(self):
        with self.assertRaisesRegex(ValueError, "missing frontmatter key: associate_judge"):
            self.parse(form32(None))

    def test_value_must_be_yes_or_no(self):
        with self.assertRaisesRegex(ValueError, "associate_judge"):
            self.parse(form32("associate_judge: maybe"))

    def test_transform_carries_the_value_into_the_fill_context(self):
        for value in ("yes", "no"):
            additions, _, _ = transform(self.parse(form32(f"associate_judge: {value}")), {})
            self.assertEqual(additions["associate_judge"], value)

    def test_fill_guard_lists_associate_judge(self):
        ok, missing = required_scalars_present({
            "applicant_names": "A", "to_affected_parties": "B",
            "proposed_hearing": "September 1, 2026", "duration_hours": "0", "duration_minutes": "45",
        })
        self.assertFalse(ok)
        self.assertEqual(missing, ["associate_judge"])


if __name__ == "__main__":
    unittest.main()
