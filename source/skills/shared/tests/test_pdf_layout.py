"""Tests for shared/scripts/pdf_layout.py on two trimmed official S.C.R. reports (see
fixtures/README.md), a synthetic bilingual page, and a single-column judgment."""

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parents[1]
sys.path.insert(0, str(SKILLS / "shared" / "scripts"))
sys.path.insert(0, str(HERE))

import bilingual_sample  # noqa: E402
import pdf_layout  # noqa: E402

FIXTURES = HERE / "fixtures"
IPEELEE = FIXTURES / "scr-2012-1-433-ipeelee-pp14-16.pdf"
HAIDA = FIXTURES / "scr-2004-3-511-haida-pp14-16.pdf"
BOCKHOLD = SKILLS / "show-me" / "tests" / "fixtures" / "westlaw-bockhold-2026-bcca-74.pdf"


@pytest.fixture(scope="module")
def ipeelee():
    return pdf_layout.read_words(IPEELEE)


@pytest.fixture(scope="module")
def haida():
    return pdf_layout.read_words(HAIDA)


@pytest.fixture
def synthetic(tmp_path):
    return pdf_layout.read_words(bilingual_sample.build(tmp_path / "sample.pdf"))


def copy(words):
    return [dict(w) for w in words]


def texts(words):
    return [w["text"] for w in words]


@pytest.mark.parametrize("name", ["ipeelee", "haida"])
def test_scr_pages_are_english_left_french_right(name, request):
    plans, bilingual = pdf_layout.detect(request.getfixturevalue(name))
    assert bilingual
    assert set(plans) == {1, 2, 3}
    for plan in plans.values():
        assert plan["langs"] == {"left": "en", "right": "fr"}


def test_english_column_drops_french_and_running_header(ipeelee):
    words, layout = pdf_layout.arrange(copy(ipeelee))
    assert layout == "bilingual"
    kept = texts(words)
    assert "LTSO" in kept and "OSLD" not in kept and "L’OSLD" not in kept
    assert "IPEELEE" not in kept and "S.C.R." not in kept and "R.C.S." not in kept
    assert all(w["top"] > pdf_layout.MARGIN_BAND * w["height"] for w in words)


def test_french_column_with_lang_fr(ipeelee):
    words, layout = pdf_layout.arrange(copy(ipeelee), lang="fr")
    assert layout == "bilingual"
    assert "L’OSLD" in texts(words) and "LTSO" not in texts(words)


def test_paragraph_crossing_a_page_reads_in_order(ipeelee):
    words, _ = pdf_layout.arrange(copy(ipeelee))
    pages = pdf_layout.page_texts(words)
    assert pages[1].endswith("[11] Mr. Ipeelee was detained until his warrant\n"
                             "expiry date for the 1999 sexual assault causing")
    assert pages[2].startswith("bodily harm. His LTSO came into effect on March")


def test_bracket_markers_align_on_odd_and_even_pages(ipeelee):
    words, _ = pdf_layout.arrange(copy(ipeelee))
    markers = {w["text"]: w["indent"] for w in words if w["leading"] and w["text"] in
               ("[11]", "[12]", "[15]")}
    assert markers == {"[11]": 0, "[12]": 0, "[15]": 0}


def test_margin_paragraph_numbers_stay_with_the_kept_column(haida):
    for lang in ("en", "fr"):
        words, _ = pdf_layout.arrange(copy(haida), lang=lang)
        margin = [w["text"] for w in words if w["indent"] == pdf_layout.MARGIN_INDENT]
        assert margin == ["20", "21", "22", "23", "24", "25", "26", "27", "28"]


def test_single_column_judgment_is_untouched():
    words = pdf_layout.read_words(BOCKHOLD, 1, 3)
    before = copy(words)
    arranged, layout = pdf_layout.arrange(words)
    assert layout == "single"
    assert texts(arranged) == texts(before)
    assert all(w["indent"] == w["x0"] for w in arranged)
    assert not pdf_layout.is_bilingual(BOCKHOLD)


def test_columns_off_keeps_every_word(ipeelee):
    words, layout = pdf_layout.arrange(copy(ipeelee), columns="off")
    assert layout == "single" and len(words) == len(ipeelee)


def test_synthetic_page_soft_hyphen_wrap_joins(synthetic):
    words, layout = pdf_layout.arrange(synthetic)
    assert layout == "bilingual"
    pdf_layout.join_wraps(words)
    split = next(i for i, w in enumerate(words) if w["text"].startswith("Wil"))
    assert words[split]["text"] == "Wil­ber­"
    assert words[split]["joined"] == "Wilberforce"
    assert words[split + 1]["text"] == "force" and words[split + 1]["cont"]
    assert "Example" not in texts(words)


def test_join_wraps_hard_hyphen_needs_a_lowercase_continuation():
    words = pdf_layout.tag_lines([
        {"page": 1, "text": "con-", "top": 10.0}, {"page": 1, "text": "tinued", "top": 22.0},
        {"page": 1, "text": "Mi-", "top": 34.0}, {"page": 1, "text": "Kmaq", "top": 46.0},
        {"page": 1, "text": "dé-", "top": 58.0}, {"page": 1, "text": "pôt", "top": 70.0},
    ])
    pdf_layout.join_wraps(words)
    assert words[0]["joined"] == "continued" and words[1]["cont"]
    assert "joined" not in words[2] and "cont" not in words[3]
    assert words[4]["joined"] == "dépôt"


def test_language_needs_a_clear_majority():
    def run(text):
        return [{"text": t} for t in text.split()]
    assert pdf_layout.language(run("the court held that the duty of care was owed by the "
                                   "defendant to the plaintiff in this case")) == "en"
    assert pdf_layout.language(run("la cour a conclu que le défendeur est tenu de payer les "
                                   "dépens dans cette affaire pour le demandeur")) == "fr"
    assert pdf_layout.language(run("Smith v. Jones, 2001 SCC 79, [2001] 3 S.C.R. 537")) is None
