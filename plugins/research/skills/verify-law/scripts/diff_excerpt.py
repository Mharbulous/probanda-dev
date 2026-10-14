#!/usr/bin/env python3
"""Word-level comparison of a stored verbatim excerpt against a source document on file.

Deterministic. No model involvement: the caller supplies the excerpt as a plain text
file, this script finds the best-matching window of words in the source and reports
exactly what differs. Standard library only, plus, for PDF sources alone, pdfplumber
for column layout (through shared/scripts/pdf_layout.py) and a lazy pypdf -> fitz
fallback for the text.

Usage:
    python diff_excerpt.py --excerpt-file EXCERPT.txt --source SOURCE.pdf
                           [--lang en|fr] [--columns auto|off]

stdout: one JSON object. stderr: a word-per-line unified diff when the two differ.

Bilingual law reports. An official S.C.R. PDF prints English and French in parallel
columns under a running header. With --columns auto (the default) and pdfplumber
importable, a PDF laid out that way is read one column at a time, in the language
--lang names (default en), with the running headers dropped (shared/scripts/
pdf_layout.py says how the layout is detected). Any other PDF is read as before.
The JSON carries "layout": "bilingual" (one language's column was compared),
"single" (no parallel columns, or --columns off), "plain" (the layout was not
checked: pdfplumber is not importable or cannot parse the PDF) or null for a
non-PDF source, and
"lang", the language asked for.

Normalisation, on the excerpt and the source alike: soft hyphens (U+00AD) are
dropped with any line break after them, a word hyphenated across a line wrap is
rejoined when the next line starts with a lowercase letter, the ligatures fi, fl, ff,
ffi and ffl are spelled out, and quotes, dashes and ellipses are straightened.

Stitched excerpts. An excerpt may join separate passages of the source, marking each
omission with "[...]" or "[…]". The excerpt is split on those markers and each part
is located on its own; the parts must appear in source order. A part whose best window
is not exact, while a verbatim run of MIN_RUN words lies outside that window, is joined
from separate passages without a marker: the window is dropped (it may be a similar
passage elsewhere) and the part is described by its verbatim runs alone. The JSON then
carries "stitching" ("marked" or "unmarked") and "parts" (one entry per marked part, or
per verbatim run of an unmarked excerpt); both are null for a single contiguous passage.
Stitched opcodes carry "part" (the marked part, or for an unmarked excerpt the run that
follows the gap), and there are four ops beyond difflib's: "omission_unmarked", "unmatched",
"not_found" and "order".

Quote edges. A quote (or a marked part) may stop before punctuation the source carries on
its first or last word: leading ( [ " ' or trailing . , ; : ) ] " (an ellipsis is read as
"..."). That counts as identical, and "edge_punctuation" records each such edge; any
other difference fails.

Exit codes:
    0  identical after normalisation (every part, in source order)
    1  found, but with differences (see the opcodes and the stderr diff)
    2  not found in this document (no part located)
    3  read error or usage error

Known limitations:
  * A short part that also occurs verbatim earlier in the source is located at its first
    occurrence, which can surface as a false "order" or "unmatched" opcode. It is never
    reported as found at a passage it does not match.
  * An unmarked omission no longer than WINDOW_SLACK words can surface as an ordinary
    "delete" opcode rather than "omission_unmarked". Either way it is a difference.
  * With stitching, "ratio" can be 1.0 while "identical" is false (for example, verbatim
    parts joined without a marker). Conversely, "ratio" is below 1.0 while "identical" is
    true when "edge_punctuation" is not empty. The exit code is the verdict.
  * A compound hyphen sitting at a line wrap (for example a hyphenated word split
    across two lines) is fused on whichever side carries the wrap, so it can surface
    as an honest exit 1 rather than an exact match. The difference is reported, never
    hidden.
  * A word hyphenated across a PDF page boundary is rejoined only when the next page's
    text starts with its lowercase continuation, which a running header usually
    prevents outside the bilingual layout. The joined word counts on the earlier page.
"""

import argparse
import bisect
import difflib
import json
import re
import string
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import pdf_layout  # noqa: E402

IDENTICAL_RATIO = 1.0
NOT_FOUND_RATIO = 0.6
WINDOW_SLACK = 0.10
MIN_RUN = 8
EXIT_IDENTICAL, EXIT_DIFFERENT, EXIT_NOT_FOUND, EXIT_ERROR = 0, 1, 2, 3

_OMISSION_MARKER = re.compile(r"\[(?:\.\.\.|…)\]")
_EDGE_MARKS = {"start": set("([\"'"), "end": set('.,;:)]"')}
_HYPHEN_WRAP = re.compile(r"([^\W\d_])-[ \t]*\r?\n[ \t]*([^\W\d_])")
_SOFT_HYPHEN = re.compile("­\\s*")
_PAGE_END_WRAP = re.compile(r"(?:­|[^\W\d_]-)\s*$")
_WHITESPACE = re.compile(r"\s+")
_PUNCT_MAP = {
    0x2018: "'", 0x2019: "'", 0x201A: "'", 0x201B: "'",
    0x201C: '"', 0x201D: '"', 0x201E: '"', 0x201F: '"',
    0x2011: "-", 0x2012: "-", 0x2013: "-", 0x2014: "-", 0x2015: "-",
    0x2026: "...",
    0xFB00: "ff", 0xFB01: "fi", 0xFB02: "fl", 0xFB03: "ffi", 0xFB04: "ffl",
}
LAYOUT_PLAIN = "plain"

_DOCX_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class SourceError(Exception):
    """Raised when a source or excerpt cannot be read."""


def normalise(text):
    """Undo wrap hyphenation, straighten quotes, dashes and ellipses, collapse whitespace.

    Never lowercases and never strips punctuation: a verbatim check has to see a
    dropped comma or a changed word ending.
    """
    text = _SOFT_HYPHEN.sub("", text)
    text = _HYPHEN_WRAP.sub(
        lambda m: m.group(1) + m.group(2) if m.group(2).islower() else m.group(0), text)
    text = text.translate(_PUNCT_MAP)
    return _WHITESPACE.sub(" ", text).strip()


def tokenise(text):
    """Split normalised text into words."""
    return normalise(text).split()


def split_parts(text):
    """Split an excerpt on its omission markers into word lists, dropping empty parts.

    A marker at the very start or end is plain truncation and leaves one part.
    """
    parts = (tokenise(chunk) for chunk in _OMISSION_MARKER.split(text))
    return [words for words in parts if words]


def _read_docx(path):
    """Extract paragraph text from a .docx using the standard library only."""
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise SourceError("not a readable .docx: {}".format(exc))
    root = ElementTree.fromstring(xml)
    paragraphs = []
    for para in root.iter(_DOCX_NS + "p"):
        parts = []
        for node in para.iter():
            if node.tag == _DOCX_NS + "t":
                parts.append(node.text or "")
            elif node.tag in (_DOCX_NS + "tab", _DOCX_NS + "br", _DOCX_NS + "cr"):
                parts.append(" ")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def _read_pdf_pages(path):
    """Return a list of page texts, trying pypdf first and PyMuPDF (fitz) second."""
    try:
        import pypdf
    except ImportError:
        pass
    else:
        try:
            reader = pypdf.PdfReader(str(path))
            return [(page.extract_text() or "") for page in reader.pages]
        except pypdf.errors.PyPdfError as exc:  # a corrupt PDF is not an OSError either
            raise SourceError("cannot read PDF: {}".format(exc))
    try:
        import pymupdf as fitz
    except ImportError:
        raise SourceError(
            "cannot read PDF: neither pypdf nor fitz (PyMuPDF) is importable"
        )
    try:
        with fitz.open(str(path)) as doc:
            return [page.get_text() for page in doc]
    except RuntimeError as exc:  # PyMuPDF's open errors are RuntimeError, not OSError
        raise SourceError("cannot read PDF: {}".format(exc))


def _read_bilingual_pages(path, lang, columns):
    """(page texts of lang's column, "bilingual") for a parallel-language PDF, else
    (None, "single"), or (None, "plain") when the layout cannot be checked.

    A sample of pages decides the layout before the whole document is read. A PDF that
    pdfplumber cannot parse is "plain" and left to _read_pdf_pages, which reads it as
    before or reports the read error.
    """
    if columns == "off":
        return None, "single"
    try:
        if not pdf_layout.is_bilingual(path):
            return None, "single"
        words, layout = pdf_layout.arrange(pdf_layout.read_words(path), lang=lang)
    except ImportError:
        return None, LAYOUT_PLAIN
    except Exception:  # pdfminer's parse errors share no base class; see the docstring
        return None, LAYOUT_PLAIN
    if layout != "bilingual":
        return None, layout
    texts = pdf_layout.page_texts(words)
    return [texts.get(n, "") for n in range(1, max(texts) + 1)], layout


def _join_page_wraps(pages):
    """Move the continuation of a word hyphenated across a page break onto the earlier page."""
    pages = list(pages)
    for i in range(len(pages) - 1):
        if not _PAGE_END_WRAP.search(pages[i]):
            continue
        rest = pages[i + 1].lstrip()
        first = rest.split(None, 1)
        if first and first[0][:1].islower():
            pages[i] = pages[i].rstrip() + "\n" + first[0]
            pages[i + 1] = first[1] if len(first) > 1 else ""
    return pages


def read_source(path, lang="en", columns="auto"):
    """Read a source file into (words, page_starts, layout).

    page_starts is a list of cumulative word indices, one per page, for PDFs; None
    for every other format, which has no page structure to report. layout is
    "bilingual", "single" or "plain" for a PDF and None otherwise.
    """
    lower = str(path).lower()
    if lower.endswith(".pdf"):
        pages, layout = _read_bilingual_pages(path, lang, columns)
        if pages is None:
            pages = _read_pdf_pages(path)
        words = []
        page_starts = []
        for page in _join_page_wraps(pages):
            page_starts.append(len(words))
            words.extend(tokenise(page))
        if not words:
            raise SourceError(
                "no text layer in this PDF; it is probably a scan needing OCR"
            )
        return words, page_starts, layout
    if lower.endswith(".docx"):
        text = _read_docx(path)
    elif lower.endswith(".md") or lower.endswith(".txt"):
        with open(path, encoding="utf-8-sig") as handle:
            text = handle.read()
    else:
        raise SourceError(
            "unsupported extension; resolve the authority through case-data first "
            "so a .pdf, .docx, .md or .txt copy is on file"
        )
    words = tokenise(text)
    if not words:
        raise SourceError("source contains no text")
    return words, None, None


def find_best_window(excerpt, source):
    """Return (ratio, start, length) for the source window closest to the excerpt."""
    n = len(excerpt)
    matcher = difflib.SequenceMatcher(None, "", excerpt, autojunk=False)
    if len(source) <= n:
        matcher.set_seq1(source)
        return matcher.ratio(), 0, len(source)

    excerpt_words = {word.strip(string.punctuation) for word in excerpt}
    best_ratio, best_start = -1.0, 0
    for start in range(len(source) - n + 1):
        if source[start].strip(string.punctuation) not in excerpt_words:
            continue
        matcher.set_seq1(source[start:start + n])
        if matcher.quick_ratio() <= best_ratio:
            continue
        ratio = matcher.ratio()
        if ratio > best_ratio:
            best_ratio, best_start = ratio, start
            if ratio >= IDENTICAL_RATIO:
                return ratio, start, n

    if best_ratio < 0:
        # Every window was filtered out; fall back to the first window.
        matcher.set_seq1(source[:n])
        best_ratio, best_start = matcher.ratio(), 0

    # A window that pairs every excerpt word with a source word differing at most by
    # edge punctuation is the passage itself. Keep its length: a shorter window scores
    # higher by dropping a punctuated last word, which would then be reported missing.
    window = source[best_start:best_start + n]
    if all(ours.strip(string.punctuation) == theirs.strip(string.punctuation)
           for ours, theirs in zip(excerpt, window)):
        return best_ratio, best_start, n

    # Refine the window length so a single dropped or added word yields one opcode
    # rather than two (a length mismatch otherwise shifts every later word).
    best_length = n
    slack = max(1, int(n * WINDOW_SLACK))
    for length in range(max(1, n - slack), n + slack + 1):
        if best_start + length > len(source):
            break
        matcher.set_seq1(source[best_start:best_start + length])
        ratio = matcher.ratio()
        if ratio > best_ratio:
            best_ratio, best_length = ratio, length
    return best_ratio, best_start, best_length


def page_range(page_starts, start, length):
    """Map a word window onto 1-based first/last page numbers."""
    if page_starts is None:
        return None, None
    first = bisect.bisect_right(page_starts, start)
    last = bisect.bisect_right(page_starts, max(start, start + length - 1))
    return max(1, first), max(1, last)


def _build_opcodes(excerpt, window):
    """Non-equal opcodes with the excerpt as side a and the source window as side b."""
    matcher = difflib.SequenceMatcher(None, excerpt, window, autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            continue
        out.append({
            "op": op,
            "ours": " ".join(excerpt[i1:i2]),
            "source": " ".join(window[j1:j2]),
        })
    return out


def _edge_punctuation(excerpt, window):
    """The edges a quote stops short of, or None if any difference is something else.

    Every difference must be the first or last word, which the source carries with
    extra allowed marks on that edge only.
    """
    matcher = difflib.SequenceMatcher(None, excerpt, window, autojunk=False)
    edges = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            continue
        if op != "replace" or i2 - i1 != j2 - j1:
            return None
        for i, theirs in zip(range(i1, i2), window[j1:j2]):
            ours = excerpt[i]
            if i == len(excerpt) - 1 and theirs.startswith(ours):
                edge, extra = "end", theirs[len(ours):]
            elif i == 0 and theirs.endswith(ours):
                edge, extra = "start", theirs[:-len(ours)]
            else:
                return None
            if not extra or not set(extra) <= _EDGE_MARKS[edge]:
                return None
            edges.append({"edge": edge, "ours": ours, "source": theirs})
    return edges


def _span(source, page_starts, start, length):
    first, last = page_range(page_starts, start, length)
    return {"page_first": first, "page_last": last,
            "source_window": " ".join(source[start:start + length])}


def _exact_runs(words, source):
    """Verbatim runs of at least MIN_RUN words as (word index, source index, size).

    difflib's matching blocks never cross, so the runs come back in source order.
    """
    matcher = difflib.SequenceMatcher(None, source, words, autojunk=False)
    return [(word_at, source_at, size)
            for source_at, word_at, size in matcher.get_matching_blocks()
            if size >= MIN_RUN]


def _from_runs(words, source, page_starts, runs):
    """Describe a part by its verbatim runs alone, naming every gap between them.

    Each gap opcode carries the index of the run that follows it ("part"); words left
    over after the last run carry None.
    """
    opcodes, covered, pos, prev_end = [], 0, 0, None
    for index, (word_at, source_at, size) in enumerate(runs):
        skipped = "" if prev_end is None else "{} source words skipped".format(
            source_at - prev_end)
        if word_at > pos:
            opcodes.append({"op": "unmatched", "part": index,
                            "ours": " ".join(words[pos:word_at]), "source": skipped})
        elif prev_end is not None:
            opcodes.append({"op": "omission_unmarked", "part": index, "ours": "",
                            "source": "{} words omitted".format(source_at - prev_end)})
        covered += size
        pos, prev_end = word_at + size, source_at + size
    if pos < len(words):
        opcodes.append({"op": "unmatched", "part": None,
                        "ours": " ".join(words[pos:]), "source": ""})
    start, end = runs[0][1], prev_end
    first, last = page_range(page_starts, start, end - start)
    result = {
        "identical": False,
        "ratio": round(covered / len(words), 4),
        "page_first": first,
        "page_last": last,
        "opcodes": opcodes,
        "edge_punctuation": [],
        "source_window": " [...] ".join(
            " ".join(source[source_at:source_at + size]) for _, source_at, size in runs),
    }
    return result, runs, start, end


def analyse(words, source, page_starts):
    """Locate one excerpt part: (result, runs, start, end).

    runs is None for a contiguous match. When the best window is not exact, a verbatim
    run lies outside it, and the verbatim runs cover more of the part than the window
    matches, the window is dropped and the runs describe the part. The coverage test
    keeps a contiguous quote with a changed word on the window when a clause of it is
    also restated earlier in the source.
    """
    ratio, start, length = find_best_window(words, source)
    if ratio < IDENTICAL_RATIO:
        runs = _exact_runs(words, source)
        covered = sum(size for _, _, size in runs) / len(words)
        outside = any(source_at < start or source_at + size > start + length
                      for _, source_at, size in runs)
        if outside and covered > ratio:
            return _from_runs(words, source, page_starts, runs)
    identical = ratio >= IDENTICAL_RATIO
    window = source[start:start + length]
    edges = None if identical else _edge_punctuation(words, window)
    identical = identical or bool(edges)
    result = {
        "identical": identical,
        "ratio": round(ratio, 4),
        **_span(source, page_starts, start, length),
        "opcodes": [] if identical else _build_opcodes(words, window),
        "edge_punctuation": edges or [],
    }
    return result, None, start, start + length


def _found(result, runs):
    return runs is not None or result["identical"] or result["ratio"] >= NOT_FOUND_RATIO


def _combine_marked(parts, analysed):
    """Build the top-level result and parts list for an excerpt split on markers."""
    entries, opcodes, located = [], [], []
    for index, (words, (result, runs, start, end)) in enumerate(zip(parts, analysed)):
        entries.append(dict(index=index, **result))
        if not _found(result, runs):
            opcodes.append({"op": "not_found", "part": index,
                            "ours": " ".join(words), "source": ""})
            continue
        opcodes.extend(dict(op, part=index) for op in result["opcodes"])
        if located and start < located[-1][2]:
            opcodes.append({"op": "order", "part": index,
                            "ours": " ".join(words[:MIN_RUN]) + " ...",
                            "source": "located before part {}".format(located[-1][0])})
        located.append((index, result, end))
    # With nothing located, report every part's best window, as a contiguous miss does.
    shown = [r for _, r, _ in located] or [result for result, _, _, _ in analysed]
    firsts = [r["page_first"] for r in shown if r["page_first"] is not None]
    lasts = [r["page_last"] for r in shown if r["page_last"] is not None]
    top = {
        "identical": not opcodes,
        "ratio": min(entry["ratio"] for entry in entries),
        "page_first": min(firsts) if firsts else None,
        "page_last": max(lasts) if lasts else None,
        "opcodes": opcodes,
        "edge_punctuation": [dict(edge, part=entry["index"]) for entry in entries
                             for edge in entry["edge_punctuation"]],
        "source_window": " [...] ".join(r["source_window"] for r in shown),
    }
    return top, entries, bool(located)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Compare a stored verbatim excerpt against a source document."
    )
    parser.add_argument("--excerpt-file", required=True,
                        help="path to a plain text file holding the excerpt")
    parser.add_argument("--source", required=True,
                        help="path to the source document (.pdf/.docx/.md/.txt)")
    parser.add_argument("--lang", choices=pdf_layout.LANGS, default="en",
                        help="the column compared in a bilingual PDF (default en)")
    parser.add_argument("--columns", choices=("auto", "off"), default="auto",
                        help="off reads every PDF as a single text, as before")
    args = parser.parse_args(argv)

    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    try:
        with open(args.excerpt_file, encoding="utf-8-sig") as handle:
            parts = split_parts(handle.read())
        if not parts:
            raise SourceError("excerpt file is empty")
        source, page_starts, layout = read_source(args.source, args.lang, args.columns)
    except (OSError, SourceError) as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return EXIT_ERROR

    analysed = [analyse(words, source, page_starts) for words in parts]
    if len(parts) > 1:
        result, entries, found = _combine_marked(parts, analysed)
        result.update(stitching="marked", parts=entries)
    else:
        result, runs, _, _ = analysed[0]
        found = _found(result, runs)
        entries = None
        if runs is not None:
            entries = [dict(index=index, identical=True, ratio=1.0, opcodes=[],
                            edge_punctuation=[], **_span(source, page_starts, i, size))
                       for index, (_, i, size) in enumerate(runs)]
        result.update(stitching="unmarked" if runs else None, parts=entries)
    result.update(layout=layout, lang=args.lang)
    print(json.dumps(result, indent=2))

    if result["identical"]:
        return EXIT_IDENTICAL
    if not found:
        print(
            "excerpt not found in this document; closest window scored "
            "{:.4f}".format(result["ratio"]),
            file=sys.stderr,
        )
    for index, (words, (part, runs, start, end)) in enumerate(zip(parts, analysed)):
        label = "excerpt" if len(parts) == 1 else "excerpt part {}".format(index)
        if runs is not None:
            print("{}: not one passage in the source; {} verbatim segments located, "
                  "{} spans unmatched; any omitted text is not marked with [...]".format(
                      label, len(runs),
                      sum(op["op"] == "unmatched" for op in part["opcodes"])),
                  file=sys.stderr)
            continue
        for line in difflib.unified_diff(words, source[start:end], label, "source",
                                         lineterm=""):
            print(line, file=sys.stderr)
    for op in result["opcodes"]:
        if op["op"] == "order":
            print("excerpt part {} is {}".format(op["part"], op["source"]),
                  file=sys.stderr)
    return EXIT_DIFFERENT if found else EXIT_NOT_FOUND


if __name__ == "__main__":
    sys.exit(main())
