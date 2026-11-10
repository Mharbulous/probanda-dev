"""Tests for references/jobs-run.md §8's text: every thread write goes through the loose_threads__ tools.

What each write does is tested against the store in source/lawyer/mcp/test/loose-threads-store.db.test.mjs
and loose-thread-discard.db.test.mjs.

Run: python -m pytest source/skills/drafting-data/tests/test_loose_thread_discard.py -q
"""

import unittest
from pathlib import Path

REFERENCES = Path(__file__).resolve().parents[1] / "references"


def section_8():
    text = (REFERENCES / "jobs-run.md").read_text(encoding="utf-8")
    begin = text.index("## 8. Loose-thread capture")
    return " ".join(text[begin:text.index("## 9. Complete", begin)].split())


class SectionRules(unittest.TestCase):
    def test_no_thread_write_is_sql(self):
        text = section_8()
        self.assertNotIn("seeds SET", text)
        self.assertNotIn("INTO seeds", text)
        self.assertNotIn("FROM seeds", text)

    def test_each_write_names_its_action(self):
        text = section_8()
        for action in ("discard", "restore", "rank", "correct", "defer", "undefer", "consume"):
            self.assertIn(f'"{action}"', text, action)

    def test_section_rules(self):
        text = section_8()
        self.assertIn("stamps `discarded_at`, the minute dropped, `YYYY-MM-DDTHH:MM` in local time, and deletes nothing", text)
        self.assertIn("No route writes it any more: a `tooling` thread is no longer sent as a suggestion", text)
        self.assertIn("**The test is whether it was cut off:**", text)
        self.assertIn("**The sweep.** Before completing a job or retiring a Writing", text)

    def test_no_reference_writes_seeds(self):
        for path in REFERENCES.glob("*.md"):
            if path.name in ("terms-and-symbols.md", "work-markers.md"):
                continue
            text = path.read_text(encoding="utf-8")
            for write in ("INTO seeds", "UPDATE seeds", "DELETE FROM seeds"):
                self.assertNotIn(write, text, path.name)


if __name__ == "__main__":
    unittest.main()
