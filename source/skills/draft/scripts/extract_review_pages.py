"""Cut each reviewed unit's cited source pages out of their PDFs for counsel's review.

Usage: python extract_review_pages.py <manifest.json> <Writing folder>

The manifest is a JSON list, one entry per unit in document order:
  {"unit": "Paragraph 12", "source": "<absolute PDF path or null>",
   "pages": [4, 5] or null, "excerpt": "<text or null>", "note": "<text>" (optional)}
`pages` are 1-based pages of that PDF, given when the pinpoint names pages, or names
paragraphs or an exhibit the caller located by reading the PDF. Without them the pages
are found by searching for the excerpt. `note` names any cited part the caller found
missing from the source. The index carries it, and it is the status of a unit with no
page and no excerpt.

Writes `review-NNN.pdf` per unit with a source and `review-pages.json` (the index) into
`<Writing folder>/Review pages/`, and prints the index. These are disposable
projections: the script never touches the drafting database.
"""
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError:
    sys.exit("PyMuPDF is not installed. Run this on the PC where the Probanda plugin is "
             "installed, not in a Cowork cloud sandbox: pip install PyMuPDF")

PAGES_DIR = "Review pages"
INDEX = "review-pages.json"


def _needle(excerpt):
    return re.sub(r"\s+", " ", excerpt).strip() if excerpt else ""


def extract_unit(n, entry, out_dir):
    result = {"unit": entry["unit"], "file": None, "pages": []}
    if entry.get("note"):
        result["note"] = entry["note"]
    source = entry.get("source")
    if not source:
        result["status"] = "no source on file"
        return result
    if not Path(source).is_file():
        result["status"] = f"source file not found: {source}"
        return result
    needle = _needle(entry.get("excerpt"))
    src = fitz.open(source)
    pages = entry.get("pages")
    if pages:
        bad = [p for p in pages if not 1 <= p <= src.page_count]
        if bad:
            result["status"] = f"page {bad[0]} is outside the source's {src.page_count} pages"
            return result
    elif needle:
        pages = [i + 1 for i in range(src.page_count) if src[i].search_for(needle)]
        if not pages:
            result["status"] = "excerpt not located in the source"
            return result
    else:
        result["status"] = entry.get("note") or "no page and no excerpt to locate it by"
        return result

    out = fitz.open()
    for p in pages:
        out.insert_pdf(src, from_page=p - 1, to_page=p - 1)
        page = out[-1]
        note = {"page": p, "highlighted": False}
        if not page.get_text().strip():
            note["note"] = "scanned page, shown whole and unhighlighted"
        elif needle:
            quads = page.search_for(needle, quads=True)
            if quads:
                page.add_highlight_annot(quads)
                note["highlighted"] = True
            else:
                note["note"] = "excerpt not found on this page, unhighlighted"
        result["pages"].append(note)
    name = f"review-{n:03d}.pdf"
    out.save(out_dir / name)
    result["file"] = str(out_dir / name)
    result["status"] = "ok"
    return result


def main(manifest_path, presentation_dir):
    entries = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    out_dir = Path(presentation_dir) / PAGES_DIR
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("review-*.pdf"):
        old.unlink()
    index = [extract_unit(n, e, out_dir) for n, e in enumerate(entries, 1)]
    text = json.dumps(index, indent=2, ensure_ascii=False)
    (out_dir / INDEX).write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("utf-8") + b"\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
