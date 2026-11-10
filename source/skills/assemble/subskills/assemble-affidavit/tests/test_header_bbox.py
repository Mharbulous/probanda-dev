"""The Form 109 header rewrite touches the identifier block and nothing else: --probe's
header_bbox stops short of the court file number and registry below it, and rewrite_header
refuses a bbox that also covers them rather than redacting them (#1376). Pages are built
with PyMuPDF at the positions measured on the /publish Form 109 template, so no Word or
LibreOffice is needed. The last test is an integration test across skills: it fills the real
/publish Form 15 template, converts it, and skips when neither Word nor LibreOffice is
available (#1428)."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / 'scripts'))
import assemble  # noqa: E402

BODY_FONT = str(SKILL / 'assets' / 'fonts' / 'LiberationSans-Regular.ttf')
# (word y0 measured on the template, text), all right-aligned at x 540.
IDENTIFIER = [(72.4, 'This is the 1st affidavit'), (86.2, 'of Jane Doe in this case'),
              (100.0, 'and was made on [DATE]')]
# Right-aligned at 540, this line starts near x 253, left of the old x > 300 cut (#1409).
LONG_IDENTIFIER = [IDENTIFIER[0], (86.2, 'of Maria Guadalupe Fernandez de la Cruz in this case'),
                   IDENTIFIER[2]]
FILE_NUMBER = [(125.8, 'No. S-999999'), (139.6, 'Vancouver')]
DATA = {'affidavit_number': 2, 'affiant_name': 'Jane Doe', 'signing_date': '2026-08-05'}


def page_pdf(path: Path, lines, label: str | None = None, label_y0: float = IDENTIFIER[0][0]
             ) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for y0, text in lines:
        page.insert_text((540 - fitz.get_text_length(text, fontsize=12), y0 + 11), text,
                         fontsize=12)
    if label:  # top left, by default on the "This is the ... affidavit" baseline
        page.insert_text((72, label_y0 + 11), label, fontsize=12)
    page.insert_text((188, 176), 'In the Supreme Court of British Columbia', fontsize=12)
    doc.save(path)
    doc.close()
    return path


def probe(pdf: Path, monkeypatch) -> dict:
    monkeypatch.setattr(assemble, 'convert_docx_to_pdf', lambda docx, out: str(pdf))
    return assemble.probe('unused.docx')


def words_of(doc, text):
    return [w for w in doc[0].get_text('words') if w[4] in text.split() and w[1] < 160]


@pytest.fixture
def form109(tmp_path):
    return page_pdf(tmp_path / 'form109.pdf', IDENTIFIER + FILE_NUMBER)


def test_probe_bbox_stops_above_file_number_and_registry(form109, monkeypatch):
    result = probe(form109, monkeypatch)
    bbox = fitz.Rect(result['header_bbox'])
    doc = fitz.open(form109)
    for w in words_of(doc, 'No. S-999999 Vancouver'):
        assert not fitz.Rect(w[:4]).intersects(bbox), w
    for w in words_of(doc, ' '.join(t for _, t in IDENTIFIER)):
        assert fitz.Rect(w[:4]) in bbox, w
    doc.close()


@pytest.mark.parametrize('identifier', [
    [(72.4, 'Affiant: Jane Doe, No. 1'), (86.2, 'Made: [DATE]')],  # other wording
    IDENTIFIER[:2],  # no "made on" line
])
def test_unrecognised_block_probes_null(identifier, tmp_path, monkeypatch):
    pdf = page_pdf(tmp_path / 'other.pdf', identifier + FILE_NUMBER)
    assert probe(pdf, monkeypatch)['header_bbox'] is None


def test_file_number_below_window_probes_the_same_bbox(form109, tmp_path, monkeypatch):
    lower = page_pdf(tmp_path / 'lower.pdf', IDENTIFIER + [(y + 60, t) for y, t in FILE_NUMBER])
    assert probe(lower, monkeypatch)['header_bbox'] == probe(form109, monkeypatch)['header_bbox']


def test_rewrite_keeps_file_number_and_registry(form109, monkeypatch):
    data = {**DATA, 'header_bbox': probe(form109, monkeypatch)['header_bbox']}
    doc = fitz.open(form109)
    assert assemble.rewrite_header(doc, data, BODY_FONT) == {'success': True}
    text = doc[0].get_text().replace('\xa0', ' ')
    doc.close()
    assert 'No. S-999999' in text and 'Vancouver' in text
    assert 'This is the 2nd affidavit' in text and 'and was made on August 5, 2026' in text
    assert '1st' not in text and '[DATE]' not in text


def test_bbox_over_identifier_and_file_number_is_refused(form109):
    doc = fitz.open(form109)
    before = doc[0].get_text()
    result = assemble.rewrite_header(doc, {**DATA, 'header_bbox': [301, 67, 545, 158]},
                                     BODY_FONT)
    assert result['success'] is False
    assert result['error'] == 'header_bbox_not_identifier_block'
    assert 'S-999999' in result['found_text']
    assert doc[0].get_text() == before
    doc.close()


def top_block_words(doc) -> list[str]:
    return sorted(doc[0].get_text(clip=fitz.Rect(0, 0, 612, 160)).replace('\xa0', ' ').split())


def assert_refused_unchanged(pdf: Path, bbox):
    doc = fitz.open(pdf)
    before = doc[0].get_text()
    result = assemble.rewrite_header(doc, {**DATA, 'header_bbox': bbox}, BODY_FONT)
    assert result['success'] is False
    assert result['error'] == 'header_bbox_not_identifier_block'
    assert doc[0].get_text() == before
    doc.close()


def test_long_affiant_line_is_covered_and_fully_rewritten(tmp_path, monkeypatch):
    pdf = page_pdf(tmp_path / 'long.pdf', LONG_IDENTIFIER + FILE_NUMBER)
    bbox = probe(pdf, monkeypatch)['header_bbox']
    doc = fitz.open(pdf)
    identifier_words = words_of(doc, ' '.join(t for _, t in LONG_IDENTIFIER))
    assert min(w[0] for w in identifier_words) < 300
    for w in identifier_words:
        assert fitz.Rect(w[:4]) in fitz.Rect(bbox), w
    assert assemble.rewrite_header(doc, {**DATA, 'header_bbox': bbox}, BODY_FONT) == {
        'success': True}
    expected = ('This is the 2nd affidavit of Jane Doe in this case '
                'and was made on August 5, 2026 No. S-999999 Vancouver')
    assert top_block_words(doc) == sorted(expected.split())
    doc.close()


@pytest.fixture
def labelled(tmp_path):
    return page_pdf(tmp_path / 'labelled.pdf', IDENTIFIER + FILE_NUMBER, label='FORM 109')


def test_probe_bbox_excludes_label_on_identifier_baseline(labelled, monkeypatch):
    bbox = fitz.Rect(probe(labelled, monkeypatch)['header_bbox'])
    doc = fitz.open(labelled)
    label = [w for w in doc[0].get_text('words') if w[0] < 200 and w[1] < 160]
    assert [w[4] for w in label] == ['FORM', '109']
    for w in label:
        assert not fitz.Rect(w[:4]).intersects(bbox), w
    for w in words_of(doc, ' '.join(t for _, t in IDENTIFIER)):
        assert fitz.Rect(w[:4]) in bbox, w
    doc.close()


def test_bbox_reaching_over_label_is_refused(labelled):
    assert_refused_unchanged(labelled, [60, 67, 545, 119])


def test_probe_bbox_excludes_label_on_its_own_baseline_inside_the_block(tmp_path, monkeypatch):
    pdf = page_pdf(tmp_path / 'between.pdf', IDENTIFIER + FILE_NUMBER, label='FORM 109',
                   label_y0=79.3)  # between identifier lines 1 and 2
    bbox = fitz.Rect(probe(pdf, monkeypatch)['header_bbox'])
    doc = fitz.open(pdf)
    label = [w for w in doc[0].get_text('words') if w[0] < 200 and w[1] < 160]
    assert [w[4] for w in label] == ['FORM', '109']
    for w in label:
        assert not fitz.Rect(w[:4]).intersects(bbox), w
    doc.close()


@pytest.mark.parametrize('cut', ['mid_word', 'between_words'])
def test_bbox_cutting_an_identifier_line_is_refused(cut, form109, monkeypatch):
    x0, y0, x1, y1 = probe(form109, monkeypatch)['header_bbox']
    doc = fitz.open(form109)
    # Identifier line 2's words, whose y0 sits about 2pt above IDENTIFIER[1]'s.
    line = sorted((w for w in doc[0].get_text('words') if 82 < w[1] < 88), key=lambda w: w[0])
    doc.close()
    jane, doe, in_ = line[1], line[2], line[3]
    left = (jane[0] + jane[2]) / 2 if cut == 'mid_word' else (doe[2] + in_[0]) / 2
    assert_refused_unchanged(form109, [left, y0, x1, y1])


def test_service_affidavit_probes_null_and_refuses_a_bbox(tmp_path, monkeypatch):
    form15 = page_pdf(tmp_path / 'form15.pdf', FILE_NUMBER)
    probed = probe(form15, monkeypatch)
    assert probed['header_bbox'] is None
    assert 'affidavit of service' in probed['note']
    doc = fitz.open(form15)
    before = doc[0].get_text()
    result = assemble.rewrite_header(doc, {**DATA, 'header_bbox': [301, 120, 545, 158]},
                                     BODY_FONT)
    assert result['error'] == 'header_bbox_not_identifier_block'
    assert doc[0].get_text() == before
    doc.close()


PUBLISH = SKILL.parents[2] / 'publish' / 'subskills' / 'publish-bcsc-form'
PIPELINE = {'affiant_name': 'Jane Doe', 'affidavit_number': 1, 'jurat_verb': 'AFFIRMED',
            'signing_date': '2026-08-05', 'jurat_bbox': [72, 325, 340, 370], 'exhibits': []}


def service_affidavit_pdf(tmp_path: Path) -> str:
    """A Form 15 page: file number and registry top right, no identifier block, 15/16 jurat."""
    doc = fitz.open(page_pdf(tmp_path / 'top.pdf', FILE_NUMBER))
    for y0, text in [(558.8, 'AFFIRMED BEFORE ME'), (572.6, 'at Vancouver, British Columbia'),
                     (586.4, 'on October 2, 2026.')]:
        doc[0].insert_text((72, y0 + 11), text, fontsize=12)
    path = tmp_path / 'form15.pdf'
    doc.save(path)
    doc.close()
    return str(path)


def test_pipeline_without_header_bbox_key_is_an_error(tmp_path):
    out = tmp_path / 'draft.pdf'
    result = assemble.run_pipeline({**PIPELINE, 'affidavit_pdf': service_affidavit_pdf(tmp_path),
                                    'output_path': str(out)})
    assert result['success'] is False
    assert result['error'] == 'missing_field' and result['field'] == 'header_bbox'
    assert not out.exists()


def test_pipeline_with_null_header_bbox_warns(tmp_path):
    result = assemble.run_pipeline({**PIPELINE, 'affidavit_pdf': service_affidavit_pdf(tmp_path),
                                    'header_bbox': None,
                                    'output_path': str(tmp_path / 'draft.pdf')})
    assert result['success'], result
    assert len([w for w in result['warnings'] if 'header_bbox is null' in w]) == 1


def test_publish_form15_assembles_with_null_header_bbox(tmp_path):
    pytest.importorskip('lxml')
    sys.path.insert(0, str(PUBLISH / 'scripts'))
    import fill_plain
    context = {
        'court_file_number': 'S-999999', 'registry': 'Vancouver',
        'plaintiff_caption': 'JANE DOE', 'plaintiff_role': 'PLAINTIFF',
        'defendant_caption': 'JOHN ROE', 'defendant_role': 'DEFENDANT',
        'deponent_name': 'Jane Doe', 'deponent_address': '1 Main Street, Vancouver, BC',
        'deponent_occupation': 'Legal Assistant',
        'swear_or_affirm': 'affirm', 'sworn_or_affirmed': 'AFFIRMED',
        'affidavit_date': 'October 2, 2026',
        'commissioner_city': 'North Vancouver', 'commissioner_name': 'Pat Smith',
        'person_served': 'John Roe', 'service_date': 'September 28, 2026',
        'service_time': '2:15 p.m.', 'service_city': 'Burnaby, Canada',
        'served_party_type': 'individual', 'identification_method': 'known',
        'identification_detail': 'I have met him on three prior occasions',
        'filed_documents': [{'description': 'Notice of Civil Claim',
                             'stamp_date': 'June 2, 2026'}],
        'unfiled_documents': [], 'sworn_by_video': 'no',
    }
    docx = tmp_path / 'form15.docx'
    fill_plain.fill(PUBLISH / 'templates' / '015-afs.docx', context, '', docx, form='afs')
    probed = assemble.probe(str(docx))
    if probed.get('error') == 'docx_conversion_failed':
        pytest.skip(f"no Word or LibreOffice converter: {probed['detail']}")
    assert probed['header_bbox'] is None, probed
    result = assemble.run_pipeline({**PIPELINE, 'signing_date': '2026-10-05',
                                    'affidavit_pdf': probed['converted_pdf'], 'header_bbox': None,
                                    'output_path': str(tmp_path / 'draft.pdf')})
    assert result['success'], result
    doc = fitz.open(result['output_path'])
    text = ' '.join(page.get_text() for page in doc).replace('\xa0', ' ')
    doc.close()
    assert 'S-999999' in text and 'AFFIDAVIT OF PERSONAL SERVICE' in text
    assert 'This is the' not in text
    assert 'at ______________,' in text and 'British Columbia on October 5, 2026.' in text
    assert 'day of' not in text and 'North Vancouver' not in text
