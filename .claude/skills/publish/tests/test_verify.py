"""Placeholder detection tests for scripts/verify.py.

The verifier used to read the document through pandoc's plain-text renderer,
which wraps a table cell to its column width.  A placeholder in a narrow
column came back split across a newline and a run of padding spaces, blew past
PLACEHOLDER_RX's 40-character limit, and was reported as OK -- every Form 62
and Form 63 Claimed/Allowed token was invisible.  These tests pin the OOXML
reader that replaced it.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from verify import check_filled, docx_text  # noqa: E402

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.'
    'openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
    'relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats'
    '.org/officeDocument/2006/relationships/officeDocument" Target="word/'
    'document.xml"/></Relationships>'
)

# A wide description column beside a 600-twip one: the proportions pandoc used
# to wrap.  The narrow cell's token is also split across two runs, the other
# way OOXML hides a placeholder from a naive reader.
DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/'
    '2006/main"><w:body><w:tbl>'
    '<w:tblGrid><w:gridCol w:w="9000"/><w:gridCol w:w="600"/></w:tblGrid>'
    '<w:tr>'
    '<w:tc><w:p><w:r><w:t>A description wide enough to leave the second '
    'column almost no room at all</w:t></w:r></w:p></w:tc>'
    '<w:tc><w:p><w:r><w:t xml:space="preserve">[NARROW </w:t></w:r>'
    '<w:r><w:t>COLUMN TOKEN]</w:t></w:r></w:p></w:tc>'
    '</w:tr>'
    '<w:tr>'
    '<w:tc><w:p><w:r><w:t>Date of assessment</w:t></w:r></w:p></w:tc>'
    '<w:tc><w:p><w:r><w:t>[dd/mmm/yyyy]</w:t></w:r></w:p></w:tc>'
    '</w:tr>'
    '</w:tbl></w:body></w:document>'
)


def _write_docx(path: Path) -> Path:
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('word/document.xml', DOCUMENT)
    return path


def test_narrow_column_placeholder_is_flagged(tmp_path):
    warns = check_filled(docx_text(_write_docx(tmp_path / 'narrow.docx')))
    assert warns == ["residual placeholder '[NARROW COLUMN TOKEN]'"]


def test_paragraph_text_is_not_wrapped(tmp_path):
    text = docx_text(_write_docx(tmp_path / 'narrow.docx'))
    assert '[NARROW COLUMN TOKEN]' in text
    # One line per paragraph -- the token never straddles a line break.
    assert not any(line.count('[') != line.count(']') for line in text.splitlines())


# A law-report year and a bracketed alteration in a quoted authority are body
# text, not template tokens. With the template's own vocabulary only that
# vocabulary is checked; without one the CLI's behaviour is unchanged.
AUTHORITY_TEXT = (
    'Bankes v. Jarvis, [1903] 1 K.B. 549\n'
    'The applicant proposes that the matter will be heard on [proposed hearing].\n'
    'Address for service: [FIRM ADDRESS]'
)


def test_vocabulary_flags_only_template_tokens():
    vocabulary = {'[proposed hearing]', '[FIRM ADDRESS]'}
    assert check_filled(AUTHORITY_TEXT, vocabulary) == [
        "residual placeholder '[FIRM ADDRESS]'"]


def test_without_vocabulary_every_bracket_is_checked():
    assert check_filled(AUTHORITY_TEXT) == [
        "residual placeholder '[1903]'", "residual placeholder '[FIRM ADDRESS]'"]
