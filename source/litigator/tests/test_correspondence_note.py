"""The SessionStart note routes every outgoing letter, email or memo through /draft."""
import json
import subprocess
import sys
import unittest
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parents[1]
HOOK = PLUGIN_DIR / "hooks" / "correspondence-note.py"
HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/hooks/correspondence-note.py"


class NoteTests(unittest.TestCase):
    def test_note_shape_and_route(self):
        result = subprocess.run([sys.executable, str(HOOK)], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "SessionStart")
        note = output["additionalContext"]
        for token in ("/litigator:draft", "report to a client", "supplement", "evidence", "say-so"):
            with self.subTest(token=token):
                self.assertIn(token, note)

    def test_registered_on_session_start(self):
        manifest = json.loads((PLUGIN_DIR / "plugin.json").read_text(encoding="utf-8"))
        entries = [e for e in manifest["hooks"]["SessionStart"]
                   if any(HOOK_ARG in h.get("args", []) for h in e["hooks"])]
        self.assertEqual(len(entries), 1)


if __name__ == "__main__":
    unittest.main()
