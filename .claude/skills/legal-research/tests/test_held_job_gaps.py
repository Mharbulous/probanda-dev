"""Pins the held research job's scope rules: the plan tags each issue `scope: in` or `scope: new`
and its completion test lets an in-scope issue stand as a gap only once every tier has run; the
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
    def test_plan_tags_scope_and_tightens_the_completion_test(self):
        scoped = read("legal-audit-scoped.md")
        self.assertIn("  scope: in / new\n", scoped)
        self.assertIn("each scope: in issue answered with a pinpoint citation, or named as a gap only once every source tier has run on it", scoped)
        self.assertNotIn("named as a gap with its research offer", scoped)

    def test_mixed_coverage_writes_gap_lines_and_returns_them(self):
        protocol = read("legal-audit-protocol.md")
        self.assertIn("`gap: <issue> : tiers not run: <tier>[; <tier>]`", protocol)
        self.assertIn("`gap: <issue> : tiers not run: none` when every tier has run on it", protocol)
        self.assertIn("Then the notes' `Gaps`, `Flags` and `Origin` sections", protocol)

    def test_gate_runs_open_tiers_before_saving_a_held_job(self):
        rule = paragraph(read("legal-research.md"), "**On a held job, an open tier is not an answer.**")
        self.assertIn("is a pipeline step, not an answer: save nothing yet", rule)
        self.assertIn("each tier runs at most once per issue", rule)
        self.assertIn("A caller holding no job keeps the single loop above.", rule)
        self.assertLess(read("legal-research.md").index("**On a held job, an open tier is not an answer.**"),
                        read("legal-research.md").index("Persist in this order."))

    def test_held_job_new_issue_is_captured_not_researched(self):
        rule = paragraph(read("legal-research.md"), "**Approved plan issues become jobs.**")
        self.assertIn("A session\nholding a `/draft` job asks no approval and writes no job.", rule)
        self.assertIn("A `scope: new` issue is not researched", rule)
        self.assertIn("researched only if they name it", rule)


if __name__ == "__main__":
    unittest.main()
