"""Extract pages from a source document and highlight passages on them, for /show-me.

    python highlight_pages.py SOURCE [--pages 12-13] --out OUT.pdf
           [--para N COLOR]... [--span "START WORDS" "END WORDS" COLOR]...
           [--excerpt FILE] [--preview DIR] [--excerpt-out FILE]
           [--lang en|fr] [--columns auto|off]

SOURCE is a PDF. A .doc, .docx or .rtf source is first converted to PDF with
`soffice --headless --convert-to pdf`. Westlaw .doc downloads are really RTF, and
LibreOffice reads them as such. LibreOffice conversion keeps hyperlinked citation
text, which pandoc drops, so pandoc is not a substitute. That conversion is for
by-hand use only: the /draft scrutiny_review host step converts with Word and hands
this script a PDF.

--pages takes one page or a range, numbered from 1. Only those pages are written.
Without --pages every page is loaded, each spec is located across the document, and
the pages written run from the first page a spec lands on to the last.

A highlight spec is a paragraph, a text span or a stored excerpt:
  --para N COLOR        from the paragraph marker N to just before the next marker
                        numbered above N, or the end of the extracted pages.
                        Candidate markers are line-leading "[N]" (also when text
                        follows in the same word, as "[N]The"), "N." and bare
                        digits-only words, grouped by style and by column (x0
                        within 2 pt; in a bilingual report, the offset from the
                        kept column's edge, with outer-margin numbers as one
                        column). The group whose numbers form the longest
                        consecutive run (1, 2, 3, ... in reading order) supplies
                        the markers, so indented sub-lists and wrapped lines
                        starting with a year are skipped.
  --span START END COLOR  the single match of the START words through the earliest
                        match of the END words after it. A span can cross pages.
  --excerpt FILE        the text of FILE (UTF-8), split on "[...]" or "[…]" into
                        parts. Each part starts at the unique match of its first k
                        words (k from 3 up to 12 until unique). When the longest
                        start tried is still repeated and the pages hold a single
                        paragraph marker 1, an occurrence before that marker (front
                        matter such as a headnote) is set aside, and the one
                        occurrence at or after it is used; two or more there still
                        fail. The part ends at the first
                        match after that of its last 3 words. When the first words
                        are not found, the anchor moves one word in at a time, and so
                        does the end. Within each part's window, source words equal
                        to the part are painted yellow and differing or extra source
                        words orange; source text between two parts is painted orange.
Words are matched as normalized tokens: case-folded, curly quotes made straight,
dashes unified, soft hyphens dropped, punctuation stripped from each token's edges.
A word broken across a line wrap is one token, painted on both lines: a line-final
word ending in a soft hyphen always joins the next line's first word, and one ending
in a letter and "-" joins it when that word starts with a lowercase letter.

Orange wins over yellow: a word in both is painted orange only.

Bilingual law reports. An official S.C.R. page prints English and French in two
columns under a running header. With --columns auto (the default) pages laid out that
way keep only the column in the language --lang names (en, the default, or fr), in
reading order, and drop their running headers and footers, so a paragraph, span or
excerpt neither finds nor paints the other language or a header
(shared/scripts/pdf_layout.py says how the layout is detected). The script then
prints "layout: bilingual, English column" (or French) before the spec lines.
--columns off reads every page whole, as before.

Outside that layout, a paragraph or span that crosses a page break also paints
whatever lies between its two parts, such as running headers, footers and page
numbers. Check the preview for them.

The script prints one line per spec: found, the tokens painted in that colour
(after orange overrides), the source pages, and where a paragraph ends. The line for
an excerpt gives the yellow tokens and the yellow runs they form, then the orange
tokens. The lines for --para and --excerpt add "crossed page break" when the painted
words lie on more than one page, and last "margin band: WORDS" naming the painted
words in the top or bottom 8 % of a page (header and footer candidates).
A spec that is not found, or whose start words (or paragraph marker) occur more
than once, fails with the pages of each match. On any failure the script exits 1
and writes nothing.

--preview DIR writes one PNG per output page, to check the highlight lands on the
right text before the file is sent.

--excerpt-out FILE writes the text of the one --span spec to FILE, in UTF-8 with a
trailing newline, for the verbatim check and the gatekeeper write. It needs exactly
one --span spec (any number of --para specs may come with it). The text is each
word of the span as the PDF gives it, joined by single spaces. A word broken across
a line wrap is written whole, without its hyphen, by the rule above, as the verbatim
check does, and soft hyphens are dropped. The span must lie on one page: a span that
crosses a page would carry the running headers and footers between its parts, which
the verbatim check cannot tell from the passage. Such a span is refused and nothing is written. The script
prints the word count, never the text.

Needs pdfplumber, reportlab and pypdf, and pypdfium2 for --preview.
"""

import argparse
import difflib
import io
import re
import shutil
import string
import subprocess
import sys
import tempfile
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import pdf_layout  # noqa: E402

COLOURS = {"yellow": (1, 1, 0), "orange": (1, 0.55, 0)}
ALPHA = 0.35
CONVERTIBLE = {".doc", ".docx", ".rtf"}
X0_TOLERANCE = 2
MARGIN_BAND = 0.08
ANCHOR_MIN, ANCHOR_MAX = 3, 12

_TRANSLATE = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", "−": "-", "­": None,
})
_EDGE = string.punctuation + "«»…"
_MARKER = re.compile(r"\[(\d+)\]|(\d+)\.")
_MARKER_WITH_TEXT = re.compile(r"\[(\d+)\][^\d\s\]]")
_BARE = re.compile(r"\d+")
_OMISSION = re.compile(r"\[(?:\.\.\.|…)\]")


class SpecError(Exception):
    pass


def normalize(text):
    return text.casefold().translate(_TRANSLATE).strip(_EDGE)


def to_pdf(source, workdir):
    if source.suffix.lower() == ".pdf":
        return source
    if source.suffix.lower() not in CONVERTIBLE:
        raise SpecError(f"unsupported source type {source.suffix}: give a PDF, .doc, .docx or .rtf")
    soffice = shutil.which("soffice")
    command = ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(workdir), str(source)]
    if soffice is None:
        raise SpecError("soffice (LibreOffice) is not on PATH, and it is needed to run: " + " ".join(command))
    command[0] = soffice
    result = subprocess.run(command, capture_output=True, text=True)
    converted = Path(workdir) / (source.stem + ".pdf")
    if result.returncode != 0 or not converted.exists():
        raise SpecError(f"soffice exited {result.returncode} without writing {converted.name}: "
                        f"{result.stderr.strip() or '(no stderr)'}")
    return converted


def parse_pages(text, page_count):
    match = re.fullmatch(r"(\d+)(?:-(\d+))?", text.strip())
    if not match:
        raise SpecError(f"--pages {text!r}: give one page or a range, e.g. 12 or 12-13")
    first = int(match.group(1))
    last = int(match.group(2) or first)
    if not 1 <= first <= last <= page_count:
        raise SpecError(f"--pages {text!r}: the source has {page_count} pages")
    return first, last


def load_words(pdf_path, first, last, lang="en", columns="auto"):
    """(words on pages first..last in reading order, layout), each word tagged with page,
    line, indent and token. A word continuing one broken across a line wrap has token ""
    and "cont" set; the word it continues holds the whole word's token."""
    words, layout = pdf_layout.arrange(pdf_layout.read_words(pdf_path, first, last),
                                       lang=lang, columns=columns)
    pdf_layout.join_wraps(words)
    for w in words:
        w["token"] = "" if w.get("cont") else normalize(w.get("joined", w["text"]))
    return words, layout


def through(words, end):
    """end moved past the later parts of a word broken across a line wrap."""
    while end + 1 < len(words) and words[end + 1].get("cont"):
        end += 1
    return end


def pages_of(words, start, end):
    pages = sorted({w["page"] for w in words[start:end + 1]})
    return str(pages[0]) if len(pages) == 1 else f"{pages[0]}-{pages[-1]}"


def paragraph_markers(words):
    """Word index -> (number, style) for each paragraph marker, style "[]", "." or "bare".

    Candidates are line-leading "[N]" (or "[N]" with text after it in the same word),
    "N." and digits-only words (bare ones up to 999), grouped by style and by column
    (indent within X0_TOLERANCE; indent is x0 except in a bilingual report, where
    pdf_layout aligns odd and even pages). The group holding the
    longest run numbered 1, 2, 3, ... in reading order wins (ties: leftmost column, then
    "[]", ".", "bare"), so sub-lists and years are skipped. For "[]" and "." the same
    column's other words with a number in the run are kept, so duplicates still show.
    """
    candidates = {}
    for i, w in enumerate(words):
        if not w["leading"]:
            continue
        match = _MARKER.fullmatch(w["text"]) or _MARKER_WITH_TEXT.match(w["text"])
        if match:
            candidates[i] = ((int(match.group(1)), "[]") if match.group(1)
                             else (int(match.group(2)), "."))
        elif _BARE.fullmatch(w["text"]) and int(w["text"]) <= 999:
            candidates[i] = (int(w["text"]), "bare")
    best = None
    for rank, style in enumerate(("[]", ".", "bare")):
        members = [i for i, (_, s) in candidates.items() if s == style]
        for centre in sorted({round(words[i]["indent"]) for i in members}):
            group = [i for i in members if abs(words[i]["indent"] - centre) <= X0_TOLERANCE]
            run = longest_run(group, candidates)
            key = (-len(run), centre, rank)
            if best is None or key < best[0]:
                best = (key, run, group, style)
    if best is None:
        return {}
    _, run, group, style = best
    found = {i: candidates[i] for i in run}
    if style != "bare":
        numbers = {candidates[i][0] for i in run}
        found.update({i: candidates[i] for i in group if candidates[i][0] in numbers})
    return found


def longest_run(group, candidates):
    """The longest sequence of group words, in reading order, numbered each previous plus 1.

    Of two equally long runs ending at one number, the one starting later wins, so a
    front-matter "1" yields to the judgment's paragraph 1. With the same start the earlier
    run is kept, so a wrapped line starting with the next number does not displace it.
    """
    ending = {}
    for i in group:
        number = candidates[i][0]
        run = ending.get(number - 1, []) + [i]
        held = ending.get(number, [])
        if len(run) > len(held) or (len(run) == len(held) and run[0] > held[0]):
            ending[number] = run
    return max(ending.values(), key=len)


def body_start(markers):
    """Word index of the single marker numbered 1, else None: text before it is front matter."""
    ones = [i for i, (n, _) in markers.items() if n == 1]
    return ones[0] if len(ones) == 1 else None


def find_para(words, markers, number):
    starts = [i for i, (n, _) in markers.items() if n == number]
    if not starts:
        raise SpecError(f"no line-leading [{number}], {number}. or bare {number} marker "
                        "on the extracted pages")
    if len(starts) > 1:
        raise SpecError(f"marker {number} found {len(starts)} times, on pages "
                        + ", ".join(str(words[i]["page"]) for i in starts))
    start = starts[0]
    style = markers[start][1]
    for i in sorted(markers):
        if i > start and markers[i][1] == style and markers[i][0] > number:
            return start, i - 1, f"ends before {words[i]['text']}"
    return start, len(words) - 1, "ends at end of extracted pages"


def find_span(words, start_words, end_words):
    sequence = [(i, w["token"]) for i, w in enumerate(words) if w["token"]]
    tokens = [t for _, t in sequence]
    start_tokens = [t for t in (normalize(x) for x in start_words.split()) if t]
    end_tokens = [t for t in (normalize(x) for x in end_words.split()) if t]
    if not start_tokens or not end_tokens:
        raise SpecError("start and end words must each hold at least one word")

    def matches(needle, begin=0):
        return [j for j in range(begin, len(tokens) - len(needle) + 1)
                if tokens[j:j + len(needle)] == needle]

    starts = matches(start_tokens)
    if not starts:
        raise SpecError(f"start words {start_words!r} not found on the extracted pages")
    if len(starts) > 1:
        raise SpecError(f"start words {start_words!r} found {len(starts)} times, on pages "
                        + ", ".join(str(words[sequence[j][0]]["page"]) for j in starts)
                        + ": give more start words")
    s = starts[0]
    s_end = s + len(start_tokens)
    ends = [j for j in matches(end_tokens, s) if j + len(end_tokens) >= s_end]
    if not ends:
        raise SpecError(f"end words {end_words!r} not found after the start words "
                        f"(page {words[sequence[s][0]]['page']})")
    e = ends[0] + len(end_tokens) - 1
    return sequence[s][0], through(words, sequence[e][0]), ""


def occurrences(tokens, needle, begin=0, stop=None):
    size = len(needle)
    stop = len(tokens) if stop is None else min(stop, len(tokens))
    return [j for j in range(begin, stop - size + 1) if tokens[j:j + size] == needle]


def anchor_start(words, sequence, tokens, part, label, body):
    """(token position, part offset, size) of the part's first uniquely placed words.

    The first k words, k from ANCHOR_MIN up to ANCHOR_MAX until unique. When those
    words are not found at all, the anchor moves one word into the part. When the
    longest start is still repeated and exactly one occurrence lies at or after the
    word index body (the body start), that occurrence is used.
    """
    shortest = min(ANCHOR_MIN, len(part))
    for offset in range(len(part) - shortest + 1):
        hits = []
        for size in range(shortest, min(ANCHOR_MAX, len(part) - offset) + 1):
            hits = occurrences(tokens, part[offset:offset + size])
            if len(hits) == 1:
                return hits[0], offset, size
            if not hits:
                break
        in_body = [j for j in hits if body is not None and sequence[j] >= body]
        if len(in_body) == 1:
            return in_body[0], offset, size
        if hits:
            raise SpecError(f"{label} start words {' '.join(part[offset:offset + size])!r} found "
                            f"{len(hits)} times, on pages "
                            + ", ".join(str(words[sequence[j]]["page"]) for j in hits))
    raise SpecError(f"{label} not found on the extracted pages")


def anchor_end(tokens, part, position, offset, size):
    """Token position where the part ends: the first match after the start anchor of its
    last ANCHOR_MIN words, moved one word back at a time until they match within twice
    the part's length. Without a match the window keeps the part's length."""
    after = offset + size
    limit = position - offset + 2 * len(part) + ANCHOR_MAX
    if len(part) > after:
        k = min(ANCHOR_MIN, len(part) - after)
        for t0 in range(len(part) - k, after - 1, -1):
            hits = occurrences(tokens, part[t0:t0 + k], position + size, limit)
            if hits:
                return hits[0] + len(part) - t0 - 1
    return min(len(tokens) - 1, position + len(part) - offset - 1)


def find_excerpt(words, path, markers):
    """Ranges painting the stored excerpt: equal words yellow, differing and omitted orange."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise SpecError(f"cannot read {path}: {error}")
    parts = [[t for t in (normalize(x) for x in chunk.split()) if t]
             for chunk in _OMISSION.split(text)]
    parts = [part for part in parts if part]
    if not parts:
        raise SpecError(f"{path} holds no words")
    sequence = [i for i, w in enumerate(words) if w["token"]]
    tokens = [words[i]["token"] for i in sequence]
    body = body_start(markers)
    ranges, previous_end = [], -1
    for number, part in enumerate(parts, 1):
        label = f"part {number}" if len(parts) > 1 else "excerpt"
        position, offset, size = anchor_start(words, sequence, tokens, part, label, body)
        if position <= previous_end:
            raise SpecError(f"part {number} lies before part {number - 1} in the source")
        start = max(previous_end + 1, position - offset)
        end = min(len(tokens) - 1, anchor_end(tokens, part, position, offset, size))
        gap_from = through(words, sequence[previous_end]) + 1 if previous_end >= 0 else None
        if gap_from is not None and sequence[start] > gap_from:
            ranges.append(((gap_from, sequence[start] - 1), "orange"))
        matcher = difflib.SequenceMatcher(None, part, tokens[start:end + 1], autojunk=False)
        for op, _, _, j1, j2 in matcher.get_opcodes():
            if j2 > j1:
                ranges.append(((sequence[start + j1], through(words, sequence[start + j2 - 1])),
                               "yellow" if op == "equal" else "orange"))
        previous_end = end
    return ranges


def in_margin_band(word):
    return (word["top"] < MARGIN_BAND * word["height"]
            or word["bottom"] > (1 - MARGIN_BAND) * word["height"])


def excerpt_text(words, start, end):
    """The span's words joined by spaces, a word broken across a line wrap rejoined and
    soft hyphens dropped."""
    return " ".join(w.get("joined", w["text"]).replace(pdf_layout.SOFT_HYPHEN, "")
                    for w in words[start:end + 1] if not w.get("cont"))


def paint(ranges):
    """Colour per word index: yellow first, then orange over it."""
    colours = {}
    for colour in ("yellow", "orange"):
        for (start, end), c in ranges:
            if c == colour:
                for i in range(start, end + 1):
                    colours[i] = colour
    return colours


def rectangles(words, colours):
    """Merge consecutive same-colour words on one line into one rectangle, per page."""
    by_page = {}
    current = None
    for i in sorted(colours):
        w = words[i]
        if (current and current["last"] == i - 1 and current["line"] == w["line"]
                and current["colour"] == colours[i]):
            current.update(last=i, x1=w["x1"], top=min(current["top"], w["top"]),
                           bottom=max(current["bottom"], w["bottom"]))
            continue
        current = {"last": i, "line": w["line"], "colour": colours[i], "x0": w["x0"],
                   "x1": w["x1"], "top": w["top"], "bottom": w["bottom"]}
        by_page.setdefault(w["page"], []).append(current)
    return by_page


def overlay(page, rects):
    # pdfplumber gives x in absolute user space and top/bottom measured down from
    # the mediabox height, with the mediabox origin already folded in.
    box = page.mediabox
    height = float(box.height)
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(float(box.right), float(box.top)))
    for r in rects:
        red, green, blue = COLOURS[r["colour"]]
        c.setFillColor(Color(red, green, blue, alpha=ALPHA))
        c.rect(r["x0"], height - r["bottom"], r["x1"] - r["x0"], r["bottom"] - r["top"],
               stroke=0, fill=1)
    c.save()
    buffer.seek(0)
    return PdfReader(buffer).pages[0]


def build_parser():
    parser = argparse.ArgumentParser(description="Extract pages and highlight passages for /show-me.")
    parser.add_argument("source", type=Path)
    parser.add_argument("--pages")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--para", nargs=2, action="append", default=[], metavar=("N", "COLOR"))
    parser.add_argument("--span", nargs=3, action="append", default=[],
                        metavar=("START", "END", "COLOR"))
    parser.add_argument("--excerpt", type=Path, metavar="FILE")
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--excerpt-out", type=Path)
    parser.add_argument("--lang", choices=pdf_layout.LANGS, default="en")
    parser.add_argument("--columns", choices=("auto", "off"), default="auto")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # margin-band words are any text
    if not args.para and not args.span and not args.excerpt:
        print("give at least one --para, --span or --excerpt spec", file=sys.stderr)
        return 1
    if args.excerpt_out and len(args.span) != 1:
        print(f"error: --excerpt-out needs exactly one --span spec, got {len(args.span)}. "
              "Nothing written.", file=sys.stderr)
        return 1
    if args.preview:
        try:
            import pypdfium2  # noqa: F401  (pdfplumber renders previews through it)
        except ImportError:
            print("error: --preview needs pypdfium2, which is not importable. Nothing written.",
                  file=sys.stderr)
            return 1
    with tempfile.TemporaryDirectory() as workdir:
        try:
            pdf_path = to_pdf(args.source, workdir)
            reader = PdfReader(io.BytesIO(Path(pdf_path).read_bytes()))
            first, last = (parse_pages(args.pages, len(reader.pages)) if args.pages
                           else (1, len(reader.pages)))
        except SpecError as error:
            print(f"error: {error}. Nothing written.", file=sys.stderr)
            return 1
        words, layout = load_words(pdf_path, first, last, args.lang, args.columns)

    if layout == "bilingual":
        print(f"layout: bilingual, {'English' if args.lang == 'en' else 'French'} column")
    markers = paragraph_markers(words)

    def single(located, colour):
        start, end, note = located
        return [((start, end), colour)], note

    found, failed = [], False
    specs = [(f"para {n} {c}", "para", c,
              lambda n=n, c=c: single(find_para(words, markers, int(n)), c))
             for n, c in args.para]
    specs += [(f"span {s!r} .. {e!r} {c}", "span", c,
               lambda s=s, e=e, c=c: single(find_span(words, s, e), c))
              for s, e, c in args.span]
    if args.excerpt:
        specs.append(("excerpt", "excerpt", "yellow",
                      lambda: (find_excerpt(words, args.excerpt, markers), "")))
    for label, kind, colour, locate in specs:
        if colour not in COLOURS:
            print(f"{label}: FAILED, colour must be yellow or orange")
            failed = True
            continue
        try:
            ranges, note = locate()
        except (SpecError, ValueError) as error:
            print(f"{label}: FAILED, {error}")
            failed = True
            continue
        found.append((label, kind, colour, ranges, note))
    if failed:
        print("Nothing written.")
        return 1
    if args.excerpt_out:
        (span_start, span_end), _ = next(ranges[0] for _, kind, _, ranges, _ in found
                                         if kind == "span")
        span_pages = pages_of(words, span_start, span_end)
        if "-" in span_pages:
            print(f"error: --excerpt-out needs a span on one page; this span runs pages "
                  f"{span_pages}. Nothing written.", file=sys.stderr)
            return 1
    if not args.pages:
        touched = [words[i]["page"] for _, _, _, ranges, _ in found
                   for (start, end), _ in ranges for i in (start, end)]
        first, last = min(touched), max(touched)
    for number in range(first, last + 1):
        if reader.pages[number - 1].rotation % 360:
            print(f"error: page {number} is rotated, which this script does not handle. "
                  "Nothing written.", file=sys.stderr)
            return 1

    colours = paint([r for _, _, _, ranges, _ in found for r in ranges])
    for label, kind, colour, ranges, note in found:
        indices = sorted({i for (start, end), _ in ranges for i in range(start, end + 1)})
        if kind == "excerpt":
            yellow = [i for i in indices if colours[i] == "yellow"]
            runs = sum(1 for k, i in enumerate(yellow) if k == 0 or yellow[k - 1] != i - 1)
            orange = sum(1 for i in indices if colours[i] == "orange")
            counts = (f"{len(yellow)} tokens painted yellow in {runs} runs, "
                      f"{orange} tokens painted orange")
        else:
            counts = f"{sum(1 for i in indices if colours[i] == colour)} tokens painted {colour}"
        tail = f", {note}" if note else ""
        if kind != "span":
            if len({words[i]["page"] for i in indices}) > 1:
                tail += ", crossed page break"
            band = [words[i]["text"] for i in indices if in_margin_band(words[i])]
            if band:
                tail += ", margin band: " + " ".join(band)
        print(f"{label}: found, {counts}, pages {pages_of(words, indices[0], indices[-1])}{tail}")

    by_page = rectangles(words, colours)
    writer = PdfWriter()
    for number in range(first, last + 1):
        page = reader.pages[number - 1]
        if number in by_page:
            page.merge_page(overlay(page, by_page[number]))
        writer.add_page(page)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "wb") as handle:
        writer.write(handle)
    print(f"written: {args.out} (source pages {first}-{last})")

    if args.excerpt_out:
        text = excerpt_text(words, span_start, span_end)
        args.excerpt_out.parent.mkdir(parents=True, exist_ok=True)
        args.excerpt_out.write_text(text + "\n", encoding="utf-8")
        print(f"excerpt: written to {args.excerpt_out} ({len(text.split())} words)")

    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)
        with pdfplumber.open(args.out) as pdf:
            for index, page in enumerate(pdf.pages):
                png = args.preview / f"{args.out.stem}-p{first + index}.png"
                page.to_image(resolution=110).save(png)
                print(f"preview: {png}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
