#!/usr/bin/env python3
"""
build_corpus: OCR detection, size buckets, a seeded stratified sample, and a build that
copies and leaves the sources untouched.

Run: python -m pytest -q scripts/token_test/tests
"""

import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

import docx
import fitz

HERE = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("build_corpus", HERE / "build_corpus.py")
build_corpus = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_corpus)

LINE = "The quick brown fox jumps over the lazy dog. " * 4


def text_pdf(path, pages):
    with fitz.open() as doc:
        for _ in range(pages):
            doc.new_page().insert_text((72, 72), LINE)
        doc.save(path)


def scanned_pdf(path, pages):
    with fitz.open() as doc:
        for _ in range(pages):
            page = doc.new_page()
            page.draw_rect(fitz.Rect(72, 72, 300, 300), color=(0, 0, 0), fill=(0.5, 0.5, 0.5))
        doc.save(path)


class BuildCorpusTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.matter = Path(self.tmp.name) / "matter"
        (self.matter / "sub").mkdir(parents=True)
        text_pdf(self.matter / "a.pdf", 1)
        text_pdf(self.matter / "sub" / "b.pdf", 3)
        text_pdf(self.matter / "c.pdf", 4)
        scanned_pdf(self.matter / "scan.pdf", 2)
        d = docx.Document()
        d.add_paragraph("x" * 7000)
        d.save(self.matter / "letter.docx")
        (self.matter / "notes.txt").write_text("ignored")

    def tearDown(self):
        self.tmp.cleanup()

    def test_bucket_edges(self):
        self.assertEqual([build_corpus.bucket(n) for n in (1, 2, 5, 6, 20, 21, 80, 81)],
                         ["1", "2-5", "2-5", "6-10", "11-20", "21-40", "41-80", None])

    def test_candidates_classify_format_and_pages(self):
        found = {f["source"].name: f for f in build_corpus.candidates([self.matter])}
        self.assertEqual(set(found), {"a.pdf", "b.pdf", "c.pdf", "scan.pdf", "letter.docx"})
        self.assertEqual((found["b.pdf"]["format"], found["b.pdf"]["pages"], found["b.pdf"]["ocr"]),
                         ("pdf_ocr", 3, True))
        self.assertEqual((found["scan.pdf"]["format"], found["scan.pdf"]["ocr"]), ("pdf_scan", False))
        self.assertEqual((found["letter.docx"]["pages"], found["letter.docx"]["bucket"]), (3, "2-5"))

    def test_sample_is_stratified_and_seeded(self):
        files = build_corpus.candidates([self.matter])
        first = [f["source"].name for f in build_corpus.sample(files, 1, seed=7)]
        again = [f["source"].name for f in build_corpus.sample(build_corpus.candidates([self.matter]), 1, seed=7)]
        self.assertEqual(first, again)
        # Cells: docx 2-5, pdf_ocr 1, pdf_ocr 2-5 (b or c), pdf_scan 2-5.
        self.assertEqual(len(first), 4)

    def test_build_copies_and_writes_variants(self):
        out = Path(self.tmp.name) / "token-test"
        before = sorted((p.name, p.stat().st_size) for p in self.matter.rglob("*"))
        build_corpus.main([str(self.matter), "--out", str(out), "--per-cell", "3"])
        self.assertEqual(sorted((p.name, p.stat().st_size) for p in self.matter.rglob("*")), before)
        with open(out / "manifest.csv", encoding="utf-8") as f:
            manifest = list(csv.DictReader(f))
        self.assertEqual(len(manifest), 5)
        corpus = sorted(p.name for p in (out / "corpus").iterdir())
        self.assertEqual(corpus, sorted(f"{m['id']}{Path(m['source']).suffix}" for m in manifest))
        scan_id = next(m["id"] for m in manifest if m["format"] == "pdf_scan")
        ocr_ids = [m["id"] for m in manifest if m["format"] == "pdf_ocr"]
        variants = {p.name for p in (out / "variants").iterdir()}
        self.assertEqual(variants, {f"{scan_id}_150dpi.pdf", f"{scan_id}_100dpi.pdf"} | {f"{i}.txt" for i in ocr_ids})
        with fitz.open(out / "variants" / f"{scan_id}_100dpi.pdf") as doc:
            self.assertEqual(doc.page_count, 2)
        with self.assertRaises(SystemExit):
            build_corpus.main([str(self.matter), "--out", str(out)])

    def test_dry_run_copies_nothing(self):
        out = Path(self.tmp.name) / "token-test"
        build_corpus.main([str(self.matter), "--out", str(out), "--dry-run"])
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
