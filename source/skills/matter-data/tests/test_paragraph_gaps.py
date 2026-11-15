# Suggestion 83893d42-82db-4d8d-a079-5081bd737271, item 2 (red test written by triage): the numbered
# paragraphs of a pleading that have no stored row are listed, so a re-check can report them.
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import pleading_positions  # noqa: E402


class ParagraphGaps(unittest.TestCase):
    def test_a_missing_numbered_paragraph_is_listed(self):
        paragraph_gaps = getattr(pleading_positions, "paragraph_gaps", lambda locators: [])
        self.assertEqual(paragraph_gaps(["para. 1", "para. 2", "para. 3", "para. 4", "para. 5", "para. 6",
                                         "para. 8", "p3", "hdr"]), ["para. 7"])


if __name__ == "__main__":
    unittest.main()
