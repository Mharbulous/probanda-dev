"""docx_helpers.emphasis_runs, the one markdown inline-emphasis parser of /publish's .docx writers,
and publish-general's use of it (spec 2026-11-26, docx conversion keeps italics).

Run: python -m pytest source/skills/publish/tests/test_emphasis_runs.py -q
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

import support  # noqa: F401  (puts publish/scripts and publish-general/scripts on sys.path)
import fill_general
from docx_helpers import emphasis_runs
from support import W

WN = "{%s}" % W


@pytest.mark.parametrize("text, runs", [
    ("See *Alpha v Beta*.", [("See ", False, False), ("Alpha v Beta", False, True), (".", False, False)]),
    ("See _Alpha v Beta_.", [("See ", False, False), ("Alpha v Beta", False, True), (".", False, False)]),
    ("A **bold** word", [("A ", False, False), ("bold", True, False), (" word", False, False)]),
    ("***Both***", [("Both", True, True)]),
    ("**Bold *and italic***", [("Bold ", True, False), ("and italic", True, True)]),
    # An _ inside a word, beside another _, or with no partner prints as itself.
    ("file_name and ____ and _open", [("file_name and ____ and _open", False, False)]),
    # So does a * with no partner, and one with a space after it.
    ("5*3 and 2 * 4", [("5*3 and 2 * 4", False, False)]),
    ("**never closed", [("**never closed", False, False)]),
    ("a *b* *c", [("a ", False, False), ("b", False, True), (" *c", False, False)]),
    # A backslash makes a marker literal.
    (r"a \*b\* c", [("a *b* c", False, False)]),
    ("", []),
])
def test_emphasis_runs(text, runs):
    assert emphasis_runs(text) == runs


def runs_of(paragraph_xml: str) -> list[tuple[str, bool, bool, bool]]:
    """(text, bold, italic, underlined) for each text run of one <w:p> built by fill_general."""
    p = ET.fromstring('<w:root xmlns:w="%s">%s</w:root>' % (W, paragraph_xml))
    out = []
    for r in p.iter(WN + "r"):
        text = "".join(t.text or "" for t in r.iter(WN + "t"))
        if text:
            rpr = r.find(WN + "rPr")
            out.append((text,) + tuple(rpr is not None and rpr.find(WN + tag) is not None
                                       for tag in ("b", "i", "u")))
    return out


FACE = """# Report on *Alpha v Beta*

## Why *Gamma v Delta* applies

The court in *Alpha v Beta* and _Epsilon_ held it, ***firmly***, and __plainly__.

- The first point, from *Zeta v Eta*.

```
Verbatim *asterisks* stay.
```

> *Gamma v Delta*, 2020 BCCA 1, para 4
"""


@pytest.fixture(scope="module")
def blocks():
    return {text: xml for block in fill_general.filed_blocks(FACE, "face")
            for xml, text in fill_general.block_paragraphs(block)}


@pytest.mark.parametrize("line, italic", [
    ("Report on *Alpha v Beta*", "Alpha v Beta"),
    ("Why *Gamma v Delta* applies", "Gamma v Delta"),
    ("- The first point, from *Zeta v Eta*.", "Zeta v Eta"),
    ("*Gamma v Delta*, 2020 BCCA 1, para 4", "Gamma v Delta"),
])
def test_italics_in_titles_headings_list_items_and_citations(blocks, line, italic):
    runs = runs_of(blocks[line])
    assert any(text == italic and i for text, _, i, _ in runs)
    assert "*" not in "".join(text for text, *_ in runs)


def test_a_paragraph_keeps_italic_bold_italic_and_underline(blocks):
    runs = runs_of(blocks["The court in *Alpha v Beta* and _Epsilon_ held it, ***firmly***, and __plainly__."])
    assert ("Alpha v Beta", False, True, False) in runs
    assert ("Epsilon", False, True, False) in runs
    assert ("firmly", True, True, False) in runs
    assert ("plainly", False, False, True) in runs
    assert not any(c in "".join(text for text, *_ in runs) for c in "*_")


def test_a_fenced_excerpt_keeps_its_asterisks(blocks):
    assert runs_of(blocks["Verbatim *asterisks* stay."]) == [("Verbatim *asterisks* stay.", False, False, False)]
