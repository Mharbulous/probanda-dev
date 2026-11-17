"""Column-aware word extraction for parallel-language law reports, shared by
verify-law's diff_excerpt.py and show-me's highlight_pages.py.

An official S.C.R. page prints the English and French texts side by side in two
columns, under a running header that spans both. A text layer read line by line
interleaves the two languages and the header. This module reads a PDF's words with
their positions (pdfplumber, imported lazily) and, when the pages are laid out that
way, keeps one language's column in reading order and drops the running headers.
Anything else passes through unchanged.

    words = read_words(path, first, last)
    words, layout = arrange(words, lang="en")      # layout: "bilingual" or "single"
    join_wraps(words)

Each word is a dict with page, text, x0, x1, top, bottom, width and height (the page
size), and after arrange() also line, leading and indent:
  * line     a counter that changes at each new line of the kept text
  * leading  True for the first word of a line
  * indent   x0 for a single-column document. In a bilingual one, x0 less the kept
             column's left edge on that page, so paragraph markers line up on odd and
             even pages, whose columns sit at different x; a number standing alone in
             the outer margin (the older S.C.R. paragraph numbers) gets MARGIN_INDENT.

Detection. A page is two-column when an empty vertical strip at least GUTTER_MIN
wide, within the middle of the page, splits its body words with at least SIDE_SHARE
on each side; the strip nearest the centre wins. Each side is English or French by
stopword counts (LANG_MIN_HITS and a LANG_RATIO majority). The document is bilingual
when at least half of the pages examined that hold text (the loaded pages for
arrange(); SAMPLE_PAGES spread across the document for is_bilingual(), a cheap first
look before a whole document is read) are two-column with one
English and one French side. Which side holds which language is decided per page,
never assumed. A two-column page whose sides are not told apart keeps the side the
chosen language held on most bilingual pages; a page without columns is kept whole.

Running headers. A line in the top or bottom MARGIN_BAND of a bilingual page is a
running header or footer, and is dropped, when it crosses the gutter, holds only
numbers, or repeats (digits removed) in the band of another loaded page.

Standard library only, plus pdfplumber for read_words().
"""

import re
import string
from collections import Counter

LINE_TOLERANCE = 3
MARGIN_BAND = 0.08
GUTTER_MIN = 6
GUTTER_RANGE = (0.3, 0.7)
SIDE_SHARE = 0.25
LANG_MIN_HITS = 8
LANG_RATIO = 2.0
SAMPLE_PAGES = 4
MARGIN_INDENT = -1000.0
LANGS = ("en", "fr")

_STOPWORDS = {
    "en": frozenset("the of and to in that is for be it by not this was with as are or "
                    "which has have from been would there an at".split()),
    "fr": frozenset("le la les de des du et que qui dans une un pour est pas au aux par "
                    "sur ce cette il elle ne se son sa ses été".split()),
}
_STRIP = string.punctuation + "«»“”‘’…"
_NUMBERISH = re.compile(r"[\[\]().\d]+")
_DIGITS = re.compile(r"\d+")
_WRAP_HYPHEN = re.compile(r"[^\W\d_]-$")
SOFT_HYPHEN = "­"


def read_words(pdf_path, first=None, last=None, pages=None):
    """Words on pages first..last (1-based), or on the listed pages, in pdfplumber's order.

    Raises ImportError when pdfplumber is not installed.
    """
    import pdfplumber

    words = []
    with pdfplumber.open(pdf_path) as pdf:
        numbers = pages or range(first or 1, (last or len(pdf.pages)) + 1)
        for number in numbers:
            page = pdf.pages[number - 1]
            width, height = float(page.width), float(page.height)
            for word in page.extract_words():
                words.append({"page": number, "text": word["text"],
                              "x0": word["x0"], "x1": word["x1"],
                              "top": word["top"], "bottom": word["bottom"],
                              "width": width, "height": height})
    return words


def page_count(pdf_path):
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        return len(pdf.pages)


def sample_pages(count):
    """Up to SAMPLE_PAGES page numbers spread evenly across a document of count pages."""
    if count <= SAMPLE_PAGES:
        return list(range(1, count + 1))
    step = count / SAMPLE_PAGES
    return sorted({int(i * step) + 1 for i in range(SAMPLE_PAGES)})


def tag_lines(words):
    """Number lines in stream order: a new line whenever top moves more than LINE_TOLERANCE."""
    line, previous = -1, None
    for word in words:
        if previous is None or word["page"] != previous["page"] \
                or abs(word["top"] - previous["top"]) > LINE_TOLERANCE:
            line += 1
            word["leading"] = True
        else:
            word["leading"] = False
        word["line"] = line
        previous = word
    return words


def _key(text):
    return text.casefold().strip(_STRIP)


def language(words):
    """"en", "fr" or None for a run of words, by stopword counts."""
    counts = {lang: sum(_key(w["text"]) in _STOPWORDS[lang] for w in words) for lang in LANGS}
    en, fr = counts["en"], counts["fr"]
    if en >= LANG_MIN_HITS and en >= LANG_RATIO * fr:
        return "en"
    if fr >= LANG_MIN_HITS and fr >= LANG_RATIO * en:
        return "fr"
    return None


def _in_band(word):
    return (word["top"] < MARGIN_BAND * word["height"]
            or word["bottom"] > (1 - MARGIN_BAND) * word["height"])


def _band_lines(words):
    """Band words grouped into lines (tops within LINE_TOLERANCE of the previous word)."""
    lines = []
    for word in sorted((w for w in words if _in_band(w)), key=lambda w: w["top"]):
        if lines and word["top"] - lines[-1][-1]["top"] <= LINE_TOLERANCE:
            lines[-1].append(word)
        else:
            lines.append([word])
    return lines


def find_gutter(words):
    """(left edge, right edge) of the empty strip splitting two columns, or None."""
    if not words:
        return None
    width = words[0]["width"]
    low, high = int(GUTTER_RANGE[0] * width), int(GUTTER_RANGE[1] * width)
    covered = [False] * (high - low + 1)
    for word in words:
        for x in range(max(low, int(word["x0"])), min(high, int(word["x1"]) + 1) + 1):
            covered[x - low] = True
    strips, start = [], None
    for offset, filled in enumerate(covered + [True]):
        if not filled and start is None:
            start = offset
        elif filled and start is not None:
            strips.append((low + start, low + offset - 1))
            start = None
    strips = [(a, b) for a, b in strips if b - a + 1 >= GUTTER_MIN]
    centre = width / 2
    for a, b in sorted(strips, key=lambda s: abs((s[0] + s[1]) / 2 - centre)):
        middle = (a + b) / 2
        left = sum(1 for w in words if (w["x0"] + w["x1"]) / 2 < middle)
        if min(left, len(words) - left) >= SIDE_SHARE * len(words):
            return a, b
    return None


def _margin_numbers(words, middle):
    """Indices of numbers standing alone outside their side's text column (outer margin)."""
    margin = set()
    for side in ("left", "right"):
        members = [i for i, w in enumerate(words)
                   if ((w["x0"] + w["x1"]) / 2 < middle) == (side == "left")]
        text = [words[i] for i in members if not _DIGITS.fullmatch(words[i]["text"])]
        if not text:
            continue
        lo, hi = min(w["x0"] for w in text), max(w["x1"] for w in text)
        for i in members:
            w = words[i]
            alone = not any(abs(o["top"] - w["top"]) <= LINE_TOLERANCE
                            for o in text)
            outside = w["x1"] < lo - 1 or w["x0"] > hi + 1
            if _DIGITS.fullmatch(w["text"]) and alone and outside:
                margin.add(i)
    return margin


def _plan_page(words):
    """Gutter and per-side languages for one page's body words."""
    body = [w for w in words if not _in_band(w)]
    gutter = find_gutter(body)
    if gutter is None:
        return {"gutter": None}
    middle = (gutter[0] + gutter[1]) / 2
    margin = _margin_numbers(body, middle)
    sides = {"left": [], "right": []}
    for i, w in enumerate(body):
        if i not in margin:
            sides["left" if (w["x0"] + w["x1"]) / 2 < middle else "right"].append(w)
    return {"gutter": gutter, "langs": {side: language(ws) for side, ws in sides.items()}}


def _bilingual(plan):
    langs = plan.get("langs") or {}
    return set(langs.values()) == set(LANGS)


def detect(words):
    """Per-page plans and whether the words are a parallel-language document."""
    by_page = {}
    for word in words:
        by_page.setdefault(word["page"], []).append(word)
    plans = {page: _plan_page(ws) for page, ws in by_page.items()}
    texty = [p for p, ws in by_page.items() if any(not _in_band(w) for w in ws)]
    two = [p for p in texty if _bilingual(plans[p])]
    return plans, bool(texty) and 2 * len(two) >= len(texty)


def is_bilingual(pdf_path):
    """Whether a sample of the document's pages is laid out in parallel languages."""
    _, bilingual = detect(read_words(pdf_path, pages=sample_pages(page_count(pdf_path))))
    return bilingual


def _headers(by_page, plans):
    """ids of words on running header or footer lines of the given pages."""
    lines = {page: _band_lines(ws) for page, ws in by_page.items()}

    def stripped(line):
        return " ".join(_DIGITS.sub("", w["text"]) for w in line).split()

    seen = Counter()
    for page_lines in lines.values():
        for key in {tuple(stripped(line)) for line in page_lines}:
            seen[key] += 1
    drop = set()
    for page, page_lines in lines.items():
        gutter = plans[page].get("gutter")
        for line in page_lines:
            crosses = gutter is not None and any(
                w["x0"] < (gutter[0] + gutter[1]) / 2 < w["x1"] for w in line)
            numbers = all(_NUMBERISH.fullmatch(w["text"]) for w in line)
            repeats = bool(stripped(line)) and seen[tuple(stripped(line))] > 1
            if crosses or numbers or repeats:
                drop.update(id(w) for w in line)
    return drop


def arrange(words, lang="en", columns="auto"):
    """(words in reading order with line, leading and indent set, layout name).

    layout is "bilingual" when lang's column was kept, "single" otherwise; a single
    layout returns the words in their original order.
    """
    if lang not in LANGS:
        raise ValueError(f"lang must be one of {', '.join(LANGS)}")
    plans, bilingual = detect(words) if columns == "auto" else ({}, False)
    if not bilingual:
        for word in words:
            word["indent"] = word["x0"]
        return tag_lines(words), "single"

    by_page = {}
    for word in words:
        by_page.setdefault(word["page"], []).append(word)
    sides = Counter(side for plan in plans.values() if _bilingual(plan)
                    for side, found in plan["langs"].items() if found == lang)
    usual = sides.most_common(1)[0][0]
    headers = _headers(by_page, plans)
    kept = []
    for page, page_words in by_page.items():
        plan = plans[page]
        body = [w for w in page_words if id(w) not in headers]
        if plan["gutter"] is None:
            for w in body:
                w["indent"] = w["x0"]
            kept.extend(body)
            continue
        middle = (plan["gutter"][0] + plan["gutter"][1]) / 2
        side = next((s for s, found in plan["langs"].items() if found == lang), usual)
        margin = {id(body[i]) for i in _margin_numbers(body, middle)}
        column = [w for w in body if id(w) in margin
                  or (((w["x0"] + w["x1"]) / 2 < middle) == (side == "left"))]
        text = [w for w in column if id(w) not in margin]
        edge = min((w["x0"] for w in text), default=0.0)
        for w in column:
            w["indent"] = MARGIN_INDENT if id(w) in margin else w["x0"] - edge
        kept.extend(column)
    return tag_lines(kept), "bilingual"


def join_wraps(words):
    """Mark words broken across a line wrap: the first part gets "joined" (the whole word,
    soft hyphens dropped) and each later part "cont" = True.

    A line-final word ending in a soft hyphen always joins the next line's first word; one
    ending in a letter and "-" joins it when that word starts with a lowercase letter.
    Words already carrying "joined" or "cont" are reset first.
    """
    for word in words:
        word.pop("joined", None)
        word.pop("cont", None)
    for i in range(len(words) - 2, -1, -1):
        word, after = words[i], words[i + 1]
        if not after["leading"]:
            continue
        text = word["text"]
        soft = text.endswith(SOFT_HYPHEN)
        hard = _WRAP_HYPHEN.search(text) and after["text"][:1].islower()
        if soft or hard:
            word["joined"] = (text[:-1] + after.get("joined", after["text"])).replace(SOFT_HYPHEN, "")
            after["cont"] = True
    return words


def page_texts(words):
    """Text of each page in words, one line per line of words: {page: text}."""
    pages = {}
    for word in words:
        lines = pages.setdefault(word["page"], [])
        if word["leading"] or not lines:
            lines.append([])
        lines[-1].append(word["text"])
    return {page: "\n".join(" ".join(line) for line in lines) for page, lines in pages.items()}
