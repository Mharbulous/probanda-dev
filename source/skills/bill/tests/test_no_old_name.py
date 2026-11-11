"""The skill is /bill (build plan slice 2). No file under source/skills/ or source/billing/ keeps the old name, apart from the one sentence saying a resumed bill keeps its older working folder."""
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[3]
# Built from pieces so this file does not hold the old name itself.
OLD = "bill" + "-client"
ALLOWED = "A resumed bill keeps the working folder its record names, even the older `<matter-data folder>\\" + OLD + "\\`"


class NoOldName(unittest.TestCase):
    def test_no_old_name(self):
        hits = []
        for root in (SOURCE / "skills", SOURCE / "billing"):
            for path in sorted(root.rglob("*")):
                if not path.is_file() or "__pycache__" in path.parts or "node_modules" in path.parts:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                if path == SOURCE / "skills" / "bill" / "SKILL.md":
                    self.assertEqual(text.count(ALLOWED), 1, "the working-folder sentence is missing")
                    text = text.replace(ALLOWED, "")
                if OLD in text:
                    hits.append(str(path.relative_to(SOURCE)))
        self.assertEqual(hits, [], "files still hold the old skill name")


if __name__ == "__main__":
    unittest.main()
