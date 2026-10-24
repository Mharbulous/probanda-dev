"""The SessionStart note carries the scrivener rule: who words correspondence, the dictation
exception and its four edit types, and stopping when the scrivener is absent."""
import json
import subprocess
import sys
import unittest
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parents[2]
HOOK = PLUGIN_DIR / "hooks" / "hidden-skills-note.py"
HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/hooks/hidden-skills-note.py"

RECIPIENTS = ("the client", "court", "an opposing lawyer or party", "a regulator", "a witness",
              "an expert", "a public body", "a non-party", "poorly chosen words could bite us")
EDIT_TYPES = ("spelling", "punctuation", "grammar", "word choice")


def note():
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["hookEventName"] == "SessionStart"
    return output["additionalContext"]


class ScrivenerRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.note = note()

    def test_names_the_scrivener_and_its_doctrine(self):
        self.assertIn("Only the lawyer:scrivener agent drafts or revises", self.note)
        self.assertIn("skills/shared/correspondence-isolation.md", self.note)
        self.assertIn("refers it to the scrivener", self.note)

    def test_names_every_covered_recipient(self):
        for recipient in RECIPIENTS:
            with self.subTest(recipient=recipient):
                self.assertIn(recipient, self.note)

    def test_dictation_exception_has_four_edit_types_and_no_other_change(self):
        self.assertIn("dictation", self.note)
        for edit in EDIT_TYPES:
            with self.subTest(edit=edit):
                self.assertIn(edit, self.note)
        self.assertIn("no sentence, fact, position, deadline or tone", self.note)

    def test_stops_when_the_scrivener_is_absent(self):
        self.assertIn("If the scrivener is absent, say so and stop.", self.note)

    def test_names_no_litigator_component(self):
        for name in ("/draft", "litigator:", "source-tracer"):
            with self.subTest(name=name):
                self.assertNotIn(name, self.note)

    def test_registered_on_session_start(self):
        manifest = json.loads((PLUGIN_DIR / "plugin.json").read_text(encoding="utf-8"))
        entries = [e for e in manifest["hooks"]["SessionStart"]
                   if any(HOOK_ARG in h.get("args", []) for h in e["hooks"])]
        self.assertEqual(len(entries), 1)


if __name__ == "__main__":
    unittest.main()
