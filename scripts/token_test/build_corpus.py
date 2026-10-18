#!/usr/bin/env python3
"""
Build the token-efficiency test corpus: a stratified sample of copies of matter files.

Lists the .pdf, .docx and .msg files under the given matter folders, counts their pages,
flags each PDF as OCR'd or scanned by its text layer (under 100 characters a page means no
text layer), buckets them by format and size, and copies up to --per-cell files from each
format x size cell into <out>/corpus/ as D###.<ext>. It only reads and copies: the matter
folders are never changed. Cloud-only placeholders of synced files are skipped, since
opening one downloads it.

Also writes <out>/manifest.csv (it holds source paths, so it stays local) and, in
<out>/variants/, each OCR'd PDF's text layer (D###.txt) and each scanned PDF re-rendered at
lower resolutions (D###_150dpi.pdf, D###_100dpi.pdf).

.docx and .msg page counts are estimates at 3,000 characters of text a page, or Word's own
saved <Pages> count where a .docx has a larger one.

Run: python scripts/token_test/build_corpus.py MATTER_FOLDER [...] [--dry-run]
"""

import argparse
import csv
import random
import re
import shutil
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF

OCR_CHARS_PER_PAGE = 100
CHARS_PER_PAGE = 3000
BUCKETS = [(1, 1, "1"), (2, 5, "2-5"), (6, 10, "6-10"), (11, 20, "11-20"), (21, 40, "21-40"), (41, 80, "41-80")]
FORMATS = ["pdf_ocr", "pdf_scan", "docx", "msg"]
VARIANT_DPIS = (150, 100)
MANIFEST_COLUMNS = ["id", "format", "pages", "ocr", "bucket", "source"]
DEFAULT_OUT = Path.home() / "token-test"
CLOUD_ONLY_ATTRIBUTES = 0x1000 | 0x400000  # FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS


def bucket(pages):
    for low, high, name in BUCKETS:
        if low <= pages <= high:
            return name
    return None


def text_pages(chars):
    return max(1, -(-chars // CHARS_PER_PAGE))


def inspect_pdf(path):
    with fitz.open(path) as doc:
        chars = sum(len(page.get_text().strip()) for page in doc)
        pages = doc.page_count
    ocr = pages > 0 and chars / pages >= OCR_CHARS_PER_PAGE
    return ("pdf_ocr" if ocr else "pdf_scan"), pages, ocr


def inspect_docx(path):
    """The larger of Word's saved <Pages> count (stale when another tool saved the file) and the text estimate."""
    with zipfile.ZipFile(path) as z:
        app = z.read("docProps/app.xml").decode("utf-8") if "docProps/app.xml" in z.namelist() else ""
        body = re.sub(r"<[^>]+>", "", z.read("word/document.xml").decode("utf-8"))
    match = re.search(r"<Pages>(\d+)</Pages>", app)
    return "docx", max(int(match.group(1)) if match else 0, text_pages(len(body.strip()))), ""


def inspect_msg(path):
    import extract_msg

    with extract_msg.openMsg(str(path)) as msg:
        body = msg.body or ""
    return "msg", text_pages(len(body.strip())), ""


INSPECTORS = {".pdf": inspect_pdf, ".docx": inspect_docx, ".msg": inspect_msg}


def cloud_only(path):
    """A cloud-only placeholder of a synced file: opening it would download it."""
    return bool(getattr(path.stat(), "st_file_attributes", 0) & CLOUD_ONLY_ATTRIBUTES)


def candidates(folders):
    """Every local file the corpus can draw on, as dicts sorted by source path. Cloud-only and unreadable files are skipped and counted."""
    found, skipped, unreadable = [], 0, 0
    for folder in folders:
        for path in sorted(Path(folder).rglob("*")):
            inspector = INSPECTORS.get(path.suffix.lower())
            if not path.is_file() or inspector is None:
                continue
            if cloud_only(path):
                skipped += 1
                continue
            try:
                fmt, pages, ocr = inspector(path)
            except Exception as e:
                unreadable += 1
                print(f"unreadable, skipped: {path}: {e!r}", file=sys.stderr)
                continue
            found.append({"format": fmt, "pages": pages, "ocr": ocr, "bucket": bucket(pages), "source": path})
    print(f"{skipped} cloud-only files skipped, {unreadable} unreadable files skipped", file=sys.stderr)
    return found


def sample(files, per_cell, seed):
    cells = defaultdict(list)
    for f in files:
        if f["bucket"]:
            cells[(f["format"], f["bucket"])].append(f)
    rng = random.Random(seed)
    chosen = []
    for key in sorted(cells):
        chosen += rng.sample(cells[key], min(per_cell, len(cells[key])))
    for n, f in enumerate(chosen, 1):
        f["id"] = f"D{n:03d}"
    return chosen


def render_at(src, dest, dpi):
    with fitz.open(src) as doc, fitz.open() as out:
        for page in doc:
            new = out.new_page(width=page.rect.width, height=page.rect.height)
            new.insert_image(new.rect, pixmap=page.get_pixmap(dpi=dpi))
        out.save(dest, deflate=True)


def write_variants(f, corpus_file, variants):
    if f["format"] == "pdf_ocr":
        with fitz.open(corpus_file) as doc:
            text = "\f".join(page.get_text() for page in doc)
        (variants / f"{f['id']}.txt").write_text(text, encoding="utf-8")
    elif f["format"] == "pdf_scan":
        for dpi in VARIANT_DPIS:
            render_at(corpus_file, variants / f"{f['id']}_{dpi}dpi.pdf", dpi)


def build(chosen, out):
    corpus, variants = out / "corpus", out / "variants"
    if corpus.exists() and any(corpus.iterdir()):
        raise SystemExit(f"{corpus} is not empty: move it aside before building a new corpus")
    corpus.mkdir(parents=True, exist_ok=True)
    variants.mkdir(parents=True, exist_ok=True)
    for f in chosen:
        corpus_file = corpus / f"{f['id']}{f['source'].suffix.lower()}"
        shutil.copy2(f["source"], corpus_file)
        write_variants(f, corpus_file, variants)
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=MANIFEST_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(chosen)


def report(files, chosen):
    counts = defaultdict(int)
    for f in files:
        counts[(f["format"], f["bucket"] or "over 80")] += 1
    picked = defaultdict(int)
    for f in chosen:
        picked[(f["format"], f["bucket"])] += 1
    print("format    bucket   found  chosen")
    for key in sorted(counts):
        print(f"{key[0]:<9} {key[1]:<8} {counts[key]:>5}  {picked.get(key, 0):>6}")
    print(f"{len(files)} files found, {len(chosen)} chosen")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folders", nargs="+", type=Path, help="matter folders to sample from")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="test folder (default: %(default)s)")
    parser.add_argument("--per-cell", type=int, default=3, help="files per format x size cell (default: 3)")
    parser.add_argument("--seed", type=int, default=0, help="random seed for the sample (default: 0)")
    parser.add_argument("--dry-run", action="store_true", help="list buckets and OCR flags; copy nothing")
    args = parser.parse_args(argv)
    files = candidates(args.folders)
    chosen = sample(files, args.per_cell, args.seed)
    if args.dry_run:
        for f in files:
            print(f"{f['format']:<9} {f['pages']:>4}p  {f['bucket'] or 'over 80':<8} {f['source']}")
    else:
        build(chosen, args.out)
    report(files, chosen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
