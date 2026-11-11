"""The bill finds the last invoice from the practice records, so nothing in this skill names the plugin that renames files or its naming review skill (build plan slice 1b)."""
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
# Built from pieces so this file does not name them itself.
FORBIDDEN = ("house" + "keeping", "file" + "-manager")


class NoFileManager(unittest.TestCase):
    def test_no_file_manager_names(self):
        hits = []
        for path in sorted(SKILL.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore").lower()
            hits += [f"{path.relative_to(SKILL)}: {word}" for word in FORBIDDEN if word in text]
        self.assertEqual(hits, [], "the skill still names a forbidden plugin or skill")


if __name__ == "__main__":
    unittest.main()
