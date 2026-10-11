"""Tests for scripts/highlight_pages.py.

Builds a two-page PDF with paragraphs [1] to [6], where the sentence of [3]
crosses the page break, and runs the script as a subprocess, the way a skill
session runs it. Bare paragraph numbers are tested on a synthetic PDF and on
fixtures/westlaw-bockhold-2026-bcca-74.pdf, a Westlaw judgment converted by Word.
"""

import subprocess
import sys
from pathlib import Path

import pdfplumber
import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.pdfgen import canvas

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "highlight_pages.py"
DIFF_SCRIPT = Path(__file__).resolve().parents[2] / "verify-law" / "scripts" / "diff_excerpt.py"
BOCKHOLD = Path(__file__).resolve().parent / "fixtures" / "westlaw-bockhold-2026-bcca-74.pdf"
YELLOW = (1, 1, 0)
ORANGE = (1, 0.55, 0)

PAGE_ONE = [
    "[1] First paragraph of the sample text.",
    "[2] The second paragraph has seven words.",
    "[3] The third paragraph begins here and this",
    "sentence carries on until it crosses the",
]
PAGE_TWO = [
    "page break and ends on the next page.",
    "[4] Fourth paragraph.",
    "[5] Fifth paragraph.",
    "[6] Sixth paragraph.",
]


@pytest.fixture
def sample(tmp_path):
    path = tmp_path / "sample.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    for lines in (PAGE_ONE, PAGE_TWO):
        c.setFont("Helvetica", 12)
        for row, text in enumerate(lines):
            c.drawString(72, 720 - row * 24, text)
        c.showPage()
    c.save()
    return path


@pytest.fixture
def hyphen_sample(tmp_path):
    """One page whose second word pair is hyphenated across a line wrap."""
    path = tmp_path / "hyphen.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    c.setFont("Helvetica", 12)
    for row, text in enumerate(["[1] The court con-", "tinued the hearing."]):
        c.drawString(72, 720 - row * 24, text)
    c.showPage()
    c.save()
    return path


@pytest.fixture
def bare_sample(tmp_path):
    """Bare paragraph numbers 1 to 5. Paragraph 2 wraps onto a line starting "2014" and
    holds an indented line starting "3"; paragraph 4 crosses the page break."""
    path = tmp_path / "bare.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    pages = [
        [(72, "1 First paragraph of the bare sample."),
         (72, "2 The second paragraph wraps onto a line that"),
         (72, "2014 began a year, and it quotes a list:"),
         (108, "3 witnesses were named in the list."),
         (72, "3 The third paragraph is short."),
         (72, "4 The fourth paragraph begins here and")],
        [(72, "crosses the page break to end here."),
         (72, "5 Fifth paragraph.")],
    ]
    for lines in pages:
        c.setFont("Helvetica", 12)
        for row, (x, text) in enumerate(lines):
            c.drawString(x, 700 - row * 24, text)
        c.showPage()
    c.save()
    return path


def draw(path, pages):
    """Write pages of (x, text) lines, Helvetica 12, rows at 700 - row * 24."""
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    for lines in pages:
        c.setFont("Helvetica", 12)
        for row, (x, text) in enumerate(lines):
            c.drawString(x, 700 - row * 24, text)
        c.showPage()
    c.save()
    return path


def bare_line(n):
    return (54, f"{n} Paragraph {n} of the sublist sample.")


@pytest.fixture
def bare_with_sublist(tmp_path):
    """Bare paragraphs 1 to 17; paragraph 12 holds an indented "1." to "4." sub-list."""
    sublist = [(74, "1. first item"), (74, "2. second item"),
               (74, "3. third item"), (74, "4. fourth item")]
    return draw(tmp_path / "bare_sublist.pdf", [
        [bare_line(n) for n in range(1, 11)],
        [bare_line(11), bare_line(12)] + sublist + [bare_line(n) for n in range(13, 18)],
    ])


@pytest.fixture
def dotted_sample(tmp_path):
    return draw(tmp_path / "dotted.pdf", [[
        (72, "1. First paragraph of the dotted sample."),
        (72, "2. The second paragraph has seven words."),
        (72, "3. Third paragraph."),
        (72, "4. Fourth paragraph."),
    ]])


@pytest.fixture
def dotted_with_year(tmp_path):
    return draw(tmp_path / "dotted_year.pdf", [[
        (72, "1. First paragraph."),
        (72, "2. The second paragraph wraps onto a line that"),
        (72, "2010. began, and runs on."),
        (72, "3. Third paragraph."),
        (72, "4. Fourth paragraph."),
        (72, "5. Fifth paragraph."),
    ]])


@pytest.fixture
def bracket_duplicate(tmp_path):
    return draw(tmp_path / "bracket_dup.pdf", [[
        (72, "[1] First paragraph."),
        (72, "[2] Second paragraph."),
        (72, "[2] Second paragraph again."),
        (72, "[3] Third paragraph."),
    ]])


PHRASE = "The judge may grant summary judgment where there is no genuine issue requiring a trial"  # 15 words


@pytest.fixture
def headnote_sample(tmp_path):
    """Westlaw-like front matter whose Held line repeats PHRASE, then bare paragraphs 1 to 15;
    paragraph 11 holds PHRASE and sits on page 2."""
    return draw(tmp_path / "headnote.pdf", [
        [(54, "Westlaw Sample v. Headnote, 2026 BCCA 999"),
         (54, "Held: The judge may grant summary judgment where there is no"),
         (54, "genuine issue requiring a trial, the headnote says."),
         (54, "Table of Authorities")] + [bare_line(n) for n in range(1, 9)],
        [bare_line(9), bare_line(10),
         (54, "11 The judge may grant summary judgment where there is no"),
         (54, "genuine issue requiring a trial, having regard to the evidence.")]
        + [bare_line(n) for n in range(12, 16)],
    ])


@pytest.fixture
def mid_window_sample(tmp_path):
    """Bare paragraphs 1 to 14; page 2 opens with paragraph 9's tail, which repeats PHRASE,
    and paragraph 11 repeats it again."""
    return draw(tmp_path / "mid_window.pdf", [
        [bare_line(n) for n in range(1, 10)],
        [(54, "continued from paragraph nine: the judge may grant summary judgment"),
         (54, "where there is no genuine issue requiring a trial, as noted."),
         bare_line(10),
         (54, "11 The judge may grant summary judgment where there is no"),
         (54, "genuine issue requiring a trial, having regard to the evidence.")]
        + [bare_line(n) for n in range(12, 15)],
    ])


@pytest.fixture
def front_matter_one(tmp_path):
    """A front-matter line starting with a bare "1" in the paragraph column, then bare
    paragraphs 1 to 5."""
    return draw(tmp_path / "front_matter_one.pdf", [
        [(54, "1 Headnote point from the front matter."),
         (54, "Table of Authorities")] + [bare_line(n) for n in range(1, 6)],
    ])


@pytest.fixture
def offset_sample(sample, tmp_path):
    """The same pages with a mediabox of [20 30 632 822]."""
    writer = PdfWriter()
    for page in PdfReader(sample).pages:
        page.mediabox = RectangleObject([20, 30, 632, 822])
        writer.add_page(page)
    path = tmp_path / "offset.pdf"
    with open(path, "wb") as handle:
        writer.write(handle)
    return path


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True, encoding="utf-8",
                          stdin=subprocess.DEVNULL)


def diff(excerpt, source):
    return subprocess.run([sys.executable, str(DIFF_SCRIPT), "--excerpt-file", str(excerpt),
                           "--source", str(source)],
                          capture_output=True, text=True, stdin=subprocess.DEVNULL)


def fill(rect):
    return tuple(round(v, 2) for v in rect["non_stroking_color"])


def overlaps(rect, word):
    return (rect["x0"] < word["x1"] and word["x0"] < rect["x1"]
            and rect["top"] < word["bottom"] and word["top"] < rect["bottom"])


def word(page, text):
    return next(w for w in page.extract_words() if w["text"] == text)


def test_para_and_page_crossing_span_are_highlighted(sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--para", "2", "yellow",
                 "--span", "this sentence carries", "next page", "orange")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 2 yellow: found, 7 tokens painted yellow, pages 1, ends before [3]" in result.stdout
    assert "found, 16 tokens painted orange, pages 1-2" in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 2
        one, two = pdf.pages
        assert one.rects and two.rects
        yellow = [r for r in one.rects if fill(r) == YELLOW]
        orange_one = [r for r in one.rects if fill(r) == ORANGE]
        orange_two = [r for r in two.rects if fill(r) == ORANGE]
        assert any(overlaps(r, word(one, "seven")) for r in yellow)
        assert any(overlaps(r, word(one, "carries")) for r in orange_one)
        assert any(overlaps(r, word(two, "break")) for r in orange_two)
        assert not any(overlaps(r, word(two, "Fourth")) for r in two.rects)


def test_orange_overrides_yellow_in_the_count(sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--para", "3", "yellow",
                 "--span", "this sentence carries", "next page", "orange")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 3 yellow: found, 7 tokens painted yellow, pages 1-2, ends before [4]" in result.stdout


def test_offset_mediabox_rect_lands_on_the_word(offset_sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(offset_sample, "--pages", "1-2", "--out", out, "--para", "2", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        assert any(overlaps(r, word(page, "seven")) for r in page.rects)
        assert not any(overlaps(r, word(page, "First")) for r in page.rects)


def test_missing_span_exits_1_and_writes_nothing(sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--para", "2", "yellow",
                 "--span", "words not in the text", "anywhere", "orange")
    assert result.returncode == 1
    assert "FAILED" in result.stdout
    assert not out.exists()


def test_ambiguous_start_exits_1_and_writes_nothing(sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--span", "paragraph", "page", "orange")
    assert result.returncode == 1
    assert "found" in result.stdout and "times" in result.stdout
    assert not out.exists()


def test_excerpt_out_round_trips_through_diff(sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--span", "The second", "seven words.", "yellow", "--excerpt-out", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    text = excerpt.read_text(encoding="utf-8")
    assert text == "The second paragraph has seven words.\n"
    assert text.strip() not in result.stdout
    assert out.exists()
    check = diff(excerpt, sample)
    assert check.returncode == 0, check.stdout + check.stderr


def test_excerpt_out_joins_hyphenated_line_wrap(hyphen_sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    result = run(hyphen_sample, "--pages", "1", "--out", out,
                 "--span", "The court", "hearing.", "yellow", "--excerpt-out", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    assert excerpt.read_text(encoding="utf-8") == "The court continued the hearing.\n"
    check = diff(excerpt, hyphen_sample)
    assert check.returncode == 0, check.stdout + check.stderr


def test_excerpt_out_refuses_cross_page_span(sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--span", "this sentence carries", "next page", "orange", "--excerpt-out", excerpt)
    assert result.returncode == 1
    assert not excerpt.exists()
    assert not out.exists()
    assert "pages 1-2" in result.stderr


def test_excerpt_out_refuses_two_spans(sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    result = run(sample, "--pages", "1-2", "--out", out,
                 "--span", "The second", "seven words.", "yellow",
                 "--span", "Fourth", "paragraph.", "orange", "--excerpt-out", excerpt)
    assert result.returncode == 1
    assert not excerpt.exists()
    assert not out.exists()


def test_bare_para_without_pages_skips_wrapped_year_and_indented_number(bare_sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(bare_sample, "--out", out, "--para", "3", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 3 yellow: found, 6 tokens painted yellow, pages 1, ends before 4" in result.stdout
    assert "crossed page break" not in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 1
        page = pdf.pages[0]
        assert any(overlaps(r, word(page, "short.")) for r in page.rects)
        assert not any(overlaps(r, word(page, "2014")) for r in page.rects)
        assert not any(overlaps(r, word(page, "witnesses")) for r in page.rects)


def test_bare_para_crossing_page_break_writes_both_pages(bare_sample, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(bare_sample, "--out", out, "--para", "4", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("para 4 yellow: found, 14 tokens painted yellow, pages 1-2, ends before 5, "
            "crossed page break") in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 2
        assert any(overlaps(r, word(pdf.pages[1], "crosses")) for r in pdf.pages[1].rects)
        assert not any(overlaps(r, word(pdf.pages[1], "Fifth")) for r in pdf.pages[1].rects)


def test_excerpt_with_a_differing_word_paints_it_orange(sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    excerpt.write_text("The fourth paragraph begins here and this\n", encoding="utf-8")
    result = run(sample, "--out", out, "--excerpt", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("excerpt: found, 6 tokens painted yellow in 2 runs, 1 tokens painted orange, "
            "pages 1") in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 1
        page = pdf.pages[0]
        assert any(overlaps(r, word(page, "third")) for r in page.rects if fill(r) == ORANGE)
        assert any(overlaps(r, word(page, "begins")) for r in page.rects if fill(r) == YELLOW)


def test_stitched_excerpt_paints_parts_yellow_and_the_gap_orange(sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    excerpt.write_text("The second paragraph has [...] begins here and this\n", encoding="utf-8")
    result = run(sample, "--out", out, "--excerpt", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("excerpt: found, 8 tokens painted yellow in 2 runs, 6 tokens painted orange, "
            "pages 1") in result.stdout
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        yellow = [r for r in page.rects if fill(r) == YELLOW]
        orange = [r for r in page.rects if fill(r) == ORANGE]
        assert any(overlaps(r, word(page, "has")) for r in yellow)
        assert any(overlaps(r, word(page, "begins")) for r in yellow)
        assert any(overlaps(r, word(page, "seven")) for r in orange)
        assert any(overlaps(r, word(page, "third")) for r in orange)


def test_bare_para_holding_dotted_sublist_ends_before_next_bare_number(bare_with_sublist, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(bare_with_sublist, "--out", out, "--para", "12", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("para 12 yellow: found, 19 tokens painted yellow, pages 2, ends before 13"
            in result.stdout)
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        assert any(overlaps(r, word(page, "fourth")) for r in page.rects)
        assert not any(overlaps(r, word(page, "13")) for r in page.rects)


def test_bare_para_is_not_resolved_to_a_sublist_item(bare_with_sublist, tmp_path):
    result = run(bare_with_sublist, "--out", tmp_path / "out.pdf", "--para", "3", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "pages 1, ends before 4" in result.stdout


def test_bare_para_in_a_page_window_beats_the_sublist(bare_with_sublist, tmp_path):
    result = run(bare_with_sublist, "--pages", "2", "--out", tmp_path / "out.pdf",
                 "--para", "12", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("para 12 yellow: found, 19 tokens painted yellow, pages 2, ends before 13"
            in result.stdout)


def test_dotted_para_resolves(dotted_sample, tmp_path):
    result = run(dotted_sample, "--out", tmp_path / "out.pdf", "--para", "2", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("para 2 yellow: found, 7 tokens painted yellow, pages 1, ends before 3."
            in result.stdout)


def test_dotted_para_skips_wrapped_year(dotted_with_year, tmp_path):
    result = run(dotted_with_year, "--out", tmp_path / "out.pdf", "--para", "2", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("para 2 yellow: found, 14 tokens painted yellow, pages 1, ends before 3."
            in result.stdout)


def test_duplicate_bracket_marker_exits_1_and_writes_nothing(bracket_duplicate, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(bracket_duplicate, "--out", out, "--para", "2", "yellow")
    assert result.returncode == 1
    assert "found 2 times" in result.stdout
    assert not out.exists()


def test_westlaw_bare_para_16_is_found_once_on_one_page(tmp_path):
    out = tmp_path / "out.pdf"
    result = run(BOCKHOLD, "--out", out, "--para", "16", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 16 yellow: found, 55 tokens painted yellow, pages 3, ends before 17" in result.stdout
    assert "crossed page break" not in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 1


def test_westlaw_bare_para_17_ends_before_18(tmp_path):
    result = run(BOCKHOLD, "--out", tmp_path / "out.pdf", "--para", "17", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 17 yellow: found" in result.stdout
    assert ", ends before 18" in result.stdout


def test_bare_para_1_skips_a_front_matter_1_in_the_same_column(front_matter_one, tmp_path):
    out = tmp_path / "out.pdf"
    result = run(front_matter_one, "--out", out, "--para", "1", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 1 yellow: found, 7 tokens painted yellow, pages 1, ends before 2" in result.stdout
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        assert not any(overlaps(r, word(page, "Headnote")) for r in page.rects)
        assert not any(overlaps(r, word(page, "Authorities")) for r in page.rects)


def test_excerpt_repeated_in_front_matter_is_located_in_the_judgment(headnote_sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    excerpt.write_text(PHRASE + "\n", encoding="utf-8")
    result = run(headnote_sample, "--out", out, "--excerpt", excerpt, "--para", "11", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("excerpt: found, 15 tokens painted yellow in 1 runs, 0 tokens painted orange, "
            "pages 2") in result.stdout
    assert "para 11 yellow: found, 21 tokens painted yellow, pages 2, ends before 12" in result.stdout
    with pdfplumber.open(out) as pdf:
        assert len(pdf.pages) == 1


def test_misquoted_excerpt_repeated_in_front_matter_paints_orange(headnote_sample, tmp_path):
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    excerpt.write_text(PHRASE.replace("issue", "dispute") + "\n", encoding="utf-8")
    result = run(headnote_sample, "--out", out, "--excerpt", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    assert ("excerpt: found, 14 tokens painted yellow in 2 runs, 1 tokens painted orange, "
            "pages 2") in result.stdout
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        assert any(overlaps(r, word(page, "issue")) for r in page.rects if fill(r) == ORANGE)


def test_front_matter_rule_needs_marker_one_in_the_window(mid_window_sample, tmp_path):
    excerpt = tmp_path / "excerpt.txt"
    excerpt.write_text(PHRASE + "\n", encoding="utf-8")
    windowed = tmp_path / "windowed.pdf"
    result = run(mid_window_sample, "--pages", "2", "--out", windowed, "--excerpt", excerpt)
    assert result.returncode == 1
    assert "found 2 times, on pages 2, 2" in result.stdout
    assert not windowed.exists()
    whole = tmp_path / "whole.pdf"
    result = run(mid_window_sample, "--out", whole, "--excerpt", excerpt)
    assert result.returncode == 1
    assert "found 2 times, on pages 2, 2" in result.stdout
    assert not whole.exists()


# Bilingual law reports (shared/scripts/pdf_layout.py). The S.C.R. fixtures live in
# shared/tests/fixtures; see the README there.
SHARED_TESTS = Path(__file__).resolve().parents[2] / "shared" / "tests"
SCR = SHARED_TESTS / "fixtures"
IPEELEE = SCR / "scr-2012-1-433-ipeelee-pp14-16.pdf"
HAIDA = SCR / "scr-2004-3-511-haida-pp14-16.pdf"
SCR_GUTTER = {1: 285, 2: 300, 3: 285}  # x between the columns on fixture pages 1-3
sys.path.insert(0, str(SHARED_TESTS))
import bilingual_sample  # noqa: E402


def painted(out):
    """(page number, rect) for every highlight rectangle in the written extract."""
    with pdfplumber.open(out) as pdf:
        return [(n, r) for n, page in enumerate(pdf.pages, 1) for r in page.rects
                if fill(r) in (YELLOW, ORANGE)]


def test_para_on_a_bilingual_page_is_found(tmp_path):
    out = tmp_path / "out.pdf"
    result = run(IPEELEE, "--pages", "2-3", "--out", out, "--para", "12", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "layout: bilingual, English column" in result.stdout
    # 95 words in fixtures/ipeelee-para12-en.txt, plus the marker
    assert "para 12 yellow: found, 96 tokens painted yellow, pages 2, ends before [13]" \
        in result.stdout


def test_margin_para_numbers_alternate_sides_and_are_found(tmp_path):
    out = tmp_path / "out.pdf"
    result = run(HAIDA, "--pages", "1-3", "--out", out, "--para", "24", "yellow",
                 "--para", "26", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "para 24 yellow: found" in result.stdout and "ends before 25" in result.stdout
    assert "para 26 yellow: found" in result.stdout


def test_english_paragraph_paints_no_french_and_no_running_header(tmp_path):
    out = tmp_path / "out.pdf"
    result = run(IPEELEE, "--pages", "1-2", "--out", out, "--para", "11", "yellow")
    assert result.returncode == 0, result.stdout + result.stderr
    # 56 words in fixtures/ipeelee-para11-en.txt, plus the marker: no header, no French
    assert "para 11 yellow: found, 57 tokens painted yellow, pages 1-2, ends before [12], " \
           "crossed page break" in result.stdout
    rects = painted(out)
    assert {n for n, _ in rects} == {1, 2}
    for n, rect in rects:
        assert rect["x1"] < SCR_GUTTER[n], (n, rect)
        assert rect["top"] > 0.08 * 702, (n, rect)


def test_lang_fr_paints_the_french_column(tmp_path):
    out = tmp_path / "out.pdf"
    result = run(IPEELEE, "--pages", "2", "--out", out, "--para", "12", "yellow",
                 "--lang", "fr")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "layout: bilingual, French column" in result.stdout
    assert all(rect["x0"] > SCR_GUTTER[1] for _, rect in painted(out))


def test_span_end_word_split_by_soft_hyphens(tmp_path):
    source = bilingual_sample.build(tmp_path / "sample.pdf")
    out = tmp_path / "out.pdf"
    excerpt = tmp_path / "excerpt.txt"
    result = run(source, "--out", out, "--span", "as stated per", "Lord Wilberforce",
                 "yellow", "--excerpt-out", excerpt)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "found, 6 tokens painted yellow" in result.stdout
    assert excerpt.read_text(encoding="utf-8") == "as stated per Lord Wilberforce\n"
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        force = next(w for w in page.extract_words() if w["text"] == "force"
                     and w["x0"] < bilingual_sample.GUTTER_X)
        assert any(overlaps(r, force) for r in page.rects)
        assert all(r["x1"] < bilingual_sample.GUTTER_X for r in page.rects)
    check = diff(excerpt, source)
    assert check.returncode == 0, check.stdout + check.stderr


def test_columns_off_reads_the_page_whole(tmp_path):
    source = bilingual_sample.build(tmp_path / "sample.pdf")
    out = tmp_path / "out.pdf"
    result = run(source, "--out", out, "--span", "The court held", "of the House.",
                 "yellow", "--columns", "off")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "layout:" not in result.stdout
    assert any(r["x1"] > bilingual_sample.GUTTER_X for _, r in painted(out))
