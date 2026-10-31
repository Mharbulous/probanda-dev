"""Pins the held research job's gap rules: the
opinion audit writes one `gap:` line per issue it leaves open and returns them; and the gate, on a
held job, runs each tier a gap names before saving, once per tier per issue.

Spec: docs/Specs/2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md

Run: python -m pytest .claude/skills/legal-research/tests/test_held_job_gaps.py -q
"""

import unittest
from pathlib import Path

SHARED = Path(__file__).resolve().parents[2] / "shared"


def read(name):
    return (SHARED / name).read_text(encoding="utf-8")


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n\n", start)
    return text[start:end if end != -1 else None]


class HeldJobGapsTest(unittest.TestCase):
    def test_mixed_coverage_writes_gap_lines_and_returns_them(self):
        protocol = read("legal-audit-protocol.md")
        self.assertIn("`gap: <issue> : tiers not run: <tier>[; <tier>]`", protocol)
        self.assertNotIn("tiers not run: none", protocol)
        self.assertIn("Then the notes' `Gaps`, `Flags` and `Origin` sections", protocol)

    def test_gate_runs_open_tiers_before_saving_a_held_job(self):
        rule = " ".join(paragraph(read("legal-research.md"), "**On a held job, an open tier is not an answer.**").split())
        self.assertIn("are a pipeline step, not an answer: save nothing yet", rule)
        self.assertIn("A `gap:` line it does not confirm as `required` adds no step.", rule)
        self.assertIn("Each tier runs at most once per issue: the tier is its kind and object as a `gap:` line names it "
                      "(Westlaw, `Legislation: <citation>`, `6. LAW: <file>`, Commons, `Note-up: <citation>`), never the "
                      "Westlaw query's subject, and the issue is the memo's one Issue.", rule)
        self.assertIn("A caller holding no job runs the same loop, adding and stamping no steps.", rule)
        self.assertLess(read("legal-research.md").index("**On a held job, an open tier is not an answer.**"),
                        read("legal-research.md").index("Persist in this order."))


if __name__ == "__main__":
    unittest.main()
