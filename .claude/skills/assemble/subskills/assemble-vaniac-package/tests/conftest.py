"""Shared fixtures: a package published from publish-vaniac-package's own
filed-render fixtures, and a stand-in for Word that draws each paragraph of
a .docx as a line of PDF text, so no Word install is needed."""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

import fitz
import pytest
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import bind_package  # noqa: E402,F401  (puts fill_vaniac and paginate_book on sys.path)
import fill_vaniac  # noqa: E402

PUBLISH_FIXTURES = (Path(__file__).resolve().parents[4] / 'publish' / 'subskills' / 'publish-vaniac-package'
                    / 'tests' / 'fixtures')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
LINES_PER_PAGE = 30


def pdf(path: Path, lines: list[str]) -> Path:
    doc = fitz.open()
    for text in lines:
        doc.new_page(width=612, height=792).insert_text((72, 400), text, fontsize=14)
    doc.save(path)
    return path


def fake_convert(docx: Path, out: Path) -> Path:
    with zipfile.ZipFile(docx) as z:
        root = etree.fromstring(z.read('word/document.xml'))
    lines = [''.join(t.text or '' for t in p.iter(f'{W}t')) for p in root.iter(f'{W}p')]
    doc = fitz.open()
    for i, line in enumerate(lines or ['']):
        if i % LINES_PER_PAGE == 0:
            page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100 + 20 * (i % LINES_PER_PAGE)), line[:90], fontsize=10)
    doc.save(out)
    return out


@pytest.fixture
def published(tmp_path: Path) -> dict:
    """A SUB folder holding Package\\ and a case-data folder holding the source
    files and package index, as publish-vaniac-package leaves them, and a
    matter root holding the exhibit sources the Source trace names."""
    sub = tmp_path / 'matter' / '0. DRAFT' / 'SUB Claimant Opening Submissions'
    source = tmp_path / '0. CASE DATA' / 'matter' / 'vaniac-submissions' / 'Claimant Opening Submissions'
    shutil.copytree(PUBLISH_FIXTURES, source)
    package = sub / 'Package'
    index_json = source / 'Package index.json'
    fill_vaniac.fill(source, package, 'opening', index_json, ['A. Renwick'])
    matter = tmp_path / 'matter'
    docs = matter / '3. DISCLOSURE'
    docs.mkdir()
    pdf(docs / 'Agreement.pdf', [f'AGREEMENT-P{k}' for k in range(1, 13)])
    pdf(docs / 'Notice.pdf', ['NOTICE-P1', 'NOTICE-P2'])
    pdf(docs / 'Log.pdf', ['LOG-P1'])
    image = docs / 'Photo.png'
    fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), False).save(image)
    trace = sub / 'Evidence Index.md'
    trace.write_text(
        '| Ex. | Date | Description | Tendered by |\n| --- | --- | --- | --- |\n'
        '| Ex. 1 | 2023-12-01 | The signed agreement | | <!-- document_id 1 -->\n\n'
        '## Source trace\n\n'
        '- Ex. 1 — 3. DISCLOSURE\\Agreement.pdf (PDF pp. 3–5) <!-- document_id 1 -->\n'
        '- Ex. 2 — 3. DISCLOSURE\\Notice.pdf <!-- document_id 2 -->\n'
        '- Ex. 3 — 3. DISCLOSURE\\Photo.png <!-- document_id 7 -->\n'
        f'- Ex. 4 — {docs / "Log.pdf"}, PDF pp. 1-1 <!-- document_id 9 -->\n',
        encoding='utf-8')
    return {'matter': matter, 'sub': sub, 'package': package, 'trace': trace,
            'index_json': index_json}
