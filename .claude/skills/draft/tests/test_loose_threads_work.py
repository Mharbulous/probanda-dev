"""Tests for loose threads after the loose-threads job was dropped (2026-10-29).

A thread is worked only by outlining it on a Milestone the practitioner names. These pin the rules
that outlived the job: discards need the practitioner's yes, and an instruction about the held
job's own work is applied, not captured.

Run: python -m pytest .claude/skills/draft/tests/test_loose_threads_work.py -q
"""

import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
WREFS = DRAFT.parent / "work" / "references"


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def atom(text, atom_id):
    """An atom's tag line and body, up to the next atom tag or heading."""
    start = text.index(f"<!-- atom id={atom_id} ")
    rest = text[start:]
    ends = [m.start() for m in re.finditer(r"\n(?:<!-- atom |#)", rest)]
    return rest[:ends[0]] if ends else rest


class TriageTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.triage = read(WREFS / "loose-thread-triage.md")

    def test_discards_still_need_the_practitioners_yes(self):
        self.assertIn("Never infer a discard from a low rank.", self.triage)
        self.assertIn("- **Discard.** Applied only on their yes", self.triage)

    def test_the_triage_file_carries_no_atom_tag(self):
        self.assertNotIn("<!-- atom", self.triage)


class CaptureTest(unittest.TestCase):

    def test_an_instruction_about_the_held_jobs_own_work_is_applied(self):
        ideas = flat(atom(read(DRAFT / "SKILL.md"), "draft.ideas"))
        self.assertIn("An instruction that directs how the held job does its own work is applied, not captured: "
                      "capture is for work outside the job.", ideas)
        self.assertIn("it is consumed only by a later outlining session.", ideas)


if __name__ == "__main__":
    unittest.main()
