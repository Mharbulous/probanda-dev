"""Regression tests for scripts/diff_excerpt.py.

Runs the script as a subprocess, the way a skill session runs it, so the exit codes
and the JSON on stdout are tested exactly as callers see them.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_DIR / "scripts" / "diff_excerpt.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

SOURCE_MD = FIXTURES / "source.md"
EXCERPT_WRAPPED = FIXTURES / "excerpt_wrapped.txt"
EXCERPT_PARAPHRASE = FIXTURES / "excerpt_paraphrase.txt"

PDF_PAGE_ONE = [
    "The chambers judge began by setting out the procedural history",
    "of the dispute and the narrow question the parties had agreed",
    "to place before the court.",
    "",
    "A party who seeks to rely on a limitation defence must raise it",
    "in a pleading, and must do so with enough particu-",
    "lars that the opposing party can meet it. The court will not",
    "infer the defence from silence.",
]
PDF_PAGE_TWO = [
    "Where the pleading is deficient, the ordinary remedy is an",
    'amendment on terms - not the striking of the claim, and not a',
    '"deemed admission" of the underlying facts.',
    "",
    "Applying that principle to the record before him, the judge",
    "concluded that the defence had been pleaded adequately and",
    "dismissed the application with costs in the cause.",
]


def run(excerpt_path, source_path, env=None, extra=()):
    """Return (returncode, parsed stdout JSON or None, stderr text)."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT),
         "--excerpt-file", str(excerpt_path),
         "--source", str(source_path), *extra],
        capture_output=True, text=True, encoding="utf-8", env=env,
    )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        payload = None
    return proc.returncode, payload, proc.stderr


def without_pypdf(tmp_path):
    """Return an environment in which `import pypdf` fails, forcing the PyMuPDF path."""
    return without(tmp_path, "pypdf")


def without(tmp_path, *modules):
    """Return an environment in which importing each named module fails."""
    shadows = tmp_path / ("no_" + "_".join(modules))
    for module in modules:
        shadow = shadows / module
        shadow.mkdir(parents=True)
        (shadow / "__init__.py").write_text(
            'raise ImportError("{} blocked by test")\n'.format(module))
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (str(shadows), env.get("PYTHONPATH")) if p)
    return env


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_wrapped_excerpt_matches_markdown_source():
    rc, payload, _ = run(EXCERPT_WRAPPED, SOURCE_MD)
    assert rc == 0
    assert payload["identical"] is True
    assert payload["ratio"] == 1.0
    assert payload["opcodes"] == []
    assert payload["page_first"] is None
    assert payload["page_last"] is None


@pytest.mark.parametrize("reader", ["default", "pymupdf"])
def test_wrapped_excerpt_matches_two_page_pdf(tmp_path, reader):
    fitz = pytest.importorskip("pymupdf")
    doc = fitz.open()
    for lines in (PDF_PAGE_ONE, PDF_PAGE_TWO):
        page = doc.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line, fontsize=11)
            y += 16
    pdf_path = tmp_path / "reasons.pdf"
    doc.save(str(pdf_path))
    doc.close()

    env = without_pypdf(tmp_path) if reader == "pymupdf" else None
    rc, payload, _ = run(EXCERPT_WRAPPED, pdf_path, env=env)
    assert rc == 0
    assert payload["identical"] is True
    assert payload["page_first"] == 1
    assert payload["page_last"] == 2


def test_paraphrase_is_not_identical():
    rc, payload, _ = run(EXCERPT_PARAPHRASE, SOURCE_MD)
    assert rc in (1, 2)
    assert payload["identical"] is False
    assert payload["ratio"] < 0.9


def test_dropped_comma_yields_one_replace_opcode(tmp_path):
    text = EXCERPT_WRAPPED.read_text(encoding="utf-8").replace("ing, and", "ing and", 1)
    excerpt = write(tmp_path, "excerpt_no_comma.txt", text)

    rc, payload, stderr = run(excerpt, SOURCE_MD)
    assert rc == 1
    assert payload["identical"] is False
    assert len(payload["opcodes"]) == 1
    assert payload["opcodes"][0]["op"] == "replace"
    assert payload["opcodes"][0]["ours"] == "pleading"
    assert payload["opcodes"][0]["source"] == "pleading,"
    assert stderr.strip()


# Issue #1091: a last word that differs only by trailing punctuation was reported as a
# missing word, because a window one word short scored higher than the full window.
# Issue #1088: a quote may stop before punctuation the source carries at its edge; that
# is verbatim, and the dropped mark is recorded in edge_punctuation.
@pytest.mark.parametrize("source_text, excerpt_text, ours, theirs", [
    ("The parties relied on terms which have not been agreed upon or are not "
     "reasonably implied in these circumstances. The next sentence begins here.",
     "The parties relied on terms which have not been agreed upon or are not "
     "reasonably implied in these circumstances",
     "circumstances", "circumstances."),
    ("The obligation to account arises at the outset and continues onward. "
     "A later paragraph deals with costs.",
     "The obligation to account arises at the outset and continues onward",
     "onward", "onward."),
    # Issue #1095: a non-ASCII ellipsis was not treated as edge punctuation.
    ("The parties relied on terms which have not been agreed upon or are not "
     "reasonably implied in these circumstances… The next sentence begins here.",
     "The parties relied on terms which have not been agreed upon or are not "
     "reasonably implied in these circumstances",
     "circumstances", "circumstances..."),
])
def test_quote_stopping_before_source_punctuation_is_identical(
        tmp_path, source_text, excerpt_text, ours, theirs):
    source = write(tmp_path, "judgment.md", source_text)
    excerpt = write(tmp_path, "excerpt.txt", excerpt_text)

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["opcodes"] == []
    assert payload["edge_punctuation"] == [{"edge": "end", "ours": ours, "source": theirs}]
    assert payload["source_window"].endswith(" " + theirs)


@pytest.mark.parametrize("source_text, excerpt_text, edge, ours, theirs", [
    ('The court said ("the parties are bound by the terms they agreed upon and no '
     'others") and moved on.',
     "the parties are bound by the terms they agreed upon",
     "start", "the", '("the'),
    ("The defence was, in the court's words, pleaded with enough particulars; the "
     "application failed.",
     "The defence was, in the court's words, pleaded with enough particulars",
     "end", "particulars", "particulars;"),
    ('The judge rejected any "deemed admission." of the facts pleaded by the party.',
     'The judge rejected any "deemed admission',
     "end", "admission", 'admission."'),
])
def test_quote_may_drop_allowed_edge_marks(tmp_path, source_text, excerpt_text, edge,
                                            ours, theirs):
    source = write(tmp_path, "judgment.md", source_text)
    excerpt = write(tmp_path, "excerpt.txt", excerpt_text)

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["edge_punctuation"] == [{"edge": edge, "ours": ours, "source": theirs}]


@pytest.mark.parametrize("source_text, excerpt_text", [
    # The excerpt changes the source's mark rather than dropping it.
    ("reasonably implied in these circumstances. The next sentence begins here.",
     "reasonably implied in these circumstances,"),
    # A dropped question mark turns the court's question into a statement.
    ("The question is whether the defendant is liable in damages? The court says no.",
     "The question is whether the defendant is liable in damages"),
    # A trailing apostrophe is a possessive, not a closing quotation mark.
    ("The court construed the parties' agreement as a whole.",
     "The court construed the parties"),
])
def test_other_edge_punctuation_differences_remain_differences(tmp_path, source_text,
                                                               excerpt_text):
    source = write(tmp_path, "judgment.md", source_text)
    excerpt = write(tmp_path, "excerpt.txt", excerpt_text)

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["edge_punctuation"] == []
    assert [op["op"] for op in payload["opcodes"]] == ["replace"]


def test_short_quote_may_drop_marks_at_both_edges(tmp_path):
    source = write(tmp_path, "judgment.md", "The rule applies (inter alia) to costs.")
    excerpt = write(tmp_path, "excerpt.txt", "inter alia")

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["edge_punctuation"] == [
        {"edge": "start", "ours": "inter", "source": "(inter"},
        {"edge": "end", "ours": "alia", "source": "alia)"}]


def test_short_marked_part_stopping_before_source_punctuation_is_found(tmp_path):
    source = write(tmp_path, "judgment.md",
                   "The court held that the parties were bound in these circumstances.")
    excerpt = write(tmp_path, "excerpt.txt",
                    "The court held that the parties [...] circumstances")

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["opcodes"] == []
    assert payload["edge_punctuation"] == [
        {"edge": "end", "ours": "circumstances", "source": "circumstances.", "part": 1}]


def test_long_quote_stopping_before_source_punctuation_is_identical(tmp_path):
    source = write(tmp_path, "judgment.md", "\n\n".join([FILLER, PARA_48, FILLER]))
    excerpt = write(tmp_path, "excerpt.txt", PARA_48.rstrip("."))

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["stitching"] is None
    assert payload["edge_punctuation"] == [
        {"edge": "end", "ours": "trial", "source": "trial."}]


def test_mid_sentence_quote_is_identical_with_no_edge_punctuation(tmp_path):
    source = write(tmp_path, "judgment.md",
                   "The parties are bound by terms which they agreed upon.")
    excerpt = write(tmp_path, "excerpt.txt", "The parties are bound by terms which")

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["edge_punctuation"] == []


def test_excerpt_with_its_full_stop_is_identical(tmp_path):
    text = ("reasonably implied in these circumstances. "
            "The next sentence begins here.")
    source = write(tmp_path, "judgment.md", text)
    excerpt = write(tmp_path, "excerpt.txt", text.split(" The next")[0])

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["identical"] is True


def test_unrelated_text_is_not_found(tmp_path):
    excerpt = write(
        tmp_path, "unrelated.txt",
        "The tribunal set the hearing down for three days in the autumn sittings "
        "and directed the registrar to circulate a revised timetable to counsel.",
    )
    rc, payload, stderr = run(excerpt, SOURCE_MD)
    assert rc == 2
    assert payload["identical"] is False
    assert payload["ratio"] < 0.6
    assert "not found" in stderr


def test_curly_quotes_and_em_dash_normalise_to_straight(tmp_path):
    text = EXCERPT_WRAPPED.read_text(encoding="utf-8")
    text = text.replace('"deemed', "\u201cdeemed").replace('admission"', "admission\u201d")
    text = text.replace(" - ", " \u2014 ")
    excerpt = write(tmp_path, "excerpt_curly.txt", text)

    rc, payload, _ = run(excerpt, SOURCE_MD)
    assert rc == 0
    assert payload["identical"] is True


def test_missing_source_pdf_is_a_read_error(tmp_path):
    rc, payload, stderr = run(EXCERPT_WRAPPED, tmp_path / "absent.pdf")
    assert rc == 3
    assert payload is None
    assert "error:" in stderr


def test_missing_source_pdf_is_a_read_error_under_pymupdf(tmp_path):
    pytest.importorskip("pymupdf")
    rc, payload, stderr = run(
        EXCERPT_WRAPPED, tmp_path / "absent.pdf", env=without_pypdf(tmp_path))
    assert rc == 3
    assert payload is None
    assert "error:" in stderr
    assert "Traceback" not in stderr


@pytest.mark.parametrize("reader", ["pypdf", "pymupdf"])
def test_corrupt_source_pdf_is_a_read_error(tmp_path, reader):
    pytest.importorskip(reader)
    corrupt = write(tmp_path, "corrupt.pdf", "not a pdf")
    env = without_pypdf(tmp_path) if reader == "pymupdf" else None
    rc, payload, stderr = run(EXCERPT_WRAPPED, corrupt, env=env)
    assert rc == 3
    assert payload is None
    assert "error:" in stderr
    assert "Traceback" not in stderr


# A judgment in which the passage quoted from paras 41, 47 and 48 has a textually
# similar decoy at para 5 (issue #984: a stitched excerpt was reported "found" at
# the decoy).
PARA_41 = (
    "I find that three of the plaintiff's claims - the consultant fees claim, and "
    "the two loan claims - are not inextricably interwoven with the defendant's "
    "counterclaim."
)
PARA_47 = (
    "Taking account of the relevant considerations, I find these three claims - the "
    "Consultancy Agreement claim, and the October 2020 Loan and December 2021 Loan "
    "claims - suitable for summary trial."
)
PARA_48 = (
    "However, unlike the consultancy claim and loan claims, I find the plaintiffs' "
    "claims for project management fees is inextricably interwoven with the "
    "counterclaim based on the pleadings and evidence before me. I find the project "
    "management fees claim to be unsuitable for summary trial."
)
DECOY = (
    "The defendant says that three of the plaintiff's claims - the consultant fees "
    "claim, and the two loan claims - are inextricably interwoven with its "
    "counterclaim. It says these three claims - the Consultancy Agreement claim, and "
    "the October 2020 Loan and December 2021 Loan claims - are not suitable for "
    "summary trial. It says the plaintiffs' claims for project management fees are "
    "also interwoven with the counterclaim on the pleadings and evidence, and the "
    "project management fees claim is unsuitable for summary trial."
)
FILLER = (
    "The chambers judge reviewed the affidavits filed by each side and the "
    "correspondence exchanged between counsel before the hearing began."
)
STITCHED_SOURCE = "\n\n".join(
    [FILLER] * 4 + [DECOY] + [FILLER] * 6 + [PARA_41] + [FILLER] * 15 + [PARA_47]
    + [FILLER] * 2 + [PARA_48] + [FILLER] * 3
)


def _decoy_absent(payload):
    windows = [payload["source_window"]] + [
        part["source_window"] for part in payload["parts"] or []
    ]
    return not any("It says" in window or "defendant says" in window
                   for window in windows)


def test_unmarked_stitch_is_located_by_part_and_flagged(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(tmp_path, "excerpt.txt", " ".join([PARA_41, PARA_47, PARA_48]))

    rc, payload, stderr = run(excerpt, source)
    assert rc == 1
    assert payload["identical"] is False
    assert payload["stitching"] == "unmarked"
    assert [part["identical"] for part in payload["parts"]] == [True, True, True]
    assert [op["op"] for op in payload["opcodes"]] == ["omission_unmarked"] * 2
    assert _decoy_absent(payload)
    assert stderr.strip()


def test_marked_stitch_in_source_order_is_identical(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    for marker in ("[...]", "[…]"):
        text = (" " + marker + " ").join([PARA_41, PARA_47, PARA_48])
        excerpt = write(tmp_path, "excerpt.txt", text)
        rc, payload, _ = run(excerpt, source)
        assert rc == 0
        assert payload["identical"] is True
        assert payload["stitching"] == "marked"
        assert len(payload["parts"]) == 3
        assert payload["opcodes"] == []
        assert _decoy_absent(payload)


def test_marked_part_stopping_before_source_punctuation_is_identical(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(tmp_path, "excerpt.txt",
                    PARA_41.rstrip(".") + " [...] " + PARA_47)

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["stitching"] == "marked"
    assert payload["opcodes"] == []
    edge = {"edge": "end", "ours": "counterclaim", "source": "counterclaim."}
    assert payload["edge_punctuation"] == [dict(edge, part=0)]
    assert payload["parts"][0]["edge_punctuation"] == [edge]
    assert payload["parts"][1]["edge_punctuation"] == []


def test_marked_stitch_out_of_order_is_a_difference(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(tmp_path, "excerpt.txt", PARA_48 + " [...] " + PARA_41)

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["identical"] is False
    assert [part["identical"] for part in payload["parts"]] == [True, True]
    assert [op["op"] for op in payload["opcodes"]] == ["order"]


def test_unmarked_omission_inside_a_marked_part_is_flagged(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(tmp_path, "excerpt.txt",
                    PARA_41 + " [...] " + PARA_47 + " " + PARA_48)

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["stitching"] == "marked"
    assert [op["op"] for op in payload["opcodes"]] == ["omission_unmarked"]
    assert _decoy_absent(payload)


def test_unmarked_stitch_with_a_changed_word_never_reports_the_decoy(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    changed = PARA_48.replace("inextricably", "closely")
    excerpt = write(tmp_path, "excerpt.txt", " ".join([PARA_41, PARA_47, changed]))

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["identical"] is False
    assert payload["stitching"] == "unmarked"
    assert "unmatched" in [op["op"] for op in payload["opcodes"]]
    assert _decoy_absent(payload)


def test_marked_part_not_in_source_is_reported_beside_the_found_part(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(
        tmp_path, "excerpt.txt",
        PARA_41 + " [...] The registrar will circulate a revised timetable to "
        "counsel for the autumn sittings.",
    )

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["stitching"] == "marked"
    assert payload["parts"][0]["identical"] is True
    assert payload["parts"][1]["ratio"] < 0.6
    assert [op["op"] for op in payload["opcodes"]] == ["not_found"]


def test_contiguous_result_carries_no_stitching():
    rc, payload, _ = run(EXCERPT_WRAPPED, SOURCE_MD)
    assert rc == 0
    assert payload["stitching"] is None
    assert payload["parts"] is None


def test_restated_clause_does_not_split_a_contiguous_quote(tmp_path):
    clause = "the claims are not inextricably interwoven with the counterclaim and"
    source = write(tmp_path, "judgment.md", "\n\n".join(
        [FILLER] * 3 + ["Counsel submitted that " + clause + " nothing more."]
        + [FILLER] * 5
        + ["I accept that " + clause + " so are suitable for determination by way "
           "of summary trial under the rule."] + [FILLER] * 2))
    excerpt = write(tmp_path, "excerpt.txt",
                    clause + " thus are suitable for determination by way of "
                    "summary trial under the rule.")

    rc, payload, _ = run(excerpt, source)
    assert rc == 1
    assert payload["stitching"] is None
    assert [(op["op"], op["ours"], op["source"]) for op in payload["opcodes"]] == [
        ("replace", "thus", "so")]


def test_leading_and_trailing_markers_are_truncation(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(tmp_path, "excerpt.txt", "[...] " + PARA_47 + " [...]")

    rc, payload, _ = run(excerpt, source)
    assert rc == 0
    assert payload["stitching"] is None


def test_marked_excerpt_with_no_part_found_is_not_found(tmp_path):
    source = write(tmp_path, "judgment.md", STITCHED_SOURCE)
    excerpt = write(
        tmp_path, "excerpt.txt",
        "The registrar will circulate a revised timetable to counsel. [...] "
        "The appeal book is due within thirty days of the order.",
    )

    rc, payload, stderr = run(excerpt, source)
    assert rc == 2
    assert [op["op"] for op in payload["opcodes"]] == ["not_found", "not_found"]
    assert payload["source_window"]
    assert "not found" in stderr


# Bilingual law reports (shared/scripts/pdf_layout.py). The S.C.R. fixtures and the
# excerpts cut from them live in shared/tests/fixtures; see the README there.
SHARED_TESTS = SKILL_DIR.parent / "shared" / "tests"
SCR = SHARED_TESTS / "fixtures"
IPEELEE = SCR / "scr-2012-1-433-ipeelee-pp14-16.pdf"
sys.path.insert(0, str(SHARED_TESTS))
import bilingual_sample  # noqa: E402


def test_english_paragraph_across_a_bilingual_page_break_is_verbatim():
    rc, payload, _ = run(SCR / "ipeelee-para11-en.txt", IPEELEE)
    assert rc == 0, payload
    assert payload["layout"] == "bilingual" and payload["lang"] == "en"
    assert (payload["page_first"], payload["page_last"]) == (1, 2)


def test_columns_off_reads_the_interleaved_text_as_before():
    rc, payload, _ = run(SCR / "ipeelee-para11-en.txt", IPEELEE, extra=("--columns", "off"))
    assert rc == 1
    assert payload["layout"] == "single"
    assert [op["op"] for op in payload["opcodes"]] == ["omission_unmarked"]


def test_english_paragraph_on_one_bilingual_page_is_verbatim():
    rc, payload, _ = run(SCR / "ipeelee-para12-en.txt", IPEELEE)
    assert rc == 0
    assert (payload["page_first"], payload["page_last"]) == (2, 2)


def test_french_paragraph_needs_lang_fr():
    rc, payload, _ = run(SCR / "ipeelee-para12-fr.txt", IPEELEE, extra=("--lang", "fr"))
    assert rc == 0, payload["opcodes"]
    assert payload["layout"] == "bilingual" and payload["lang"] == "fr"
    rc, payload, _ = run(SCR / "ipeelee-para12-fr.txt", IPEELEE)
    assert rc == 2


def test_soft_hyphen_wrap_in_source_and_excerpt(tmp_path):
    source = bilingual_sample.build(tmp_path / "sample.pdf")
    for text in ("as stated per Lord Wilberforce in the leading decision",
                 "as stated per Lord Wil\u00adber\u00adforce in the leading decision",
                 "as stated per Lord Wil\u00ad\nber\u00ad force in the leading decision"):
        excerpt = write(tmp_path, "excerpt.txt", text)
        rc, payload, _ = run(excerpt, source)
        assert rc == 0, (text, payload["opcodes"])
        assert payload["layout"] == "bilingual"


def test_without_pdfplumber_the_layout_is_plain(tmp_path):
    env = without(tmp_path, "pdfplumber")
    rc, payload, _ = run(SCR / "ipeelee-para12-en.txt", IPEELEE, env=env)
    assert rc == 0
    assert payload["layout"] == "plain"


def test_pymupdf_soft_hyphens_are_normalised(tmp_path):
    """PyMuPDF reads this report's line-end hyphens as U+00AD ("compor\xad tement")."""
    pytest.importorskip("pymupdf")
    env = without(tmp_path, "pdfplumber", "pypdf")
    rc, payload, _ = run(SCR / "ipeelee-para12-fr.txt", IPEELEE, env=env,
                         extra=("--lang", "fr"))
    assert payload["layout"] == "plain"
    assert not any("\u00ad" in op["source"] for op in payload["opcodes"])
    assert rc == 0, payload["opcodes"]


def test_non_pdf_source_has_no_layout():
    rc, payload, _ = run(EXCERPT_WRAPPED, SOURCE_MD)
    assert rc == 0
    assert payload["layout"] is None and payload["lang"] == "en"


def test_ligatures_are_spelled_out(tmp_path):
    source = write(tmp_path, "source.md", "The \ufb01nding of \ufb02agrant breach was af\ufb01rmed.")
    excerpt = write(tmp_path, "excerpt.txt", "The finding of flagrant breach was affirmed.")
    rc, _, _ = run(excerpt, source)
    assert rc == 0
