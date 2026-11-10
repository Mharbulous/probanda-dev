import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fitz

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "extract_review_pages.py"


class ExtractReviewPagesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        doc = fitz.open()
        doc.new_page().insert_text((72, 72), "The first page says nothing much.")
        doc.new_page().insert_text((72, 72), "The tenant paid rent on 1 March 2024.")
        doc.new_page()  # no text layer, as a scanned page has none
        self.pdf = self.tmp / "Ex A.pdf"
        doc.save(self.pdf)
        self.presentation = self.tmp / "NOA Application"
        self.presentation.mkdir()

    def run_script(self, entries):
        manifest = self.tmp / "manifest.json"
        manifest.write_text(json.dumps(entries), encoding="utf-8")
        subprocess.run([sys.executable, str(SCRIPT), str(manifest), str(self.presentation)],
                       check=True, capture_output=True)
        pages_dir = self.presentation / "Review pages"
        return pages_dir, json.loads((pages_dir / "review-pages.json").read_text(encoding="utf-8"))

    def test_one_page_per_pinpoint_and_no_source(self):
        pages_dir, index = self.run_script([
            {"unit": "Paragraph 1", "source": str(self.pdf), "pages": None, "excerpt": "paid rent on\n1 March 2024"},
            {"unit": "Paragraph 2", "source": str(self.pdf), "pages": [1, 3], "excerpt": "nothing much"},
            {"unit": "Paragraph 3", "source": None, "pages": None, "excerpt": None},
            {"unit": "Paragraph 4", "source": str(self.tmp / "gone.pdf"), "pages": [1], "excerpt": None},
            {"unit": "Paragraph 5", "source": str(self.pdf), "pages": None, "excerpt": "not in the exhibit"},
        ])
        self.assertEqual([u["unit"] for u in index], [f"Paragraph {n}" for n in range(1, 6)])

        located = index[0]
        self.assertEqual(located["status"], "ok")
        self.assertEqual([p["page"] for p in located["pages"]], [2])
        out = fitz.open(located["file"])
        self.assertEqual(out.page_count, 1)
        self.assertEqual(len(list(out[0].annots())), 1)

        pinned = index[1]
        self.assertEqual(fitz.open(pinned["file"]).page_count, 2)
        self.assertEqual(pinned["pages"][0]["highlighted"], True)
        self.assertEqual(pinned["pages"][1]["note"], "scanned page, shown whole and unhighlighted")

        self.assertEqual(index[2], {"unit": "Paragraph 3", "file": None, "pages": [], "status": "no source on file"})
        self.assertTrue(index[3]["status"].startswith("source file not found"))
        self.assertEqual(index[4]["status"], "excerpt not located in the source")
        self.assertEqual(sorted(p.name for p in pages_dir.glob("*.pdf")), ["review-001.pdf", "review-002.pdf"])

    def test_paragraph_cited_unit_on_a_scanned_affidavit(self):
        # "paras. 9-10; Exhibit H": the preparing job read the scan and located the
        # paragraphs on page 2 and Exhibit H (stamp page and exhibit) on pages 3-4.
        scan = fitz.open()
        for _ in range(4):
            scan.new_page()
        sworn = self.tmp / "AFF#2 AFFIRMED.pdf"
        scan.save(sworn)
        _, index = self.run_script([
            {"unit": "Postulate 1", "source": str(sworn), "pages": [2, 3, 4], "excerpt": None},
            {"unit": "Postulate 2", "source": str(sworn), "pages": None, "excerpt": None},
            {"unit": "Postulate 3", "source": str(sworn), "pages": None, "excerpt": None,
             "note": "para. 20 is not in the source, which ends at para. 19"},
            {"unit": "Postulate 4", "source": str(sworn), "pages": [4], "excerpt": None,
             "note": "Exhibits K-M are not in the source"},
        ])
        cited = index[0]
        self.assertEqual(cited["status"], "ok")
        self.assertEqual([p["page"] for p in cited["pages"]], [2, 3, 4])
        self.assertTrue(all(p["note"] == "scanned page, shown whole and unhighlighted" and not p["highlighted"]
                            for p in cited["pages"]))
        self.assertEqual(fitz.open(cited["file"]).page_count, 3)
        self.assertEqual(index[1]["status"], "no page and no excerpt to locate it by")
        self.assertEqual(index[2]["status"], "para. 20 is not in the source, which ends at para. 19")
        self.assertIsNone(index[2]["file"])
        self.assertEqual(index[3]["status"], "ok")
        self.assertEqual(index[3]["note"], "Exhibits K-M are not in the source")

    def test_rerun_replaces_earlier_pages(self):
        self.run_script([{"unit": "Paragraph 1", "source": str(self.pdf), "pages": [1], "excerpt": None},
                         {"unit": "Paragraph 2", "source": str(self.pdf), "pages": [2], "excerpt": None}])
        pages_dir, _ = self.run_script([{"unit": "Paragraph 1", "source": str(self.pdf), "pages": [2], "excerpt": None}])
        self.assertEqual([p.name for p in pages_dir.glob("*.pdf")], ["review-001.pdf"])


if __name__ == "__main__":
    unittest.main()
