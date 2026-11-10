"""The SessionStart note routes every outgoing letter, email or memo through /draft, and its words to the scrivener."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "source" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402


PLUGIN_DIR = Path(__file__).resolve().parents[1]
HOOK = PLUGIN_DIR / "hooks" / "correspondence-note.py"
HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/hooks/correspondence-note.py"


class NoteTests(unittest.TestCase):
    def test_note_shape_and_route(self):
        result = run_hook(HOOK, timeout=None, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "SessionStart")
        note = output["additionalContext"]
        for token in ("/litigator:draft", "report to a client", "supplement", "evidence",
                      "route for the document", "The lawyer:scrivener agent writes its words",
                      "correspondence-isolation.md", "places them verbatim", "dictation",
                      "An email is never drafted in chat", ".eml"):
            with self.subTest(token=token):
                self.assertIn(token, note)

    def test_registered_on_session_start(self):
        manifest = json.loads((PLUGIN_DIR / "plugin.json").read_text(encoding="utf-8"))
        entries = [e for e in manifest["hooks"]["SessionStart"]
                   if any(HOOK_ARG in h.get("args", []) for h in e["hooks"])]
        self.assertEqual(len(entries), 1)


if __name__ == "__main__":
    unittest.main()
