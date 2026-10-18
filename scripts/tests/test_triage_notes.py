#!/usr/bin/env python3
"""
triage_notes: a hat's notes file is shown step by step and capped at 3000 characters.

Run: python -m pytest -q scripts/tests/test_triage_notes.py
"""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(SCRIPTS, "triage_notes.py")
_spec = importlib.util.spec_from_file_location("triage_notes", SCRIPT)
triage_notes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(triage_notes)

PHRASE = triage_notes.PHRASE


class Show(unittest.TestCase):
    def test_untagged_text_shows_at_every_step(self):
        self.assertEqual(triage_notes.show("Argue from the user's own words.", 1), "Argue from the user's own words.")

    def test_a_step_block_shows_from_its_step_on(self):
        text = "Always.\n<step3>Name the cost.</step3>\n"
        self.assertNotIn("Name the cost.", triage_notes.show(text, 2))
        self.assertIn("Name the cost.", triage_notes.show(text, 3))
        self.assertIn("Name the cost.", triage_notes.show(text, 7))
        self.assertIn("Always.", triage_notes.show(text, 2))

    def test_shown_blocks_lose_their_tags(self):
        shown = triage_notes.show("<step2>Concede early.</step2>", 2)
        self.assertEqual(shown, "Concede early.")

    def test_advice_is_cumulative(self):
        text = "<step2>Two.</step2><step4>Four.</step4><step5>Five.</step5>"
        self.assertEqual(triage_notes.show(text, 4), "Two.Four.")


class Cap(unittest.TestCase):
    def test_exactly_3000_is_kept_whole(self):
        text = "a" * 3000
        self.assertEqual(triage_notes.cap(text), text)

    def test_3001_is_truncated_and_marked(self):
        self.assertEqual(triage_notes.cap("a" * 3001), "a" * 3000 + PHRASE)

    def test_tags_count_toward_the_cap(self):
        text = "<step3>" + "a" * 2987 + "</step3>"
        self.assertEqual(len(text), 3002)
        self.assertEqual(triage_notes.cap(text), text[:3000] + PHRASE)

    def test_the_phrase_goes_when_the_text_is_back_under_the_cap(self):
        self.assertEqual(triage_notes.cap("short notes" + PHRASE), "short notes")

    def test_recapping_a_capped_file_drops_the_phrase(self):
        # Without the phrase a capped file is exactly 3000, so the rule removes it.
        once = triage_notes.cap("b" * 4000)
        self.assertEqual(triage_notes.cap(once), "b" * 3000)


class Cli(unittest.TestCase):
    def test_cap_rewrites_the_file_and_show_prints_a_step(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "notes.md"
            path.write_text("Keep.<step3>Later.</step3>" + "c" * 3000, encoding="utf-8", newline="\n")
            subprocess.run([sys.executable, SCRIPT, "cap", str(path)], check=True)
            capped = path.read_text(encoding="utf-8")
            self.assertTrue(capped.endswith(PHRASE))
            self.assertEqual(len(capped), 3000 + len(PHRASE))
            out = subprocess.run([sys.executable, SCRIPT, "show", str(path), "2"],
                                 check=True, capture_output=True, text=True, encoding="utf-8").stdout
            self.assertTrue(out.startswith("Keep."))
            self.assertNotIn("Later.", out)


if __name__ == "__main__":
    unittest.main()
