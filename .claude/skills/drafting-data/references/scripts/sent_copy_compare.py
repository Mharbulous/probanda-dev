"""Compare a Writing's sent copy with its stored text (ADR 0024 D6; the Sent write,
filing-checklists.md section 13 "Sent write").

The runtime's Sent write (drafting_data__record_sent) runs this script through its Python
driver: one JSON request on stdin, one JSON result on stdout. It holds no SQL and opens no
database. The caller passes the stored paragraphs; the script reads the copy and reports each
paragraph the copy does not contain.

request = {"paragraphs": [str], "path": str | null, "text": str | null}, exactly one of
path and text. A path ends in .eml, .pdf or .msg.

result = {"method": "eml" | "pdf" | "text" | "msg", "compared": bool, "missing": [str],
          "mismatches": [{"index": int, "sent": str | null}],
          "note": str (only when compared is false)}

Each mismatch names one missing paragraph by its index in the request and gives the span of the
copy that aligns best with it, in full, or null when no word of it is in the copy. The span is
found word by word over the whole normalized copy, because normalizing erases the copy's
paragraph breaks. It only explains a refusal: the check itself is the containment test alone.

A .eml and pasted text are read with the standard library, a .pdf with PyMuPDF (the
dependency draft/scripts/extract_review_pages.py already carries). A .msg cannot be read
without an external package, so it is recorded by path and not compared, and the result says
so. Text is compared with whitespace runs collapsed and curly quotes made straight, so a line
break or a typographer's quote in the copy does not read as a difference.
"""
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path

MSG_NOTE = (".msg cannot be read without an external package, so the sent copy is recorded "
            "by path and was not compared with the stored text")

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})


def normalize(text):
    return re.sub(r"\s+", " ", text.translate(_QUOTES)).strip()


class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def eml_text(path):
    """The text of every text/plain part, or of every text/html part when none is plain."""
    with open(path, "rb") as fh:
        message = BytesParser(policy=policy.default).parse(fh)
    plain, html = [], []
    for part in message.walk():
        if part.is_multipart() or part.get_content_disposition() == "attachment":
            continue
        if part.get_content_type() == "text/plain":
            plain.append(part.get_content())
        elif part.get_content_type() == "text/html":
            parser = _TextOnly()
            parser.feed(part.get_content())
            html.append(" ".join(parser.parts))
    return "\n".join(plain or html)


def pdf_text(path):
    try:
        import pymupdf as fitz
    except ImportError:
        raise SystemExit("PyMuPDF is not installed. Run this on the PC where the Probanda plugin is "
                         "installed, not in a Cowork cloud sandbox: pip install PyMuPDF")
    with fitz.open(path) as doc:
        return "\n".join(page.get_text() for page in doc)


def aligned_span(paragraph, words):
    """The run of the copy's words that best aligns with a stored paragraph, or None.

    A window as long as the paragraph slides over the copy, counting the words it shares with
    the paragraph. The window sharing most, widened by half its length each side, is aligned
    with the paragraph word by word, and the span runs from the first word matched to the last."""
    target = normalize(paragraph).split(" ")
    n = len(target)
    need, have = Counter(target), Counter()
    common = best = best_start = 0
    for end, word in enumerate(words):
        if have[word] < need[word]:
            common += 1
        have[word] += 1
        start = end - n + 1
        if start > 0:
            gone = words[start - 1]
            have[gone] -= 1
            if have[gone] < need[gone]:
                common -= 1
        if common > best:
            best, best_start = common, max(0, start)
    if best == 0:
        return None
    lo, hi = max(0, best_start - n // 2), min(len(words), best_start + n + n // 2)
    blocks = [b for b in SequenceMatcher(None, words[lo:hi], target, autojunk=False).get_matching_blocks() if b.size]
    return " ".join(words[lo + blocks[0].a:lo + blocks[-1].a + blocks[-1].size])


def run(request):
    paragraphs = request.get("paragraphs") or []
    path, text = request.get("path"), request.get("text")
    if (path is None) == (text is None):
        raise ValueError("pass exactly one of path and text")
    if text is not None:
        method, copy = "text", text
    else:
        suffix = Path(path).suffix.lower()
        if suffix not in (".eml", ".pdf", ".msg"):
            raise ValueError(f"{path}: a sent copy is a .eml, .pdf or .msg file, or pasted text")
        if not Path(path).is_file():
            raise ValueError(f"{path}: no such file")
        method = suffix[1:]
        if method == "msg":
            return {"method": "msg", "compared": False, "missing": [], "mismatches": [], "note": MSG_NOTE}
        copy = eml_text(path) if method == "eml" else pdf_text(path)
    haystack = normalize(copy)
    missing = [i for i, p in enumerate(paragraphs) if normalize(p) not in haystack]
    words = haystack.split(" ")
    return {"method": method, "compared": True, "missing": [paragraphs[i] for i in missing],
            "mismatches": [{"index": i, "sent": aligned_span(paragraphs[i], words)} for i in missing]}


if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read()))))
